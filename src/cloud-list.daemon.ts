import { NS } from "@ns";

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
 */
const RESULT_FILE = "cloud-list-result.txt";

export async function main(ns: NS) {
    const ramLimit = ns.cloud.getRamLimit();

    const hostnames = ns.cloud.getServerNames();
    const servers = hostnames.map((hostname) => ({
        hostname,
        ram: ns.getServerMaxRam(hostname),
        usedRam: ns.getServerUsedRam(hostname),
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
        servers,
        moneyAvailable: ns.getServerMoneyAvailable("home"),
        serverLimit: ns.cloud.getServerLimit(),
        ramLimit,
        costByRam,
    };

    ns.write(RESULT_FILE, JSON.stringify(result), "w");
}
