import type { NS, Server } from '@ns'

/**
 * Compound actions (see `cgd/types.ts`'s `CgdActionHandler`) for cloud
 * ("purchased") servers — ported from the pre-epic one-shot daemons
 * `daemons/cloud-list.daemon.ts`/`cloud-buy.daemon.ts`/`cloud-delete.daemon.ts`
 * (all deleted), which existed purely to keep `ns.cloud.*` off `ui.app.js`'s
 * permanent footprint by spawning as their own throwaway scripts. Now they
 * run inside the persistent tiered daemon instead, invoked via
 * `cgd.daemon.queue.enqueueAction`.
 *
 * All three are registered at **tier 2** (see `daemons/lv2.daemon.ts`).
 * `cloudListAction` was briefly tried at tier 1 on the reasoning that
 * read-only enumeration is foundational plumbing several other apps depend
 * on (Share, XP Farm, File Explorer, Programs) — but measured live, it
 * pushed tier 1 to 11.55 GB total once `getServer` (2.00 GB) and
 * `cloud.getServerNames` (1.05 GB) got pulled in, well past tier 1's
 * ~8 GB starter-player budget. Tier 1 staying cheap won out over avoiding a
 * temporary functionality gap in those other apps below tier 2 — see
 * `lv1.daemon.ts`'s `TIER_1_ACTIONS` comment.
 */

export const SLAVE_NODE_FILE = 'slave-nodes.txt'

/**
 * `Server` (NS's own type, straight from `ns.getServer`) plus one extra
 * flag — reusing it instead of hand-rolling `{ hostname, ram, usedRam }`
 * means every consumer gets the full server shape (`hasAdminRights`,
 * `purchasedByPlayer`, ...) for free, not just the three fields this app
 * happened to need originally.
 */
export type CloudServerRow = Server & {
  /**
   * True for a player-designated "slave node" (see
   * `cgd/actions/slave-nodes.ts`) — a rooted, non-purchased server the
   * player has opted into the same worker role a purchased server plays
   * — false/absent for an actual purchased server.
   */
  isSlave?: boolean
}

export interface CloudListResult {
  servers: CloudServerRow[]
  moneyAvailable: number
  serverLimit: number
  ramLimit: number
  costByRam: Record<number, number>
}

/**
 * Gathers everything the Cloud Servers app needs to render its list —
 * purchased-server inventory, RAM/server limits, current money, and a price
 * quote for every valid RAM tier — plus every player-designated "slave
 * node" (self-healing `SLAVE_NODE_FILE` in the same pass, exactly as the
 * original daemon did: dropping any hostname that no longer exists, lost
 * root access, or somehow became purchased).
 *
 * Registered at tier 2, alongside `cloudBuyAction`/`cloudDeleteAction`
 * below — despite being read-only, and despite several apps beyond Cloud
 * Servers itself calling `ui/utils/cloud-list.ts`'s `fetchCloudList` (Share,
 * XP Farm, File Explorer, Programs' spawn-target list). It was tried at
 * tier 1 first on exactly that reasoning, but measured live at 11.55 GB
 * total for tier 1 once `getServer` (2.00 GB) and `cloud.getServerNames`
 * (1.05 GB) got pulled in — too heavy for tier 1's ~8 GB starter-player
 * budget. Those other apps degrade gracefully below tier 2 for now; see
 * `daemons/lv1.daemon.ts`'s `TIER_1_ACTIONS` comment.
 */
export async function cloudListAction(ns: NS): Promise<CloudListResult> {
  const ramLimit = ns.cloud.getRamLimit()

  const hostnames = ns.cloud.getServerNames()
  const servers: Server[] = hostnames.map(ns.getServer.bind(ns))

  const raw = ns.read(SLAVE_NODE_FILE)
  let configuredSlaves: string[] = []
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed))
        configuredSlaves = parsed
    }
    catch {
      // Treat an unparsable file as empty — the write below then
      // clears it back to a valid `[]`.
    }
  }
  const slaves = configuredSlaves
    .filter(ns.serverExists.bind(ns))
    .map(ns.getServer.bind(ns))
    .filter(s => s.hasAdminRights && !s.purchasedByPlayer)
  const slaveNames = slaves.map(s => s.hostname)
  if (slaveNames.length !== configuredSlaves.length) {
    ns.write(SLAVE_NODE_FILE, JSON.stringify(slaveNames), 'w')
  }

  // Price for every valid power-of-two RAM tier up to the cap — computed
  // once here so the buy form can show live prices without a round-trip
  // of its own.
  const costByRam: Record<number, number> = {}
  for (let ram = 2; ram <= ramLimit; ram *= 2) {
    costByRam[ram] = ns.cloud.getServerCost(ram)
  }

  return {
    servers: [...servers, ...slaves],
    moneyAvailable: ns.getServerMoneyAvailable('home'),
    serverLimit: ns.cloud.getServerLimit(),
    ramLimit,
    costByRam,
  }
}

/** Purchases one cloud server. Args: `[hostname: string, ram: number]`. */
export async function cloudBuyAction(
  ns: NS,
  hostname: unknown,
  ram: unknown,
): Promise<{ ok: boolean, hostname?: string, error?: string }> {
  const h = String(hostname ?? '')
  const r = Number(ram)

  const cost = ns.cloud.getServerCost(r)
  const money = ns.getServerMoneyAvailable('home')
  if (!Number.isFinite(cost)) {
    return { ok: false, error: `Invalid RAM amount: ${r} (must be a power of 2).` }
  }
  if (cost > money) {
    return {
      ok: false,
      error: `Not enough money: need $${cost.toLocaleString()}, have $${money.toLocaleString()}.`,
    }
  }
  const newHostname = ns.cloud.purchaseServer(h, r)
  return newHostname
    ? { ok: true, hostname: newHostname }
    : { ok: false, error: 'Purchase failed — invalid hostname, or server limit reached.' }
}

/** Deletes one cloud server. Args: `[hostname: string]`. */
export async function cloudDeleteAction(ns: NS, hostname: unknown): Promise<{ ok: boolean, error?: string }> {
  const h = String(hostname ?? '')
  const ok = ns.cloud.deleteServer(h)
  return ok ? { ok: true } : { ok: false, error: 'Delete failed — the server may still have scripts running on it.' }
}
