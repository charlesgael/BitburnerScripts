import type { NS } from '@ns'
import type { CgdActionHandlers } from '../cgd/types'
import { cloudBuyAction, cloudDeleteAction, cloudListAction } from '../cgd/actions/cloud'
import { slaveNodeHostsAction } from '../cgd/actions/slave-nodes'
import { runTieredDaemon } from '../cgd/daemon-core'
import { makeStatPusher } from '../cgd/stat-push'
import { BASELINE_STAT_PROVIDERS } from '../cgd/stats'
import { reserveTier1Ram, TIER_1_ACTIONS, TIER_1_METHODS } from './lv1.daemon'

const TIER_2_METHODS = [
  ...TIER_1_METHODS,
  'getServer',
  'run',
  'hasTorRouter',
]

/**
 * Tier 2: adds cloud-server management — listing, purchasing, deleting —
 * and the slave-node network scan (see `docs/epic-cgd-namespace.md`'s tier
 * table). Imports tier 1's `TIER_1_METHODS`/`reserveTier1Ram`/
 * `TIER_1_ACTIONS` directly rather than duplicating them — the
 * `lv1 ← lv2 ← lv3 ← lv4` chain from the design doc's import-chain section,
 * made concrete.
 *
 * `cloudList` lives here, not tier 1, despite being read-only — see
 * `lv1.daemon.ts`'s `TIER_1_ACTIONS` comment for the measured RAM reason
 * (`getServer`/`cloud.getServerNames` alone pushed tier 1 to 11.55 GB,
 * well past its ~8 GB starter-player budget).
 *
 * No new raw dispatch entries on top of tier 1's: `cloudList`/`cloudBuy`/
 * `cloudDelete`/`slaveNodeHosts` are all registered as compound actions
 * instead (see `cgd/types.ts`'s `CgdActionHandler`) — genuine multi-step
 * operations (a cost-check-then-purchase sequence; a network BFS) that
 * don't need decoy/allow-list sync the way `TIER_1_METHODS` does, since
 * their literal `ns.*` calls live directly in their own handler bodies and
 * get counted the ordinary way just by being defined.
 *
 * Usage: `run daemons/lv2.daemon.js`
 */
const TIER_2_ACTIONS: CgdActionHandlers = {
  ...TIER_1_ACTIONS,
  cloudList: cloudListAction,
  cloudBuy: cloudBuyAction,
  cloudDelete: cloudDeleteAction,
  slaveNodeHosts: slaveNodeHostsAction,
}

function reserveTier2Ram(ns: NS) {
  reserveTier1Ram(ns)
  void ns.getServer
  void ns.run
  void ns.hasTorRouter
}

export async function main(ns: NS): Promise<void> {
  // Same reasoning as lv1.daemon.ts's own call — this tier's compiled
  // output is a separate bundle from lv1.daemon.js, so an unused,
  // non-exported import wouldn't survive tree-shaking on its own.
  reserveTier2Ram(ns)
  await runTieredDaemon(ns, 2, 'daemons/lv2.daemon.js', new Set(TIER_2_METHODS), {
    actionHandlers: TIER_2_ACTIONS,
    onIdle: makeStatPusher(BASELINE_STAT_PROVIDERS),
  })
}
