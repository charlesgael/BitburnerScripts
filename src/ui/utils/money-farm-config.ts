import type { QueuedNS } from './ns-proxy'

/**
 * Shared constants/types for the Money Farm feature: the player dedicates a
 * purchased ("cloud") server to earning money via a precisely-timed HWGW
 * (hack/weaken/grow/weaken) batch pipeline against a picked target (see
 * `ui/apps/money-farm/` and `daemons/money-farm.daemon.ts`).
 *
 * Same two-channel shape as `xp-farm-config.ts` (see that file's header
 * comment for the full rationale, unchanged here): `MONEY_FARM_CONFIG_FILE`
 * is a JSON array of dedicated hostnames the app writes and the daemon
 * reads/reconciles; status is derived by the app polling `ns.ps(host)`
 * directly rather than trusting a value pushed by the daemon.
 *
 * A host dedicated here and one dedicated to XP Farm are mutually
 * exclusive in practice without either side needing to read the other's
 * config file: `ui/components/server-card.tsx`'s "Occupied" state already
 * disables toggling on any host with `ramUsed > 0` it doesn't itself
 * control, and a farm-claimed host always has non-zero used RAM from its
 * own loops/batches.
 */
export const MONEY_FARM_CONFIG_FILE = 'money-farm-config.txt'
export const MONEY_FARM_DAEMON_SCRIPT = 'daemons/money-farm.daemon.js'
export const MONEY_FARM_DAEMON_HOST = 'home'

/**
 * The three worker scripts every managed host runs — same underlying
 * files XP Farm and flooder.app.ts already use, referenced from here so
 * both sides of this feature share one copy of the filenames.
 */
export const MONEY_FARM_HACK_SCRIPT = 'daemons/hack.daemon.js'
export const MONEY_FARM_GROW_SCRIPT = 'daemons/grow.daemon.js'
export const MONEY_FARM_WEAKEN_SCRIPT = 'daemons/weaken.daemon.js'

/**
 * One host's current Money Farm assignment, as the daemon last computed
 * it — `mode` tells the app which of the three scripts to expect running
 * and how to label the card: `weaken`/`grow-prep` are the pre-farm
 * security/money prep stages (see `daemons/money-farm.daemon.ts`'s header
 * comment), `farm` means the HWGW batch pipeline is live against
 * `target`.
 */
export interface MoneyFarmAssignment {
  target: string
  mode: 'weaken' | 'grow-prep' | 'farm'
}

export type MoneyFarmStatus = Record<string, MoneyFarmAssignment>

/**
 * The set of hostnames currently dedicated to money farming, or [] if the
 * config file doesn't exist yet / is empty / unparsable.
 */
export async function readMoneyFarmHosts(ns: QueuedNS): Promise<string[]> {
  const raw = await ns._read(MONEY_FARM_CONFIG_FILE)
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
 * Overwrites the config file with `hosts` — the only way the dedicated
 * list ever changes; the daemon only ever reads it (aside from its own
 * self-heal of a deleted server, same as `xp-farm-config.ts`).
 */
export async function writeMoneyFarmHosts(ns: QueuedNS, hosts: string[]): Promise<void> {
  await ns._write(MONEY_FARM_CONFIG_FILE, JSON.stringify(hosts), 'w')
}
