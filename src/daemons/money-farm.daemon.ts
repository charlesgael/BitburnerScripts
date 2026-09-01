import type { NS, Server } from '@ns'
import type { BatchPlan } from '../utils/hack-math'
import {
  MONEY_FARM_CONFIG_FILE as CONFIG_FILE,
  MONEY_FARM_GROW_SCRIPT as GROW_SCRIPT,
  MONEY_FARM_HACK_SCRIPT as HACK_SCRIPT,
  MONEY_FARM_WEAKEN_SCRIPT as WEAKEN_SCRIPT,
} from '../ui/utils/money-farm-config'
import { BATCH_SPACING, computeBatchPlan } from '../utils/hack-math'
import { distributeThreads, splitGrowWeakenThreads } from '../utils/thread-balance'

/**
 * Background orchestrator for the Money Farm feature (`ui/apps/money-farm/`).
 * Same overall shape as `xp-farm.daemon.ts` (config-file reconciliation,
 * seizing exclusive control of every listed cloud server, a single live-
 * picked shared target, self-exit once the list empties) — see that file's
 * header comment for the parts that are identical. What differs is the
 * target metric (money/sec potential, not XP) and what each managed host
 * actually runs, which goes through three stages against the shared
 * target, re-evaluated every `STATE_CHECK_INTERVAL`:
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
 *    matches `flooder.app.ts`'s own long-standing hack-delay formula — not
 *    a coincidence, just the same trick extended to four discrete legs
 *    instead of three continuous loops. Every `BATCH_SPACING` ms this
 *    daemon tries to dispatch one more batch (as one-shot `--once`
 *    processes — see `hack.daemon.ts`/`grow.daemon.ts`/`weaken.daemon.ts`)
 *    across whichever dedicated hosts currently have pooled free RAM,
 *    until either RAM runs out or `maxConcurrentBatches`
 *    (`floor(weakenTime / BATCH_SPACING)`) batches are already in flight —
 *    that cap exists because *concurrency density* against one target, not
 *    absolute thread count, is what causes overlapping batches to drift
 *    the server away from the prepped baseline this daemon's math assumes;
 *    RAM beyond what the current target can safely absorb should go to a
 *    second target instead (a real future Phase 3, not built here).
 *
 * **Pooled, not per-host-independent** (the one deliberate departure from
 * XP Farm's model): every stage above computes ONE plan against the sum of
 * every dedicated host's own free-RAM capacity, then splits each thread
 * category across hosts proportionally (`distributeThreads`) — because,
 * unlike grow/weaken, `hack()` can overshoot a shared target if several
 * hosts each independently decided how much money to take.
 *
 * **Desync fallback**: every `STATE_CHECK_INTERVAL` while farming, if the
 * target's live security has drifted more than `SECURITY_EPSILON` above
 * minimum on two consecutive checks, farm mode is abandoned and the target
 * falls back to prep — a safety net for engine-tick jitter or a foreign
 * process, not the primary defense (that's the concurrency cap above).
 *
 * Runs with or without the Formulas API: `utils/hack-math.ts`'s
 * `computeHackMath` uses `ns.formulas.hacking.*` when `Formulas.exe` is
 * owned, falling back to the base `ns.hackAnalyze*`/`ns.get*Time`
 * functions (a "guesstimation" against the server's current live state)
 * otherwise — both paths feed the exact same downstream math here.
 */
const CHECK_INTERVAL = 15000
const STATE_CHECK_INTERVAL = 5000
const SECURITY_EPSILON = 1
const PREP_MONEY_RATIO = 0.95
const DESYNC_STRIKES_TO_FALLBACK = 2

type Mode = 'weaken' | 'grow-prep' | 'farm'

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
 * weakenTime`. Unlike XP Farm's `baseDifficulty`-only metric, this can't
 * be proven monotonically improving (`weakenTime` depends on the target's
 * current* security, which our own farming activity moves around), so a
 * hysteresis margin guards against thrashing: once `currentTarget` is
 * adopted, a candidate only replaces it by scoring at least 1.5x higher,
 * not just momentarily ahead.
 */
function pickTarget(ns: NS, currentTarget: string | null): string | null {
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
    return currentTarget
  if (!currentTarget || best.hostname === currentTarget)
    return best.hostname

  const currentServer = ns.getServer(currentTarget)
  const currentWeakenTime = ns.getWeakenTime(currentTarget)
  const currentScore = currentWeakenTime > 0
    ? (currentServer.moneyMax ?? 0) * ns.hackAnalyzeChance(currentTarget) / currentWeakenTime
    : 0
  return bestScore > currentScore * 1.5 ? best.hostname : currentTarget
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
 * A managed host's *total* RAM, not what's currently free. Prep mode
 * (`applyPrepMode`) redefines a host's whole assignment from scratch each
 * check, not "how much room is left on top of what's already running" —
 * using `hostFreeRam` there was a real bug: the grow/weaken loops it just
 * launched immediately ate the free RAM they were sized against, so the
 * very next check computed a much smaller split, saw it differ from
 * `prepAssignment`, and killed+relaunched every `STATE_CHECK_INTERVAL`
 * tick before either script ran anywhere near its own completion time.
 * Farm mode's `tryDispatchBatch` correctly keeps using `hostFreeRam` —
 * there, "room left on top of already-dispatched in-flight batches" is
 * exactly what's wanted.
 */
function hostTotalRam(ns: NS, hosts: string[]): Record<string, number> {
  const totalRam: Record<string, number> = {}
  for (const host of hosts)
    totalRam[host] = ns.getServerMaxRam(host)
  return totalRam
}

/**
 * Converts `freeRam` (GB, mutated in place — decremented by whatever this
 * category consumes) into per-host thread counts for one category, using
 * `scriptRam` as that category's own script cost. Sequential calls against
 * the same `freeRam`/`hosts` (hack, then grow, then weaken1, then weaken2)
 * correctly account for RAM already claimed by an earlier category.
 */
function allocateCategory(
  freeRam: Record<string, number>,
  hosts: string[],
  scriptRam: number,
  threadsNeeded: number,
): Record<string, number> {
  const capacity: Record<string, number> = {}
  for (const host of hosts)
    capacity[host] = scriptRam > 0 ? Math.floor(freeRam[host] / scriptRam) : 0
  const assigned = distributeThreads(hosts, capacity, threadsNeeded)
  for (const [host, threads] of Object.entries(assigned))
    freeRam[host] -= threads * scriptRam
  return assigned
}

function sumValues(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, v) => sum + v, 0)
}

/**
 * Weaken-only or grow-prep stage: computes the pooled thread split (100%
 * weaken, or `splitGrowWeakenThreads`'s grow/weaken ratio) and only
 * kills+relaunches a host whose assigned counts actually changed from
 * `prepAssignment`'s last-known value (or which has a foreign process) —
 * idempotent on repeated calls while nothing's actually changed, so
 * calling this every `STATE_CHECK_INTERVAL` tick doesn't churn a
 * still-converging prep.
 */
function applyPrepMode(
  ns: NS,
  hosts: string[],
  target: string,
  mode: 'weaken' | 'grow-prep',
  growScriptRam: number,
  weakenScriptRam: number,
  prepAssignment: Record<string, { growThreads: number, weakenThreads: number }>,
) {
  const totalRam = hostTotalRam(ns, hosts)
  let growAssigned: Record<string, number> = {}
  let weakenAssigned: Record<string, number>

  if (mode === 'weaken') {
    const capacity: Record<string, number> = {}
    for (const host of hosts)
      capacity[host] = weakenScriptRam > 0 ? Math.floor(totalRam[host] / weakenScriptRam) : 0
    const totalWeakenThreads = hosts.reduce((sum, h) => sum + capacity[h], 0)
    weakenAssigned = distributeThreads(hosts, capacity, totalWeakenThreads)
  }
  else {
    // Pooled total, using weakenScriptRam as the shared reference cost for
    // both scripts — same simplifying assumption `xp-farm.daemon.ts`
    // already makes (both are near-identical trivial loop scripts).
    const capacity: Record<string, number> = {}
    for (const host of hosts)
      capacity[host] = weakenScriptRam > 0 ? Math.floor(totalRam[host] / weakenScriptRam) : 0
    const totalThreads = hosts.reduce((sum, h) => sum + capacity[h], 0)
    const { growThreads, weakenThreads } = splitGrowWeakenThreads(ns, totalThreads)
    growAssigned = allocateCategory(totalRam, hosts, growScriptRam, growThreads)
    weakenAssigned = allocateCategory(totalRam, hosts, weakenScriptRam, weakenThreads)
  }

  for (const host of hosts) {
    const g = growAssigned[host] ?? 0
    const w = weakenAssigned[host] ?? 0
    const prev = prepAssignment[host]
    const changed = !prev || prev.growThreads !== g || prev.weakenThreads !== w
    const foreign = ns.ps(host).some(p => p.filename !== GROW_SCRIPT && p.filename !== WEAKEN_SCRIPT)

    if (foreign || changed) {
      if (foreign)
        ns.print(`${host}: foreign process detected — reclaiming exclusive control.`)
      ns.killall(host)
      ns.print(`${host}: prepping ${target} (${mode}) — ${g}g / ${w}w.`)
      if (g > 0)
        ns.exec(GROW_SCRIPT, host, g, target, 0)
      if (w > 0)
        ns.exec(WEAKEN_SCRIPT, host, w, target, 0)
      prepAssignment[host] = { growThreads: g, weakenThreads: w }
    }
  }
}

/**
 * Tries to dispatch exactly one HWGW batch across `hosts`' pooled free RAM.
 * Returns false (nothing launched — safe to retry next tick) if any of the
 * four legs can't be fully covered by current free RAM; only calls
 * `ns.exec` once every leg is confirmed to fit.
 */
function tryDispatchBatch(
  ns: NS,
  hosts: string[],
  target: string,
  plan: BatchPlan,
  hackScriptRam: number,
  growScriptRam: number,
  weakenScriptRam: number,
): boolean {
  const freeRam = hostFreeRam(ns, hosts)

  const hackAssigned = allocateCategory(freeRam, hosts, hackScriptRam, plan.hackThreads)
  if (sumValues(hackAssigned) < plan.hackThreads)
    return false
  const growAssigned = allocateCategory(freeRam, hosts, growScriptRam, plan.growThreads)
  if (sumValues(growAssigned) < plan.growThreads)
    return false
  const weaken1Assigned = allocateCategory(freeRam, hosts, weakenScriptRam, plan.weaken1Threads)
  if (sumValues(weaken1Assigned) < plan.weaken1Threads)
    return false
  const weaken2Assigned = allocateCategory(freeRam, hosts, weakenScriptRam, plan.weaken2Threads)
  if (sumValues(weaken2Assigned) < plan.weaken2Threads)
    return false

  for (const [host, threads] of Object.entries(hackAssigned))
    ns.exec(HACK_SCRIPT, host, threads, '--once', target, plan.delayHack)
  for (const [host, threads] of Object.entries(growAssigned))
    ns.exec(GROW_SCRIPT, host, threads, '--once', target, plan.delayGrow)
  for (const [host, threads] of Object.entries(weaken1Assigned))
    ns.exec(WEAKEN_SCRIPT, host, threads, '--once', target, plan.delayWeaken1)
  for (const [host, threads] of Object.entries(weaken2Assigned))
    ns.exec(WEAKEN_SCRIPT, host, threads, '--once', target, plan.delayWeaken2)
  return true
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
  const hackScriptRam = ns.getScriptRam(HACK_SCRIPT, 'home')
  const growScriptRam = ns.getScriptRam(GROW_SCRIPT, 'home')
  const weakenScriptRam = ns.getScriptRam(WEAKEN_SCRIPT, 'home')

  ns.print(`Started. Checking ${CONFIG_FILE} every ${CHECK_INTERVAL / 1000}s.`)

  const managedHosts = new Set<string>()
  const prepAssignment: Record<string, { growThreads: number, weakenThreads: number }> = {}
  const inFlightBatches: { endsAt: number }[] = []
  let currentTarget: string | null = null
  let currentMode: Mode | null = null
  let batchPlan: BatchPlan | null = null
  let desyncStrikes = 0
  let lastConfigCheck = 0
  let lastStateCheck = 0

  function resetFarmState() {
    for (const host of managedHosts) ns.killall(host)
    inFlightBatches.length = 0
    for (const host of Object.keys(prepAssignment)) delete prepAssignment[host]
    currentMode = null
    batchPlan = null
    desyncStrikes = 0
  }

  while (true) {
    const now = Date.now()

    if (now - lastConfigCheck >= CHECK_INTERVAL) {
      lastConfigCheck = now

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
        ns.killall(host)
        ns.scp([HACK_SCRIPT, GROW_SCRIPT, WEAKEN_SCRIPT], host, 'home')
        managedHosts.add(host)
        ns.print(`${host}: claimed.`)
      }

      if (validHosts.length === 0) {
        ns.print('No dedicated servers left — exiting. The app relaunches this when one is enabled again.')
        break
      }

      const bestTarget = pickTarget(ns, currentTarget)
      if (bestTarget !== currentTarget) {
        ns.print(`Switching target ${currentTarget ?? '(none)'} -> ${bestTarget ?? '(none)'}.`)
        resetFarmState()
        currentTarget = bestTarget
      }
    }

    if (!currentTarget) {
      await ns.sleep(STATE_CHECK_INTERVAL)
      continue
    }

    if (now - lastStateCheck >= STATE_CHECK_INTERVAL) {
      lastStateCheck = now
      const server = ns.getServer(currentTarget)
      const mode = modeFor(server)
      const modeChanged = mode !== currentMode

      if (modeChanged) {
        ns.print(
          `${currentTarget}: mode ${currentMode ?? '(none)'} -> ${mode} `
          + `(security ${(server.hackDifficulty ?? 0).toFixed(2)}/${(server.minDifficulty ?? 0).toFixed(2)}, `
          + `money ${ns.format.number(server.moneyAvailable ?? 0)}/${ns.format.number(server.moneyMax ?? 0)}).`,
        )
        for (const host of managedHosts) ns.killall(host)
        inFlightBatches.length = 0
        for (const host of Object.keys(prepAssignment)) delete prepAssignment[host]
        desyncStrikes = 0
        currentMode = mode
        batchPlan = mode === 'farm' ? computeBatchPlan(ns, currentTarget) : null
        if (batchPlan) {
          ns.print(
            `${currentTarget}: batch plan — ${batchPlan.hackThreads}h/${batchPlan.growThreads}g/`
            + `${batchPlan.weaken1Threads}w1/${batchPlan.weaken2Threads}w2 `
            + `(${(batchPlan.actualHackFraction * 100).toFixed(1)}% steal/batch), `
            + `weakenTime ${(batchPlan.weakenTime / 1000).toFixed(1)}s, `
            + `max ${batchPlan.maxConcurrentBatches} concurrent batches.`,
          )
        }
      }

      if (currentMode === 'farm') {
        if (!modeChanged) {
          const securityGap = (server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0)
          if (securityGap > SECURITY_EPSILON) {
            desyncStrikes++
            if (desyncStrikes >= DESYNC_STRIKES_TO_FALLBACK) {
              ns.print(`${currentTarget}: security drifted (${securityGap.toFixed(2)} above min) — falling back to prep.`)
              resetFarmState()
            }
          }
          else {
            desyncStrikes = 0
          }
          ns.print(`${currentTarget}: ${inFlightBatches.length}/${batchPlan?.maxConcurrentBatches ?? 0} batches in flight.`)
        }
      }
      else if (currentMode) {
        applyPrepMode(ns, [...managedHosts], currentTarget, currentMode, growScriptRam, weakenScriptRam, prepAssignment)
      }
    }

    if (currentMode === 'farm' && batchPlan) {
      for (let i = inFlightBatches.length - 1; i >= 0; i--) {
        if (inFlightBatches[i].endsAt <= now)
          inFlightBatches.splice(i, 1)
      }
      if (inFlightBatches.length < batchPlan.maxConcurrentBatches) {
        const dispatched = tryDispatchBatch(ns, [...managedHosts], currentTarget, batchPlan, hackScriptRam, growScriptRam, weakenScriptRam)
        if (dispatched)
          inFlightBatches.push({ endsAt: now + batchPlan.totalDuration })
      }
    }

    await ns.sleep(currentMode === 'farm' ? BATCH_SPACING : STATE_CHECK_INTERVAL)
  }
}
