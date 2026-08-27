import { NS } from "@ns";

/**
 * Compound action (see `cgd/types.ts`'s `CgdActionHandler`) backing the
 * Cloud Servers app's Slave Nodes checklist tab — ported from the pre-epic
 * `daemons/slave-node-hosts.daemon.ts` (deleted), which spawned as its own
 * one-shot script purely to keep `ns.scan`/`ns.getServer` off `ui.app.js`'s
 * permanent footprint.
 *
 * Registered at **tier 2** (see `daemons/lv2.daemon.ts`), unlike
 * `cgd/actions/cloud.ts`'s `cloudListAction` — this is only ever used by
 * the Cloud Servers app's own checklist, not depended on broadly the way
 * cloud-server enumeration is, so there's no reason to make it available
 * any earlier than the rest of that app's administrative capability.
 */
export interface SlaveNodeHost {
    hostname: string;
    ram: number;
    usedRam: number;
}

/** Every hostname reachable from `home`, found via a plain BFS. */
function scanNetwork(ns: NS): string[] {
    const seen = new Set<string>(["home"]);
    const queue = ["home"];
    while (queue.length > 0) {
        const current = queue.shift() as string;
        for (const neighbor of ns.scan(current)) {
            if (!seen.has(neighbor)) {
                seen.add(neighbor);
                queue.push(neighbor);
            }
        }
    }
    return [...seen];
}

/** Walks the whole network from `home` and returns every rooted,
 * non-purchased, non-`home` host — the full checklist the Cloud Servers
 * app's Slave Nodes tab renders, independent of which are currently
 * designated (that's cross-referenced client-side against the already-
 * fetched `CloudServerRow[]` snapshot). Root access alone is what's needed
 * here — same as before, backdoor status is irrelevant to running scripts
 * on a machine. */
export async function slaveNodeHostsAction(ns: NS): Promise<{ hosts: SlaveNodeHost[] }> {
    const hosts: SlaveNodeHost[] = scanNetwork(ns)
        .filter((hostname) => hostname !== "home")
        .map((hostname) => ({ hostname, server: ns.getServer(hostname) }))
        .filter(({ server }) => server.hasAdminRights && !server.purchasedByPlayer)
        .map(({ hostname }) => ({
            hostname,
            ram: ns.getServerMaxRam(hostname),
            usedRam: ns.getServerUsedRam(hostname),
        }));
    return { hosts };
}
