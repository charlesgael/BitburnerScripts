import type { NS, ScriptArg } from '@ns'

/**
 * Live status for hwgw (`src/hwgw/`) — the money-earning system that
 * replaced `daemons/money-farm.daemon.ts`. No port, no log file: this
 * reads exactly what Bitburner already tracks natively.
 *
 * `start.js` never calls `ns.hack`/`ns.grow`/`ns.weaken` itself, so its own
 * `ns.getRunningScript(pid).onlineMoneyMade`/`offlineMoneyMade` is always
 * ~0 — money/XP have to come from the actual `h.js`/`g.js`/`w.js` worker
 * pids running on the dedicated hosts instead (`scanHwgwWorkers` below).
 * `start.js`'s own pid is still useful for one different thing: its
 * `--target`/mode. `hwgw/start.ts` prints a `{action:'state-change', to}`
 * JSON line via `ns.print` at every state transition — `getRunningScript`
 * already returns a process's own logs, so reading the *latest* one back
 * costs nothing beyond the one `getRunningScript` call this file already
 * needs for money/XP.
 */

export const HWGW_ORCHESTRATOR_SCRIPT = 'hwgw/start.js'
export const HWGW_HACK_SCRIPT = 'hwgw/h.js'
export const HWGW_GROW_SCRIPT = 'hwgw/g.js'
export const HWGW_WEAKEN_SCRIPT = 'hwgw/w.js'

/** Mirrors `hwgw/start.ts`'s own `state` union exactly. */
export type HwgwMode = 'null' | 'prep' | 'farm' | 'done'

export interface HwgwTargetStatus {
  target: string
  mode: HwgwMode
  moneyMade: number
  expGained: number
  moneyPerHour: number
  expPerHour: number
  /** `hackDifficulty - minDifficulty` at the orchestrator's last tick — 0 once weaken has caught up. */
  securityExcess: number
  /** `moneyMax - moneyAvailable` at the orchestrator's last tick — 0 once grow has caught up. */
  moneyDeficit: number
  /**
   * This target's `hwgw/start.js` pid, for `ns.ui.openTail(pid)` — `null`
   * when no live orchestrator was found for it (only its workers turned up
   * in the scan; hwgw has no self-healing, see `hwgw/start.ts`'s `'done'`
   * branch, so an orchestrator can die while its workers keep looping).
   */
  pid: number | null
}

/** Every hwgw target currently known, plus which purchased-server host(s) are running its workers. */
export interface HwgwStatusResult {
  byTarget: Record<string, HwgwTargetStatus>
  /** host -> distinct target names with at least one h.js/g.js/w.js running there. */
  byHost: Record<string, string[]>
}

/** Same convention `hwgw/start.ts`'s own duplicate-instance check uses. */
function argTarget(args: ScriptArg[]): string | null {
  const idx = args.indexOf('--target')
  const value = idx === -1 ? undefined : args[idx + 1]
  return typeof value === 'string' && value ? value : null
}

/** `hwgw/start.ts`'s `setState`'s own snapshot shape — mode plus the security/money numbers it already had on hand at that tick. */
export interface OrchestratorSnapshot {
  mode: HwgwMode
  securityExcess: number
  moneyDeficit: number
}

/** `OrchestratorSnapshot` plus the pid it was read off — `scanHwgwOrchestrators`'s own return shape, `pid` added there (not by `latestSnapshot`, which only ever sees the log lines, never the process info). */
export interface OrchestratorStatus extends OrchestratorSnapshot {
  pid: number
}

const NULL_SNAPSHOT: OrchestratorSnapshot = { mode: 'null', securityExcess: 0, moneyDeficit: 0 }

/**
 * The most recent `{action:'state-change', to, securityExcess, moneyDeficit}`
 * line in `logs`, scanned newest-first — everything else `ns.print` writes
 * (the plain human-readable lines) just fails `JSON.parse` and is skipped.
 * `NULL_SNAPSHOT` (never having transitioned at all) if no such line
 * exists yet. `hwgw/start.ts` re-prints this every loop tick, not just on
 * an actual transition, specifically so this scan always finds a recent
 * one — see that file's own comment on `setState`.
 */
function latestSnapshot(logs: string[]): OrchestratorSnapshot {
  for (let i = logs.length - 1; i >= 0; i--) {
    try {
      const parsed: unknown = JSON.parse(logs[i])
      if (
        parsed !== null
        && typeof parsed === 'object'
        && (parsed as { action?: unknown }).action === 'state-change'
        && typeof (parsed as { to?: unknown }).to === 'string'
      ) {
        const p = parsed as { to: HwgwMode, securityExcess?: unknown, moneyDeficit?: unknown }
        return {
          mode: p.to,
          securityExcess: typeof p.securityExcess === 'number' ? p.securityExcess : 0,
          moneyDeficit: typeof p.moneyDeficit === 'number' ? p.moneyDeficit : 0,
        }
      }
    }
    catch {
      // Not a JSON log line — keep scanning backward.
    }
  }
  return NULL_SNAPSHOT
}

/** Every currently-running `hwgw/start.js` instance's own target -> snapshot (+ pid), from `home`. */
export function scanHwgwOrchestrators(ns: NS, home = 'home'): Map<string, OrchestratorStatus> {
  const snapshots = new Map<string, OrchestratorStatus>()
  for (const proc of ns.ps(home)) {
    if (proc.filename !== HWGW_ORCHESTRATOR_SCRIPT)
      continue
    const target = argTarget(proc.args)
    if (!target)
      continue
    const rs = ns.getRunningScript(proc.pid)
    if (!rs)
      continue
    snapshots.set(target, { ...latestSnapshot(rs.logs), pid: proc.pid })
  }
  return snapshots
}

interface WorkerTotals {
  moneyMade: number
  expGained: number
  /** The longest-running matching worker's own online+offline runtime, for this target. */
  hours: number
}

/**
 * Sums `getRunningScript` totals for every `h.js`/`g.js`/`w.js` pid found
 * across `hosts`, grouped by each worker's own `args[0]` target — grouping
 * falls out of the scan for free, since every hwgw worker's target is its
 * first positional arg. Also returns which host(s) each target's workers
 * were found on, for a per-host view (a host can carry more than one
 * target — `hwgw/start.ts` shares one host pool across every running
 * instance, it doesn't dedicate one host per target).
 */
export function scanHwgwWorkers(ns: NS, hosts: string[]): { totals: Map<string, WorkerTotals>, byHost: Map<string, Set<string>> } {
  const totals = new Map<string, WorkerTotals>()
  const byHost = new Map<string, Set<string>>()

  for (const host of hosts) {
    for (const proc of ns.ps(host)) {
      if (
        proc.filename !== HWGW_HACK_SCRIPT
        && proc.filename !== HWGW_GROW_SCRIPT
        && proc.filename !== HWGW_WEAKEN_SCRIPT
      ) {
        continue
      }
      const target = typeof proc.args[0] === 'string' ? proc.args[0] : undefined
      if (!target)
        continue

      const rs = ns.getRunningScript(proc.pid)
      if (!rs)
        continue

      const hours = (rs.onlineRunningTime + rs.offlineRunningTime) / 3600
      const prev = totals.get(target) ?? { moneyMade: 0, expGained: 0, hours: 0 }
      totals.set(target, {
        moneyMade: prev.moneyMade + rs.onlineMoneyMade + rs.offlineMoneyMade,
        expGained: prev.expGained + rs.onlineExpGained + rs.offlineExpGained,
        hours: Math.max(prev.hours, hours),
      })

      const targetsOnHost = byHost.get(host) ?? new Set<string>()
      targetsOnHost.add(target)
      byHost.set(host, targetsOnHost)
    }
  }

  return { totals, byHost }
}

/**
 * The whole live picture: every target's mode (from the orchestrators on
 * `home`) merged with its money/XP totals and rate (from the workers on
 * `dedicatedHosts`), plus which host(s) are currently running each target.
 * A target can appear with a mode but no worker totals yet (just entered
 * `prep`, nothing to sum) or vice versa (an orchestrator died but its
 * workers keep looping — hwgw has no self-healing, see `hwgw/start.ts`'s
 * `'done'` branch) — both are real, valid states, not bugs to paper over.
 */
export function gatherHwgwStatus(ns: NS, dedicatedHosts: string[], home = 'home'): HwgwStatusResult {
  const snapshots = scanHwgwOrchestrators(ns, home)
  const { totals, byHost } = scanHwgwWorkers(ns, dedicatedHosts)

  const targetNames = new Set([...snapshots.keys(), ...totals.keys()])
  const byTarget: Record<string, HwgwTargetStatus> = {}
  for (const target of targetNames) {
    const t = totals.get(target) ?? { moneyMade: 0, expGained: 0, hours: 0 }
    const s = snapshots.get(target)
    byTarget[target] = {
      target,
      mode: s?.mode ?? NULL_SNAPSHOT.mode,
      moneyMade: t.moneyMade,
      expGained: t.expGained,
      moneyPerHour: t.hours > 0 ? t.moneyMade / t.hours : 0,
      expPerHour: t.hours > 0 ? t.expGained / t.hours : 0,
      securityExcess: s?.securityExcess ?? NULL_SNAPSHOT.securityExcess,
      moneyDeficit: s?.moneyDeficit ?? NULL_SNAPSHOT.moneyDeficit,
      pid: s?.pid ?? null,
    }
  }

  const byHostOut: Record<string, string[]> = {}
  for (const [host, targets] of byHost) {
    byHostOut[host] = [...targets]
  }

  return { byTarget, byHost: byHostOut }
}

/** Just the target names currently running against, for `xp-farm.daemon.ts`'s collision check — no mode/money/XP needed there. */
export function scanHwgwTargets(ns: NS, dedicatedHosts: string[], home = 'home'): Set<string> {
  const snapshots = scanHwgwOrchestrators(ns, home)
  const { totals } = scanHwgwWorkers(ns, dedicatedHosts)
  return new Set([...snapshots.keys(), ...totals.keys()])
}
