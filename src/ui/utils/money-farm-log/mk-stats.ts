import type { Mode, MoneyFarmLogEntry } from './types'

const MS_PER_HOUR = 3_600_000

// --- INTERFACES --- //

export interface MoneyFarmActionSummary {
  count: number
  threads: number
  totalDuration: number
  averageDuration: number
}

export interface MoneyFarmHackSummary extends MoneyFarmActionSummary {
  money: number
  averageMoney: number
  moneyPerThread: number
}

export interface MoneyFarmGrowSummary extends MoneyFarmActionSummary {
  growth: number
  averageGrowth: number
}

export interface MoneyFarmServerSnapshot {
  ts: number

  money: number
  maxMoney: number
  moneyDeficit: number

  security: number
  minSecurity: number
  securityExcess: number
}

export interface MoneyFarmTargetSummary {
  uptimeMs: number
  uptimeHours: number

  totalMoney: number
  moneyPerHour: number

  hacks: MoneyFarmHackSummary
  grows: MoneyFarmGrowSummary
  weakens: MoneyFarmActionSummary

  mode: {
    changes: number
    transitions: Record<string, number>
    durationMs: Record<Mode, number>
  }

  server: {
    averageMoneyDeficit: number
    averageSecurityExcess: number
    snapshots: MoneyFarmServerSnapshot[]
  }
}

export interface MoneyFarmLogSummary {
  durationMs: number
  durationHours: number

  totalMoney: number
  moneyPerHour: number

  hacks: MoneyFarmHackSummary
  grows: MoneyFarmGrowSummary
  weakens: MoneyFarmActionSummary

  targets: Record<string, MoneyFarmTargetSummary>
}

interface TargetRuntime {
  startedAt?: number
  endedAt?: number

  mode?: Mode
  modeStartedAt?: number

  lastServerSnapshot?: MoneyFarmServerSnapshot
  lastServerTs?: number

  serverMoneyDeficitTime: number
  serverSecurityExcessTime: number
}

// --- CONSTRUCTORS --- //

function createLogSummary(): MoneyFarmLogSummary {
  return {
    durationMs: 0,
    durationHours: 0,

    totalMoney: 0,
    moneyPerHour: 0,

    hacks: createHackSummary(),
    grows: createGrowSummary(),
    weakens: createActionSummary(),

    targets: {},
  }
}

function createTargetSummary(): MoneyFarmTargetSummary {
  return {
    uptimeMs: 0,
    uptimeHours: 0,

    totalMoney: 0,
    moneyPerHour: 0,

    hacks: createHackSummary(),
    grows: createGrowSummary(),
    weakens: createActionSummary(),

    mode: {
      changes: 0,
      transitions: {},
      durationMs: {
        'weaken': 0,
        'grow-prep': 0,
        'farm': 0,
      },
    },

    server: {
      averageMoneyDeficit: 0,
      averageSecurityExcess: 0,
      snapshots: [],
    },
  }
}

function createActionSummary(): MoneyFarmActionSummary {
  return {
    count: 0,
    threads: 0,
    totalDuration: 0,
    averageDuration: 0,
  }
}

function createHackSummary(): MoneyFarmHackSummary {
  return {
    ...createActionSummary(),
    money: 0,
    averageMoney: 0,
    moneyPerThread: 0,
  }
}

function createGrowSummary(): MoneyFarmGrowSummary {
  return {
    ...createActionSummary(),
    growth: 0,
    averageGrowth: 0,
  }
}

function createTargetRuntime(): TargetRuntime {
  return {
    serverMoneyDeficitTime: 0,
    serverSecurityExcessTime: 0,
  }
}

// --- WORK LIFECYCLE --- //

function startWork(
  runtime: TargetRuntime,
  ts: number,
): void {
  /*
   * A target can technically receive another start-work after
   * a previous session has ended. Reset session-local state here.
   */
  runtime.startedAt = ts
  runtime.endedAt = undefined

  runtime.mode = undefined
  runtime.modeStartedAt = undefined

  runtime.lastServerSnapshot = undefined
  runtime.lastServerTs = undefined

  runtime.serverMoneyDeficitTime = 0
  runtime.serverSecurityExcessTime = 0
}

function endWork(
  target: MoneyFarmTargetSummary,
  runtime: TargetRuntime,
  ts: number,
): void {
  if (runtime.startedAt !== undefined) {
    target.uptimeMs += elapsed(runtime.startedAt, ts)
  }

  closeMode(target, runtime, ts)
  closeServerInterval(runtime, ts)

  runtime.endedAt = ts
  runtime.startedAt = undefined
  runtime.mode = undefined
  runtime.modeStartedAt = undefined
  runtime.lastServerSnapshot = undefined
  runtime.lastServerTs = undefined
}

// --- MODE TRACKING --- //

function changeMode(
  target: MoneyFarmTargetSummary,
  runtime: TargetRuntime,
  oldMode: string,
  mode: Mode,
  ts: number,
): void {
  target.mode.changes++

  const transition = `${oldMode} -> ${mode}`

  target.mode.transitions[transition]
    = (target.mode.transitions[transition] ?? 0) + 1

  /*
   * Close the previous mode's interval.
   *
   * We trust the runtime's actual mode rather than oldMode because
   * the runtime represents what we've actually observed in the log.
   */
  closeMode(target, runtime, ts)

  runtime.mode = mode
  runtime.modeStartedAt = ts
}

function closeMode(
  target: MoneyFarmTargetSummary,
  runtime: TargetRuntime,
  endTs: number,
): void {
  if (
    runtime.mode === undefined
    || runtime.modeStartedAt === undefined
  ) {
    return
  }

  target.mode.durationMs[runtime.mode] += elapsed(
    runtime.modeStartedAt,
    endTs,
  )

  runtime.modeStartedAt = undefined
}

// --- ACTION AGGREGATION --- //

function addAction(
  summary: MoneyFarmActionSummary,
  target: MoneyFarmActionSummary,
  entry: {
    threads: number
    duration: number
  },
): void {
  addActionTo(summary, entry.threads, entry.duration)
  addActionTo(target, entry.threads, entry.duration)
}

function addActionTo(
  summary: MoneyFarmActionSummary,
  threads: number,
  duration: number,
): void {
  summary.count++
  summary.threads += threads
  summary.totalDuration += duration
}

function addHack(
  summary: MoneyFarmHackSummary,
  target: MoneyFarmHackSummary,
  entry: Extract<MoneyFarmLogEntry & { action: 'hack' }, { action: 'hack' }>,
): void {
  addAction(summary, target, entry)

  const money = entry.money ?? 0

  summary.money += money
  target.money += money
}

function addGrow(
  summary: MoneyFarmGrowSummary,
  target: MoneyFarmGrowSummary,
  entry: Extract<MoneyFarmLogEntry & { action: 'grow' }, { action: 'grow' }>,
): void {
  addAction(summary, target, entry)

  const growth = entry.growth ?? 0

  summary.growth += growth
  target.growth += growth
}

// --- SERVER TRACKING --- //

function updateServer(
  target: MoneyFarmTargetSummary,
  runtime: TargetRuntime,
  entry: Extract<
    MoneyFarmLogEntry,
    { action: 'update-server' }
  >,
): void {
  /*
   * First, close the previous snapshot's time interval.
   */
  closeServerInterval(runtime, entry.ts)

  const snapshot: MoneyFarmServerSnapshot = {
    ts: entry.ts,

    money: entry.money,
    maxMoney: entry.maxMoney,
    moneyDeficit: Math.max(
      0,
      entry.maxMoney - entry.money,
    ),

    security: entry.security,
    minSecurity: entry.minSecurity,
    securityExcess: Math.max(
      0,
      entry.security - entry.minSecurity,
    ),
  }

  target.server.snapshots.push(snapshot)

  runtime.lastServerSnapshot = snapshot
  runtime.lastServerTs = entry.ts
}

function closeServerInterval(
  runtime: TargetRuntime,
  endTs: number,
): void {
  const snapshot = runtime.lastServerSnapshot
  const startTs = runtime.lastServerTs

  if (
    snapshot === undefined
    || startTs === undefined
  ) {
    return
  }

  /*
   * Only count the interval while the target is actually alive.
   */
  const intervalStart = Math.max(
    startTs,
    runtime.startedAt ?? startTs,
  )

  const intervalEnd = Math.min(
    endTs,
    runtime.endedAt ?? endTs,
  )

  const duration = elapsed(
    intervalStart,
    intervalEnd,
  )

  runtime.serverMoneyDeficitTime
    += snapshot.moneyDeficit * duration

  runtime.serverSecurityExcessTime
    += snapshot.securityExcess * duration

  runtime.lastServerTs = endTs
}

// --- CLOSING UNFINISHED --- //

function closeRuntime(
  target: MoneyFarmTargetSummary,
  runtime: TargetRuntime,
  endTs: number,
): void {
  /*
   * If start-work was never followed by end-work, the target was
   * still alive when logging stopped.
   */
  if (runtime.startedAt !== undefined) {
    target.uptimeMs += elapsed(
      runtime.startedAt,
      endTs,
    )
  }

  closeMode(target, runtime, endTs)
  closeServerInterval(runtime, endTs)
}

// --- FINALIZATION --- //

function finalizeSummary(
  summary: MoneyFarmLogSummary,
): void {
  finalizeAction(summary.hacks)
  finalizeAction(summary.grows)
  finalizeAction(summary.weakens)

  finalizeHack(summary.hacks)
  finalizeGrow(summary.grows)

  summary.moneyPerHour
    = summary.durationMs > 0
      ? summary.totalMoney
      / (summary.durationMs / MS_PER_HOUR)
      : 0
}

function finalizeTarget(
  target: MoneyFarmTargetSummary,
  serverMoneyDeficitTime: number,
  serverSecurityExcessTime: number,
): void {
  target.uptimeHours
    = target.uptimeMs / MS_PER_HOUR

  target.moneyPerHour
    = target.uptimeMs > 0
      ? target.totalMoney
      / (target.uptimeMs / MS_PER_HOUR)
      : 0

  finalizeAction(target.hacks)
  finalizeAction(target.grows)
  finalizeAction(target.weakens)

  finalizeHack(target.hacks)
  finalizeGrow(target.grows)

  target.server.averageMoneyDeficit
    = target.uptimeMs > 0
      ? serverMoneyDeficitTime / target.uptimeMs
      : 0

  target.server.averageSecurityExcess
    = target.uptimeMs > 0
      ? serverSecurityExcessTime / target.uptimeMs
      : 0
}

function finalizeAction(
  summary: MoneyFarmActionSummary,
): void {
  summary.averageDuration
    = summary.count > 0
      ? summary.totalDuration / summary.count
      : 0
}

function finalizeHack(
  summary: MoneyFarmHackSummary,
): void {
  summary.averageMoney
    = summary.count > 0
      ? summary.money / summary.count
      : 0

  summary.moneyPerThread
    = summary.threads > 0
      ? summary.money / summary.threads
      : 0
}

function finalizeGrow(
  summary: MoneyFarmGrowSummary,
): void {
  summary.averageGrowth
    = summary.count > 0
      ? summary.growth / summary.count
      : 0
}

function elapsed(
  start: number,
  end: number,
): number {
  return Math.max(0, end - start)
}

// --- LOGIC --- //

export function summarizeMoneyLog(
  entries: MoneyFarmLogEntry[],
): MoneyFarmLogSummary {
  const summary = createLogSummary()

  if (entries.length === 0) {
    return summary
  }

  // Logs are normally chronological already, but don't rely on that.
  const sortedEntries = [...entries].sort((a, b) => a.ts - b.ts)

  const firstTs = sortedEntries[0].ts
  const lastTs = sortedEntries[sortedEntries.length - 1].ts

  summary.durationMs = Math.max(0, lastTs - firstTs)
  summary.durationHours = summary.durationMs / MS_PER_HOUR

  const runtimes = new Map<string, TargetRuntime>()

  const getTarget = (target: string): MoneyFarmTargetSummary => {
    return (
      summary.targets[target] ??= createTargetSummary()
    )
  }

  const getRuntime = (target: string): TargetRuntime => {
    let runtime = runtimes.get(target)

    if (!runtime) {
      runtime = createTargetRuntime()
      runtimes.set(target, runtime)
    }

    return runtime
  }

  for (const entry of sortedEntries) {
    if (!('target' in entry)) {
      continue
    }

    const target = getTarget(entry.target)
    const runtime = getRuntime(entry.target)

    switch (entry.action) {
      case 'start-work':
        startWork(runtime, entry.ts)
        break

      case 'end-work':
        endWork(target, runtime, entry.ts)
        break

      case 'change-mode':
        changeMode(target, runtime, entry.oldMode, entry.mode, entry.ts)
        break

      case 'hack':
        addHack(summary.hacks, target.hacks, entry as Extract<MoneyFarmLogEntry, { action: 'hack' }>)
        summary.totalMoney += entry.money ?? 0
        target.totalMoney += entry.money ?? 0
        break

      case 'grow':
        addGrow(summary.grows, target.grows, entry as Extract<MoneyFarmLogEntry, { action: 'grow' }>)
        break

      case 'weaken':
        addAction(summary.weakens, target.weakens, entry)
        break

      case 'update-server':
        updateServer(target, runtime, entry)
        break
    }
  }

  /*
   * Close all state that was still active when the log ended.
   */
  for (const [targetName, runtime] of runtimes) {
    const target = summary.targets[targetName]

    if (!target) {
      continue
    }

    closeRuntime(target, runtime, lastTs)

    finalizeTarget(
      target,
      runtime.serverMoneyDeficitTime,
      runtime.serverSecurityExcessTime,
    )
  }

  finalizeSummary(summary)

  return summary
}
