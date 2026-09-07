import type { QueuedNS } from './ns-proxy'

/**
 * Shared constants for hwgw's dashboard (`ui/apps/money-farm/`, kept at
 * that path/id — see that app's own header comment for why) — the player
 * dedicates purchased ("cloud") servers to `src/hwgw/start.ts`'s shared
 * host pool.
 *
 * Unlike `money-farm.daemon.ts`'s live-reconciled `money-farm-config.json`
 * (deleted along with that daemon), this file is read once by
 * `auto-hack.app.ts` at its own startup, not watched — hwgw has no live
 * orchestrator to reconcile against. Editing it here only takes effect the
 * next time `auto-hack.app.js` is (re)started; an already-running target's
 * `hwgw/start.js` instance keeps whatever host list it was launched with
 * until it's individually relaunched — see `money-farm-content.tsx`'s
 * banner text for the exact wording shown to the player.
 */
export const HWGW_HOSTS_FILE = 'hwgw-hosts.json'
export const AUTO_HACK_SCRIPT = 'auto-hack.app.js'
export const AUTO_HACK_HOST = 'home'

/**
 * The set of hostnames currently dedicated to hwgw, or [] if the config
 * file doesn't exist yet / is empty / unparsable.
 */
export async function readHwgwHosts(ns: QueuedNS): Promise<string[]> {
  const raw = await ns._read(HWGW_HOSTS_FILE)
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
 * Overwrites the config file with `hosts`. Unlike `money-farm-config.ts`'s
 * equivalent, nothing watches this live — see this file's own header
 * comment for the "next restart" contract that implies.
 */
export async function writeHwgwHosts(ns: QueuedNS, hosts: string[]): Promise<void> {
  await ns._write(HWGW_HOSTS_FILE, JSON.stringify(hosts), 'w')
}
