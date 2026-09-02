import type { AppDefinition } from '../../types'
import { MoneyFarmDashboard } from './components/money-farm-dashboard'

/**
 * Lets the player dedicate purchased ("cloud") servers to earning money:
 * toggling a server here just writes it in/out of `money-farm-config.txt`
 * (via `readMoneyFarmHosts`/`writeMoneyFarmHosts`, both 0 GB) and makes
 * sure `daemons/money-farm.daemon.ts` is running to act on it. Everything
 * RAM-heavy — picking a target, prepping it, computing and dispatching
 * HWGW batches — happens entirely in that daemon; this app never calls
 * `ns.hack`/`ns.grow`/`ns.weaken`/`ns.getServer`/`ns.killall` itself, same
 * reasoning as `../xp-farm/` (see that app's own header comment and the
 * RAM-cost model section in CLAUDE.md).
 *
 * Deliberately no RAM bar, same as XP Farm: a dedicated server's RAM is
 * entirely the daemon's business.
 *
 * The daemon is a self-managing background process, not something this
 * app starts/stops directly: enabling a server just ensures it's running
 * (`ns.isRunning` first, never launches a duplicate), and disabling the
 * last one doesn't kill it — it notices its config list went empty on its
 * own next cycle and exits by itself. Never passed to `useAddChildPid()`
 * for the same reason as XP Farm — meant to outlive a UI restart.
 *
 * Mutually exclusive with XP Farm (and anything else) claiming the same
 * host: no cross-config-file check needed — `../../components/server-card.tsx`'s
 * "Occupied" state already disables toggling on any host with
 * `ramUsed > 0` it doesn't itself control, and a farm-claimed host always
 * has non-zero used RAM from its own loops/batches.
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
