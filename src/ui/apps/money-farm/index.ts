import type { AppDefinition } from '../../types'
import { MoneyFarmDashboard } from './components/money-farm-dashboard'

/**
 * Lets the player dedicate purchased ("cloud") servers to hwgw's shared
 * host pool (`src/hwgw/`, which replaced `daemons/money-farm.daemon.ts`
 * and `daemons/steady-farm.daemon.ts`, both since deleted): toggling a
 * server here just writes it in/out of `hwgw-hosts.json` (via
 * `readHwgwHosts`/`writeHwgwHosts`, both 0 GB). Unlike the deleted
 * daemon's live-reconciled config file, this one is only read once, by
 * `auto-hack.app.ts` at its own startup — see `hwgw-config.ts`'s own
 * header comment for the exact "takes effect next restart" contract that
 * implies, and `money-farm-content.tsx`'s banner for the wording shown to
 * the player. Live status (mode + money/XP per hour, per target) comes
 * from the `hwgwStatus` compound action (`cgd/actions/hwgw.ts`, tier 2),
 * which scans `ns.ps`/`ns.getRunningScript` server-side — this app never
 * calls `ns.hack`/`ns.grow`/`ns.weaken`/`ns.getServer`/`ns.killall` itself,
 * same reasoning as `../xp-farm/` (see that app's own header comment and
 * the RAM-cost model section in CLAUDE.md).
 *
 * Deliberately no RAM-reservation bar, unlike the deleted daemon's own
 * dashboard: hwgw never partitions RAM between targets in the first
 * place, so there's nothing to visualize.
 *
 * `auto-hack.app.js` (the thing that watches `known-servers.json` and
 * launches one `hwgw/start.js` per target) is a self-managing background
 * process, not something this app starts/stops directly beyond the
 * `InstanceManager` toggle in `money-farm-dashboard.tsx` — enabling a host
 * here doesn't itself launch anything, and disabling the last one doesn't
 * kill `auto-hack.app.js` either. Never passed to `useAddChildPid()` for
 * the same reason as XP Farm — meant to outlive a UI restart.
 *
 * hwgw's own host pool is *not* an exclusive claim the way the old
 * daemon's was (see `use-money-farm.ts`'s own header comment) — the only
 * cross-feature exclusion left is XP Farm's, which this app still
 * respects (`use-money-farm.ts`'s `refresh()` excludes any host XP Farm
 * has already dedicated).
 *
 * All state/behavior lives in `logic/use-money-farm.ts`; `components/` is
 * plain presentational JSX driven off that hook's return value.
 */
export const MoneyFarmApp: AppDefinition = {
  id: 'money-farm',
  icon: '💰',
  label: 'Money Farm',
  Content: MoneyFarmDashboard,
  minDaemonTier: 2,
  preferredWidth: 1200,
  preferredHeight: 700,
  minWidth: 1200 * 0.6,
  minHeight: 700 * 0.6,
}
