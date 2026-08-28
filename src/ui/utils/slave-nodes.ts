import type { SlaveNodeHost } from '../../cgd/actions/slave-nodes'
import type { CgdQueue } from '../../cgd/types'
import type { QueuedNS } from './ns-proxy'
import { SLAVE_NODE_FILE } from '../../cgd/actions/cloud'

export type { SlaveNodeHost }

/**
 * Shared constants/types/helpers for the "Slave Nodes" feature: letting the
 * player check off an already-rooted, non-purchased server (found the
 * normal way — cracked/backdoored on the network) into the same worker role
 * a purchased ("cloud") server plays for the Programs/XP Farm/Share apps.
 * Priceless early game, before the player can afford their first real cloud
 * server.
 *
 * A designated slave node has no in-game marker of its own the way a
 * purchased server has `purchasedByPlayer` — so `SLAVE_NODE_FILE` (defined
 * in `cgd/actions/cloud.ts`, imported from there so both sides of the
 * self-healing story share one constant) is that marker: a JSON array of
 * hostnames the player has designated, written here by the Cloud Servers
 * app's checklist tab and read back — with self-healing — by
 * `cgd/actions/cloud.ts`'s `cloudListAction`, which folds them straight
 * into the same `CloudServerRow[]` snapshot purchased servers already flow
 * through. That's the whole trick: every consumer of `ui/utils/cloud-list.ts`'s
 * `fetchCloudList` (Share, XP Farm, Programs' task manager, and the Cloud
 * Servers app's own list) picks up slave nodes for free, tagged
 * `isSlave: true` on each row, with no changes needed on their end.
 *
 * `ns.read`/`ns.write` are 0 GB and on tier 1's allow-list, so the app can
 * touch `SLAVE_NODE_FILE` directly through the queued ns without any RAM or
 * tier concern — same convention as `xp-farm-config.ts`.
 */

/**
 * The set of hostnames currently designated as slave nodes, or [] if the
 * file doesn't exist yet / is empty / unparsable.
 */
export async function readSlaveNodes(ns: QueuedNS): Promise<string[]> {
  const raw = await ns._read(SLAVE_NODE_FILE)
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

/**
 * Overwrites the designated list with `hosts` — the only way it ever
 * changes; `cgd/actions/cloud.ts`'s `cloudListAction` only ever reads (and
 * self-heals) it.
 */
export async function writeSlaveNodes(ns: QueuedNS, hosts: string[]): Promise<void> {
  await ns._write(SLAVE_NODE_FILE, JSON.stringify(hosts), 'w')
}

/**
 * Client-side helper for `cgd/actions/slave-nodes.ts`'s `slaveNodeHostsAction`
 * — returns every rooted, non-purchased, non-`home` host on the network.
 * Registered at tier 2 (unlike `fetchCloudList`), so this is only called
 * from the Cloud Servers app, which is itself gated on `minDaemonTier: 2`.
 */
export async function fetchSlaveNodeHosts(enqueueAction: CgdQueue['enqueueAction']): Promise<SlaveNodeHost[]> {
  const result = (await enqueueAction('slaveNodeHosts', [])) as { hosts: SlaveNodeHost[] }
  return result.hosts
}
