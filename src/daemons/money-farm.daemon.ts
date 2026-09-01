import type { NS, Server } from '@ns'
import type { Mode, WorkerStatus } from '../ui/utils/money-farm-log/types'
import type { BatchPlan } from '../utils/hack-math'
import { MONEY_FARM_PORT } from '../ports.lib'
import {
  MONEY_FARM_CONFIG_FILE as CONFIG_FILE,
  MONEY_FARM_GROW_SCRIPT as GROW_SCRIPT,
  MONEY_FARM_HACK_SCRIPT as HACK_SCRIPT,
  MONEY_FARM_WEAKEN_SCRIPT as WEAKEN_SCRIPT,
} from '../ui/utils/money-farm-config'
import { addMoneyFarmLog } from '../ui/utils/money-farm-log'
import { BATCH_SPACING, computeBatchPlan, computeHackMath } from '../utils/hack-math'
import { distributeThreads } from '../utils/thread-balance'

/**
 * Background orchestrator for the Money Farm feature (`ui/apps/money-farm/`).
 * Same overall shape as `xp-farm.daemon.ts` (config-file reconciliation,
 * seizing exclusive control of every listed cloud server, self-exit once
 * the list empties) — see that file's header comment for the parts that
 * are identical. What differs: the target metric (money/sec potential, not
 * XP), and what each managed host actually runs, which goes through three
 * stages against whichever target(s) currently hold a session, re-evaluated
 * every `STATE_CHECK_INTERVAL`:
 *
 * 1. **weaken** — target security is more than `SECURITY_EPSILON` above its
 *    minimum: enough weaken threads to close exactly that gap
 *    (`ceil(securityGap / weakenAnalyze(1))`), not the pool's full
 *    capacity — see `applyPrepMode`'s own header comment for why sizing
 *    off capacity instead of actual need turned out to waste most of a
 *    large fleet's dispatched threads.
 * 2. **grow-prep** — security is near minimum but money is below
 *    `PREP_MONEY_RATIO` of max: enough grow threads to close exactly that
 *    money gap (`computeHackMath`'s `growThreadsFor`), plus enough weaken
 *    threads to counteract exactly what that grow dispatch will actually
 *    add to security.
 * 3. **farm** — security near minimum and money near max: a real HWGW
 *    (hack/weaken/grow/weaken) batch pipeline. `computeBatchPlan`
 *    (`utils/hack-math.ts`) sizes one batch (steal `HACK_FRACTION_PER_BATCH`
 *    of the target's max money, plus exactly the grow/weaken threads to
 *    counteract that hack and its own regrowth) and computes each leg's
 *    delay so, dispatched together, they land staggered in the order H,
 *    W1, G, W2, `BATCH_SPACING` ms apart:
 *
 *    ```
 *    delayHack  = weakenTime - hackTime            // lands at weakenTime
 *    delayW1    = BATCH_SPACING                     // lands at weakenTime + 1*SPACING
 *    delayGrow  = weakenTime + 2*SPACING - growTime  // lands at weakenTime + 2*SPACING
 *    delayW2    = 3*BATCH_SPACING                    // lands at weakenTime + 3*SPACING
 *    ```
 *
 *    All four delays are non-negative by construction (`weakenTime` is
 *    always the longest of the three base actions), and `delayHack`
 *    matches `flooder.app.ts`'s own long-standing hack-delay formula. Every
 *    `BATCH_SPACING` ms this daemon tries to dispatch one more batch (as
 *    one-shot `--once` processes — see `hack.daemon.ts`/`grow.daemon.ts`/
 *    `weaken.daemon.ts`) across whichever dedicated hosts currently have
 *    pooled free RAM, until either RAM runs out or `maxConcurrentBatches`
 *    is reached. That cap (see `utils/hack-math.ts`'s `computeBatchPlan`)
 *    folds together two different safety limits: a landing-order cap
 *    (`floor(weakenTime / BATCH_SPACING)`, almost never binding) and a
 *    cumulative-hack-exposure cap (`SAFE_TOTAL_HACK_FRACTION` — found
 *    necessary live: RAM alone let far more batches dispatch than were
 *    safe, and since they all get dispatched within a second or two of
 *    each other, their hack legs land clustered together rather than
 *    smoothly staggered, draining a target's money well below what any
 *    single batch's own compensating grow leg could catch up on).
 *
 * **A chain of target sessions, not a fixed pair.** `maxConcurrentBatches`
 * deliberately caps out around what's *safe* against one target, which in
 * practice is well below what a well-RAM'd fleet of dedicated hosts can
 * actually dispatch — confirmed live even with two fixed sessions
 * (the original Phase 3 shape): both saturated while a large share of
 * pooled RAM still sat idle, because a hard-coded pair has the same small
 * fixed ceiling regardless of fleet size. `sessions[0]` (the root) farms
 * the live-picked best target, same as `primary` always did. Every
 * `STATE_CHECK_INTERVAL` tick, the chain is walked in order — the moment
 * any session's mode isn't `'farm'` after its own tick, every session
 * after* it is torn down (see `killSession`) and the chain is truncated
 * there; the regressed session itself keeps running (it's now legitimately
 * prepping). Only if the walk completes without a regression (every
 * session still farming) and the *tail* is saturated
 * (`inFlightBatches.length >= maxConcurrentBatches`) with pooled free RAM
 * still clearing `MIN_CHAIN_EXTENSION_THREADS` does the chain extend by
 * one more live-picked target (excluding every target already in the
 * chain). No explicit length cap — it self-limits on RAM or on
 * `pickTarget` running out of eligible targets.
 *
 * **Per-session precise kill, never `ns.killall`, once a host is shared.**
 * `ns.killall(host)` is still used exactly twice: seizing a *newly
 * claimed* host (nothing of ours could be running there yet, so wiping
 * everything is safe and matches `xp-farm.daemon.ts`'s identical claim
 * behavior) and releasing a host dropped from the config file (handing it
 * back fully clean). Everywhere else — a session's own mode transitions,
 * desync fallback, prep relaunches — kills only that session's own tracked
 * pids (`ns.exec`'s return value, stored in `PrepAssignment`/
 * `InFlightBatch`), since multiple sessions can now legitimately be
 * running the same three scripts against different targets on the same
 * host at once; a filename-based "foreign process" check (the pre-Phase-3
 * design used one) can no longer tell them apart, so it's been dropped
 * rather than left in as a latent cross-session killer. The tradeoff: a
 * genuinely* foreign process (something outside this daemon's own
 * tracked pids) is no longer auto-evicted mid-cycle the way it used to be
 * — only at claim time.
 *
 * **Pooled, not per-host-independent** (the one deliberate departure from
 * XP Farm's model, for every session in the chain): every stage above
 * computes ONE plan against the sum of every dedicated host's own RAM
 * capacity, then splits each thread category across hosts proportionally
 * (`distributeThreads`) — because, unlike grow/weaken, `hack()` can
 * overshoot a shared target if several hosts each independently decided
 * how much money to take. `applyPrepMode`'s `sizing` parameter governs how
 * a session's prep stage sources that pooled capacity: `'total'` — used
 * only by `sessions[0]`, and only when the *entire* chain has just
 * collapsed down to it (a regression at the root kills everything, so
 * nothing else is competing for the RAM it's about to size off in full) —
 * or `'sticky'`, used by every other chain position, always, including a
 * non-root session that regresses while sessions before it in the chain
 * are still actively farming: sizing off a host's *whole* RAM while an
 * upstream session is concurrently dispatching batches against that same
 * RAM would repeat the exact infinite-relaunch bug `hostTotalRam` was
 * originally added to fix — see that function's own comment — just
 * triggered by a sibling's activity instead of self-reference. `'sticky'`
 * sizes off currently *free* RAM, but only once per host and only until
 * that host's tracked pids die, never recomputing-and-relaunching on
 * every tick the way `'total'` does.
 *
 * `utils/hack-math.ts`'s `computeHackMath` currently always uses the base
 * `ns.hackAnalyze*`/`ns.get*Time` functions ("guesstimation" against the
 * server's current live state) — its Formulas-API branch is commented out
 * there: referencing `ns.formulas.hacking.*` statically reserves their RAM
 * whether or not `Formulas.exe` is owned or that branch ever runs, the
 * same referenced-cost-is-charged-regardless trap the RAM-cost model
 * section of CLAUDE.md describes, confirmed live here too. Both branches
 * share the same call shape, so re-enabling it later is a one-line change
 * in that file alone, nothing here.
 */
const CHECK_INTERVAL = 15000
const STATE_CHECK_INTERVAL = 5000
const SECURITY_EPSILON = 1
const PREP_MONEY_RATIO = 0.95
const DESYNC_STRIKES_TO_FALLBACK = 2
/**
 * Minimum pooled free-RAM capacity, expressed in weaken-script-sized
 * threads, worth bothering to extend the chain by one more session for —
 * a handful of leftover GB isn't worth a whole extra prep pipeline.
 * Tunable.
 */
const MIN_CHAIN_EXTENSION_THREADS = 20
/**
 * Longest a session's target can go without a fresh `'update-server'`
 * entry, even if the snapshot hasn't changed since the last one. A
 * well-tuned `farm` mode batch pipeline keeps returning to the *exact*
 * same steady-state money/security point between `STATE_CHECK_INTERVAL`
 * samples (each batch's compensating legs pull it right back), so the
 * change-triggered log alone can go silent for minutes at a time despite
 * real, continuous activity — confirmed live. That's correct for the
 * drift-checkpoint purpose (nothing to re-anchor to if nothing drifted),
 * but a chart of money over time wants guaranteed points on the line even
 * during a stable stretch, so it reads as "stable" rather than "did this
 * stop?" — this heartbeat exists purely for that, on top of (not instead
 * of) the change-triggered log.
 */
const UPDATE_SERVER_HEARTBEAT_INTERVAL = 60000

interface ScriptRams {
  hack: number
  grow: number
  weaken: number
}

/**
 * One host's current prep-mode assignment, including the pids it was
 * launched with (0 = that leg wasn't launched, e.g. 0 grow threads) so it
 * can be torn down precisely later — see the module header comment on why
 * this replaced `ns.killall(host)` for anything but claim/release.
 */
interface PrepAssignment {
  target: string
  growThreads: number
  weakenThreads: number
  growPid: number
  weakenPid: number
}

interface InFlightBatch {
  endsAt: number
  pids: number[]
}

/**
 * The `money`/`maxMoney`/`security`/`minSecurity` values from this
 * session's last *logged* `'update-server'` entry — compared against on
 * every `tickSession` call so an unchanged snapshot doesn't get re-written
 * every `STATE_CHECK_INTERVAL` tick. `null` until the first entry is ever
 * logged for this session.
 */
interface ServerSnapshot {
  money: number
  maxMoney: number
  security: number
  minSecurity: number
}

interface TargetSession {
  target: string
  mode: Mode | null
  batchPlan: BatchPlan | null
  desyncStrikes: number
  inFlightBatches: InFlightBatch[]
  lastLoggedSnapshot: ServerSnapshot | null
  /**
   * `Date.now()` of the last `'update-server'` entry actually logged for
   * this session, whether triggered by a real change or by
   * `UPDATE_SERVER_HEARTBEAT_INTERVAL` — 0 until the first one.
   */
  lastLoggedSnapshotAt: number
}

function createSession(target: string): TargetSession {
  return { target, mode: null, batchPlan: null, desyncStrikes: 0, inFlightBatches: [], lastLoggedSnapshot: null, lastLoggedSnapshotAt: 0 }
}

function readHosts(ns: NS): string[] {
  const raw = ns.read(CONFIG_FILE)
  if (!raw)
    return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

/**
 * Every hostname reachable from `home` — see `xp-farm.daemon.ts`'s
 * identical helper for why this isn't cached across cycles.
 */
function scanNetwork(ns: NS): string[] {
  const seen = new Set<string>(['home'])
  const queue = ['home']
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const neighbor of ns.scan(current)) {
      if (!seen.has(neighbor)) {
        seen.add(neighbor)
        queue.push(neighbor)
      }
    }
  }
  return [...seen]
}

/**
 * The rooted, non-purchased, eligible (hacking-level-cleared, has money)
 * server with the best money/sec potential — `moneyMax * hackChance /
 * weakenTime` — excluding anything in `exclude` (the other session's
 * current target, so the two never converge on the same one). Unlike XP
 * Farm's `baseDifficulty`-only metric, this can't be proven monotonically
 * improving (`weakenTime` depends on the target's *current* security,
 * which our own farming activity moves around), so a hysteresis margin
 * guards against thrashing: once `currentTarget` is adopted, a candidate
 * only replaces it by scoring at least 1.5x higher, not just momentarily
 * ahead. `currentTarget` is treated as unset if it's in `exclude` (can
 * happen transiently right after a session hand-off).
 *
 * Returns the winning target's own score alongside it — not logged here
 * (this function doesn't know whether its result is actually a new
 * session's target worth recording; each caller folds it into its own
 * `'start-work'` log entry when it actually is) — so callers get it for
 * free rather than recomputing the same formula a second time.
 */
function pickTarget(ns: NS, currentTarget: string | null, exclude: Set<string>): { target: string | null, score: number } {
  const effectiveCurrent = currentTarget && !exclude.has(currentTarget) ? currentTarget : null
  const hackingLevel = ns.getHackingLevel()
  let best: Server | null = null
  let bestScore = -Infinity
  for (const hostname of scanNetwork(ns)) {
    if (hostname === 'home' || exclude.has(hostname))
      continue
    const server = ns.getServer(hostname)
    if (!server.hasAdminRights || server.purchasedByPlayer)
      continue
    if ((server.requiredHackingSkill ?? 0) > hackingLevel)
      continue
    if ((server.moneyMax ?? 0) <= 0)
      continue
    const weakenTime = ns.getWeakenTime(hostname)
    if (weakenTime <= 0)
      continue
    const score = (server.moneyMax ?? 0) * ns.hackAnalyzeChance(hostname) / weakenTime
    if (score > bestScore) {
      bestScore = score
      best = server
    }
  }
  if (!best)
    return { target: effectiveCurrent, score: 0 }
  if (!effectiveCurrent || best.hostname === effectiveCurrent)
    return { target: best.hostname, score: bestScore }

  const currentServer = ns.getServer(effectiveCurrent)
  const currentWeakenTime = ns.getWeakenTime(effectiveCurrent)
  const currentScore = currentWeakenTime > 0
    ? (currentServer.moneyMax ?? 0) * ns.hackAnalyzeChance(effectiveCurrent) / currentWeakenTime
    : 0
  return bestScore > currentScore * 1.5
    ? { target: best.hostname, score: bestScore }
    : { target: effectiveCurrent, score: currentScore }
}

function modeFor(server: Server): Mode {
  const security = server.hackDifficulty ?? 0
  const minSecurity = server.minDifficulty ?? 0
  const money = server.moneyAvailable ?? 0
  const moneyMax = server.moneyMax ?? 1
  if (security - minSecurity > SECURITY_EPSILON)
    return 'weaken'
  if (money < moneyMax * PREP_MONEY_RATIO)
    return 'grow-prep'
  return 'farm'
}

function hostFreeRam(ns: NS, hosts: string[]): Record<string, number> {
  const freeRam: Record<string, number> = {}
  for (const host of hosts)
    freeRam[host] = Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host))
  return freeRam
}

/**
 * A managed host's *total* RAM, not what's currently free. Prep mode's
 * `'total'` sizing (`applyPrepMode`) redefines a host's whole assignment
 * from scratch each check, not "how much room is left on top of what's
 * already running" — using `hostFreeRam` there was a real bug: the
 * grow/weaken loops it just launched immediately ate the free RAM they
 * were sized against, so the very next check computed a much smaller
 * split, saw it differ from `prepAssignment`, and killed+relaunched every
 * `STATE_CHECK_INTERVAL` tick before either script ran anywhere near its
 * own completion time. Farm mode's `tryDispatchBatch` correctly keeps
 * using `hostFreeRam` — there, "room left on top of already-dispatched
 * in-flight batches" is exactly what's wanted.
 */
function hostTotalRam(ns: NS, hosts: string[]): Record<string, number> {
  const totalRam: Record<string, number> = {}
  for (const host of hosts)
    totalRam[host] = ns.getServerMaxRam(host)
  return totalRam
}

/**
 * Converts `ramSource` (GB, mutated in place — decremented by whatever
 * this category consumes) into per-host thread counts for one category,
 * using `scriptRam` as that category's own script cost. Sequential calls
 * against the same `ramSource`/`hosts` (hack, then grow, then weaken1,
 * then weaken2) correctly account for RAM already claimed by an earlier
 * category.
 */
function allocateCategory(
  ramSource: Record<string, number>,
  hosts: string[],
  scriptRam: number,
  threadsNeeded: number,
): Record<string, number> {
  const capacity: Record<string, number> = {}
  for (const host of hosts)
    capacity[host] = scriptRam > 0 ? Math.floor(ramSource[host] / scriptRam) : 0
  const assigned = distributeThreads(hosts, capacity, threadsNeeded)
  for (const [host, threads] of Object.entries(assigned))
    ramSource[host] -= threads * scriptRam
  return assigned
}

function sumValues(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, v) => sum + v, 0)
}

/**
 * `allocateCategory`, but caps `needed` to what `hosts` can actually run
 * before calling it — `distributeThreads` doesn't clamp per-host beyond a
 * host's own capacity when the requested total exceeds pooled capacity
 * (every host's share scales proportionally *above* what it can run, so
 * the sum comes out right but individual hosts get asked for more threads
 * than they have RAM for, which the later `ns.exec` would then just
 * fail). `applyPrepMode` is the only caller here, and its whole point is
 * sizing to the actual need rather than to capacity, so that mismatch is
 * expected and must be capped, not treated as an error.
 */
function allocateNeeded(
  ramSource: Record<string, number>,
  hosts: string[],
  scriptRam: number,
  needed: number,
): Record<string, number> {
  const capacity: Record<string, number> = {}
  for (const host of hosts)
    capacity[host] = scriptRam > 0 ? Math.floor(ramSource[host] / scriptRam) : 0
  const totalCapacity = hosts.reduce((sum, h) => sum + capacity[h], 0)
  return allocateCategory(ramSource, hosts, scriptRam, Math.min(needed, totalCapacity))
}

function isWorkerStatus(value: unknown): value is WorkerStatus {
  return typeof value === 'object' && value !== null && 'action' in value && 'target' in value
}

/**
 * Drains every currently-queued message off `MONEY_FARM_PORT` and appends
 * one `log/money-farm-log.txt` line per message (via `addLog`, same idiom
 * `contracts/state-file/`'s `recordContractResult` uses). Only `grow`
 * status needs filling in here: its worker can't cheaply compute
 * `ns.growthAnalyzeSecurity` itself (1GB, multiplied by however many
 * threads that *worker* runs with) the way this daemon can (1GB total,
 * referenced once regardless of how many times it's actually called at
 * runtime) — see `grow.daemon.ts`'s header comment.
 */
function drainStatusPort(ns: NS) {
  const port = ns.getPortHandle(MONEY_FARM_PORT)
  while (!port.empty()) {
    const raw = port.read()
    if (!isWorkerStatus(raw))
      continue
    const deltaSecurity = raw.action === 'grow' && raw.deltaSecurity === undefined
      ? ns.growthAnalyzeSecurity(raw.threads)
      : raw.deltaSecurity
    addMoneyFarmLog(ns, {
      action: raw.action,
      target: raw.target,
      threads: raw.threads,
      duration: raw.duration,
      money: raw.money,
      deltaSecurity,
      growth: raw.growth,
    })
  }
}

function killTracked(ns: NS, pid: number) {
  if (pid > 0)
    ns.kill(pid)
}

/**
 * Tears down everything `session` currently owns — its in-flight batch
 * legs and any prep-mode loops still tracked in `prepAssignment` for its
 * target — via precise per-pid kills, never `ns.killall`, so it can never
 * collide with another session sharing the same hosts. Resets `session`'s
 * own mode/plan/strike-count back to a fresh state; the caller decides
 * what (if anything) to set next.
 */
function killSession(ns: NS, session: TargetSession, prepAssignment: Record<string, PrepAssignment>) {
  for (const batch of session.inFlightBatches) {
    for (const pid of batch.pids) killTracked(ns, pid)
  }
  session.inFlightBatches.length = 0
  for (const host of Object.keys(prepAssignment)) {
    if (prepAssignment[host].target === session.target) {
      killTracked(ns, prepAssignment[host].growPid)
      killTracked(ns, prepAssignment[host].weakenPid)
      delete prepAssignment[host]
    }
  }
  session.mode = null
  session.batchPlan = null
  session.desyncStrikes = 0
}

/**
 * Weaken-only or grow-prep stage for one session — see the module header
 * comment for what `sizing: 'total' | 'sticky'` means and why the two
 * differ. `'sticky'` only (re)sizes hosts that don't yet have a live,
 * correctly-targeted assignment (no assignment, wrong target, or a
 * tracked pid found dead in `ns.ps`); `'total'` reconsiders every host
 * every call, the way this always worked pre-Phase-3.
 *
 * Sizes to the *actual* gap that needs closing, not to pooled capacity —
 * `ceil(securityGap / weakenAnalyze(1))` for weaken, `ceil(growThreadsFor
 * (currentMoney, moneyMax))` (`computeHackMath`, same Formulas-aware/
 * base-NS-fallback math `computeBatchPlan` already uses, so referencing it
 * here adds no new RAM cost) for grow. Confirmed live as a real problem
 * once the fleet grew large: with capacity-based sizing, only the first
 * host's worth of threads to complete actually did anything — every other
 * host's threads (once a large fleet meant "capacity" vastly exceeded
 * "need") ran for the full weaken/growTime and had zero effect, because
 * the gap was already closed by the time they resolved. Whatever pool
 * capacity isn't needed is left genuinely free, which other chain
 * sessions' farm-mode dispatch can then use via the same live
 * `hostFreeRam` check they already read.
 */
function applyPrepMode(
  ns: NS,
  hosts: string[],
  target: string,
  server: Server,
  mode: 'weaken' | 'grow-prep',
  growScriptRam: number,
  weakenScriptRam: number,
  prepAssignment: Record<string, PrepAssignment>,
  sizing: 'total' | 'sticky',
) {
  const candidateHosts = sizing === 'total'
    ? hosts
    : hosts.filter((host) => {
        const prev = prepAssignment[host]
        if (!prev || prev.target !== target)
          return true
        const alive = ns.ps(host)
        const growAlive = prev.growThreads === 0 || alive.some(p => p.pid === prev.growPid)
        const weakenAlive = prev.weakenThreads === 0 || alive.some(p => p.pid === prev.weakenPid)
        return !(growAlive && weakenAlive)
      })

  if (candidateHosts.length === 0)
    return

  const ramSource = sizing === 'total' ? hostTotalRam(ns, candidateHosts) : hostFreeRam(ns, candidateHosts)
  let growAssigned: Record<string, number> = {}
  let weakenAssigned: Record<string, number>

  if (mode === 'weaken') {
    const weakenPerThread = ns.weakenAnalyze(1)
    const securityGap = Math.max(0, (server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0))
    const neededWeakenThreads = weakenPerThread > 0 ? Math.ceil(securityGap / weakenPerThread) : 0
    weakenAssigned = allocateNeeded(ramSource, candidateHosts, weakenScriptRam, neededWeakenThreads)
  }
  else {
    const hm = computeHackMath(ns, target)
    const currentMoney = Math.max(server.moneyAvailable ?? 0, 1)
    const moneyMax = server.moneyMax ?? 0
    const neededGrowThreads = currentMoney < moneyMax ? Math.max(0, Math.ceil(hm.growThreadsFor(currentMoney, moneyMax))) : 0
    growAssigned = allocateNeeded(ramSource, candidateHosts, growScriptRam, neededGrowThreads)

    // Sized off what actually got dispatched (capacity-capped), not the
    // uncapped ideal above — if the pool couldn't fully cover
    // neededGrowThreads, the real security bump will be smaller than that
    // ideal implies.
    const actualGrowThreads = sumValues(growAssigned)
    const weakenPerThread = ns.weakenAnalyze(1)
    const neededWeakenThreads = actualGrowThreads > 0
      ? Math.ceil(ns.growthAnalyzeSecurity(actualGrowThreads) / weakenPerThread)
      : 0
    weakenAssigned = allocateNeeded(ramSource, candidateHosts, weakenScriptRam, neededWeakenThreads)
  }

  for (const host of candidateHosts) {
    const g = growAssigned[host] ?? 0
    const w = weakenAssigned[host] ?? 0
    const prev = prepAssignment[host]
    // 'sticky' only ever reaches here for hosts already filtered as
    // needing (re)assignment; 'total' still needs its own change check.
    const changed = sizing === 'sticky' || !prev || prev.target !== target || prev.growThreads !== g || prev.weakenThreads !== w

    if (changed) {
      if (prev) {
        killTracked(ns, prev.growPid)
        killTracked(ns, prev.weakenPid)
      }
      ns.print(`${host}: prepping ${target} (${mode}) — ${g}g / ${w}w.`)
      const growPid = g > 0 ? ns.exec(GROW_SCRIPT, host, g, target, 0, g, '--port', MONEY_FARM_PORT) : 0
      const weakenPid = w > 0 ? ns.exec(WEAKEN_SCRIPT, host, w, target, 0, w, '--port', MONEY_FARM_PORT) : 0
      prepAssignment[host] = { target, growThreads: g, weakenThreads: w, growPid, weakenPid }
    }
  }
}

/**
 * Tries to dispatch exactly one HWGW batch across `hosts`' pooled free RAM.
 * Returns null (nothing launched — safe to retry next tick) if any of the
 * four legs can't be fully covered by current free RAM; only calls
 * `ns.exec` once every leg is confirmed to fit, returning every launched
 * pid so the caller can track this batch precisely.
 */
function tryDispatchBatch(
  ns: NS,
  hosts: string[],
  target: string,
  plan: BatchPlan,
  hackScriptRam: number,
  growScriptRam: number,
  weakenScriptRam: number,
): number[] | null {
  const freeRam = hostFreeRam(ns, hosts)

  const hackAssigned = allocateCategory(freeRam, hosts, hackScriptRam, plan.hackThreads)
  if (sumValues(hackAssigned) < plan.hackThreads)
    return null
  const growAssigned = allocateCategory(freeRam, hosts, growScriptRam, plan.growThreads)
  if (sumValues(growAssigned) < plan.growThreads)
    return null
  const weaken1Assigned = allocateCategory(freeRam, hosts, weakenScriptRam, plan.weaken1Threads)
  if (sumValues(weaken1Assigned) < plan.weaken1Threads)
    return null
  const weaken2Assigned = allocateCategory(freeRam, hosts, weakenScriptRam, plan.weaken2Threads)
  if (sumValues(weaken2Assigned) < plan.weaken2Threads)
    return null

  const pids: number[] = []
  for (const [host, threads] of Object.entries(hackAssigned))
    pids.push(ns.exec(HACK_SCRIPT, host, threads, target, plan.delayHack, threads, '--once', '--port', MONEY_FARM_PORT))
  for (const [host, threads] of Object.entries(growAssigned))
    pids.push(ns.exec(GROW_SCRIPT, host, threads, target, plan.delayGrow, threads, '--once', '--port', MONEY_FARM_PORT))
  for (const [host, threads] of Object.entries(weaken1Assigned))
    pids.push(ns.exec(WEAKEN_SCRIPT, host, threads, target, plan.delayWeaken1, threads, '--once', '--port', MONEY_FARM_PORT))
  for (const [host, threads] of Object.entries(weaken2Assigned))
    pids.push(ns.exec(WEAKEN_SCRIPT, host, threads, target, plan.delayWeaken2, threads, '--once', '--port', MONEY_FARM_PORT))
  return pids
}

/**
 * Mode evaluation, transition handling, and prep dispatch for one session
 * — everything gated on `STATE_CHECK_INTERVAL`. Batch dispatch itself
 * (needs the much tighter `BATCH_SPACING` cadence) is `tickDispatch`,
 * called separately every loop iteration.
 */
function tickSession(
  ns: NS,
  session: TargetSession,
  hosts: string[],
  prepAssignment: Record<string, PrepAssignment>,
  rams: ScriptRams,
  sizing: 'total' | 'sticky',
  now: number,
) {
  const server = ns.getServer(session.target)
  const mode = modeFor(server)
  const modeChanged = mode !== session.mode

  // Checked every STATE_CHECK_INTERVAL tick for every session in the
  // chain, but only actually logged when it differs from the last
  // *logged* snapshot, or when UPDATE_SERVER_HEARTBEAT_INTERVAL has
  // elapsed since that last log regardless — see that constant's own
  // comment for why the heartbeat exists (a well-tuned farm mode can
  // legitimately return to the exact same steady-state snapshot for
  // minutes at a time, which is correct for the drift-checkpoint purpose
  // but leaves a money-over-time chart looking silent). See
  // money-farm-log/types.ts's updateServer schema comment for what this
  // doubles as (the absolute-security checkpoint a deltaSecurity-summing
  // reader should re-anchor to).
  const snapshot: ServerSnapshot = {
    money: server.moneyAvailable ?? 0,
    maxMoney: server.moneyMax ?? 0,
    security: server.hackDifficulty ?? 0,
    minSecurity: server.minDifficulty ?? 0,
  }
  const prev = session.lastLoggedSnapshot
  const snapshotUnchanged = prev !== null
    && prev.money === snapshot.money
    && prev.maxMoney === snapshot.maxMoney
    && prev.security === snapshot.security
    && prev.minSecurity === snapshot.minSecurity
  const heartbeatDue = now - session.lastLoggedSnapshotAt >= UPDATE_SERVER_HEARTBEAT_INTERVAL
  if (!snapshotUnchanged || heartbeatDue) {
    addMoneyFarmLog(ns, {
      action: 'update-server',
      target: session.target,
      ...snapshot,
    })
    session.lastLoggedSnapshot = snapshot
    session.lastLoggedSnapshotAt = now
  }

  if (modeChanged) {
    ns.print(
      `${session.target}: mode ${session.mode ?? '(none)'} -> ${mode} `
      + `(security ${(server.hackDifficulty ?? 0).toFixed(2)}/${(server.minDifficulty ?? 0).toFixed(2)}, `
      + `money ${ns.format.number(server.moneyAvailable ?? 0)}/${ns.format.number(server.moneyMax ?? 0)}).`,
    )
    addMoneyFarmLog(ns, {
      action: 'change-mode',
      target: session.target,
      oldMode: session.mode ?? '(none)',
      mode,
    })
    killSession(ns, session, prepAssignment)
    session.mode = mode
    session.batchPlan = mode === 'farm' ? computeBatchPlan(ns, session.target) : null
    if (session.batchPlan) {
      ns.print(
        `${session.target}: batch plan — ${session.batchPlan.hackThreads}h/${session.batchPlan.growThreads}g/`
        + `${session.batchPlan.weaken1Threads}w1/${session.batchPlan.weaken2Threads}w2 `
        + `(${(session.batchPlan.actualHackFraction * 100).toFixed(1)}% steal/batch), `
        + `weakenTime ${(session.batchPlan.weakenTime / 1000).toFixed(1)}s, `
        + `max ${session.batchPlan.maxConcurrentBatches} concurrent batches.`,
      )
    }
  }

  if (session.mode === 'farm') {
    if (!modeChanged) {
      const securityGap = (server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0)
      if (securityGap > SECURITY_EPSILON) {
        session.desyncStrikes++
        if (session.desyncStrikes >= DESYNC_STRIKES_TO_FALLBACK) {
          ns.print(`${session.target}: security drifted (${securityGap.toFixed(2)} above min) — falling back to prep.`)
          killSession(ns, session, prepAssignment)
        }
      }
      else {
        session.desyncStrikes = 0
      }
      ns.print(`${session.target}: ${session.inFlightBatches.length}/${session.batchPlan?.maxConcurrentBatches ?? 0} batches in flight.`)
    }
  }
  else if (session.mode) {
    applyPrepMode(ns, hosts, session.target, server, session.mode, rams.grow, rams.weaken, prepAssignment, sizing)
  }
}

/**
 * Config-file reconciliation: claims/releases hosts, self-heals a deleted
 * one, and re-picks primary's target (never regressing without clearing
 * `1.5x` hysteresis — see `pickTarget`). Returns the updated `sessions`
 * chain (every session torn down and replaced by a single fresh root if
 * the root's target actually changed) and whether every dedicated host is
 * gone (the caller should exit). Taking `sessions` as a plain parameter
 * rather than reading/reassigning the caller's own `let` directly
 * sidesteps a real TS 4.9 control-flow-narrowing limitation hit here live
 * with the old `primary`/`secondary` fields: accessing a `let`-declared
 * union type's property inside a conditionally-`break`ing block nested in
 * a `while(true)` loop caused `tsc` to report the variable as circularly
 * self-referencing its own initializer — a compiler quirk, not a real
 * type issue, but this structure avoids it entirely rather than fighting
 * it (kept even though `sessions` itself, a plain array, isn't the
 * `T | null` union shape that actually triggered it, for the same reason
 * this whole function stayed split out).
 */
function reconcileTargets(
  ns: NS,
  managedHosts: Set<string>,
  prepAssignment: Record<string, PrepAssignment>,
  sessions: TargetSession[],
): { sessions: TargetSession[], empty: boolean } {
  const configured = readHosts(ns)
  const validHosts = configured.filter(h => ns.serverExists(h))
  if (validHosts.length !== configured.length)
    ns.write(CONFIG_FILE, JSON.stringify(validHosts), 'w')
  const hostSet = new Set(validHosts)

  for (const host of [...managedHosts]) {
    if (hostSet.has(host))
      continue
    if (ns.serverExists(host))
      ns.killall(host)
    managedHosts.delete(host)
    delete prepAssignment[host]
    ns.print(`${host}: released — no longer in ${CONFIG_FILE}.`)
  }

  for (const host of validHosts) {
    if (managedHosts.has(host))
      continue
    // Newly claimed: nothing of ours could be running here yet, so a full
    // killall is the one place that's still safe/correct — see the
    // module header comment.
    ns.killall(host)
    ns.scp([HACK_SCRIPT, GROW_SCRIPT, WEAKEN_SCRIPT], host, 'home')
    managedHosts.add(host)
    ns.print(`${host}: claimed.`)
  }

  if (validHosts.length === 0) {
    ns.print('No dedicated servers left — exiting. The app relaunches this when one is enabled again.')
    return { sessions: [], empty: true }
  }

  const previousTarget = sessions[0]?.target ?? null
  const excludeForRoot = new Set(sessions.slice(1).map(s => s.target))
  const picked = pickTarget(ns, previousTarget, excludeForRoot)
  const bestTarget = picked.target
  if (bestTarget && bestTarget !== previousTarget) {
    ns.print(`Switching target ${previousTarget ?? '(none)'} -> ${bestTarget}.`)
    // Every existing session's lifespan ends here (root retargeting
    // replaces the whole chain), and the new root's begins — see
    // money-farm-log/types.ts's workLifecycleSchema comment for why this
    // pair replaced the old single change-target entry.
    for (const session of sessions) {
      killSession(ns, session, prepAssignment)
      addMoneyFarmLog(ns, { action: 'end-work', target: session.target })
    }
    addMoneyFarmLog(ns, { action: 'start-work', target: bestTarget, score: picked.score })
    return { sessions: [createSession(bestTarget)], empty: false }
  }

  return { sessions, empty: false }
}

/**
 * Batch-dispatch tick for one session — a no-op unless it's actually
 * farming. Called every loop iteration (not gated on
 * `STATE_CHECK_INTERVAL`) so every session in the chain gets the tight
 * `BATCH_SPACING` cadence farm mode needs.
 */
function tickDispatch(ns: NS, session: TargetSession, hosts: string[], rams: ScriptRams, now: number) {
  if (session.mode !== 'farm' || !session.batchPlan)
    return
  for (let i = session.inFlightBatches.length - 1; i >= 0; i--) {
    if (session.inFlightBatches[i].endsAt <= now)
      session.inFlightBatches.splice(i, 1)
  }
  if (session.inFlightBatches.length < session.batchPlan.maxConcurrentBatches) {
    const pids = tryDispatchBatch(ns, hosts, session.target, session.batchPlan, rams.hack, rams.grow, rams.weaken)
    if (pids)
      session.inFlightBatches.push({ endsAt: now + session.batchPlan.totalDuration, pids })
  }
}

export async function main(ns: NS) {
  ns.disableLog('ALL')

  // Refuse to run alongside another live instance — see
  // `xp-farm.daemon.ts`'s identical guard for why.
  const dupe = ns.ps('home').find(p => p.filename === ns.getScriptName() && p.pid !== ns.pid)
  if (dupe) {
    ns.tprint(`WARNING: daemons/money-farm.daemon.js is already running (pid ${dupe.pid}) — exiting.`)
    return
  }

  // Measured from home (Viteburner always deploys these there), not
  // per-host — see `xp-farm.daemon.ts`'s `claim()` for the same reasoning.
  const rams: ScriptRams = {
    hack: ns.getScriptRam(HACK_SCRIPT, 'home'),
    grow: ns.getScriptRam(GROW_SCRIPT, 'home'),
    weaken: ns.getScriptRam(WEAKEN_SCRIPT, 'home'),
  }

  ns.print(`Started. Checking ${CONFIG_FILE} every ${CHECK_INTERVAL / 1000}s.`)

  const managedHosts = new Set<string>()
  const prepAssignment: Record<string, PrepAssignment> = {}
  let sessions: TargetSession[] = []
  let lastConfigCheck = 0
  let lastStateCheck = 0

  // Registered once, up front, so it's armed for the whole run — killed
  // manually (Programs/task-manager), crashing, or falling off the end
  // (config list empties) all trigger it. `managedHosts` is read at call
  // time via closure, not snapshotted here, so it reflects whatever this
  // daemon actually had claimed by the time it died — same idiom as
  // `flooder.app.ts`'s identical `touchedHosts` cleanup. A plain killall
  // per host is correct here (unlike everywhere else in this file, which
  // kills only a session's own tracked pids so two sessions can share a
  // host): the whole daemon is going away, so every session's work stops
  // together, no partial preservation needed.
  ns.atExit(() => {
    for (const host of managedHosts) {
      if (ns.serverExists(host))
        ns.killall(host)
    }
  }, 'money-farm-cleanup')

  while (true) {
    const now = Date.now()
    drainStatusPort(ns)

    if (now - lastConfigCheck >= CHECK_INTERVAL) {
      lastConfigCheck = now
      const reconciled = reconcileTargets(ns, managedHosts, prepAssignment, sessions)
      if (reconciled.empty)
        break
      sessions = reconciled.sessions
    }

    if (sessions.length === 0) {
      await ns.sleep(STATE_CHECK_INTERVAL)
      continue
    }

    if (now - lastStateCheck >= STATE_CHECK_INTERVAL) {
      lastStateCheck = now
      const hostsSnapshot = [...managedHosts]

      // Walk the chain in order — the root (index 0) always gets 'total'
      // sizing (safe only because a regression anywhere kills everything
      // after it, so nothing else is ever competing for the RAM it sizes
      // off in full); every other position gets 'sticky', always,
      // including when *it's* the one regressing — see the module header
      // comment for why sizing off a host's whole RAM while an earlier
      // chain position is still actively farming would reintroduce the
      // infinite-relaunch bug hostTotalRam exists to prevent.
      let regressedAt = -1
      for (let i = 0; i < sessions.length; i++) {
        tickSession(ns, sessions[i], hostsSnapshot, prepAssignment, rams, i === 0 ? 'total' : 'sticky', now)
        if (sessions[i].mode !== 'farm') {
          regressedAt = i
          break
        }
      }

      if (regressedAt >= 0) {
        // Everything after the regressed position is actually removed
        // from the chain (not just mode-changed) — its lifespan ends here.
        // The regressed session itself isn't logged: it keeps running,
        // just in a different mode (tickSession's own change-mode entry
        // already covers that).
        for (let i = regressedAt + 1; i < sessions.length; i++) {
          ns.print(`${sessions[i].target}: releasing — ${sessions[regressedAt].target} (chain position ${regressedAt}) needs its share of the pool back.`)
          killSession(ns, sessions[i], prepAssignment)
          addMoneyFarmLog(ns, { action: 'end-work', target: sessions[i].target })
        }
        sessions.length = regressedAt + 1
      }
      else {
        const tail = sessions[sessions.length - 1]
        if (tail.batchPlan && tail.inFlightBatches.length >= tail.batchPlan.maxConcurrentBatches) {
          const freeThreads = sumValues(hostFreeRam(ns, hostsSnapshot)) / Math.max(rams.weaken, 1)
          if (freeThreads >= MIN_CHAIN_EXTENSION_THREADS) {
            const exclude = new Set(sessions.map(s => s.target))
            const nextPicked = pickTarget(ns, null, exclude)
            const nextTarget = nextPicked.target
            if (nextTarget) {
              ns.print(`${nextTarget}: extending chain (position ${sessions.length}) — ${tail.target} saturated with spare pooled RAM.`)
              addMoneyFarmLog(ns, { action: 'start-work', target: nextTarget, score: nextPicked.score })
              sessions.push(createSession(nextTarget))
            }
          }
        }
      }
    }

    const hostsSnapshot = [...managedHosts]
    for (const session of sessions)
      tickDispatch(ns, session, hostsSnapshot, rams, now)

    const anyFarming = sessions.some(s => s.mode === 'farm')
    await ns.sleep(anyFarming ? BATCH_SPACING : STATE_CHECK_INTERVAL)
  }
}
