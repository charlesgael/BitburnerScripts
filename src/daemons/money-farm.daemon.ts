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
 *    capacity — see `computePrepNeed`'s own header comment for why sizing
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
 *    `weaken.daemon.ts`) across whichever hosts the session currently owns
 *    (see below) with free RAM, until either RAM runs out or
 *    `maxConcurrentBatches` is reached. That cap (see `utils/hack-math.ts`'s
 *    `computeBatchPlan`) folds together two different safety limits: a
 *    landing-order cap (`floor(weakenTime / BATCH_SPACING)`, almost never
 *    binding) and a cumulative-hack-exposure cap (`SAFE_TOTAL_HACK_FRACTION`
 *    — found necessary live: RAM alone let far more batches dispatch than
 *    were safe, and since they all get dispatched within a second or two of
 *    each other, their hack legs land clustered together rather than
 *    smoothly staggered, draining a target's money well below what any
 *    single batch's own compensating grow leg could catch up on).
 *
 * **A prioritized list of independent sessions, each owning an exclusive
 * host partition — not a dependency chain.** `sessions[0]` (the root)
 * always farms the live-picked best target, same as `primary` always did;
 * `sessions[1..]` are additional targets opportunistically picked to soak
 * up whatever pooled RAM the root alone can't profitably use. List order is
 * priority order, not a runtime dependency: a session earlier in the list
 * outranks every session after it and can reclaim RAM from them (see
 * partitioning below), but a later session regressing to `weaken`/
 * `grow-prep` no longer tears down anything after it — that used to be
 * necessary when every session drew from one shared pool (a regression
 * changed how much of the pool the rest of the chain could safely assume),
 * but partitioning gives every session its own exclusive hosts, so a
 * sibling's mode change simply can't affect it. `reconcileTargets` only
 * ever replaces `sessions[0]` on a root retarget (1.5x hysteresis, see
 * `pickTarget`) — `sessions[1..]` have no logical tie to root's identity
 * and are left running.
 *
 * **Partitioning: every session owns an exclusive, disjoint subset of
 * `managedHosts` (`TargetSession.hosts`), sized to roughly double its own
 * estimated need — not one shared pool split proportionally per stage the
 * way this used to work.** A host belongs to at most one session at a
 * time; whatever's left over (`managedHosts` minus the union of every
 * session's `.hosts`) is "unassigned" and needs no separate bookkeeping —
 * a session's hosts fall back into that set the instant it's removed from
 * `sessions` (eviction, a session dying, config release), and a freshly
 * created session simply starts with `hosts: []`. `ensurePartition` (run
 * once per session per `STATE_CHECK_INTERVAL` tick, in priority order)
 * grows a session's partition only on a genuine deficit — its cached
 * `estimatedNeedGB` (see `TargetSession`'s own field comment) exceeding
 * what it currently owns — first from whatever's unassigned, then, if
 * that's not enough, by evicting `sessions[i+1..]` (strictly
 * lower-priority, since list order is priority order) one at a time from
 * the very end until the target is met or nothing's left to evict. This
 * exists specifically because a fixed-size fleet's RAM can badly outstrip
 * what a single target can safely absorb (`computeBatchPlan`'s own
 * `maxConcurrentBatches` cap) — without a second, third, ... session
 * competing for the leftover, most of a large fleet just sits idle. The
 * previous chain design *also* solved that, but only once the *entire*
 * chain had reached `farm` mode — confirmed live as a real problem once
 * prep-mode sizing was fixed to track actual need rather than capacity
 * (see point 1 above): a big fleet's root prep stage now claims only a
 * sliver of the pool, and nothing else could start until it finished
 * prepping and started farming. Partitioning decouples "can a new session
 * start" from "is every earlier session already farming" entirely — a new
 * session only needs *unassigned* capacity to exist, regardless of what
 * mode anything else is in. See `ensurePartition`'s own header comment for
 * the exact grow/evict mechanics, and `main`'s state-check block for how a
 * brand new session gets appended once genuinely idle capacity clears
 * `MIN_CHAIN_EXTENSION_THREADS`.
 *
 * **Per-session precise kill, never `ns.killall`, once a host has ever been
 * assigned to a session.** `ns.killall(host)` is still used exactly twice:
 * seizing a *newly claimed* host (nothing of ours could be running there
 * yet, so wiping everything is safe and matches `xp-farm.daemon.ts`'s
 * identical claim behavior) and releasing a host dropped from the config
 * file (handing it back fully clean, and stripped out of whichever
 * session's `.hosts` still listed it). Everywhere else — a session's own
 * mode transitions, desync fallback, eviction, prep relaunches — kills
 * only that session's own tracked pids (`ns.exec`'s return value, stored in
 * `PrepAssignment`/`InFlightBatch`). Since partitioning guarantees a host
 * is never shared between two live sessions, a filename-based "foreign
 * process" sweep isn't needed to tell sessions apart the way it would be
 * under a pooled model — precise pid tracking is still used regardless, so
 * a genuinely foreign process (something outside this daemon's own tracked
 * pids) is only ever evicted at claim time, same as before.
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
 * Minimum unassigned free-RAM capacity, expressed in weaken-script-sized
 * threads, worth bothering to start a whole new session for — a handful of
 * leftover GB isn't worth a whole extra prep pipeline. Tunable.
 */
const MIN_CHAIN_EXTENSION_THREADS = 20
/**
 * How generously `ensurePartition` sizes a session's host partition once
 * it's already forced to grow it: the target is
 * `estimatedNeedGB * PARTITION_HEADROOM_MULTIPLIER`, not the bare need
 * itself, so a session doesn't immediately re-trigger another grow (and,
 * worse, another eviction) the very next time its need ticks up slightly.
 * Whether a grow triggers at all is still gated on the *bare* need exceeding
 * current capacity (see `ensurePartition`) — this constant only controls
 * how far past that point it reaches once it's already growing.
 */
const PARTITION_HEADROOM_MULTIPLIER = 2
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
  /**
   * This session's exclusive subset of `managedHosts` — never shared with
   * another live session (see the module header comment's partitioning
   * section). Starts empty on a brand new session; `ensurePartition` grows
   * it on the very first `tickSession` call once a real mode (and thus a
   * real `estimatedNeedGB`) is known.
   */
  hosts: string[]
  /**
   * The RAM (GB) this session's *current* mode would need to fully cover
   * its own gap in one shot — recomputed only when `mode` actually changes
   * (alongside `batchPlan`), not every tick: prep mode's real need only
   * ever shrinks as its gap closes, and farm mode's is stable between mode
   * changes (tied to the also-cached `batchPlan`), so a mode transition is
   * the only moment this figure can jump. `ensurePartition` compares a
   * session's current partition capacity against this to decide whether it
   * needs to grow. 0 until the session's first real mode is assigned.
   */
  estimatedNeedGB: number
}

function createSession(target: string): TargetSession {
  return {
    target,
    mode: null,
    batchPlan: null,
    desyncStrikes: 0,
    inFlightBatches: [],
    lastLoggedSnapshot: null,
    lastLoggedSnapshotAt: 0,
    hosts: [],
    estimatedNeedGB: 0,
  }
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
 * weakenTime` — excluding anything in `exclude` (every other session's
 * current target, so two sessions never converge on the same one). Unlike
 * XP Farm's `baseDifficulty`-only metric, this can't be proven
 * monotonically improving (`weakenTime` depends on the target's *current*
 * security, which our own farming activity moves around), so a hysteresis
 * margin guards against thrashing: once `currentTarget` is adopted, a
 * candidate only replaces it by scoring at least 1.5x higher, not just
 * momentarily ahead. `currentTarget` is treated as unset if it's in
 * `exclude` (can happen transiently right after a session hand-off).
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
 * A host's *total* RAM, not what's currently free. `applyPrepMode` sizes
 * off this rather than `hostFreeRam` for the same reason it always has:
 * prep mode redefines a session's whole assignment from scratch each
 * check, not "how much room is left on top of what's already running" —
 * using `hostFreeRam` there was a real bug even before partitioning
 * existed: the grow/weaken loops it just launched immediately ate the free
 * RAM they were sized against, so the very next check computed a much
 * smaller split, saw it differ from `prepAssignment`, and killed+relaunched
 * every `STATE_CHECK_INTERVAL` tick before either script ran anywhere near
 * its own completion time. That self-referential trap is orthogonal to
 * partitioning (it's about a session's own just-launched scripts, not a
 * sibling's) and still applies now that every session's hosts are
 * exclusive to it. Farm mode's `tryDispatchBatch` correctly keeps using
 * `hostFreeRam` — there, "room left on top of already-dispatched in-flight
 * batches" is exactly what's wanted. `ensurePartition`'s own capacity
 * check also uses this: a partition's *size* is measured by total RAM, not
 * by whatever happens to be free on it at the instant of the check.
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
 * target — via precise per-pid kills, never `ns.killall`. Resets
 * `session`'s own mode/plan/strike-count back to a fresh state; the caller
 * decides what (if anything) to set next. Does not touch `session.hosts` —
 * a killed/regressing session that stays in `sessions` keeps its
 * partition; a session actually being removed from `sessions` (eviction,
 * root retarget, config release) has its hosts fall back into the
 * unassigned pool automatically once it's no longer referenced there, with
 * no separate cleanup needed here.
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
 * The uncapped thread counts that would fully close `mode`'s own gap in
 * one shot — shared by `applyPrepMode` (as the starting point for what to
 * actually dispatch, capacity permitting) and `estimateNeedGB` (to size a
 * session's partition against the *ideal* need, not whatever a
 * capacity-limited dispatch would actually manage this tick). `weaken`
 * mode only ever populates `weakenThreads`; `grow-prep` populates both,
 * with `weakenThreads` sized to counteract the *uncapped* grow figure —
 * `applyPrepMode` separately re-derives its own dispatch-time weaken figure
 * off whatever grow threads capacity actually allowed, which is
 * deliberately not this function's concern.
 */
function computePrepNeed(ns: NS, target: string, server: Server, mode: 'weaken' | 'grow-prep'): { growThreads: number, weakenThreads: number } {
  const weakenPerThread = ns.weakenAnalyze(1)
  if (mode === 'weaken') {
    const securityGap = Math.max(0, (server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0))
    const weakenThreads = weakenPerThread > 0 ? Math.ceil(securityGap / weakenPerThread) : 0
    return { growThreads: 0, weakenThreads }
  }
  const hm = computeHackMath(ns, target)
  const currentMoney = Math.max(server.moneyAvailable ?? 0, 1)
  const moneyMax = server.moneyMax ?? 0
  const growThreads = currentMoney < moneyMax ? Math.max(0, Math.ceil(hm.growThreadsFor(currentMoney, moneyMax))) : 0
  const weakenThreads = growThreads > 0 && weakenPerThread > 0
    ? Math.ceil(ns.growthAnalyzeSecurity(growThreads) / weakenPerThread)
    : 0
  return { growThreads, weakenThreads }
}

/**
 * The RAM (GB) a session in `mode` would need to fully cover its own gap
 * in one shot — the basis `ensurePartition` sizes a session's exclusive
 * host partition against (doubled — see `PARTITION_HEADROOM_MULTIPLIER`).
 * Mirrors `computePrepNeed`'s uncapped ideal for `weaken`/`grow-prep`; for
 * `farm`, uses the already-computed `batchPlan`'s own thread counts times
 * how many batches it allows concurrently in flight — the true RAM ceiling
 * that mode will ever ask for, not just one batch's worth.
 */
function estimateNeedGB(
  ns: NS,
  target: string,
  server: Server,
  mode: Mode,
  batchPlan: BatchPlan | null,
  rams: ScriptRams,
): number {
  if (mode === 'farm') {
    if (!batchPlan)
      return 0
    const perBatch = batchPlan.hackThreads * rams.hack
      + batchPlan.growThreads * rams.grow
      + (batchPlan.weaken1Threads + batchPlan.weaken2Threads) * rams.weaken
    return perBatch * batchPlan.maxConcurrentBatches
  }
  const need = computePrepNeed(ns, target, server, mode)
  return need.growThreads * rams.grow + need.weakenThreads * rams.weaken
}

/**
 * Weaken-only or grow-prep stage for one session, dispatched across its
 * own exclusive `hosts` partition — see the module header comment's
 * partitioning section for why no host here can ever be shared with
 * another live session, and `hostTotalRam`'s own comment for why sizing
 * always recomputes from scratch against total (not free) RAM every call.
 *
 * Sizes to the *actual* gap that needs closing, not to pooled capacity —
 * see `computePrepNeed`'s own header comment for the exact math and why
 * capacity-based sizing turned out to waste most of a large fleet's
 * dispatched threads once capacity routinely exceeded what a target
 * actually needed. Whatever a session's own partition can't currently
 * cover of that need is simply left undone this tick (graceful
 * degradation, same as the rest of this file) — `ensurePartition` is what
 * grows a chronically undersized partition, not this function.
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
) {
  if (hosts.length === 0)
    return

  const ramSource = hostTotalRam(ns, hosts)
  const need = computePrepNeed(ns, target, server, mode)
  let growAssigned: Record<string, number> = {}
  let weakenAssigned: Record<string, number>

  if (mode === 'weaken') {
    weakenAssigned = allocateNeeded(ramSource, hosts, weakenScriptRam, need.weakenThreads)
  }
  else {
    growAssigned = allocateNeeded(ramSource, hosts, growScriptRam, need.growThreads)

    // Sized off what actually got dispatched (capacity-capped), not the
    // uncapped ideal above — if the partition couldn't fully cover
    // need.growThreads, the real security bump will be smaller than that
    // ideal implies.
    const actualGrowThreads = sumValues(growAssigned)
    const weakenPerThread = ns.weakenAnalyze(1)
    const neededWeakenThreads = actualGrowThreads > 0 && weakenPerThread > 0
      ? Math.ceil(ns.growthAnalyzeSecurity(actualGrowThreads) / weakenPerThread)
      : 0
    weakenAssigned = allocateNeeded(ramSource, hosts, weakenScriptRam, neededWeakenThreads)
  }

  for (const host of hosts) {
    const g = growAssigned[host] ?? 0
    const w = weakenAssigned[host] ?? 0
    const prev = prepAssignment[host]
    const changed = !prev || prev.target !== target || prev.growThreads !== g || prev.weakenThreads !== w

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
 * Grows (never shrinks) `session`'s exclusive host partition when its
 * cached `estimatedNeedGB` genuinely exceeds what it currently owns — a
 * no-op the vast majority of ticks, since prep mode's own need only ever
 * shrinks and farm mode's is stable between mode changes (see
 * `estimatedNeedGB`'s own field comment). On a real deficit, first pulls
 * from whatever's currently unassigned (`managedHosts` minus every
 * session's own `.hosts` — nothing else needs tracking, a session's hosts
 * fall back into that set the instant it's removed from `sessions`),
 * largest-RAM host first (fewest hosts spent per GB reserved), aiming for
 * `PARTITION_HEADROOM_MULTIPLIER * estimatedNeedGB` so it doesn't
 * immediately re-trigger next tick. If the unassigned pool alone can't
 * reach that target, evicts `sessions[index + 1 ..]` — strictly
 * lower-priority than `session` itself, since list order is priority
 * order — one at a time from the very end (`killSession` plus an
 * `'end-work'` log), folding each freed session's hosts into the
 * unassigned pool before checking again, until the target is met or
 * nothing's left to evict. If even that isn't enough, settles for
 * whatever's available — the same graceful degradation prep/farm dispatch
 * already fall back to when the whole fleet is genuinely RAM-starved.
 *
 * Deliberately does *not* top a session up toward the 2x target just
 * because idle capacity happens to be sitting around with no deficit —
 * that would let existing sessions quietly absorb small leftovers that
 * `main`'s extension check would otherwise use to start a whole new
 * session, which is exactly the behavior partitioning exists to enable.
 */
function ensurePartition(
  ns: NS,
  session: TargetSession,
  index: number,
  sessions: TargetSession[],
  managedHosts: Set<string>,
  prepAssignment: Record<string, PrepAssignment>,
) {
  if (sumValues(hostTotalRam(ns, session.hosts)) >= session.estimatedNeedGB)
    return

  const targetGB = session.estimatedNeedGB * PARTITION_HEADROOM_MULTIPLIER

  const unassignedHosts = () => {
    const owned = new Set(sessions.flatMap(s => s.hosts))
    return [...managedHosts].filter(h => !owned.has(h))
  }
  const growFromUnassigned = () => {
    const pool = unassignedHosts().sort((a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a))
    for (const host of pool) {
      if (sumValues(hostTotalRam(ns, session.hosts)) >= targetGB)
        break
      session.hosts.push(host)
    }
  }

  growFromUnassigned()
  while (sumValues(hostTotalRam(ns, session.hosts)) < targetGB && sessions.length > index + 1) {
    const evicted = sessions[sessions.length - 1]
    ns.print(`${evicted.target}: evicted — ${session.target} (priority ${index}) needs its hosts back.`)
    killSession(ns, evicted, prepAssignment)
    addMoneyFarmLog(ns, { action: 'end-work', target: evicted.target })
    sessions.length -= 1
    growFromUnassigned()
  }
}

/**
 * Mode evaluation, transition handling, and prep dispatch for one session
 * — everything gated on `STATE_CHECK_INTERVAL`. Batch dispatch itself
 * (needs the much tighter `BATCH_SPACING` cadence) is `tickDispatch`,
 * called separately every loop iteration. Does not touch `session.hosts` or
 * partitioning — the caller runs `ensurePartition` for this session right
 * after this returns, once `mode`/`batchPlan`/`estimatedNeedGB` are fresh.
 */
function tickSession(
  ns: NS,
  session: TargetSession,
  prepAssignment: Record<string, PrepAssignment>,
  rams: ScriptRams,
  now: number,
) {
  const server = ns.getServer(session.target)
  const mode = modeFor(server)
  const modeChanged = mode !== session.mode

  // Checked every STATE_CHECK_INTERVAL tick for every session, but only
  // actually logged when it differs from the last *logged* snapshot, or
  // when UPDATE_SERVER_HEARTBEAT_INTERVAL has elapsed since that last log
  // regardless — see that constant's own comment for why the heartbeat
  // exists (a well-tuned farm mode can legitimately return to the exact
  // same steady-state snapshot for minutes at a time, which is correct for
  // the drift-checkpoint purpose but leaves a money-over-time chart
  // looking silent). See money-farm-log/types.ts's updateServer schema
  // comment for what this doubles as (the absolute-security checkpoint a
  // deltaSecurity-summing reader should re-anchor to).
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
    session.estimatedNeedGB = estimateNeedGB(ns, session.target, server, mode, session.batchPlan, rams)
    if (session.batchPlan) {
      ns.print(
        `${session.target}: batch plan — ${session.batchPlan.hackThreads}h/${session.batchPlan.growThreads}g/`
        + `${session.batchPlan.weaken1Threads}w1/${session.batchPlan.weaken2Threads}w2 `
        + `(${(session.batchPlan.actualHackFraction * 100).toFixed(1)}% steal/batch), `
        + `weakenTime ${(session.batchPlan.weakenTime / 1000).toFixed(1)}s, `
        + `max ${session.batchPlan.maxConcurrentBatches} concurrent batches, `
        + `~${session.estimatedNeedGB.toFixed(1)}GB needed.`,
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
    applyPrepMode(ns, session.hosts, session.target, server, session.mode, rams.grow, rams.weaken, prepAssignment)
  }
}

/**
 * Config-file reconciliation: claims/releases hosts, self-heals a deleted
 * one, and re-picks the root's target (never regressing without clearing
 * `1.5x` hysteresis — see `pickTarget`). Returns the updated `sessions`
 * list and whether every dedicated host is gone (the caller should exit).
 * Only `sessions[0]` is ever replaced here — a root retarget kills the old
 * root and starts a fresh one, but every other session has no logical tie
 * to root's identity and is left running untouched. Taking `sessions` as a
 * plain parameter rather than reading/reassigning the caller's own `let`
 * directly sidesteps a real TS 4.9 control-flow-narrowing limitation hit
 * here live with the old `primary`/`secondary` fields: accessing a
 * `let`-declared union type's property inside a conditionally-`break`ing
 * block nested in a `while(true)` loop caused `tsc` to report the variable
 * as circularly self-referencing its own initializer — a compiler quirk,
 * not a real type issue, but this structure avoids it entirely rather than
 * fighting it.
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
    for (const session of sessions)
      session.hosts = session.hosts.filter(h => h !== host)
    ns.print(`${host}: released — no longer in ${CONFIG_FILE}.`)
  }

  for (const host of validHosts) {
    if (managedHosts.has(host))
      continue
    // Newly claimed: nothing of ours could be running here yet, so a full
    // killall is the one place that's still safe/correct — see the
    // module header comment. Left unassigned to any session's partition
    // until ensurePartition (or the extension check) claims it.
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
    const root = sessions[0]
    if (root) {
      killSession(ns, root, prepAssignment)
      addMoneyFarmLog(ns, { action: 'end-work', target: root.target })
    }
    addMoneyFarmLog(ns, { action: 'start-work', target: bestTarget, score: picked.score })
    return { sessions: [createSession(bestTarget), ...sessions.slice(1)], empty: false }
  }

  return { sessions, empty: false }
}

/**
 * Batch-dispatch tick for one session — a no-op unless it's actually
 * farming. Called every loop iteration (not gated on
 * `STATE_CHECK_INTERVAL`) so every session gets the tight `BATCH_SPACING`
 * cadence farm mode needs.
 */
function tickDispatch(ns: NS, session: TargetSession, rams: ScriptRams, now: number) {
  if (session.mode !== 'farm' || !session.batchPlan)
    return
  for (let i = session.inFlightBatches.length - 1; i >= 0; i--) {
    if (session.inFlightBatches[i].endsAt <= now)
      session.inFlightBatches.splice(i, 1)
  }
  if (session.inFlightBatches.length < session.batchPlan.maxConcurrentBatches) {
    const pids = tryDispatchBatch(ns, session.hosts, session.target, session.batchPlan, rams.hack, rams.grow, rams.weaken)
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
  // kills only a session's own tracked pids so hosts stay attributable to
  // the session that owns them): the whole daemon is going away, so every
  // session's work stops together, no partial preservation needed.
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

      // Priority order: tick each session (mode/estimatedNeedGB refresh),
      // then let it grow its own partition — including evicting anything
      // strictly lower-priority than itself — before moving to the next.
      // A session evicted this pass is simply gone by the time the loop
      // would have reached its old index; `sessions.length` shrinks and
      // the bound is rechecked every iteration.
      for (let i = 0; i < sessions.length; i++) {
        tickSession(ns, sessions[i], prepAssignment, rams, now)
        ensurePartition(ns, sessions[i], i, sessions, managedHosts, prepAssignment)
      }

      // Whatever's left unassigned after every session's own deficit is
      // satisfied is genuinely idle — worth starting a brand new session
      // over once it clears MIN_CHAIN_EXTENSION_THREADS, regardless of
      // what mode anything else is currently in (see the module header
      // comment's partitioning section for why this no longer waits on
      // the rest of the list reaching 'farm').
      const owned = new Set(sessions.flatMap(s => s.hosts))
      const unassignedHosts = [...managedHosts].filter(h => !owned.has(h))
      const unassignedGB = sumValues(hostFreeRam(ns, unassignedHosts))
      if (unassignedGB / Math.max(rams.weaken, 1) >= MIN_CHAIN_EXTENSION_THREADS) {
        const exclude = new Set(sessions.map(s => s.target))
        const nextPicked = pickTarget(ns, null, exclude)
        const nextTarget = nextPicked.target
        if (nextTarget) {
          ns.print(`${nextTarget}: starting new session (priority ${sessions.length}) — ${unassignedGB.toFixed(1)}GB unassigned.`)
          addMoneyFarmLog(ns, { action: 'start-work', target: nextTarget, score: nextPicked.score })
          sessions.push(createSession(nextTarget))
        }
      }
    }

    for (const session of sessions)
      tickDispatch(ns, session, rams, now)

    const anyFarming = sessions.some(s => s.mode === 'farm')
    await ns.sleep(anyFarming ? BATCH_SPACING : STATE_CHECK_INTERVAL)
  }
}
