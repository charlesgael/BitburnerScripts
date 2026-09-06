import type { NS, ScriptArg, Server } from '@ns'
import type { Mode, WorkerStatus } from '../lib/steady-farm/types'
import type { BatchPlan, HackMath } from '../utils/hack-math'
import { addSteadyFarmLog } from '../lib/steady-farm'
import {
  STEADY_FARM_GROW_SCRIPT as GROW_SCRIPT,
  STEADY_FARM_HACK_SCRIPT as HACK_SCRIPT,
  STEADY_FARM_WEAKEN_SCRIPT as WEAKEN_SCRIPT,
} from '../lib/steady-farm/config'
import { parseArgs } from '../utils/args'
import { computeBatchPlan, computeHackMath, computePrepNeed } from '../utils/hack-math'
import { STEADY_FARM_PORT } from '../utils/ports.lib'
import { allocateNeeded, sumValues } from '../utils/thread-balance'

/**
 * Background orchestrator for the Steady Farm feature — an offline-safe
 * alternative to `money-farm.daemon.ts`'s precision HWGW batching, built
 * specifically because that system can't be extrapolated by Bitburner's
 * offline-gains calculator: dynamic target selection and constantly
 * replaced one-shot (`--once`) batch legs both need a live orchestrator to
 * keep re-dispatching, which the offline calculator has no way to
 * simulate. It only extrapolates scripts it can see running a stable
 * hack/grow/weaken loop at the moment you disconnect — exactly what
 * `xp-farm.daemon.ts`'s own continuous grow/weaken loops already are,
 * which is the shape this daemon reproduces for a *money*-earning HWGW
 * cycle instead of an XP-earning grow/weaken one.
 *
 * **One target per instance, but multiple instances can run at once.**
 * Hostnames and an optional `--target` pin are positional/flag launch
 * arguments, not a shared config file — `run daemons/steady-farm.daemon.js
 * --target foo host1 host2` dedicates `host1`/`host2` to farming `foo`
 * specifically; omitting `--target` auto-picks one instead (see
 * `pickTarget` below) and behaves like the very first version of this
 * daemon did. Launching several instances, each with its own `--target`
 * and its own disjoint slice of hostnames, lets you farm multiple targets
 * across one fleet at once — deliberately *not* a money-farm-style runtime
 * partition system: the player decides the host split at launch time, the
 * same explicit-assignment principle every other mutual-exclusion boundary
 * in this project already relies on, rather than negotiating shared RAM at
 * runtime. Two instances pinned to the *same* target (or two unpinned
 * ones) refuse to coexist — see `main`'s own duplicate check — but nothing
 * stops two different targets' instances from listing overlapping
 * hostnames if you tell them to; that's on you to avoid, same as nothing
 * else in this project automatically protects against a host being
 * double-dedicated across features either.
 *
 * **Stability over agility.** Unlike money-farm's chain of competing
 * sessions, an unpinned instance only ever replaces its current target if
 * it stops qualifying, or a candidate scores at least `RETARGET_HYSTERESIS`
 * (5x) higher — a much wider margin than money-farm's own 1.5x, since here
 * a swap means tearing down and rebuilding the entire wave series from
 * scratch, not just redirecting one session. `pickTarget` reuses
 * money-farm's `moneyMax * hackChance / weakenTime` scoring (the base-NS
 * version, not money-farm's newer Formulas-aware refinement — deliberately
 * simpler, consistent with this daemon's whole stability-over-precision
 * bias). A pinned instance never calls `pickTarget` at all.
 *
 * **Same three stages as money-farm** (`weaken` → `grow-prep` → `farm`,
 * `modeFor`'s thresholds identical), reusing `computePrepNeed` from
 * `utils/hack-math.ts` for need-based prep sizing — already continuous-loop
 * dispatch even in money-farm's own version, so prep's own offline-safety
 * story is unchanged; this daemon just has no partition/slot system,
 * always sizing prep against its entire (instance-specific) dedicated
 * fleet since there's only ever one target competing for it.
 *
 * **Farm mode launches self-sustaining wave-sets instead of live-dispatched
 * batches.** `computeBatchPlan` (reused for its thread counts only — see
 * below for why its own timing/`maxConcurrentBatches` aren't) still
 * supplies the community-standard H→W1→G→W2 landing order. The difference
 * is entirely in how those legs get launched: money-farm's
 * `tryDispatchBatch` calls `ns.exec` with `--once` every `BATCH_SPACING`
 * (100ms) forever, needing the daemon to keep running to keep dispatching.
 * This daemon instead launches every leg of every wave exactly once, with
 * no `--once` flag at all (a genuine continuous loop, same as
 * `hack.daemon.ts`/`grow.daemon.ts`/`weaken.daemon.ts` support already),
 * and never touches them again unless one dies.
 *
 * **Waves never overlap — one full H,W,G,W cycle always lands and clears
 * before the next wave's hack lands.** Confirmed live as necessary:
 * reusing money-farm's `BATCH_SPACING` (100ms) for the launch-time stagger
 * packed every wave's landings so tightly together they were effectively
 * simultaneous — fine for money-farm, whose live orchestrator watches and
 * corrects any resulting drift within one `STATE_CHECK_INTERVAL` tick, but
 * this daemon has no live orchestrator once a wave series is launched, so
 * overlapping hacks have nothing catching the compounding drift. `WAVE_LEG_GAP_MS`
 * (2s) separates the four legs *within* one wave; `WAVE_SERIES_GAP_MS`
 * (14s), on top of that, separates one wave's last landing from the next
 * wave's first — see `seriesTiming`'s own header comment for exactly how
 * these combine into "how many whole waves fit per weaken cycle."
 *
 * The staggering itself is still achieved entirely through *launch
 * timing*, not per-iteration delay tricks — worth spelling out, since a
 * fixed-delay `sleep(delay); act(); repeat` loop can only produce landings
 * at multiples of its own period (`delay + actionTime`); it cannot land
 * once at time X and then repeat at a *different* period Y. So every leg
 * of every wave uses the *same* period (`seriesTiming`'s own `period`,
 * anchored on `weakenTime` since weaken is always the longest of the three
 * base actions), with its own delay computed as `period - ownActionTime`
 * (hack and weaken1/weaken2 differ, since their action times differ).
 * Since every leg's own loop then has an identical period, whatever
 * relative offset exists between them *at the moment they're launched*
 * persists forever, automatically — `launchWaves` just launches hack,
 * sleeps `WAVE_LEG_GAP_MS`, launches weaken1, sleeps, launches grow,
 * sleeps, launches weaken2, sleeps `WAVE_SERIES_GAP_MS` (not
 * `WAVE_LEG_GAP_MS` — the bigger inter-wave gap), then moves into the next
 * wave's hack — `4 * numWaves` processes total, each started exactly once.
 *
 * **Whole wave per host, not cross-host leg-splitting.** `planWaves` finds,
 * for each of up to `seriesTiming`'s `maxWaves` candidates, a single host
 * with enough free RAM for that wave's entire 4-leg cost; a wave that
 * doesn't fit anywhere simply isn't launched. Simpler than money-farm's
 * `distributeThreads`-per-category model, at the cost of some fragmentation
 * waste on an odd-sized fleet — an accepted simplification given this
 * daemon's whole purpose is stability, not maximum RAM efficiency. This is
 * safe precisely *because* every wave's thread counts come from one global
 * `computeBatchPlan` call, not independently recomputed per host — packing
 * a fixed, already-safe number of pre-sized waves onto hosts never risks
 * the over-hacking a truly independent per-host calculation would.
 *
 * **Supervision, not orchestration.** The periodic tick only relaunches
 * something that died unexpectedly (a leg crashed, or was manually
 * killed) — never proactively touches a healthy wave. Rather than
 * surgically repairing one dead leg mid-cycle (fragile: the other three
 * legs of that wave are still mid-cycle at their own arbitrary phase, so a
 * partial relaunch can't cleanly re-derive the right stagger), a dead leg
 * or a sustained security desync both trigger the same full rebuild path
 * as a mode change: tear everything down, let the next tick's `modeFor`
 * re-evaluate from scratch.
 *
 * **`modeFor` is never consulted while already farming.** A hack or grow
 * leg landing routinely pushes security (and money) off pristine for the
 * `WAVE_LEG_GAP_MS` gap before its own compensating weaken lands — expected,
 * self-correcting, and not a desync at all. Confirmed live: re-running
 * `modeFor` on the raw per-tick snapshot the same way the not-yet-farming
 * branch does caught this normal bump on essentially every tick and tore
 * the whole wave series down before its own weaken ever got a chance to
 * land, oscillating farm/grow-prep/weaken forever. So the farm branch below
 * decides purely from `allWavesHealthy` plus the same sustained
 * (`DESYNC_STRIKES_TO_FALLBACK`-consecutive-tick) security check — `modeFor`
 * only ever runs in the *other* branch, driving the initial weaken ->
 * grow-prep -> farm climb.
 *
 * **Never `ns.killall`, anywhere, including at claim/exit** — the one
 * deliberate departure from money-farm/xp-farm's identical-looking claim
 * step, which does killall a host once at claim time (safe there, since
 * they hold a live-editable config file and re-claim on every add). This
 * daemon's hosts are fixed launch arguments with no re-claim step at all,
 * so there's nothing recurring for a defensive wipe to protect; every pid
 * this daemon ever spawns is already precisely tracked
 * (`PrepAssignment`/`Wave.pids`), and `teardown` — the one function every
 * "start fresh" moment already funnels through — kills exactly those and
 * nothing else. `ns.atExit` reuses that same `teardown` call rather than
 * `ns.killall`ing every host, so a stale foreign process, or an orphan
 * left behind by a prior crashed run of this exact daemon, is never swept
 * up automatically — an accepted tradeoff for never touching anything
 * this daemon didn't itself launch.
 *
 * **Separate port, log file, and `cgd.store` field from money-farm.**
 * `STEADY_FARM_PORT` avoids a real race that sharing `MONEY_FARM_PORT`
 * would cause: two independent daemons' drain loops polling the same
 * queue would consume (and mis-attribute) each other's worker status
 * messages, since nothing in a worker's own payload says which
 * orchestrator launched it. `lib/steady-farm/`'s own log file sidesteps
 * needing a `source` field on every entry. `cgd.store`'s `steadyFarm`
 * field is separate from `moneyFarm` for the identical reason: `setState`
 * shallow-merges at the top level, so two independent daemons writing to
 * the *same* field would clobber each other's data every cycle.
 * `xp-farm.daemon.ts` unions both fields' `perTarget` targets when
 * building its shared-target exclusion set — this daemon's batch math is
 * exactly as vulnerable to XP Farm's grow interference as money-farm's is.
 *
 * **That same shallow-merge hazard also exists *within* Steady Farm now**,
 * once multiple instances share one `steadyFarm` field: `mergeSteadyFarmEntry`
 * always reads the field's current `perTarget` array, replaces only the
 * entry matching this instance's own target (dropping a stale one if it
 * just retargeted), and writes the merged whole back — never a bare
 * `setState({ steadyFarm: {...} })` with only this instance's own data,
 * which would erase every other instance's entry. `ns.atExit` calls it
 * with a `null` entry to remove just this instance's own contribution
 * rather than clearing the whole field the way a single-instance design
 * safely could.
 */
const CHECK_INTERVAL = 15000
const STATE_CHECK_INTERVAL = 5000
const SECURITY_EPSILON = 1
const PREP_MONEY_RATIO = 0.95
const DESYNC_STRIKES_TO_FALLBACK = 2
/**
 * How much better a candidate target must score to replace the current one
 * — far wider than money-farm's 1.5x, since a retarget here means tearing
 * down and rebuilding the entire wave series from scratch, not just
 * redirecting one session among several. Stability matters more than
 * chasing a marginally better target. Only ever consulted by an unpinned
 * instance — a `--target` pin never retargets at all.
 */
const RETARGET_HYSTERESIS = 5
/**
 * Landing gap (ms) between consecutive legs *within* one wave (H→W1→G→W2)
 * — deliberately seconds, not `money-farm.daemon.ts`'s `BATCH_SPACING`
 * (100ms): that value is tuned for many *overlapping* batches maximizing
 * online throughput, where a landing-order mixup is caught and corrected
 * by a live orchestrator within the next tick. This daemon has no live
 * orchestrator watching it — wave series are launched once and left
 * running for potentially hours, so getting the order visibly, safely
 * separated matters more than packing waves as tightly as possible.
 */
const WAVE_LEG_GAP_MS = 2000
/**
 * Extra pause (ms), on top of `WAVE_LEG_GAP_MS`, between one wave's last
 * landing (its second weaken) and the next wave's first (its hack) — see
 * `seriesTiming`'s own header comment for how this and `WAVE_LEG_GAP_MS`
 * combine into "how many whole waves fit per weaken cycle." Confirmed live
 * as necessary: without a gap this much larger than the intra-wave one,
 * consecutive waves' hacks land close enough together that they're
 * effectively simultaneous, defeating the entire point of waves that never
 * overlap.
 */
const WAVE_SERIES_GAP_MS = 14000

interface ScriptRams {
  hack: number
  grow: number
  weaken: number
}

/**
 * One host's current prep-mode assignment — pids are tracked so
 * `teardown` can kill precisely these two processes rather than
 * `ns.killall`ing the host (this daemon never calls `ns.killall` at all —
 * see the module header comment's own paragraph on that). No `target`
 * field needed here the way money-farm's composite-keyed version has:
 * this daemon only ever has one target per instance, so a host (belonging
 * to exactly one instance) can never carry two different targets'
 * assignments at once.
 */
interface PrepAssignment {
  growThreads: number
  weakenThreads: number
  growPid: number
  weakenPid: number
}

/** One self-sustaining HWGW wave-set — all four legs launched onto the same host. */
interface Wave {
  host: string
  pids: number[]
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

/** `moneyMax * hackChance / weakenTime` for one candidate — same base-NS formula money-farm's own scoring started from. */
function scoreServer(ns: NS, hostname: string, server: Server): number | null {
  const weakenTime = ns.getWeakenTime(hostname)
  return weakenTime > 0 ? (server.moneyMax ?? 0) * ns.hackAnalyzeChance(hostname) / weakenTime : null
}

/**
 * The rooted, non-purchased, eligible (hacking-level-cleared, has money)
 * server with the best money/sec potential — only ever replaces
 * `currentTarget` if it stops qualifying, or a candidate scores at least
 * `RETARGET_HYSTERESIS` times higher (see this daemon's own header comment
 * for why that margin is so much wider than money-farm's 1.5x). Only ever
 * called for an unpinned instance.
 */
function pickTarget(ns: NS, currentTarget: string | null): { target: string | null, score: number } {
  const hackingLevel = ns.getHackingLevel()
  let best: Server | null = null
  let bestScore = -Infinity
  for (const hostname of scanNetwork(ns)) {
    if (hostname === 'home')
      continue
    const server = ns.getServer(hostname)
    if (!server.hasAdminRights || server.purchasedByPlayer)
      continue
    if ((server.requiredHackingSkill ?? 0) > hackingLevel)
      continue
    if ((server.moneyMax ?? 0) <= 0)
      continue
    const score = scoreServer(ns, hostname, server)
    if (score !== null && score > bestScore) {
      bestScore = score
      best = server
    }
  }
  if (!best)
    return { target: currentTarget, score: 0 }
  if (!currentTarget)
    return { target: best.hostname, score: bestScore }
  if (best.hostname === currentTarget)
    return { target: currentTarget, score: bestScore }

  const currentServer = ns.getServer(currentTarget)
  const stillEligible = currentServer.hasAdminRights && !currentServer.purchasedByPlayer
    && (currentServer.requiredHackingSkill ?? 0) <= hackingLevel && (currentServer.moneyMax ?? 0) > 0
  if (!stillEligible)
    return { target: best.hostname, score: bestScore }

  const currentScore = scoreServer(ns, currentTarget, currentServer) ?? 0
  return bestScore > currentScore * RETARGET_HYSTERESIS
    ? { target: best.hostname, score: bestScore }
    : { target: currentTarget, score: currentScore }
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

function hostFreeRam(ns: NS, hosts: string[]): Record<string, number> {
  const freeRam: Record<string, number> = {}
  for (const host of hosts)
    freeRam[host] = Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host))
  return freeRam
}

function killTracked(ns: NS, pid: number) {
  if (pid > 0)
    ns.kill(pid)
}

/** Kills every tracked prep-mode pid and every wave leg, then clears both — the one teardown path every "start fresh" moment shares. */
function teardown(ns: NS, prepAssignment: Record<string, PrepAssignment>, waves: Wave[]) {
  for (const host of Object.keys(prepAssignment)) {
    killTracked(ns, prepAssignment[host].growPid)
    killTracked(ns, prepAssignment[host].weakenPid)
    delete prepAssignment[host]
  }
  for (const wave of waves) {
    for (const pid of wave.pids) killTracked(ns, pid)
  }
  waves.length = 0
}

function isWorkerStatus(value: unknown): value is WorkerStatus {
  return typeof value === 'object' && value !== null && 'action' in value && 'target' in value
}

/** Drains `STEADY_FARM_PORT` — see the module header comment for why this daemon never reads `MONEY_FARM_PORT`. */
function drainStatusPort(ns: NS) {
  const port = ns.getPortHandle(STEADY_FARM_PORT)
  while (!port.empty()) {
    const raw = port.read()
    if (!isWorkerStatus(raw))
      continue
    const deltaSecurity = raw.action === 'grow' && raw.deltaSecurity === undefined
      ? ns.growthAnalyzeSecurity(raw.threads)
      : raw.deltaSecurity
    addSteadyFarmLog(ns, {
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

/**
 * Weaken-only or grow-prep stage, dispatched across this instance's entire
 * dedicated fleet — no partition/slot system needed the way money-farm has
 * one, since there's only ever one target competing for this fleet's RAM.
 * Reuses `computePrepNeed` (`utils/hack-math.ts`) for need-based sizing —
 * already continuous-loop dispatch, so this stage is exactly as
 * offline-safe as `xp-farm.daemon.ts`'s own grow/weaken loops.
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
    // Rate-balanced against actualGrowThreads for the same reason
    // computePrepNeed's own uncapped version is — see that function's own
    // header comment.
    const actualGrowThreads = sumValues(growAssigned)
    const weakenPerThread = ns.weakenAnalyze(1)
    const hm = computeHackMath(ns, target)
    const neededWeakenThreads = actualGrowThreads > 0 && weakenPerThread > 0 && hm.growTime > 0
      ? Math.ceil(ns.growthAnalyzeSecurity(actualGrowThreads) * hm.weakenTime / (hm.growTime * weakenPerThread))
      : 0
    weakenAssigned = allocateNeeded(ramSource, hosts, weakenScriptRam, neededWeakenThreads)
  }

  for (const host of hosts) {
    const g = growAssigned[host] ?? 0
    const w = weakenAssigned[host] ?? 0
    const prev = prepAssignment[host]
    const changed = !prev || prev.growThreads !== g || prev.weakenThreads !== w

    if (changed) {
      if (prev) {
        killTracked(ns, prev.growPid)
        killTracked(ns, prev.weakenPid)
      }
      ns.print(`${host}: prepping ${target} (${mode}) — ${g}g / ${w}w.`)
      const growPid = g > 0 ? ns.exec(GROW_SCRIPT, host, g, target, 0, g, '--port', STEADY_FARM_PORT) : 0
      const weakenPid = w > 0 ? ns.exec(WEAKEN_SCRIPT, host, w, target, 0, w, '--port', STEADY_FARM_PORT) : 0
      prepAssignment[host] = { growThreads: g, weakenThreads: w, growPid, weakenPid }
    }
  }
}

/**
 * The shared recurrence period every wave's every leg loops at, plus how
 * many whole, non-overlapping waves fit inside it. `period` is anchored on
 * `weakenTime` (always the longest of the three base actions — a wave's
 * own hack lands at `period - hackTime + hackTime = period`, working
 * backward from weaken2 landing last) plus the three `WAVE_LEG_GAP_MS`
 * gaps between its own four legs — so one wave, start to finish, spans
 * `weakenTime + 3*WAVE_LEG_GAP_MS`. Each wave then additionally reserves
 * `WAVE_SERIES_GAP_MS` of the period exclusively as breathing room before
 * the next wave's hack is allowed to land — `slotWidth` is one wave's full
 * reservation (its own span plus that gap), and `maxWaves` is simply how
 * many of those slots tile into `period` without spilling into where wave
 * 0's own next recurrence needs to land. `Math.floor`, never rounding up:
 * a slot that doesn't fully fit is dropped entirely rather than launched
 * half-overlapping the next cycle.
 *
 * An easy target's `weakenTime` can be shorter than `slotWidth` itself
 * (specifically, whenever `weakenTime < WAVE_SERIES_GAP_MS`) — the natural
 * period doesn't even fit one whole slot, which would floor `maxWaves` to
 * 0 and leave the daemon farming nothing at all. Rather than give up,
 * this forces exactly one wave, stretching `period` out to `slotWidth`
 * (20s at the default gaps) instead of the too-short natural value — the
 * "increasing delay" this buys is real: `launchWaves`' own `period -
 * ownActionTime` formula turns that larger period directly into a bigger
 * `weakenDelay`/`growDelay`/`hackDelay`, so the single wave still gets the
 * full safety margin between its own landing and its own next recurrence,
 * it just idles longer between cycles than an easy target's raw
 * `weakenTime` alone would require.
 */
function seriesTiming(hm: HackMath): { period: number, maxWaves: number } {
  const naturalPeriod = hm.weakenTime + 3 * WAVE_LEG_GAP_MS
  const slotWidth = 3 * WAVE_LEG_GAP_MS + WAVE_SERIES_GAP_MS
  const maxWaves = Math.floor(naturalPeriod / slotWidth)
  if (maxWaves >= 1)
    return { period: naturalPeriod, maxWaves }
  return { period: slotWidth, maxWaves: 1 }
}

/**
 * Finds a placement (one host) for each of up to `maxWaves` (from
 * `seriesTiming`) candidate waves — first-fit against each host's
 * currently-free RAM, decremented as waves are placed so two waves never
 * double-book the same GB. Stops as soon as no host has room for one more
 * whole wave; the caller launches only as many waves as this returns,
 * never the full `maxWaves` if the fleet can't afford it. See the module
 * header comment for why whole-wave-per-host (no cross-host leg-splitting)
 * is an accepted simplification here.
 */
function planWaves(ns: NS, hosts: string[], plan: BatchPlan, rams: ScriptRams, maxWaves: number): string[] {
  const perWaveRam = plan.hackThreads * rams.hack
    + plan.growThreads * rams.grow
    + (plan.weaken1Threads + plan.weaken2Threads) * rams.weaken
  if (perWaveRam <= 0)
    return []

  const freeRam = hostFreeRam(ns, hosts)
  const placements: string[] = []
  for (let i = 0; i < maxWaves; i++) {
    const host = hosts.find(h => freeRam[h] >= perWaveRam)
    if (!host)
      break
    freeRam[host] -= perWaveRam
    placements.push(host)
  }
  return placements
}

/**
 * Launches every leg of every wave in `waves` exactly once — `period`
 * (`seriesTiming`) anchors every leg's own delay so hack, weaken1, grow,
 * and weaken2 each share the identical recurrence length despite their
 * different action times, which is what lets a purely launch-time stagger
 * persist forever (see the module header comment's staggering paragraph
 * for the full reasoning). `WAVE_LEG_GAP_MS` separates the four launches
 * within one wave; the sleep *after* a wave's last leg (its second weaken)
 * uses the much larger `WAVE_SERIES_GAP_MS` instead, so the next wave's
 * hack lands with real breathing room after this wave fully clears, not
 * packed in immediately behind it. None of these are `--once`: every leg
 * keeps looping on its own from here on, needing no further daemon
 * intervention unless one dies.
 *
 * Mutates `waves` in place (pushing each leg's pid as it's launched) rather
 * than building and returning its own local array — this whole launch can
 * take tens of seconds (`WAVE_LEG_GAP_MS`/`WAVE_SERIES_GAP_MS` sleeps times
 * however many waves), and `waves` here is the *same* array reference
 * `ns.atExit`'s `teardown` closes over. A local array only handed back on
 * return would leave `teardown` looking at whatever `waves` held *before*
 * this call started for the entire duration of this function — any pid
 * already launched by an in-flight call would be invisible to it and
 * orphaned if the daemon were killed mid-launch. Confirmed live.
 */
async function launchWaves(ns: NS, waves: Wave[], target: string, plan: BatchPlan, hm: HackMath): Promise<void> {
  const { period } = seriesTiming(hm)
  const hackDelay = Math.max(0, period - hm.hackTime)
  const weakenDelay = Math.max(0, period - hm.weakenTime)
  const growDelay = Math.max(0, period - hm.growTime)

  for (let i = 0; i < waves.length; i++) {
    const host = waves[i].host
    waves[i].pids.push(ns.exec(HACK_SCRIPT, host, plan.hackThreads, target, hackDelay, plan.hackThreads, '--port', STEADY_FARM_PORT))
    await ns.sleep(WAVE_LEG_GAP_MS)
    waves[i].pids.push(ns.exec(WEAKEN_SCRIPT, host, plan.weaken1Threads, target, weakenDelay, plan.weaken1Threads, '--port', STEADY_FARM_PORT))
    await ns.sleep(WAVE_LEG_GAP_MS)
    waves[i].pids.push(ns.exec(GROW_SCRIPT, host, plan.growThreads, target, growDelay, plan.growThreads, '--port', STEADY_FARM_PORT))
    await ns.sleep(WAVE_LEG_GAP_MS)
    waves[i].pids.push(ns.exec(WEAKEN_SCRIPT, host, plan.weaken2Threads, target, weakenDelay, plan.weaken2Threads, '--port', STEADY_FARM_PORT))
    await ns.sleep(WAVE_SERIES_GAP_MS)
  }
}

/** True if every leg of every wave is still alive. */
function allWavesHealthy(ns: NS, waves: Wave[]): boolean {
  return waves.every(wave => wave.pids.every(pid => ns.isRunning(pid)))
}

/**
 * Reads another already-running process's own `--target` value out of its
 * raw `args` array — used by `main`'s duplicate-instance check to tell
 * "another instance pinned to a different target, meant to coexist" apart
 * from "another instance pinned to the same one (or equally unpinned),
 * a genuine duplicate." `null` covers both "no --target given" (unpinned)
 * and "malformed/missing value," which is fine: either way it just means
 * this process isn't pinned to any specific target.
 */
function argTarget(args: ScriptArg[]): string | null {
  const idx = args.indexOf('--target')
  const value = idx === -1 ? undefined : args[idx + 1]
  return typeof value === 'string' && value ? value : null
}

let snapshot = {
  money: 0,
  maxMoney: 0,
  security: 0,
  minSecurity: 0,
}

export async function main(ns: NS) {
  ns.disableLog('ALL')

  const flags = parseArgs(ns, [
    {
      long: 'target',
      defaultValue: '',
      description: 'Pin this instance to a specific target instead of auto-picking one. Launch several instances, each with its own --target and its own disjoint hostnames, to farm multiple targets across the same fleet at once.',
    },
  ] as const, [])
  const pinnedTarget = (flags.target as string) || null
  const requestedHosts = (flags._ as ScriptArg[]).map(String)

  // Refuse to run alongside another instance targeting the exact same
  // thing — pinned instances for DIFFERENT targets are meant to coexist
  // (the whole point of --target), so this only rejects a genuine
  // duplicate: another already-running instance with the identical pin,
  // or, if unpinned, any other unpinned instance (auto-pick mode only
  // ever makes sense once).
  const dupe = ns.ps('home').find(p =>
    p.filename === ns.getScriptName()
    && p.pid !== ns.pid
    && argTarget(p.args) === pinnedTarget,
  )
  if (dupe) {
    ns.tprint(`WARNING: daemons/steady-farm.daemon.js is already running for ${pinnedTarget ?? '(auto-pick)'} (pid ${dupe.pid}) — exiting.`)
    return
  }

  const hosts = requestedHosts.filter(h => ns.serverExists(h))
  if (hosts.length === 0) {
    ns.tprint('WARNING: daemons/steady-farm.daemon.js needs at least one dedicated hostname as a positional argument — exiting.')
    return
  }
  if (pinnedTarget && !ns.serverExists(pinnedTarget)) {
    ns.tprint(`WARNING: --target ${pinnedTarget} doesn't exist — exiting.`)
    return
  }
  // pickTarget already filters this out for an unpinned instance, but a
  // pin bypasses that entirely — quit up front rather than claiming hosts
  // and running the whole weaken/grow-prep/farm state machine against a
  // target that can never earn a single dollar.
  if (pinnedTarget && (ns.getServer(pinnedTarget).moneyMax ?? 0) <= 0) {
    ns.tprint(`WARNING: --target ${pinnedTarget} has no money to earn (moneyMax is 0) — exiting.`)
    return
  }

  // Scripts copied once, up front — hosts are fixed launch arguments, not
  // a live-editable config file (see the module header comment), so
  // there's no later re-claim step that would need to redo this. No
  // killall here: unlike money-farm/xp-farm's claim step, this daemon
  // never defensively wipes a host's existing process list — see the
  // module header comment's "never `ns.killall`" paragraph for why every
  // teardown path here already works entirely from precise pid tracking
  // instead, and what that trades away (a stale process from outside this
  // daemon, or an orphan from a prior crashed run of it, isn't
  // automatically cleared).
  for (const host of hosts)
    ns.scp([HACK_SCRIPT, GROW_SCRIPT, WEAKEN_SCRIPT], host, 'home')

  const rams: ScriptRams = {
    hack: ns.getScriptRam(HACK_SCRIPT, 'home'),
    grow: ns.getScriptRam(GROW_SCRIPT, 'home'),
    weaken: ns.getScriptRam(WEAKEN_SCRIPT, 'home'),
  }

  ns.print(`Started on [${hosts.join(', ')}]${pinnedTarget ? `, pinned to ${pinnedTarget}` : ', auto-picking a target'}.`)

  const prepAssignment: Record<string, PrepAssignment> = {}
  let waves: Wave[] = []
  let target: string | null = pinnedTarget
  let mode: Mode | null = null
  let batchPlan: BatchPlan | null = null
  let maxWaves = 0
  let desyncStrikes = 0
  let lastRetargetCheck = 0
  let lastStateCheck = 0

  // Killed manually, crashing, or the process otherwise ending all trigger
  // this. Reuses `teardown` — the exact same precise per-pid kill every
  // other "start fresh" moment in this file already goes through — rather
  // than `ns.killall`'ing each host: `prepAssignment`/`waves` are already
  // this daemon's own complete record of everything it ever spawned, so a
  // second, separate "spawned pids" array would just be duplicate
  // bookkeeping of the same information. `prepAssignment` is mutated in
  // place and `waves` is closed over by reference, so this always sees
  // whatever's actually live at the moment of exit, not a stale snapshot
  // from when `atExit` was registered.
  ns.atExit(() => {
    teardown(ns, prepAssignment, waves)
  }, 'steady-farm-cleanup')

  while (true) {
    const now = Date.now()
    drainStatusPort(ns)

    if (!pinnedTarget && now - lastRetargetCheck >= CHECK_INTERVAL) {
      lastRetargetCheck = now
      const picked = pickTarget(ns, target)
      if (picked.target !== target) {
        ns.print(`Switching target ${target ?? '(none)'} -> ${picked.target}.`)
        teardown(ns, prepAssignment, waves)
        if (target) {
          addSteadyFarmLog(ns, { action: 'end-work', target })
        }
        if (picked.target)
          addSteadyFarmLog(ns, { action: 'start-work', target: picked.target, score: picked.score })
        target = picked.target
        mode = null
        batchPlan = null
        maxWaves = 0
        desyncStrikes = 0
      }
    }

    if (!target) {
      await ns.sleep(STATE_CHECK_INTERVAL)
      continue
    }

    if (now - lastStateCheck >= STATE_CHECK_INTERVAL) {
      lastStateCheck = now
      // Self-heal only: a dedicated host can be deleted (Cloud Servers
      // app) mid-run. No add/remove polling beyond this — the hostname
      // list itself is fixed for this instance's whole lifetime.
      const currentHosts = hosts.filter(h => ns.serverExists(h))
      const server = ns.getServer(target)

      if (snapshot.money !== server.moneyAvailable
        || snapshot.maxMoney !== server.moneyMax
        || snapshot.security !== server.hackDifficulty
        || snapshot.minSecurity !== server.minDifficulty) {
        snapshot = {
          money: server.moneyAvailable ?? 0,
          maxMoney: server.moneyMax ?? 0,
          security: server.hackDifficulty ?? 0,
          minSecurity: server.minDifficulty ?? 0,
        }
        addSteadyFarmLog(ns, {
          action: 'update-server',
          target,
          ...snapshot,
        })
      }

      if (mode === 'farm') {
        // Already farming: a hack or grow leg landing routinely pushes
        // security (and money) off pristine for the couple of seconds
        // before its own compensating weaken lands — WAVE_LEG_GAP_MS apart
        // by design. A single instantaneous modeFor() read here would
        // mistake that normal mid-cycle bump for a genuine desync and tear
        // down a perfectly healthy wave series before its own weaken ever
        // gets a chance to land — confirmed live, this used to fire on
        // essentially every tick. So once farming, only a dead leg or a
        // *sustained* (DESYNC_STRIKES_TO_FALLBACK-consecutive-tick) security
        // desync ever ends farm mode — never a raw modeFor() classification,
        // which stays reserved for the not-yet-farming branch below.
        let unhealthy = !allWavesHealthy(ns, waves)
        const securityGap = (server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0)
        if (securityGap > SECURITY_EPSILON) {
          desyncStrikes++
          if (desyncStrikes >= DESYNC_STRIKES_TO_FALLBACK) {
            ns.print(`${target}: security drifted (${securityGap.toFixed(2)} above min) — falling back to prep.`)
            unhealthy = true
          }
        }
        else {
          desyncStrikes = 0
        }
        if (unhealthy) {
          ns.print(`${target}: a wave leg died or desynced — tearing down for a fresh rebuild next tick.`)
          teardown(ns, prepAssignment, waves)
          mode = null
          batchPlan = null
          maxWaves = 0
        }
        else {
          ns.print(`${target}: ${waves.length}/${maxWaves} wave(s) running.`)
        }
      }
      else {
        // Not farming yet (or just fell back to it) — modeFor's raw
        // snapshot classification is exactly what should drive the
        // weaken -> grow-prep -> farm progression here.
        const newMode = modeFor(server)
        if (newMode !== mode) {
          ns.print(
            `${target}: mode ${mode ?? '(none)'} -> ${newMode} `
            + `(security ${(server.hackDifficulty ?? 0).toFixed(2)}/${(server.minDifficulty ?? 0).toFixed(2)}, `
            + `money ${ns.format.number(server.moneyAvailable ?? 0)}/${ns.format.number(server.moneyMax ?? 0)}).`,
          )
          addSteadyFarmLog(ns, { action: 'change-mode', target, oldMode: mode ?? '(none)', mode: newMode })
          teardown(ns, prepAssignment, waves)
          mode = newMode
          desyncStrikes = 0

          if (mode === 'farm') {
            batchPlan = computeBatchPlan(ns, target)
            const hm = computeHackMath(ns, target)
            maxWaves = seriesTiming(hm).maxWaves
            const placements = planWaves(ns, currentHosts, batchPlan, rams, maxWaves)
            // Assigned to the outer `waves` binding *before* launching
            // starts — see launchWaves's own header comment for why this
            // ordering (rather than `waves = await launchWaves(...)`)
            // matters for atExit's teardown.
            waves = placements.map(host => ({ host, pids: [] }))
            await launchWaves(ns, waves, target, batchPlan, hm)
            ns.print(
              `${target}: launched ${waves.length}/${maxWaves} non-overlapping wave(s) `
              + `(${batchPlan.hackThreads}h/${batchPlan.growThreads}g/${batchPlan.weaken1Threads}w1/${batchPlan.weaken2Threads}w2 each).`,
            )
            console.log(`${target}: launched ${waves.length}/${maxWaves} non-overlapping wave(s) `
              + `(${batchPlan.hackThreads}h/${batchPlan.growThreads}g/${batchPlan.weaken1Threads}w1/${batchPlan.weaken2Threads}w2 each).`)
          }
          else {
            batchPlan = null
            maxWaves = 0
          }
        }

        if (mode && mode !== 'farm')
          applyPrepMode(ns, currentHosts, target, server, mode, rams.grow, rams.weaken, prepAssignment)
      }
    }

    await ns.sleep(STATE_CHECK_INTERVAL)
  }
}
