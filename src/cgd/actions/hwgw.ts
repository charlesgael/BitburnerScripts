import type { NS } from '@ns'
import type { HwgwStatusResult } from '../../lib/hwgw/workers'
import { gatherHwgwStatus } from '../../lib/hwgw/workers'

/**
 * Compound action (see `cgd/types.ts`'s `CgdActionHandler`) for hwgw's live
 * status — the money-earning system that replaced `daemons/money-farm.daemon.ts`.
 * Registered at tier 2 (see `daemons/lv2.daemon.ts`): its only consumer,
 * `ui/apps/money-farm/`, is already `minDaemonTier: 2`, so there's nothing
 * to gain from tier-1-cheap placement the way `cloudListAction` originally
 * tried and abandoned (see that file's own header comment) — this action
 * would never render below tier 2 regardless.
 *
 * Deliberately takes `hosts` as an argument rather than self-discovering
 * via `ns.cloud.getServerNames()` — keeps this action's own footprint at
 * exactly `ns.ps` (already tier-0-free) + `ns.getRunningScript` (0.3 GB),
 * not tied to whatever else self-discovery would pull in. The caller
 * (`use-money-farm.ts`) already has the dedicated-host list from
 * `readHwgwHosts`, so there's nothing this action needs to look up itself.
 */
export async function hwgwStatusAction(ns: NS, hosts: unknown): Promise<HwgwStatusResult> {
  const dedicatedHosts = Array.isArray(hosts) ? hosts.map(String) : []
  return gatherHwgwStatus(ns, dedicatedHosts)
}
