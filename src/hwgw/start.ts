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
const GW_THREAD_MULTI = 1.1

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
  ns.ui.openTail()

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
    ns.ui.closeTail()
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
    if (state === 'null') {
      // Define if we go in farm or in prep
      if (hackDifficulty! > minDifficulty! || moneyAvailable! < moneyMax!) {
        state = 'prep'
      }
      else {
        state = 'farm'
      }
    }
    else if (state === 'prep') {
      let growthThreads = 0
      let incSecurity = 0
      let weakenThreads = 0
      if (moneyAvailable! < moneyMax!) {
        ns.print(`Money deficit: ${formatMoney(moneyMax! - moneyAvailable!)}`)
        const multiplier = moneyMax! / moneyAvailable!
        growthThreads += Math.ceil(ns.growthAnalyze(target, multiplier))
        incSecurity += Math.ceil(ns.growthAnalyzeSecurity(growthThreads))
      }
      if (hackDifficulty! + incSecurity > minDifficulty!) {
        ns.print(`Security excess: ${formatNumber(hackDifficulty! + incSecurity - minDifficulty!)}`)
        weakenThreads += Math.ceil((hackDifficulty! + incSecurity - minDifficulty!) / WEAKEN_REDUCTION)
      }

      if (growthThreads === 0 && weakenThreads === 0) {
        state = 'farm'
        continue
      }

      const ramNeeds = growthThreads * rams.grow + weakenThreads * rams.weaken
      const host = await waitForHost(ramNeeds)

      const time = ns.getWeakenTime(target)
      if (growthThreads > 0)
        pids.push(ns.exec(GROW_SCRIPT, host, Math.ceil(growthThreads * GW_THREAD_MULTI), target))
      if (weakenThreads > 0)
        pids.push(ns.exec(WEAKEN_SCRIPT, host, Math.ceil(weakenThreads * GW_THREAD_MULTI), target))

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
      const host = await waitForHost(ramNeeds)

      ns.print(`Looptime: ${formatDuration(loopTime / 1000)}, ram: ${formatRam(ramNeeds)}, host: ${host}`)

      for (let i = 0; i < loops; i++) {
        pids.push(ns.exec(HACK_SCRIPT, host, hackThreads, target, loopTime, 0 + waveLength * i))
        pids.push(ns.exec(WEAKEN_SCRIPT, host, weaken1Threads, target, loopTime, WAVE_LEG_GAP_MS + waveLength * i))
        pids.push(ns.exec(GROW_SCRIPT, host, growthThreads, target, loopTime, WAVE_LEG_GAP_MS * 2 + waveLength * i))
        pids.push(ns.exec(WEAKEN_SCRIPT, host, weaken2Threads, target, loopTime, WAVE_LEG_GAP_MS * 3 + waveLength * i))
      }
      state = 'done'
    }
    else {
      ns.print(`Farm ongoing`)
      if (moneyAvailable! < moneyMax!) {
        ns.print(`Money deficit: ${formatMoney(moneyMax! - moneyAvailable!)}`)
      }
      if (hackDifficulty! > minDifficulty!) {
        ns.print(`Security excess: ${formatNumber(hackDifficulty! - minDifficulty!)}`)
      }
      await ns.sleep(60_000)
    }
  }

  async function waitForHost(ramNeeds: number): Promise<string> {
    while (true) {
      const host = hosts.find(it => ns.getServerMaxRam(it) - ns.getServerUsedRam(it) > ramNeeds)
      if (host === undefined) {
        ns.print(`Couldn't find available host with ${formatRam(ramNeeds)} available RAM.`)
        await ns.sleep(2000)
      }
      else {
        return host
      }
    }
  }
}
