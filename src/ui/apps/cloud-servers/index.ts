import type { AppDefinition } from '../../types'
import { CloudServersContent } from './components/cloud-servers-content'

/**
 * Lets the player buy, list, and delete purchased ("cloud") servers.
 *
 * This app never references `ns.cloud.*` (or `ns.getServerMoneyAvailable`)
 * itself — Bitburner charges a script for every ns.* function it merely
 * references* anywhere in its reachable code, whether or not that code
 * path runs, and since this file is always part of ui.app.js's bundle,
 * writing those here would permanently inflate its footprint. Instead all
 * of that work happens through `window.cgd.daemon.queue.enqueueAction` —
 * see `cgd/actions/cloud.ts` (`cloudList`/`cloudBuy`/`cloudDelete`) and
 * `cgd/actions/slave-nodes.ts` (`slaveNodeHosts`), all gated at tier 2 —
 * `minDaemonTier: 2` below keeps this app out of the grid entirely below
 * that. `cloudList` lives at tier 2 despite being read-only (several other
 * apps — Share, XP Farm, File Explorer, Programs — depend on it too, and
 * degrade gracefully below tier 2 rather than being gated on it
 * themselves) — see that action's own header comment for the measured RAM
 * reason.
 *
 * Also has a second tab, "Slave Nodes", letting the player check off
 * already-rooted, non-purchased servers on the network as stand-ins for a
 * purchased server — handy early game before the player can afford a real
 * one. See `ui/utils/slave-nodes.ts`'s header comment for the full design:
 * the short version is that `cgd/actions/cloud.ts`'s `cloudListAction`
 * folds designated slave nodes straight into the same `CloudServerRow[]`
 * snapshot purchased servers already flow through, so Share/XP Farm/
 * Programs treat the two uniformly with no changes of their own.
 *
 * All state/behavior lives in `logic/use-cloud-servers.ts`; `components/`
 * is plain presentational JSX driven off that hook's return value.
 */
export const CloudServersApp: AppDefinition = {
  id: 'cloud-servers',
  icon: '🖥️',
  label: 'Cloud S.',
  Content: CloudServersContent,
  // Wide enough to open already showing two ~260px server cards per row
  // (see the grid in CloudServersContent) instead of the default window
  // width falling back to a single column.
  preferredWidth: 850,
  preferredHeight: 620,
  minWidth: 290,
  minDaemonTier: 2,
}
