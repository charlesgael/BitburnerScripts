import type { Mode, MoneyFarmLogEntry, RollupLogEntry } from './types'

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

/**
 * Raw, summable subset shared by `MoneyFarmActionSummary` and friends —
 * shape a rollup entry's per-action totals are merged from/into (see
 * `mergeActionTotals` below). Never the derived `average*`/`moneyPerThread`
 * fields, which `finalizeAction`/`finalizeHack`/`finalizeGrow` always
 * recompute fresh from these once every raw number is summed.
 */
interface RawActionTotals {
  count: number
  threads: number
  totalDuration: number
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
  }
}

export interface MoneyFarmLogSummary {
  durationMs: number
  durationHours: number

  totalMoney: number
  money2h: number
  moneyPerHour: number
  moneyPerHour2h: number
  totalHacks: number
  hacks2h: number
  totalGrows: number
  grows2h: number
  totalWeakens: number
  weakens2h: number

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

export function createLogSummary(): MoneyFarmLogSummary {
  return {
    durationMs: 0,
    durationHours: 0,

    totalMoney: 0,
    money2h: 0,
    moneyPerHour: 0,
    moneyPerHour2h: 0,
    totalHacks: 0,
    hacks2h: 0,
    totalGrows: 0,
    grows2h: 0,
    totalWeakens: 0,
    weakens2h: 0,

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

// --- ROLLUP MERGE --- //

function mergeActionTotals(
  target: MoneyFarmActionSummary,
  raw: RawActionTotals,
): void {
  target.count += raw.count
  target.threads += raw.threads
  target.totalDuration += raw.totalDuration
}

/**
 * Folds one `'rollup'` entry's already-aggregated history into a live
 * `summary`/`runtimes` accumulation — the mirror image of
 * `buildMoneyFarmRollup` below, which is what produces these entries in
 * the first place. Purely additive: every field a rollup carries is a raw,
 * summable total (see `RollupTarget`'s own comment in `types.ts`), so
 * merging it is just "add these numbers to the numbers already there,"
 * the same as replaying the real entries it replaced would have done.
 */
function applyRollupEntry(
  summary: MoneyFarmLogSummary,
  getTarget: (target: string) => MoneyFarmTargetSummary,
  getRuntime: (target: string) => TargetRuntime,
  entry: RollupLogEntry,
): void {
  summary.totalMoney += entry.totalMoney
  summary.totalHacks += entry.totalHacks
  summary.totalGrows += entry.totalGrows
  summary.totalWeakens += entry.totalWeakens

  mergeActionTotals(summary.hacks, entry.hacks)
  summary.hacks.money += entry.hacks.money

  mergeActionTotals(summary.grows, entry.grows)
  summary.grows.growth += entry.grows.growth

  mergeActionTotals(summary.weakens, entry.weakens)

  for (const t of entry.targets) {
    const target = getTarget(t.target)
    const runtime = getRuntime(t.target)

    target.totalMoney += t.totalMoney
    target.uptimeMs += t.uptimeMs

    mergeActionTotals(target.hacks, t.hacks)
    target.hacks.money += t.hacks.money

    mergeActionTotals(target.grows, t.grows)
    target.grows.growth += t.grows.growth

    mergeActionTotals(target.weakens, t.weakens)

    target.mode.changes += t.modeChanges
    for (const key in t.modeTransitions) {
      target.mode.transitions[key] = (target.mode.transitions[key] ?? 0) + t.modeTransitions[key]
    }
    target.mode.durationMs.weaken += t.modeDurationMs.weaken
    target.mode.durationMs['grow-prep'] += t.modeDurationMs['grow-prep']
    target.mode.durationMs.farm += t.modeDurationMs.farm

    runtime.serverMoneyDeficitTime += t.moneyDeficitTimeMs
    runtime.serverSecurityExcessTime += t.securityExcessTimeMs

    /*
     * Only the restart timestamp carries forward (the "minimal"
     * carry-forward option — see `reopenAt`'s own comment in `types.ts`).
     * `runtime.mode`/`lastServerSnapshot` are deliberately left alone:
     * `changeMode`/`updateServer` both set them unconditionally on the
     * next real entry for this target regardless of prior state, so the
     * only cost is a small, self-healing gap in mode-duration/security-
     * average tracking between this rollup and that next real entry.
     */
    if (t.reopenAt !== undefined) {
      runtime.startedAt = t.reopenAt
    }
  }
}

/**
 * Applies one log entry — real or a `'rollup'` digest of formerly-real
 * ones — to a live `summary`/`runtimes` accumulation. Shared by
 * `summarizeMoneyLog` (the whole file) and `buildMoneyFarmRollup` below
 * (just the chunk being collapsed), so the two can never drift apart on
 * how an entry is interpreted.
 */
function applyEntry(
  summary: MoneyFarmLogSummary,
  getTarget: (target: string) => MoneyFarmTargetSummary,
  getRuntime: (target: string) => TargetRuntime,
  twoHoursTs: number,
  entry: MoneyFarmLogEntry,
): void {
  if (entry.action === 'rollup') {
    applyRollupEntry(summary, getTarget, getRuntime, entry)
    return
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
      summary.totalHacks += entry.threads ?? 1
      if (entry.ts >= twoHoursTs) {
        summary.hacks2h += entry.threads ?? 1
        summary.money2h += entry.money ?? 0
      }
      break

    case 'grow':
      addGrow(summary.grows, target.grows, entry as Extract<MoneyFarmLogEntry, { action: 'grow' }>)
      summary.totalGrows += entry.threads ?? 1
      if (entry.ts >= twoHoursTs) {
        summary.grows2h += entry.threads ?? 1
      }
      break

    case 'weaken':
      addAction(summary.weakens, target.weakens, entry)
      summary.totalWeakens += entry.threads ?? 1
      if (entry.ts >= twoHoursTs) {
        summary.weakens2h += entry.threads ?? 1
      }
      break

    case 'update-server':
      updateServer(runtime, entry)
      break
  }
}

// --- LOGIC --- //

export function summarizeMoneyLog(
  entries: MoneyFarmLogEntry[],
): MoneyFarmLogSummary {
  const twoHoursTs = Date.now() - 2 * MS_PER_HOUR
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
    applyEntry(summary, getTarget, getRuntime, twoHoursTs, entry)
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

// --- ROLLUP BUILD --- //

/**
 * Collapses a chunk of aging log entries — the head `state-farm/index.ts`
 * is about to trim off — into a single compact `'rollup'` entry, so
 * `addMoneyFarmLog`'s periodic trim can aggregate instead of just
 * discarding the head (see that file's own header comment). Runs the same
 * `applyEntry` accumulation `summarizeMoneyLog` uses, scoped to just
 * `entries`, which transparently folds in a *previous* rollup entry too if
 * one happens to land inside this chunk (chained rollups) — this is what
 * keeps the log at exactly one rollup line forever rather than
 * accumulating more each time it's trimmed.
 *
 * `boundaryTs` is deliberately distinct from this rollup's own `ts` (the
 * true* minimum of `entries`, preserved so a later full
 * `summarizeMoneyLog` over `[rollup, ...retained]` still reports the real
 * session-start time/duration): `boundaryTs` is the point *after* this
 * chunk ends — the first retained entry's own timestamp, in practice —
 * used only to close out and re-anchor any target whose session was still
 * open when this chunk was collapsed (see `reopenAt` on `RollupTarget` in
 * `types.ts`).
 */
export function buildMoneyFarmRollup(
  entries: MoneyFarmLogEntry[],
  boundaryTs: number,
): RollupLogEntry | null {
  if (entries.length === 0) {
    return null
  }

  const sorted = [...entries].sort((a, b) => a.ts - b.ts)
  const ts = sorted[0].ts
  const twoHoursTs = Date.now() - 2 * MS_PER_HOUR

  const summary = createLogSummary()
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

  for (const entry of sorted) {
    applyEntry(summary, getTarget, getRuntime, twoHoursTs, entry)
  }

  const targets: RollupLogEntry['targets'] = []

  for (const [name, runtime] of runtimes) {
    const target = summary.targets[name]

    if (!target) {
      continue
    }

    /*
     * Folds trailing uptime + closes the open mode interval + closes the
     * open server interval, all up to `boundaryTs` — the same finisher
     * `summarizeMoneyLog` runs at the very end of the whole log, just
     * scoped to this chunk's boundary instead. Doesn't clear
     * `runtime.startedAt` (see that field's own tracking below), so
     * checking it after this call is still meaningful.
     */
    closeRuntime(target, runtime, boundaryTs)

    targets.push({
      target: name,
      totalMoney: target.totalMoney,
      uptimeMs: target.uptimeMs,
      hacks: {
        count: target.hacks.count,
        threads: target.hacks.threads,
        totalDuration: target.hacks.totalDuration,
        money: target.hacks.money,
      },
      grows: {
        count: target.grows.count,
        threads: target.grows.threads,
        totalDuration: target.grows.totalDuration,
        growth: target.grows.growth,
      },
      weakens: {
        count: target.weakens.count,
        threads: target.weakens.threads,
        totalDuration: target.weakens.totalDuration,
      },
      modeChanges: target.mode.changes,
      modeTransitions: { ...target.mode.transitions },
      modeDurationMs: { ...target.mode.durationMs },
      moneyDeficitTimeMs: runtime.serverMoneyDeficitTime,
      securityExcessTimeMs: runtime.serverSecurityExcessTime,
      reopenAt: runtime.startedAt !== undefined ? boundaryTs : undefined,
    })
  }

  return {
    ts,
    action: 'rollup',
    totalMoney: summary.totalMoney,
    totalHacks: summary.totalHacks,
    totalGrows: summary.totalGrows,
    totalWeakens: summary.totalWeakens,
    hacks: {
      count: summary.hacks.count,
      threads: summary.hacks.threads,
      totalDuration: summary.hacks.totalDuration,
      money: summary.hacks.money,
    },
    grows: {
      count: summary.grows.count,
      threads: summary.grows.threads,
      totalDuration: summary.grows.totalDuration,
      growth: summary.grows.growth,
    },
    weakens: {
      count: summary.weakens.count,
      threads: summary.weakens.threads,
      totalDuration: summary.weakens.totalDuration,
    },
    targets,
  }
}
