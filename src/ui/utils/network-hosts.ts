import type { QueuedNS } from './ns-proxy'

/**
 * Reads `netmapper.app.ts`'s cached network scan (`known-servers.json.txt`)
 * — a JSON array of full `Server` objects — for the File Explorer app
 * (`ui/apps/file-explorer/`) to offer scanned/hacked hosts as browsable
 * "drives" alongside `home` and purchased servers, without this file (or
 * `ui.app.js`'s reachable code generally) ever referencing `ns.scan`
 * itself — see `ui/apps/cloud-servers/`'s header comment for why that
 * matters. Purely a best-effort cache read via `ns.read` (0 GB).
 * `known-servers.json.txt` only exists once the player has actually run
 * Netmapper at least once (see the Programs catalog in `ui/apps/index.ts`),
 * and only on whichever host they ran it on (see `ui/apps/task-manager/`'s
 * header comment) — so this only ever reads it from `home`, matching where
 * a player would normally run it, and returns `[]` rather than throwing if
 * it's missing, empty, or unparsable.
 */
const KNOWN_SERVERS_FILE = 'known-servers.json.txt'

export interface NetworkHostRow {
  hostname: string
  hasRoot: boolean
}

export async function readNetworkHosts(ns: QueuedNS): Promise<NetworkHostRow[]> {
  try {
    const raw = await ns._read(KNOWN_SERVERS_FILE)
    if (!raw)
      return []
    const servers = JSON.parse(raw) as { hostname?: string, hasAdminRights?: boolean }[]
    if (!Array.isArray(servers))
      return []
    return servers
      .filter(s => typeof s.hostname === 'string')
      .map(s => ({ hostname: s.hostname as string, hasRoot: !!s.hasAdminRights }))
  }
  catch {
    return []
  }
}
