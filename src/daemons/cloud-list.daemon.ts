import { NS } from "@ns";
import { SLAVE_NODE_FILE } from "../ui/utils/slave-nodes";

/**
 * Gathers everything the Cloud Servers app needs to render its list —
 * purchased-server inventory, RAM/server limits, current money, and a
 * price quote for every valid RAM tier — and writes it as JSON to
 * `cloud-list-result.txt` on `home`, then exits.
 *
 * Split out of the sidebar app on purpose: Bitburner charges a script for
 * every ns.* function it merely *references* anywhere in its reachable
 * code, whether or not that code path runs. `ns.cloud.*` alone would add
 * several GB to ui.app.js permanently since it's always running — see the
 * RAM-cost model section in CLAUDE.md. Here, that cost only applies for the
 * instant this daemon is alive; the app just ns.exec's it and reads the
 * result file back (both effectively free).
 *
 * Also folds in every player-designated "slave node" (see
 * `ui/utils/slave-nodes.ts`) — a rooted, non-purchased server the player has
 * opted into the same worker role a purchased server plays, tagged
 * `isSlave: true` on its row — self-healing `SLAVE_NODE_FILE` in the same
 * pass (dropping any hostname that no longer exists, lost root access, or
 * somehow became purchased, e.g. was deleted and re-bought under the same
 * name) the way `daemons/xp-farm.daemon.ts` self-heals its own config file
 * each cycle. This is the one place that merge happens: every consumer of
 * this snapshot (Share, XP Farm, Programs' task manager, and the Cloud
 * Servers app's own list) picks up slave nodes for free with no changes of
 * their own.
 */
const RESULT_FILE = "cloud-list-result.txt";

export async function main(ns: NS) {
    const ramLimit = ns.cloud.getRamLimit();

    const hostnames = ns.cloud.getServerNames();
    const servers = hostnames.map((hostname) => ({
        hostname,
        ram: ns.getServerMaxRam(hostname),
        usedRam: ns.getServerUsedRam(hostname),
        isSlave: false,
    }));

    const raw = ns.read(SLAVE_NODE_FILE);
    let configuredSlaves: string[] = [];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) configuredSlaves = parsed;
        } catch {
            // Treat an unparsable file as empty — the write below then
            // clears it back to a valid `[]`.
        }
    }
    const validSlaves = configuredSlaves.filter((hostname) => {
        if (!ns.serverExists(hostname)) return false;
        const server = ns.getServer(hostname);
        return server.hasAdminRights && !server.purchasedByPlayer;
    });
    if (validSlaves.length !== configuredSlaves.length) {
        ns.write(SLAVE_NODE_FILE, JSON.stringify(validSlaves), "w");
    }
    const slaveRows = validSlaves.map((hostname) => ({
        hostname,
        ram: ns.getServerMaxRam(hostname),
        usedRam: ns.getServerUsedRam(hostname),
        isSlave: true,
    }));

    // Price for every valid power-of-two RAM tier up to the cap — computed
    // once here so the buy form can show live prices without a round-trip
    // of its own. ns.cloud.getServerCost's RAM cost is per-script, not
    // per-call, so looping it ~20 times is free.
    const costByRam: Record<number, number> = {};
    for (let ram = 2; ram <= ramLimit; ram *= 2) {
        costByRam[ram] = ns.cloud.getServerCost(ram);
    }

    const result = {
        servers: [...servers, ...slaveRows],
        moneyAvailable: ns.getServerMoneyAvailable("home"),
        serverLimit: ns.cloud.getServerLimit(),
        ramLimit,
        costByRam,
    };

    ns.write(RESULT_FILE, JSON.stringify(result), "w");
}
