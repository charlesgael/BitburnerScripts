import { NS } from "@ns";

/**
 * Purchases one cloud server and writes the outcome as JSON to
 * `cloud-buy-result.txt` on `home`, then exits. Split out of the sidebar
 * app for the same RAM-footprint reason as `cloud-list.daemon.ts` — see
 * that file's header comment.
 *
 * Args: hostname (string), ram (number, must be a power of 2).
 */
const RESULT_FILE = "cloud-buy-result.txt";

export async function main(ns: NS) {
    const hostname = String(ns.args[0] ?? "");
    const ram = Number(ns.args[1]);

    let result: { ok: boolean; hostname?: string; error?: string };

    const cost = ns.cloud.getServerCost(ram);
    const money = ns.getServerMoneyAvailable("home");
    if (!isFinite(cost)) {
        result = { ok: false, error: `Invalid RAM amount: ${ram} (must be a power of 2).` };
    } else if (cost > money) {
        result = { ok: false, error: `Not enough money: need $${cost.toLocaleString()}, have $${money.toLocaleString()}.` };
    } else {
        const newHostname = ns.cloud.purchaseServer(hostname, ram);
        result = newHostname
            ? { ok: true, hostname: newHostname }
            : { ok: false, error: "Purchase failed — invalid hostname, or server limit reached." };
    }

    ns.write(RESULT_FILE, JSON.stringify(result), "w");
}
