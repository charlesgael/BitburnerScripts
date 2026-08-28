import type { CloudListResult, CloudServerRow } from '../../cgd/actions/cloud'
import type { CgdQueue } from '../../cgd/types'

export type { CloudListResult, CloudServerRow }

/**
 * Client-side helper for `cgd/actions/cloud.ts`'s `cloudListAction` —
 * shared by the Cloud Servers app (its own list) and every other app that
 * needs to know what cloud/slave servers exist (Share, XP Farm, File
 * Explorer, Programs' spawn-target list). Registered at **tier 2**, despite
 * being read-only — see that action's own header comment for the measured
 * RAM reason. Every non-Cloud-Servers caller above degrades gracefully
 * below tier 2 (an empty/unavailable cloud-server list) rather than being
 * gated on it themselves.
 *
 * No stale-cache fallback the way the pre-epic version (spawning
 * `daemons/cloud-list.daemon.ts` fresh each call) needed — that existed
 * specifically for "not enough free RAM to launch even this tiny one-shot
 * script right now," which doesn't apply once the persistent daemon is
 * already running: a call through `enqueueAction` doesn't allocate any new
 * RAM at all, it's just a queued request against a process that already
 * exists. A rejection now means something more specific (no daemon
 * registered, or its tier is below 2) and a cached value would just mask
 * that instead of surfacing it.
 */
export async function fetchCloudList(enqueueAction: CgdQueue['enqueueAction']): Promise<CloudListResult> {
  return (await enqueueAction('cloudList', [])) as CloudListResult
}

/**
 * Sorts a copy of `rows` alphabetically by hostname — shared so the Cloud
 * Servers, XP Farm, and Share apps all list purchased servers in the same
 * order instead of whatever order the daemon happened to enumerate them in.
 */
export function sortByHostname<T extends { hostname: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.hostname.localeCompare(b.hostname))
}
