import type { NS, Server } from '@ns'
import type { BatchPlan } from '../utils/hack-math'
import { MONEY_FARM_PORT } from '../ports.lib'
import {
  MONEY_FARM_CONFIG_FILE as CONFIG_FILE,
  MONEY_FARM_GROW_SCRIPT as GROW_SCRIPT,
  MONEY_FARM_HACK_SCRIPT as HACK_SCRIPT,
  MONEY_FARM_WEAKEN_SCRIPT as WEAKEN_SCRIPT,
} from '../ui/utils/money-farm-config'
import { addMoneyFarmLog } from '../ui/utils/money-farm-log'
import { BATCH_SPACING, computeBatchPlan } from '../utils/hack-math'
import { distributeThreads, splitGrowWeakenThreads } from '../utils/thread-balance'

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
 *    minimum: every dedicated host's pooled RAM goes entirely to weaken().
 * 2. **grow-prep** — security is near minimum but money is below
 *    `PREP_MONEY_RATIO` of max: pooled RAM splits between grow/weaken via
 *    `splitGrowWeakenThreads` (the same ratio-balancing XP Farm uses to
 *    hold security flat while growing).
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
 * **Two target sessions, not one.** `maxConcurrentBatches` deliberately
 * cape out around what's *safe* against one target, which in practice is
 * well below what a well-RAM'd fleet of dedicated hosts can actually
 * dispatch — confirmed live: a single target sat saturated while a large
 * share of pooled RAM sat idle. Rather than push more RAM at the same
 * target past its safety margin, a `primary` session farms the live-picked
 * best target as before; once `primary` is stably in `farm` mode *and*
 * saturated (`inFlightBatches.length >= maxConcurrentBatches`) *and*
 * pooled free RAM still clears `MIN_SECONDARY_THREADS`, a `secondary`
 * session opportunistically starts on the next-best target, sharing the
 * same host pool. `secondary` only ever exists while `primary` is farming
 * — the instant `primary` needs the pool back (any non-farm mode change,
 * including its own desync fallback), `secondary` is torn down first (see
 * `killSession`) so the two sessions' prep stages never have to negotiate
 * shared RAM. Capped at exactly two sessions — a general N-target
 * scheduler is out of scope here.
 *
 * **Per-session precise kill, never `ns.killall`, once a host is shared.**
 * `ns.killall(host)` is still used exactly twice: seizing a *newly
 * claimed* host (nothing of ours could be running there yet, so wiping
 * everything is safe and matches `xp-farm.daemon.ts`'s identical claim
 * behavior) and releasing a host dropped from the config file (handing it
 * back fully clean). Everywhere else — a session's own mode transitions,
 * desync fallback, prep relaunches — kills only that session's own tracked
 * pids (`ns.exec`'s return value, stored in `PrepAssignment`/
 * `InFlightBatch`), since two sessions can now legitimately be running the
 * same three scripts against different targets on the same host at once;
 * a filename-based "foreign process" check (the pre-Phase-3 design used
 * one) can no longer tell the two apart, so it's been dropped rather than
 * left in as a latent cross-session killer. The tradeoff: a *genuinely*
 * foreign process (something outside this daemon's own tracked pids) is
 * no longer auto-evicted mid-cycle the way it used to be — only at claim
 * time.
 *
 * **Pooled, not per-host-independent** (the one deliberate departure from
 * XP Farm's model, for both sessions): every stage above computes ONE plan
 * against the sum of every dedicated host's own RAM capacity, then splits
 * each thread category across hosts proportionally (`distributeThreads`) —
 * because, unlike grow/weaken, `hack()` can overshoot a shared target if
 * several hosts each independently decided how much money to take.
 * `applyPrepMode`'s `sizing` parameter governs how a session's prep stage
 * sources that pooled capacity: `'total'` (primary — sizes off each host's
 * whole* RAM, safe because primary always holds exclusive claim on the
 * pool while it preps) or `'sticky'` (secondary — sizes off currently
 * free* RAM, but only once per host and only until that host's tracked
 * pids die, never recomputing-and-relaunching on every tick the way
 * primary does; primary's own concurrent farm-mode RAM usage fluctuates
 * independently of anything secondary does, so treating every fluctuation
 * as "capacity changed, relaunch" would repeat the exact infinite-relaunch
 * bug `hostTotalRam` was originally added to fix — see that function's own
 * comment — just triggered by primary's activity instead of self-reference).
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
 * threads, worth bothering to start a secondary session for — a handful
 * of leftover GB isn't worth a whole second prep pipeline. Tunable.
 */
const MIN_SECONDARY_THREADS = 20

type Mode = 'weaken' | 'grow-prep' | 'farm'

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

interface TargetSession {
  target: string
  mode: Mode | null
  batchPlan: BatchPlan | null
  desyncStrikes: number
  inFlightBatches: InFlightBatch[]
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
 */
function pickTarget(ns: NS, currentTarget: string | null, exclude: Set<string>): string | null {
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
    return effectiveCurrent
  if (!effectiveCurrent || best.hostname === effectiveCurrent)
    return best.hostname

  const currentServer = ns.getServer(effectiveCurrent)
  const currentWeakenTime = ns.getWeakenTime(effectiveCurrent)
  const currentScore = currentWeakenTime > 0
    ? (currentServer.moneyMax ?? 0) * ns.hackAnalyzeChance(effectiveCurrent) / currentWeakenTime
    : 0
  return bestScore > currentScore * 1.5 ? best.hostname : effectiveCurrent
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
 * Raw status object a worker writes to `MONEY_FARM_PORT` — see
 * `hack.daemon.ts`/`grow.daemon.ts`/`weaken.daemon.ts`'s own header
 * comments for why `money`/`deltaSecurity` aren't always populated by the
 * worker itself. Written via `ns.writePort` (a real object, `structuredClone`d
 * by the game — not a JSON string, so no `JSON.parse` needed on this end).
 */
interface WorkerStatus {
  action: 'hack' | 'grow' | 'weaken'
  target: string
  threads: number
  duration: number
  money?: number
  deltaSecurity?: number
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
 */
function applyPrepMode(
  ns: NS,
  hosts: string[],
  target: string,
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
    const capacity: Record<string, number> = {}
    for (const host of candidateHosts)
      capacity[host] = weakenScriptRam > 0 ? Math.floor(ramSource[host] / weakenScriptRam) : 0
    const totalWeakenThreads = candidateHosts.reduce((sum, h) => sum + capacity[h], 0)
    weakenAssigned = distributeThreads(candidateHosts, capacity, totalWeakenThreads)
  }
  else {
    // Pooled total, using weakenScriptRam as the shared reference cost for
    // both scripts — same simplifying assumption `xp-farm.daemon.ts`
    // already makes (both are near-identical trivial loop scripts).
    const capacity: Record<string, number> = {}
    for (const host of candidateHosts)
      capacity[host] = weakenScriptRam > 0 ? Math.floor(ramSource[host] / weakenScriptRam) : 0
    const totalThreads = candidateHosts.reduce((sum, h) => sum + capacity[h], 0)
    const { growThreads, weakenThreads } = splitGrowWeakenThreads(ns, totalThreads, target)
    growAssigned = allocateCategory(ramSource, candidateHosts, growScriptRam, growThreads)
    weakenAssigned = allocateCategory(ramSource, candidateHosts, weakenScriptRam, weakenThreads)
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
      const growPid = g > 0 ? ns.exec(GROW_SCRIPT, host, g, '--port', MONEY_FARM_PORT, target, 0, g) : 0
      const weakenPid = w > 0 ? ns.exec(WEAKEN_SCRIPT, host, w, '--port', MONEY_FARM_PORT, target, 0, w) : 0
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
    pids.push(ns.exec(HACK_SCRIPT, host, threads, '--once', '--port', MONEY_FARM_PORT, target, plan.delayHack, threads))
  for (const [host, threads] of Object.entries(growAssigned))
    pids.push(ns.exec(GROW_SCRIPT, host, threads, '--once', '--port', MONEY_FARM_PORT, target, plan.delayGrow, threads))
  for (const [host, threads] of Object.entries(weaken1Assigned))
    pids.push(ns.exec(WEAKEN_SCRIPT, host, threads, '--once', '--port', MONEY_FARM_PORT, target, plan.delayWeaken1, threads))
  for (const [host, threads] of Object.entries(weaken2Assigned))
    pids.push(ns.exec(WEAKEN_SCRIPT, host, threads, '--once', '--port', MONEY_FARM_PORT, target, plan.delayWeaken2, threads))
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
) {
  const server = ns.getServer(session.target)
  const mode = modeFor(server)
  const modeChanged = mode !== session.mode

  if (modeChanged) {
    ns.print(
      `${session.target}: mode ${session.mode ?? '(none)'} -> ${mode} `
      + `(security ${(server.hackDifficulty ?? 0).toFixed(2)}/${(server.minDifficulty ?? 0).toFixed(2)}, `
      + `money ${ns.format.number(server.moneyAvailable ?? 0)}/${ns.format.number(server.moneyMax ?? 0)}).`,
    )
    // Every logged security value elsewhere is a *delta* from one worker's
    // own completed action (see money-farm-log.ts's header comment) — grow
    // in particular never gets an exact one (its worker can't cheaply
    // compute growthAnalyzeSecurity itself, and the daemon's own fill-in
    // uses a fixed per-thread formula that doesn't account for cores), so
    // summed deltas alone will drift from reality over time. A mode
    // transition is a natural checkpoint to log the actual live value
    // instead, so a downstream reader can re-anchor its running total here
    // rather than trusting an ever-compounding sum of deltas.
    addMoneyFarmLog(ns, {
      action: 'set-security',
      target: session.target,
      security: server.hackDifficulty ?? 0,
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
    applyPrepMode(ns, hosts, session.target, session.mode, rams.grow, rams.weaken, prepAssignment, sizing)
  }
}

/**
 * Config-file reconciliation: claims/releases hosts, self-heals a deleted
 * one, and re-picks primary's target (never regressing without clearing
 * `1.5x` hysteresis — see `pickTarget`). Returns the updated
 * `primary`/`secondary` (both torn down and `primary` replaced fresh if
 * the target actually changed) and whether every dedicated host is gone
 * (the caller should exit). Taking `primary`/`secondary` as plain
 * parameters rather than reading/reassigning the caller's own `let`s
 * directly sidesteps a real TS 4.9 control-flow-narrowing limitation hit
 * here live: accessing a `let`-declared union type's property inside a
 * conditionally-`break`ing block nested in a `while(true)` loop caused
 * `tsc` to report the variable as circularly self-referencing its own
 * initializer — a compiler quirk, not a real type issue, but this
 * structure avoids it entirely rather than fighting it.
 */
function reconcileTargets(
  ns: NS,
  managedHosts: Set<string>,
  prepAssignment: Record<string, PrepAssignment>,
  primary: TargetSession | null,
  secondary: TargetSession | null,
): { primary: TargetSession | null, secondary: TargetSession | null, empty: boolean } {
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
    return { primary: null, secondary: null, empty: true }
  }

  const previousTarget = primary?.target ?? null
  const excludeForPrimary = secondary ? new Set([secondary.target]) : new Set<string>()
  const bestTarget = pickTarget(ns, previousTarget, excludeForPrimary)
  if (bestTarget && bestTarget !== previousTarget) {
    ns.print(`Switching target ${previousTarget ?? '(none)'} -> ${bestTarget}.`)
    if (primary)
      killSession(ns, primary, prepAssignment)
    if (secondary)
      killSession(ns, secondary, prepAssignment)
    return {
      primary: { target: bestTarget, mode: null, batchPlan: null, desyncStrikes: 0, inFlightBatches: [] },
      secondary: null,
      empty: false,
    }
  }

  return { primary, secondary, empty: false }
}

/**
 * Batch-dispatch tick for one session — a no-op unless it's actually
 * farming. Called every loop iteration (not gated on
 * `STATE_CHECK_INTERVAL`) so both sessions get the tight `BATCH_SPACING`
 * cadence farm mode needs.
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
  let primary: TargetSession | null = null
  let secondary: TargetSession | null = null
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
      const reconciled = reconcileTargets(ns, managedHosts, prepAssignment, primary, secondary)
      if (reconciled.empty)
        break
      primary = reconciled.primary
      secondary = reconciled.secondary
    }

    if (!primary) {
      await ns.sleep(STATE_CHECK_INTERVAL)
      continue
    }

    if (now - lastStateCheck >= STATE_CHECK_INTERVAL) {
      lastStateCheck = now
      const hostsSnapshot = [...managedHosts]
      tickSession(ns, primary, hostsSnapshot, prepAssignment, rams, 'total')

      if (primary.mode !== 'farm') {
        // Primary needs the pool back (any non-farm mode, including a
        // fresh desync fallback) — release secondary first so the two
        // sessions' prep stages never fight over shared RAM. See the
        // module header comment.
        if (secondary) {
          ns.print(`${secondary.target}: releasing secondary — primary needs the pool back.`)
          killSession(ns, secondary, prepAssignment)
          secondary = null
        }
      }
      else if (secondary) {
        tickSession(ns, secondary, hostsSnapshot, prepAssignment, rams, 'sticky')
      }
      else if (primary.batchPlan && primary.inFlightBatches.length >= primary.batchPlan.maxConcurrentBatches) {
        const freeThreads = sumValues(hostFreeRam(ns, hostsSnapshot)) / Math.max(rams.weaken, 1)
        if (freeThreads >= MIN_SECONDARY_THREADS) {
          const secondTarget = pickTarget(ns, null, new Set([primary.target]))
          if (secondTarget) {
            ns.print(`${secondTarget}: starting secondary target — primary saturated with spare pooled RAM.`)
            secondary = { target: secondTarget, mode: null, batchPlan: null, desyncStrikes: 0, inFlightBatches: [] }
          }
        }
      }
    }

    const hostsSnapshot = [...managedHosts]
    tickDispatch(ns, primary, hostsSnapshot, rams, now)
    if (secondary)
      tickDispatch(ns, secondary, hostsSnapshot, rams, now)

    const anyFarming = primary.mode === 'farm' || secondary?.mode === 'farm'
    await ns.sleep(anyFarming ? BATCH_SPACING : STATE_CHECK_INTERVAL)
  }
}
