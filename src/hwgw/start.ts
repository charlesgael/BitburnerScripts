import type { NS, ScriptArg } from '@ns'
import { parseArgs } from '../utils/args'
import { formatDuration } from '../utils/format/dates'
import { formatMoney, formatNumber, formatRam } from '../utils/format/game'

const HACK_SCRIPT = 'hwgw/h.js'
const GROW_SCRIPT = 'hwgw/g.js'
const WEAKEN_SCRIPT = 'hwgw/w.js'

const WEAKEN_REDUCTION = 0.05
const HACK_AUGMENTATION = 0.002
const GROW_AUGMENTATION = 0.004
const GW_THREAD_MULTI = 1.2

const HACK_STEAL = 0.1

const WAVE_LEG_GAP_MS = 500
const WAVE_SERIES_GAP_MS = 2_000

function argTarget(args: ScriptArg[]): string | null {
  const idx = args.indexOf('--target')
  const value = idx === -1 ? undefined : args[idx + 1]
  return typeof value === 'string' && value ? value : null
}

export async function main(ns: NS) {
  ns.disableLog('ALL')

  const args = parseArgs(ns, [
    { long: 'target', defaultValue: 'n00dles', description: 'Target to HWGW', short: 't' },
  ])
  const requestedHosts = args._.map(String)
  const target = args.target

  // let lastStateCheck = 0
  // let signalsReceived = 0
  let state: 'null' | 'done' | 'farm' | 'prep' = 'null'
  const pids: number[] = []

  ns.atExit(() => {
    for (const p of pids) {
      ns.kill(p)
    }
  })

  const dupe = ns.ps('home').find(p =>
    p.filename === ns.getScriptName()
    && p.pid !== ns.pid
    && argTarget(p.args) === target,
  )
  if (dupe) {
    ns.tprint(`WARNING: daemons/steady-farm.daemon.js is already running for ${target ?? '(auto-pick)'} (pid ${dupe.pid}) — exiting.`)
    return
  }

  const hosts = requestedHosts.filter(h => ns.serverExists(h))
  if (hosts.length === 0) {
    ns.tprint('WARNING: daemons/steady-farm.daemon.js needs at least one dedicated hostname as a positional argument — exiting.')
    return
  }
  if (target && !ns.serverExists(target)) {
    ns.tprint(`WARNING: target ${target} doesn't exist — exiting.`)
    return
  }
  if (target && (ns.getServer(target).moneyMax ?? 0) <= 0) {
    ns.tprint(`WARNING: target ${target} has no money to earn (moneyMax is 0) — exiting.`)
    return
  }
  if (target && !ns.getServer(target).hasAdminRights) {
    ns.tprint(`WARNING: target ${target} — no root access — exiting.`)
    return
  }
  for (const host of hosts)
    ns.scp([HACK_SCRIPT, GROW_SCRIPT, WEAKEN_SCRIPT], host, 'home')

  const rams = {
    hack: ns.getScriptRam(HACK_SCRIPT, 'home'),
    grow: ns.getScriptRam(GROW_SCRIPT, 'home'),
    weaken: ns.getScriptRam(WEAKEN_SCRIPT, 'home'),
  }

  while (true) {
    const { hackDifficulty, minDifficulty, moneyAvailable, moneyMax } = ns.getServer(target)
    const snapshot = {
      securityExcess: Math.max(0, hackDifficulty! - minDifficulty!),
      moneyDeficit: Math.max(0, moneyMax! - moneyAvailable!),
    }
    // Re-affirmed every tick, not just on an actual transition — Bitburner
    // caps how many lines a script's own log retains (configurable in
    // Options), so a target sitting in one state for a long time (`done`
    // especially, once every other target has also stopped touching this
    // one's own log) would otherwise eventually scroll its original
    // `state-change` line out of the buffer entirely, and
    // `lib/hwgw/workers.ts`'s `latestState` would silently fall back to
    // reporting `'null'`. Re-printing the identical line every iteration
    // keeps it within whatever window the backward scan actually needs.
    setState(state, snapshot)
    if (state === 'null') {
      // Define if we go in farm or in prep
      if (hackDifficulty! > minDifficulty! || moneyAvailable! < moneyMax!) {
        setState('prep', snapshot)
      }
      else {
        setState('farm', snapshot)
      }
    }
    else if (state === 'prep') {
      let growthThreads = 0
      let incSecurity = 0
      let weakenThreads = 0
      if (moneyAvailable! < moneyMax!) {
        ns.print(`Money deficit: ${formatMoney(snapshot.moneyDeficit)}`)
        const multiplier = moneyMax! / moneyAvailable!
        growthThreads += Math.ceil(ns.growthAnalyze(target, multiplier))
        incSecurity += Math.ceil(ns.growthAnalyzeSecurity(growthThreads))
      }
      if (hackDifficulty! + incSecurity > minDifficulty!) {
        ns.print(`Security excess: ${formatNumber(hackDifficulty! + incSecurity - minDifficulty!)}`)
        weakenThreads += Math.ceil((hackDifficulty! + incSecurity - minDifficulty!) / WEAKEN_REDUCTION)
      }

      if (growthThreads === 0 && weakenThreads === 0) {
        setState('farm', snapshot)
        continue
      }

      const ramNeeds = growthThreads * rams.grow + weakenThreads * rams.weaken
      const host = await waitForHost(ramNeeds, snapshot)

      const time = ns.getWeakenTime(target)
      const added = []
      if (growthThreads > 0)
        added.push(ns.exec(GROW_SCRIPT, host, Math.ceil(growthThreads * GW_THREAD_MULTI), target))
      if (weakenThreads > 0)
        added.push(ns.exec(WEAKEN_SCRIPT, host, Math.ceil(weakenThreads * GW_THREAD_MULTI), target))
      if (added.includes(0)) {
        ns.print(`Failed to launch prep for ${target}`)
        ns.sleep(2_000)
        added.filter(it => it).forEach(ns.kill)
        continue
      }
      pids.push(...added)

      ns.print(`Waiting ${formatDuration(time / 1000)} for prep phase`)
      await ns.sleep(time)
    }
    else if (state === 'farm') {
      const waveLength = (WAVE_LEG_GAP_MS * 3 + WAVE_SERIES_GAP_MS)
      const loops = Math.ceil(ns.getWeakenTime(target) / waveLength)
      const loopTime = loops * (WAVE_LEG_GAP_MS * 3 + WAVE_SERIES_GAP_MS)

      const hackThreads = Math.ceil(ns.hackAnalyzeThreads(target, moneyMax! * HACK_STEAL))
      const weaken1Threads = Math.ceil((hackThreads * HACK_AUGMENTATION) / WEAKEN_REDUCTION * GW_THREAD_MULTI)
      const growthThreads = Math.ceil(ns.growthAnalyze(target, 1 / (1 - HACK_STEAL) * GW_THREAD_MULTI))
      const weaken2Threads = Math.ceil((growthThreads * GROW_AUGMENTATION) / WEAKEN_REDUCTION * GW_THREAD_MULTI)

      const ramNeeds = loops * (
        rams.hack * hackThreads
        + rams.weaken * weaken1Threads
        + rams.grow * growthThreads
        + rams.weaken * weaken2Threads
      )
      const host = await waitForHost(ramNeeds, snapshot)

      ns.print(`Looptime: ${formatDuration(loopTime / 1000)}, ram: ${formatRam(ramNeeds)}, host: ${host}`)

      const added = []
      for (let i = 0; i < loops; i++) {
        added.push(ns.exec(HACK_SCRIPT, host, hackThreads, target, loopTime, 0 + waveLength * i))
        added.push(ns.exec(WEAKEN_SCRIPT, host, weaken1Threads, target, loopTime, WAVE_LEG_GAP_MS + waveLength * i))
        added.push(ns.exec(GROW_SCRIPT, host, growthThreads, target, loopTime, WAVE_LEG_GAP_MS * 2 + waveLength * i))
        added.push(ns.exec(WEAKEN_SCRIPT, host, weaken2Threads, target, loopTime, WAVE_LEG_GAP_MS * 3 + waveLength * i))
      }
      if (added.includes(0)) {
        ns.print(`Failed to launch prep for ${target}`)
        ns.sleep(2_000)
        added.filter(it => it).forEach(ns.kill)
        continue
      }
      pids.push(...added)
      setState('done', snapshot)
    }
    else {
      ns.print(`Farm ongoing`)
      if (snapshot.moneyDeficit > 0) {
        ns.print(`Money deficit: ${formatMoney(snapshot.moneyDeficit)}`)
      }
      if (snapshot.securityExcess > 0) {
        ns.print(`Security excess: ${formatNumber(snapshot.securityExcess)}`)
      }
      await ns.sleep(60_000)
    }
  }

  async function waitForHost(ramNeeds: number, snapshot: { securityExcess: number, moneyDeficit: number }): Promise<string> {
    while (true) {
      const host = hosts
        .map(it => [it, ns.getServerMaxRam(it) - ns.getServerUsedRam(it)] as const)
        .filter(([, free]) => free > ramNeeds)
        .sort(([,A], [,B]) => B - A)[0]?.[0]
      if (host === undefined) {
        ns.print(`Couldn't find available host with ${formatRam(ramNeeds)} available RAM.`)
        // Same reaffirm as the outer loop's own `setState` call — a target
        // stuck here a long time (many concurrent instances competing for
        // one host pool) would otherwise go just as long without touching
        // its own log, risking the same state-change decay `setState`'s
        // own comment describes.
        notifyState(`${state}-ram`, snapshot)
        await ns.sleep(2000)
      }
      else {
        return host
      }
    }
  }

  // Every transition also gets a structured log line, alongside the plain
  // human-readable prints already scattered through the loop below —
  // `lib/hwgw/workers.ts`'s `scanHwgwOrchestrators` reads this back via
  // `ns.getRunningScript(pid).logs` to know this instance's current mode,
  // at no extra RAM cost (that same call is already needed for money/XP).
  // `snapshot` piggybacks the security-excess/money-deficit numbers this
  // loop already computes off the very same `ns.getServer(target)` call —
  // reading them back this way costs the dashboard nothing beyond the
  // `getRunningScript` call it already makes, rather than a second
  // `ns.getServer` from wherever renders them.
  function setState(next: typeof state, snapshot: { securityExcess: number, moneyDeficit: number }) {
    state = next
    notifyState(next, snapshot)
  }

  function notifyState(state: string, snapshot: { securityExcess: number, moneyDeficit: number }) {
    ns.print(JSON.stringify({ action: 'state-change', to: state, ...snapshot }))
  }
}
