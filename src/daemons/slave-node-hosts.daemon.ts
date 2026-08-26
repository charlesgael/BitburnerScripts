import { NS } from "@ns";
import { SLAVE_NODE_HOSTS_RESULT_FILE as RESULT_FILE } from "../ui/utils/slave-nodes";

/**
 * Walks the whole network from `home` (like `daemons/xp-farm.daemon.ts`'s
 * own `scanNetwork`) and writes every rooted, non-purchased, non-`home` host
 * as JSON to `slave-node-hosts-result.txt` on `home`, then exits — the full
 * checklist the Cloud Servers app's Slave Nodes tab renders (see
 * `ui/apps/cloud-servers/components/slave-node-checklist.tsx`), independent
 * of which of those are currently designated (that's cross-referenced
 * client-side against the already-fetched `CloudServerRow[]` snapshot — see
 * `ui/utils/slave-nodes.ts`'s header comment).
 *
 * Root access alone is what's needed here — same as
 * `daemons/spawn-remote.daemon.ts`'s `ns.scp`/`ns.exec` pair, which don't
 * care whether a host has a backdoor installed. Backdoor only matters for
 * faction/company access and a handful of special server actions, not for
 * running scripts on a machine.
 *
 * Split out of `daemons/cloud-list.daemon.ts` (rather than folded into it)
 * because that daemon only ever needs to enumerate the player's *purchased*
 * servers (`ns.cloud.getServerNames()`) plus re-read the already-designated
 * list — it has no reason to reference `ns.scan`/`ns.getServer` at all. This
 * script exists purely for the one-off "what's out there" scan, split out
 * for the same RAM-footprint reason as every other daemon here — see the
 * RAM-cost model section in CLAUDE.md.
 */
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

export async function main(ns: NS) {
    const hosts = scanNetwork(ns)
        .filter((hostname) => hostname !== "home")
        .map((hostname) => ({ hostname, server: ns.getServer(hostname) }))
        .filter(({ server }) => server.hasAdminRights && !server.purchasedByPlayer)
        .map(({ hostname }) => ({
            hostname,
            ram: ns.getServerMaxRam(hostname),
            usedRam: ns.getServerUsedRam(hostname),
        }));

    ns.write(RESULT_FILE, JSON.stringify({ hosts }), "w");
}
