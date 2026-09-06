import type { NS } from '@ns'
import { STEADY_FARM_DAEMON_SCRIPT } from './config'

export interface SteadyFarmLiveStats {
  totalMoney: number
  moneyPerHour: number
  totalExp: number
  expPerHour: number
}

/**
 * Live totals across every currently-running Steady Farm daemon instance —
 * `main.tsx`'s login-time summary, and the whole reason this doesn't need
 * to parse `STEADY_FARM_LOG_FILE` or track a checkpoint at all.
 * `ns.getRunningScript` (0.3GB) reports `online`/`offlineMoneyMade` and
 * `online`/`offlineExpGained` per process, natively tracked by the game —
 * `offlineMoneyMade` specifically is exactly the figure Bitburner's own
 * offline-gains calculator computes for a script it saw running a stable
 * loop at disconnect, which is this daemon's entire design goal. Passing a
 * pid as `getRunningScript`'s first argument means the host it's actually
 * running on doesn't matter, so finding every `daemons/steady-farm.daemon.js`
 * instance via `ns.ps('home')` (`STEADY_FARM_DAEMON_HOST` is always `home`)
 * is sufficient — no need to scan any instance's own dedicated fleet.
 *
 * Each instance's own rate is computed from its own `onlineRunningTime +
 * offlineRunningTime` and summed, rather than dividing a pooled total by
 * one shared clock — multiple instances (each targeting a different
 * server) can have started at very different times, and summing per-
 * instance rates avoids an older instance's longer clock diluting a
 * freshly-launched one's own rate.
 */
export function computeSteadyFarmStats(ns: NS): SteadyFarmLiveStats | null {
  const daemons = ns.ps('home').filter(p => p.filename === STEADY_FARM_DAEMON_SCRIPT)
  if (daemons.length === 0)
    return null

  let totalMoney = 0
  let moneyPerHour = 0
  let totalExp = 0
  let expPerHour = 0
  for (const proc of daemons) {
    const rs = ns.getRunningScript(proc.pid)
    if (!rs)
      continue
    const money = rs.onlineMoneyMade + rs.offlineMoneyMade
    const exp = rs.onlineExpGained + rs.offlineExpGained
    const hours = (rs.onlineRunningTime + rs.offlineRunningTime) / 3600
    totalMoney += money
    totalExp += exp
    if (hours > 0) {
      moneyPerHour += money / hours
      expPerHour += exp / hours
    }
  }
  return { totalMoney, moneyPerHour, totalExp, expPerHour }
}
