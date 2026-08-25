import { NS } from "@ns";

/**
 * Copies a script from `home` to another server and starts it there, then
 * writes the outcome as JSON to `spawn-remote-result.txt` on `home`, and
 * exits. (The launched script itself keeps running independently on
 * `host` — this daemon's job is just to get it copied over and started.)
 *
 * This is what actually makes the Programs app's cloud-server dropdown
 * work: `ns.exec` requires the target file to already exist on the
 * destination server (see NetscriptDefinitions.d.ts), and unlike `home` —
 * which Viteburner deploys scripts to directly — a purchased ("cloud")
 * server never has them until something `ns.scp`'s them over. Split out
 * of the sidebar app for the same RAM-footprint reason as
 * `cloud-list.daemon.ts`: ns.scp (0.6GB) and this script's own copy of
 * ns.exec (1.3GB) would otherwise permanently inflate ui.app.js.
 *
 * Args: script (string), host (string), threads (number), ...args to pass
 * through to the launched script.
 */
const RESULT_FILE = "spawn-remote-result.txt";

export async function main(ns: NS) {
    const script = String(ns.args[0]);
    const host = String(ns.args[1]);
    const threads = Number(ns.args[2]) || 1;
    const scriptArgs = ns.args.slice(3);

    let result: { ok: boolean; pid?: number; error?: string };

    const copied = ns.scp(script, host);
    if (!copied) {
        result = { ok: false, error: `Couldn't copy ${script} to ${host} — does it exist on home?` };
    } else {
        const pid = ns.exec(script, host, threads, ...scriptArgs);
        result =
            pid !== 0
                ? { ok: true, pid }
                : {
                      ok: false,
                      error: `Couldn't start ${script} on ${host} — enough free RAM? Already running with different args?`,
                  };
    }

    ns.write(RESULT_FILE, JSON.stringify(result), "w");
}
