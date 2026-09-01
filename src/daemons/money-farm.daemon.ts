import type { NS, Server } from '@ns'
import type { Mode, WorkerStatus } from '../ui/utils/money-farm-log/types'
import type { BatchPlan } from '../utils/hack-math'
import { getCgdStore } from '../cgd/store'
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
 * RAM entitlement — not a dependency chain.** `sessions[0]` (the root)
 * always farms the live-picked best target, same as `primary` always did;
 * `sessions[1..]` are additional targets opportunistically picked to soak
 * up whatever pooled RAM the root alone can't profitably use. List order is
 * priority order, not a runtime dependency: a session earlier in the list
 * outranks every session after it and can reclaim RAM from them (see
 * partitioning below), but a later session regressing to `weaken`/
 * `grow-prep` no longer tears down anything after it — that used to be
 * necessary when every session drew from one shared pool (a regression
 * changed how much of the pool the rest of the chain could safely assume),
 * but partitioning gives every session its own exclusive entitlement, so a
 * sibling's mode change simply can't affect it. `reconcileTargets` only
 * ever replaces `sessions[0]` on a root retarget (1.5x hysteresis, see
 * `pickTarget`) — `sessions[1..]` have no logical tie to root's identity
 * and are left running.
 *
 * **Partitioning: every session owns an exclusive number of equal-sized
 * slots on each host it touches (`TargetSession.hostSlots`), sized to
 * roughly double its own estimated need — not one shared pool split
 * proportionally per stage the way this used to work, and not whole hosts
 * either (see the next paragraph for why).** A managed host divides into
 * `totalSlots` equal-sized chunks of `SLOT_SIZE_GB` each (`slotSizeGB`); a
 * host smaller than that is just one slot, sized to itself, so this whole
 * mechanism is a no-op for any host that never exceeds `SLOT_SIZE_GB` —
 * degrades to exactly the original whole-host behavior there. A given slot
 * belongs to at most one session; whatever's left over (every host's
 * unclaimed slots, `unclaimedSlots`) is "unassigned" and needs no separate
 * bookkeeping — a session's slots fall back into that count the instant
 * it's removed from `sessions` (eviction, a session dying, config release),
 * and a freshly created session simply starts with `hostSlots: {}`.
 * `ensurePartition` (run once per session per `STATE_CHECK_INTERVAL` tick,
 * in priority order) grows a session's entitlement only on a genuine
 * deficit — its cached `estimatedNeedGB` (see `TargetSession`'s own field
 * comment) exceeding what it currently owns — first from whatever's
 * unassigned, then, if that's not enough, by evicting `sessions[i+1..]`
 * (strictly lower-priority, since list order is priority order) one at a
 * time from the very end until the target is met or nothing's left to
 * evict. This exists specifically because a fixed-size fleet's RAM can
 * badly outstrip what a single target can safely absorb (`computeBatchPlan`'s
 * own `maxConcurrentBatches` cap) — without a second, third, ... session
 * competing for the leftover, most of a large fleet just sits idle. The
 * previous *whole-host* version of this design also solved that, but a
 * host can't be split: with a heterogeneous fleet (a handful of
 * near-max-RAM hosts alongside many modest ones — Bitburner's purchasable
 * cap is 1,048,576GB, 2^20), a session needing a few thousand GB could end
 * up owning an entire outlier host hundreds of times larger than its real
 * need, confirmed live, starving every other session even though almost
 * none of that host was actually being used. Slots bound the overshoot on
 * any single grow to `SLOT_SIZE_GB` regardless of how large the
 * contributing host is, and `ensurePartition`'s own slot-picking prefers a
 * host the session already holds a slot on before ever claiming a fresh
 * one, so a session still tends to consolidate onto few hosts rather than
 * spreading thin — it just isn't forced to take an entire oversized host
 * to get there.
 *
 * **Sharing a host across sessions is safe without a live-usage ledger,
 * specifically because slot ownership is mutually exclusive and this
 * daemon is the sole writer to every managed host.** Prep mode
 * (`applyPrepMode`) sizes directly off `sessionHostCapacityGB` — a
 * session's own slot count times that host's slot size — never a live
 * `ns.getServerUsedRam` read: since two sessions' slot counts on one host
 * can never sum past that host's `totalSlots`, each session sizing
 * strictly within its own fixed entitlement can never collectively exceed
 * the host's real capacity, however the live usage happens to be
 * distributed at the instant of the check. This is the same anti-self-
 * reference trick the original *whole-host* `hostTotalRam`-based sizing
 * used (see that function's own comment) — sizing off a session's own
 * fixed ceiling, not a live reading, whether that ceiling is "the whole
 * host" or "my own slots on it" doesn't change the reasoning. Farm mode
 * (`tryDispatchBatch`) still needs to know how much of its own entitlement
 * is currently free (to avoid double-dispatching on top of its own
 * still-in-flight batches, same as before), but computes that from this
 * session's own tracked `InFlightBatch.hostUsage` rather than a live
 * host-wide read — a live read on a shared host would include a
 * sibling's usage too, which says nothing about how much of this
 * session's own slots are free. `sessionFreeGBPerHost`'s own comment
 * covers this in full.
 *
 * **`prepAssignment` is keyed by `target::host`, not bare `host`.** A
 * genuinely new correctness requirement introduced by slot-sharing: two
 * different sessions can now legitimately both be in prep mode on the same
 * physical host at once (each on its own slots), and a bare-hostname key
 * would let the second session's `applyPrepMode` call silently overwrite
 * the first's tracked pids. `prepKey(target, host)` composes the key;
 * `killSession` still finds a session's own entries by filtering on the
 * stored `.target` field (unaffected by the key format change), and
 * `reconcileTargets`'s release path matches by key suffix instead of exact
 * key. Bitburner hostnames never contain `::`, so the separator is
 * unambiguous.
 *
 * **Per-session precise kill, never `ns.killall`, once a host has ever been
 * assigned to a session.** `ns.killall(host)` is still used exactly twice:
 * seizing a *newly claimed* host (nothing of ours could be running there
 * yet, so wiping everything is safe and matches `xp-farm.daemon.ts`'s
 * identical claim behavior) and releasing a host dropped from the config
 * file (handing it back fully clean, and stripped out of every session's
 * `.hostSlots` plus every matching `prepAssignment` entry). Everywhere else
 * — a session's own mode transitions, desync fallback, eviction, prep
 * relaunches — kills only that session's own tracked pids (`ns.exec`'s
 * return value, stored in `PrepAssignment`/`InFlightBatch`), which is what
 * makes host-sharing safe to begin with: nothing here ever needs to guess
 * which pid on a shared host belongs to which session, since every pid is
 * already precisely attributed at launch time.
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
 * How generously `ensurePartition` sizes a session's entitlement once it's
 * already forced to grow it: the target is
 * `estimatedNeedGB * PARTITION_HEADROOM_MULTIPLIER`, not the bare need
 * itself, so a session doesn't immediately re-trigger another grow (and,
 * worse, another eviction) the very next time its need ticks up slightly.
 * Whether a grow triggers at all is still gated on the *bare* need exceeding
 * current capacity (see `ensurePartition`) — this constant only controls
 * how far past that point it reaches once it's already growing.
 */
const PARTITION_HEADROOM_MULTIPLIER = 2
/**
 * Fleet-wide, fixed slot size (GB) a managed host divides into for
 * partitioning purposes — see the module header comment's partitioning
 * section for the full reasoning. A host smaller than this is just one
 * slot, sized to itself (`slotSizeGB`). Power-of-2, same as every
 * Bitburner server size, so a host divides into slots with zero
 * remainder. Chosen relative to a typical session's own farm-mode need (a
 * few thousand GB observed live) so a session spans several slots rather
 * than being dwarfed by, or barely fitting inside, a single one. Tunable.
 */
const SLOT_SIZE_GB = 512
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
 * One (session, host) pair's current prep-mode assignment, including the
 * pids it was launched with (0 = that leg wasn't launched, e.g. 0 grow
 * threads) so it can be torn down precisely later — see the module header
 * comment on why this replaced `ns.killall(host)` for anything but
 * claim/release, and on why the `Record` this lives in is keyed by
 * `prepKey(target, host)` rather than bare `host` now that a host can
 * carry more than one session's assignment at once.
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
  /**
   * GB this specific batch committed per host, across all four legs —
   * what `sessionFreeGBPerHost` subtracts from a session's own entitlement
   * to know how much room it has left, without ever needing a live
   * host-wide usage read (see that function's own header comment). Pruned
   * from `session.inFlightBatches` at the exact same `endsAt` moment
   * `tickDispatch` already uses to free up a `maxConcurrentBatches` slot —
   * no separate expiry logic.
   */
  hostUsage: Record<string, number>
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
   * This session's exclusive slot count on each host it touches (host ->
   * slot count) — never shared with another live session at the *slot*
   * level, though the same physical host can appear in more than one
   * session's `hostSlots` now (see the module header comment's
   * partitioning section). Starts empty on a brand new session;
   * `ensurePartition` grows it on the very first `tickSession` call once a
   * real mode (and thus a real `estimatedNeedGB`) is known.
   */
  hostSlots: Record<string, number>
  /**
   * The RAM (GB) this session's *current* mode would need to fully cover
   * its own gap in one shot — recomputed only when `mode` actually changes
   * (alongside `batchPlan`), not every tick: prep mode's real need only
   * ever shrinks as its gap closes, and farm mode's is stable between mode
   * changes (tied to the also-cached `batchPlan`), so a mode transition is
   * the only moment this figure can jump. `ensurePartition` compares a
   * session's current entitlement against this to decide whether it needs
   * to grow. 0 until the session's first real mode is assigned.
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
    hostSlots: {},
    estimatedNeedGB: 0,
  }
}

/** The flat list of hostnames `session` currently holds any slots on. */
function sessionHostList(session: TargetSession): string[] {
  return Object.keys(session.hostSlots)
}

function prepKey(target: string, host: string): string {
  return `${target}::${host}`
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

function hostTotalRam(ns: NS, hosts: string[]): Record<string, number> {
  const totalRam: Record<string, number> = {}
  for (const host of hosts)
    totalRam[host] = ns.getServerMaxRam(host)
  return totalRam
}

/**
 * One host's own slot size (GB) — `SLOT_SIZE_GB`, or the host's own total
 * RAM if that's smaller. A host below the fleet-wide slot size is just one
 * slot, which degrades every slot-based function in this file back to
 * plain whole-host behavior for it — see the module header comment's
 * partitioning section.
 */
function slotSizeGB(ns: NS, host: string): number {
  return Math.min(SLOT_SIZE_GB, ns.getServerMaxRam(host))
}

/** How many equal-sized slots `host` divides into. */
function totalSlots(ns: NS, host: string): number {
  const size = slotSizeGB(ns, host)
  return size > 0 ? Math.floor(ns.getServerMaxRam(host) / size) : 0
}

/** How many of `host`'s total slots aren't currently claimed by any session. */
function unclaimedSlots(ns: NS, host: string, sessions: TargetSession[]): number {
  const claimed = sessions.reduce((sum, s) => sum + (s.hostSlots[host] ?? 0), 0)
  return totalSlots(ns, host) - claimed
}

/**
 * `session`'s own RAM entitlement (GB) on one host — its slot count there
 * times that host's own slot size. Deliberately never touches live usage:
 * see the module header comment's shared-host-safety paragraph for why a
 * fixed entitlement, not a live reading, is what makes sharing a host
 * across sessions safe without a usage ledger.
 */
function sessionHostCapacityGB(ns: NS, session: TargetSession, host: string): number {
  return (session.hostSlots[host] ?? 0) * slotSizeGB(ns, host)
}

/** `session`'s total RAM entitlement (GB) across every host it holds any slots on. */
function sessionCapacityGB(ns: NS, session: TargetSession): number {
  return sessionHostList(session).reduce((sum, host) => sum + sessionHostCapacityGB(ns, session, host), 0)
}

/**
 * A flat, unslotted host list's raw total RAM (GB) — used only for the
 * fleet-wide figure (`pushMoneyFarmStats`'s `totalRam`), which has no
 * per-session entitlement to respect. Anything session-specific goes
 * through `sessionCapacityGB` instead.
 */
function fleetTotalGB(ns: NS, hosts: string[]): number {
  return sumValues(hostTotalRam(ns, hosts))
}

/**
 * `session`'s own remaining room (GB) on each host it holds slots on right
 * now: its entitlement (`sessionHostCapacityGB`) minus whatever this
 * session's own currently-tracked `inFlightBatches` have already committed
 * there. Deliberately never consults a live `ns.getServerUsedRam` read —
 * on a host shared between sessions, that would include a sibling's usage
 * too, which says nothing about how much of *this* session's own slots
 * are free. Safe without a live check specifically because slot ownership
 * is mutually exclusive (see `ensurePartition`) and every GB this session
 * ever commits to a host is tracked here until `tickDispatch` prunes it at
 * the exact moment those processes actually exit — no separate ledger to
 * drift out of sync, since it's read from the same struct that timing
 * already relies on.
 */
function sessionFreeGBPerHost(ns: NS, session: TargetSession): Record<string, number> {
  const committed: Record<string, number> = {}
  for (const batch of session.inFlightBatches) {
    for (const [host, gb] of Object.entries(batch.hostUsage))
      committed[host] = (committed[host] ?? 0) + gb
  }
  const free: Record<string, number> = {}
  for (const host of sessionHostList(session))
    free[host] = Math.max(0, sessionHostCapacityGB(ns, session, host) - (committed[host] ?? 0))
  return free
}

/**
 * `session`'s own currently-committed RAM (GB) — farm mode's own
 * `inFlightBatches[].hostUsage` (this session's exact tracked dispatch,
 * see `tryDispatchBatch`), or prep mode's `prepAssignment` entries for
 * hosts this session owns. A session is only ever in one mode at a time (a
 * mode change tears everything down via `killSession`), so exactly one of
 * the two sources is ever non-empty for a given session.
 */
function sessionUsedGB(session: TargetSession, prepAssignment: Record<string, PrepAssignment>, rams: ScriptRams): number {
  let used = 0
  for (const batch of session.inFlightBatches) {
    for (const gb of Object.values(batch.hostUsage)) used += gb
  }
  for (const host of sessionHostList(session)) {
    const p = prepAssignment[prepKey(session.target, host)]
    if (p)
      used += p.growThreads * rams.grow + p.weakenThreads * rams.weaken
  }
  return used
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
 * decides what (if anything) to set next. Does not touch
 * `session.hostSlots` — a killed/regressing session that stays in
 * `sessions` keeps its entitlement; a session actually being removed from
 * `sessions` (eviction, root retarget, config release) has its slots fall
 * back into the unassigned count automatically once it's no longer
 * referenced there, with no separate cleanup needed here.
 */
function killSession(ns: NS, session: TargetSession, prepAssignment: Record<string, PrepAssignment>) {
  for (const batch of session.inFlightBatches) {
    for (const pid of batch.pids) killTracked(ns, pid)
  }
  session.inFlightBatches.length = 0
  for (const key of Object.keys(prepAssignment)) {
    if (prepAssignment[key].target === session.target) {
      killTracked(ns, prepAssignment[key].growPid)
      killTracked(ns, prepAssignment[key].weakenPid)
      delete prepAssignment[key]
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
 * session's entitlement against the *ideal* need, not whatever a
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
 * entitlement against (doubled — see `PARTITION_HEADROOM_MULTIPLIER`).
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
 * own exclusive slot entitlement — see the module header comment's
 * shared-host-safety paragraph for why sizing off `sessionHostCapacityGB`
 * (a fixed ceiling) rather than a live read is what makes this safe even
 * when a host is shared with another session.
 *
 * Sizes to the *actual* gap that needs closing, not to pooled capacity —
 * see `computePrepNeed`'s own header comment for the exact math and why
 * capacity-based sizing turned out to waste most of a large fleet's
 * dispatched threads once capacity routinely exceeded what a target
 * actually needed. Whatever a session's own entitlement can't currently
 * cover of that need is simply left undone this tick (graceful
 * degradation, same as the rest of this file) — `ensurePartition` is what
 * grows a chronically undersized entitlement, not this function.
 */
function applyPrepMode(
  ns: NS,
  session: TargetSession,
  server: Server,
  mode: 'weaken' | 'grow-prep',
  growScriptRam: number,
  weakenScriptRam: number,
  prepAssignment: Record<string, PrepAssignment>,
) {
  const hosts = sessionHostList(session)
  if (hosts.length === 0)
    return

  const target = session.target
  const ramSource: Record<string, number> = {}
  for (const host of hosts)
    ramSource[host] = sessionHostCapacityGB(ns, session, host)

  const need = computePrepNeed(ns, target, server, mode)
  let growAssigned: Record<string, number> = {}
  let weakenAssigned: Record<string, number>

  if (mode === 'weaken') {
    weakenAssigned = allocateNeeded(ramSource, hosts, weakenScriptRam, need.weakenThreads)
  }
  else {
    growAssigned = allocateNeeded(ramSource, hosts, growScriptRam, need.growThreads)

    // Sized off what actually got dispatched (capacity-capped), not the
    // uncapped ideal above — if the entitlement couldn't fully cover
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
    const key = prepKey(target, host)
    const prev = prepAssignment[key]
    const changed = !prev || prev.growThreads !== g || prev.weakenThreads !== w

    if (changed) {
      if (prev) {
        killTracked(ns, prev.growPid)
        killTracked(ns, prev.weakenPid)
      }
      ns.print(`${host}: prepping ${target} (${mode}) — ${g}g / ${w}w.`)
      const growPid = g > 0 ? ns.exec(GROW_SCRIPT, host, g, target, 0, g, '--port', MONEY_FARM_PORT) : 0
      const weakenPid = w > 0 ? ns.exec(WEAKEN_SCRIPT, host, w, target, 0, w, '--port', MONEY_FARM_PORT) : 0
      prepAssignment[key] = { target, growThreads: g, weakenThreads: w, growPid, weakenPid }
    }
  }
}

/**
 * Tries to dispatch exactly one HWGW batch across `session`'s own
 * remaining entitlement (`sessionFreeGBPerHost` — its slots minus what its
 * own other in-flight batches already committed, never a live host-wide
 * read; see that function's own header comment for why). Returns null
 * (nothing launched — safe to retry next tick) if any of the four legs
 * can't be fully covered; only calls `ns.exec` once every leg is confirmed
 * to fit, returning every launched pid plus the exact GB this batch
 * committed per host, so the caller can track both precisely.
 */
function tryDispatchBatch(
  ns: NS,
  session: TargetSession,
  plan: BatchPlan,
  hackScriptRam: number,
  growScriptRam: number,
  weakenScriptRam: number,
): { pids: number[], hostUsage: Record<string, number> } | null {
  const hosts = sessionHostList(session)
  const target = session.target
  const freeRam = sessionFreeGBPerHost(ns, session)

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

  const hostUsage: Record<string, number> = {}
  const addUsage = (assigned: Record<string, number>, scriptRam: number) => {
    for (const [host, threads] of Object.entries(assigned))
      hostUsage[host] = (hostUsage[host] ?? 0) + threads * scriptRam
  }
  addUsage(hackAssigned, hackScriptRam)
  addUsage(growAssigned, growScriptRam)
  addUsage(weaken1Assigned, weakenScriptRam)
  addUsage(weaken2Assigned, weakenScriptRam)

  const pids: number[] = []
  for (const [host, threads] of Object.entries(hackAssigned))
    pids.push(ns.exec(HACK_SCRIPT, host, threads, target, plan.delayHack, threads, '--once', '--port', MONEY_FARM_PORT))
  for (const [host, threads] of Object.entries(growAssigned))
    pids.push(ns.exec(GROW_SCRIPT, host, threads, target, plan.delayGrow, threads, '--once', '--port', MONEY_FARM_PORT))
  for (const [host, threads] of Object.entries(weaken1Assigned))
    pids.push(ns.exec(WEAKEN_SCRIPT, host, threads, target, plan.delayWeaken1, threads, '--once', '--port', MONEY_FARM_PORT))
  for (const [host, threads] of Object.entries(weaken2Assigned))
    pids.push(ns.exec(WEAKEN_SCRIPT, host, threads, target, plan.delayWeaken2, threads, '--once', '--port', MONEY_FARM_PORT))
  return { pids, hostUsage }
}

/**
 * Grows (never shrinks) `session`'s exclusive slot entitlement when its
 * cached `estimatedNeedGB` genuinely exceeds what it currently owns — a
 * no-op the vast majority of ticks, since prep mode's own need only ever
 * shrinks and farm mode's is stable between mode changes (see
 * `estimatedNeedGB`'s own field comment). On a real deficit, first claims
 * unclaimed slots one at a time (`unclaimedSlots`), preferring a host the
 * session already holds a slot on before ever claiming a fresh one (fewer
 * distinct hosts in a session's footprint means fewer `ns.exec` calls per
 * batch dispatch) — falling back to any unclaimed slot, smallest-host
 * first purely as a deterministic tiebreak (see the module header
 * comment's partitioning section for why overshoot itself no longer
 * depends on host size once claims happen one slot at a time). Aims for
 * `PARTITION_HEADROOM_MULTIPLIER * estimatedNeedGB` so it doesn't
 * immediately re-trigger next tick. If unclaimed slots alone can't reach
 * that target, evicts `sessions[index + 1 ..]` — strictly lower-priority
 * than `session` itself, since list order is priority order — one at a
 * time from the very end (`killSession` plus an `'end-work'` log), which
 * frees every slot that session held (on any host) the instant it's
 * spliced out, before checking again, until the target is met or nothing's
 * left to evict. If even that isn't enough, settles for whatever's
 * available — the same graceful degradation prep/farm dispatch already
 * fall back to when the whole fleet is genuinely RAM-starved.
 *
 * Deliberately does *not* top a session up toward the 2x target just
 * because idle slots happen to be sitting around with no deficit — that
 * would let existing sessions quietly absorb small leftovers that `main`'s
 * extension check would otherwise use to start a whole new session, which
 * is exactly the behavior partitioning exists to enable.
 */
function ensurePartition(
  ns: NS,
  session: TargetSession,
  index: number,
  sessions: TargetSession[],
  managedHosts: Set<string>,
  prepAssignment: Record<string, PrepAssignment>,
) {
  if (sessionCapacityGB(ns, session) >= session.estimatedNeedGB)
    return

  const targetGB = session.estimatedNeedGB * PARTITION_HEADROOM_MULTIPLIER

  const growSlots = () => {
    while (sessionCapacityGB(ns, session) < targetGB) {
      let pick = sessionHostList(session).find(host => unclaimedSlots(ns, host, sessions) > 0)
      if (!pick) {
        const candidates = [...managedHosts]
          .filter(host => unclaimedSlots(ns, host, sessions) > 0)
          .sort((a, b) => ns.getServerMaxRam(a) - ns.getServerMaxRam(b))
        pick = candidates[0]
      }
      if (!pick)
        break
      session.hostSlots[pick] = (session.hostSlots[pick] ?? 0) + 1
    }
  }

  growSlots()
  while (sessionCapacityGB(ns, session) < targetGB && sessions.length > index + 1) {
    const evicted = sessions[sessions.length - 1]
    ns.print(`${evicted.target}: evicted — ${session.target} (priority ${index}) needs its slots back.`)
    killSession(ns, evicted, prepAssignment)
    addMoneyFarmLog(ns, { action: 'end-work', target: evicted.target })
    sessions.length -= 1
    growSlots()
  }
}

/**
 * Mode evaluation, transition handling, and prep dispatch for one session
 * — everything gated on `STATE_CHECK_INTERVAL`. Batch dispatch itself
 * (needs the much tighter `BATCH_SPACING` cadence) is `tickDispatch`,
 * called separately every loop iteration. Does not touch
 * `session.hostSlots` or partitioning — the caller runs `ensurePartition`
 * for this session right after this returns, once
 * `mode`/`batchPlan`/`estimatedNeedGB` are fresh.
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
    applyPrepMode(ns, session, server, session.mode, rams.grow, rams.weaken, prepAssignment)
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
    for (const key of Object.keys(prepAssignment)) {
      if (key.endsWith(`::${host}`))
        delete prepAssignment[key]
    }
    for (const session of sessions)
      delete session.hostSlots[host]
    ns.print(`${host}: released — no longer in ${CONFIG_FILE}.`)
  }

  for (const host of validHosts) {
    if (managedHosts.has(host))
      continue
    // Newly claimed: nothing of ours could be running here yet, so a full
    // killall is the one place that's still safe/correct — see the
    // module header comment. Left unassigned until ensurePartition (or
    // the extension check) claims a slot on it.
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
    const result = tryDispatchBatch(ns, session, session.batchPlan, rams.hack, rams.grow, rams.weaken)
    if (result)
      session.inFlightBatches.push({ endsAt: now + session.batchPlan.totalDuration, pids: result.pids, hostUsage: result.hostUsage })
  }
}

/**
 * Snapshots every session's own entitlement (reserved RAM, actually-used
 * RAM, current mode) plus the fleet-wide total into `cgd.store`'s
 * `moneyFarm` field — see that field's own doc comment (`cgd/types.ts`)
 * for why a non-tiered daemon pushing here is fine (`window-cgd.ts`'s
 * accessor is explicitly safe to call from any script) and why `reserved`
 * in particular can't be derived any other way (it's this daemon's own
 * internal partition bookkeeping, not anything `ns.ps` process args
 * expose). Reuses `hostTotalRam`, `sessionCapacityGB`, and `sessionUsedGB`,
 * all already tracked/computed elsewhere in this file, so this adds no new
 * RAM cost. A session with no mode yet (created this tick, not ticked once
 * itself yet) is skipped — nothing meaningful to report until its own
 * entitlement exists. Wrapped in try/catch, same reasoning as
 * `stat-push.ts`'s own provider loop: one failed push here shouldn't take
 * down the whole daemon's main loop.
 */
function pushMoneyFarmStats(
  ns: NS,
  sessions: TargetSession[],
  managedHosts: Set<string>,
  prepAssignment: Record<string, PrepAssignment>,
  rams: ScriptRams,
) {
  try {
    const totalRam = fleetTotalGB(ns, [...managedHosts])
    const perTarget = sessions
      .filter((s): s is TargetSession & { mode: Mode } => s.mode !== null)
      .map(s => ({
        target: s.target,
        mode: s.mode,
        reserved: sessionCapacityGB(ns, s),
        used: sessionUsedGB(s, prepAssignment, rams),
      }))
    getCgdStore().setState({ moneyFarm: { totalRam, perTarget } })
  }
  catch {
    // See this function's own header comment.
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
  // kills only a session's own tracked pids so a shared host's other
  // session isn't affected): the whole daemon is going away, so every
  // session's work stops together, no partial preservation needed.
  ns.atExit(() => {
    for (const host of managedHosts) {
      if (ns.serverExists(host))
        ns.killall(host)
    }
    // Clears the stale snapshot rather than leaving the last-known state
    // sitting in the store once this daemon is actually gone — see
    // pushMoneyFarmStats's own header comment.
    try {
      getCgdStore().setState({ moneyFarm: undefined })
    }
    catch {
      // Same reasoning as pushMoneyFarmStats's own catch.
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
      // then let it grow its own entitlement — including evicting anything
      // strictly lower-priority than itself — before moving to the next.
      // A session evicted this pass is simply gone by the time the loop
      // would have reached its old index; `sessions.length` shrinks and
      // the bound is rechecked every iteration.
      for (let i = 0; i < sessions.length; i++) {
        tickSession(ns, sessions[i], prepAssignment, rams, now)
        ensurePartition(ns, sessions[i], i, sessions, managedHosts, prepAssignment)
      }

      // Whatever unclaimed slots remain after every session's own deficit
      // is satisfied are genuinely idle — worth starting a brand new
      // session over once they clear MIN_CHAIN_EXTENSION_THREADS,
      // regardless of what mode anything else is currently in (see the
      // module header comment's partitioning section for why this no
      // longer waits on the rest of the list reaching 'farm'). An
      // unclaimed slot's GB is always exactly free — nothing ever runs
      // outside its owning session's own entitlement — so no live read is
      // needed here either.
      const unassignedGB = [...managedHosts]
        .reduce((sum, host) => sum + unclaimedSlots(ns, host, sessions) * slotSizeGB(ns, host), 0)
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

      pushMoneyFarmStats(ns, sessions, managedHosts, prepAssignment, rams)
    }

    for (const session of sessions)
      tickDispatch(ns, session, rams, now)

    const anyFarming = sessions.some(s => s.mode === 'farm')
    await ns.sleep(anyFarming ? BATCH_SPACING : STATE_CHECK_INTERVAL)
  }
}
