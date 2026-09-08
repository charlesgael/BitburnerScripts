import type { NS, RunOptions, ScriptArg } from '@ns'
import { HWGW_HOSTS_FILE } from '../ui/utils/hwgw-config'
import { parseArgs } from '../utils/args'
import { formatDuration } from '../utils/format/dates'
import { formatMoney, formatNumber, formatPercent, formatRam } from '../utils/format/game'
import { exitIfOffline } from '../utils/ns/offline'

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

export function readHwgwHosts(ns: NS): string[] {
  const raw = ns.read(HWGW_HOSTS_FILE)
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

function argTarget(args: ScriptArg[]): string | null {
  const idx = args.indexOf('--target')
  const value = idx === -1 ? undefined : args[idx + 1]
  return typeof value === 'string' && value ? value : null
}

class Program {
  public args: ScriptArg[]

  constructor(
    public script: string,
    public threadOrOptions?: number | RunOptions,
    ...args: ScriptArg[]
  ) {
    this.args = args
  }
}

function smallerBatches(program: Program, size = 1000): Program[] {
  let threadCount = typeof program.threadOrOptions === 'number' ? program.threadOrOptions : program.threadOrOptions?.threads ?? 1
  if (threadCount < size)
    return [program]

  const slice: Program[] = []
  const sliceCount = Math.ceil(threadCount / size)
  for (let i = 0; i < sliceCount; i++) {
    const thisSlice = threadCount > size ? size : threadCount
    threadCount -= thisSlice
    if (typeof program.threadOrOptions === 'object') {
      slice.push(new Program(program.script, { ...program.threadOrOptions, threads: thisSlice }, ...program.args))
    }
    else {
      slice.push(new Program(program.script, thisSlice, ...program.args))
    }
  }
  return slice
}

function launchFleet(ns: NS, hosts: string[], programs: Program[]): readonly [false, undefined] | readonly [true, number[]] {
  const pids: number[] = []
  for (const program of programs) {
    pids.push(exec(ns, program.script, hosts, program.threadOrOptions, ...program.args))
  }

  if (pids.includes(0)) {
    pids.filter(it => it).forEach(pid => ns.kill(pid))
    return [false, undefined]
  }
  return [true, pids]
}

function exec(ns: NS, script: string, hosts: string[], threadOrOptions?: number | RunOptions, ...args: ScriptArg[]): number {
  let pid = 0
  for (const host of hosts) {
    pid = ns.exec(script, host, threadOrOptions, ...args)
    if (pid > 0)
      return pid
  }
  ns.print(`ERROR: Could not launch ${script} x${JSON.stringify(threadOrOptions)}`)
  return 0
}

export async function main(ns: NS) {
  ns.disableLog('ALL')
  await exitIfOffline(ns)

  const args = parseArgs(ns, [
    { long: 'target', defaultValue: 'n00dles', description: 'Target to HWGW', short: 't' },
  ])
  const requestedHosts = args._.length ? args._.map(String) : undefined
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

  let hosts: string[] = []
  const dupe = ns.ps('home').find(p =>
    p.filename === ns.getScriptName()
    && p.pid !== ns.pid
    && argTarget(p.args) === target,
  )
  if (dupe) {
    ns.tprint(`WARNING: daemons/steady-farm.daemon.js is already running for ${target ?? '(auto-pick)'} (pid ${dupe.pid}) — exiting.`)
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

  const rams = {
    hack: ns.getScriptRam(HACK_SCRIPT, 'home'),
    grow: ns.getScriptRam(GROW_SCRIPT, 'home'),
    weaken: ns.getScriptRam(WEAKEN_SCRIPT, 'home'),
  }

  while (true) {
    // No length check here on purpose: an empty list (a bad edit to
    // hwgw-hosts.json, or every listed host getting sold/deleted at once)
    // falls straight through to hostCandidates()/free-RAM math below —
    // free comes out 0, which the existing `free < ramNeeds` retry path
    // already handles by sleeping and re-reading next tick, rather than
    // this hard-exiting a target that may have been earning for hours.
    hosts = requestedHosts?.filter(h => ns.serverExists(h)) || readHwgwHosts(ns)
    for (const host of hosts)
      ns.scp([HACK_SCRIPT, GROW_SCRIPT, WEAKEN_SCRIPT], host, 'home')

    const { hackDifficulty, minDifficulty, moneyAvailable, moneyMax } = ns.getServer(target)
    const snapshot = {
      securityExcess: Math.max(0, hackDifficulty! - minDifficulty!),
      moneyDeficit: Math.max(0, moneyMax! - moneyAvailable!),
      deficitPercent: Math.max(0, moneyMax! - moneyAvailable!) / moneyMax!,
    }

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
        growthThreads += Math.ceil(ns.growthAnalyze(target, multiplier) * GW_THREAD_MULTI)
        incSecurity += Math.ceil(ns.growthAnalyzeSecurity(growthThreads))
      }
      if (hackDifficulty! + incSecurity > minDifficulty!) {
        ns.print(`Security excess: ${formatNumber(hackDifficulty! + incSecurity - minDifficulty!)}`)
        weakenThreads += Math.ceil((hackDifficulty! + incSecurity - minDifficulty!) / WEAKEN_REDUCTION * GW_THREAD_MULTI)
      }

      if (growthThreads === 0 && weakenThreads === 0) {
        setState('farm', snapshot)
        continue
      }

      const ramNeeds = growthThreads * rams.grow + weakenThreads * rams.weaken
      // const host = await waitForHost(ramNeeds, snapshot)
      const [slaves, free] = hostCandidates()
      ns.print(`[prep] Grows: ${growthThreads}, Weakens: ${weakenThreads}, ram: ${formatRam(ramNeeds)} vs ${formatRam(free)} free`)

      if (free < ramNeeds) {
        ns.print(`Not trying to launch prep for ${target}`)
        notifyState(`${state}-ram`, snapshot)
        await ns.sleep(10_000)
        continue
      }

      const time = ns.getWeakenTime(target)

      const programs: Program[] = []
      if (growthThreads > 0)
        programs.push(...smallerBatches(new Program(GROW_SCRIPT, growthThreads, target), 200))
      if (weakenThreads > 0)
        programs.push(...smallerBatches(new Program(WEAKEN_SCRIPT, weakenThreads, target), 200))

      const [success, added] = launchFleet(ns, slaves, programs)
      if (!success) {
        ns.print(`Failed to launch prep for ${target}`)
        notifyState(`${state}-ram`, snapshot)
        await ns.sleep(10_000)
        continue
      }
      pids.push(...added)

      ns.print(`Waiting ${formatDuration(time / 1000)} for prep phase`)
      notifyState(`${state}`, snapshot)
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
      // const host = await waitForHost(ramNeeds, snapshot)
      const [slaves, free] = hostCandidates()

      if (free < ramNeeds) {
        ns.print(`Not trying to launch prep for ${target}`)
        notifyState(`${state}-ram`, snapshot)
        await ns.sleep(10_000)
        continue
      }

      ns.print(`[farm] Looptime: ${formatDuration(loopTime / 1000)}, ram: ${formatRam(ramNeeds)} vs ${formatRam(free)} free`)

      const programs: Program[] = []
      for (let i = 0; i < loops; i++) {
        programs.push(new Program(HACK_SCRIPT, { preventDuplicates: true, threads: hackThreads }, target, loopTime, 0 + waveLength * i))
        programs.push(new Program(WEAKEN_SCRIPT, { preventDuplicates: true, threads: weaken1Threads }, target, loopTime, WAVE_LEG_GAP_MS + waveLength * i))
        programs.push(new Program(GROW_SCRIPT, { preventDuplicates: true, threads: growthThreads }, target, loopTime, WAVE_LEG_GAP_MS * 2 + waveLength * i))
        programs.push(new Program(WEAKEN_SCRIPT, { preventDuplicates: true, threads: weaken2Threads }, target, loopTime, WAVE_LEG_GAP_MS * 3 + waveLength * i))
      }

      const [success, added] = launchFleet(ns, slaves, programs)
      if (!success) {
        ns.print(`Failed to launch farm for ${target}`)
        notifyState(`${state}-ram`, snapshot)
        await ns.sleep(10_000)
        continue
      }
      pids.push(...added)
      notifyState(`${state}`, snapshot)
      await ns.sleep(Math.ceil(WAVE_LEG_GAP_MS * 3 + WAVE_SERIES_GAP_MS / 2))
      setState('done', snapshot)
    }
    else {
      ns.print(`Farm ongoing`)
      if (snapshot.moneyDeficit > 0) {
        ns.print(`Money deficit: ${formatMoney(snapshot.moneyDeficit)} (${formatPercent(snapshot.deficitPercent)})`)
      }
      if (snapshot.securityExcess > 0) {
        ns.print(`Security excess: ${formatNumber(snapshot.securityExcess)}`)
      }
      if (snapshot.deficitPercent > 0.25 || snapshot.securityExcess > 5) {
        ns.print(`Too much drift, back to 'prep'`)
        killall()
        setState('prep', snapshot)
        continue
      }
      setState('done', snapshot)
      await ns.sleep((WAVE_LEG_GAP_MS * 3 + WAVE_SERIES_GAP_MS) * 5)
    }
  }

  function killall() {
    pids.filter(it => it).forEach(pid => ns.kill(pid))
    pids.length = 0
  }

  // eslint-disable-next-line unused-imports/no-unused-vars
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

  function hostCandidates() {
    const candidates = hosts
      .map(it => [it, ns.getServerMaxRam(it) - ns.getServerUsedRam(it)] as const)
      .sort(([,A], [,B]) => B - A)

    return [
      candidates.map(([it]) => it),
      candidates.map(([,free]) => free).reduce((a, b) => a + b, 0),
    ] as const
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
