import { NS } from "@ns";

/**
 * Deletes one cloud server and writes the outcome as JSON to
 * `cloud-delete-result.txt` on `home`, then exits. Split out of the
 * sidebar app for the same RAM-footprint reason as `cloud-list.daemon.ts`
 * — see that file's header comment.
 *
 * Args: hostname (string).
 */
const RESULT_FILE = "cloud-delete-result.txt";

export async function main(ns: NS) {
    const hostname = String(ns.args[0] ?? "");

    const ok = ns.cloud.deleteServer(hostname);
    const result = ok
        ? { ok: true }
        : { ok: false, error: "Delete failed — the server may still have scripts running on it." };

    ns.write(RESULT_FILE, JSON.stringify(result), "w");
}
