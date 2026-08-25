import { QueuedNS } from "./ns-proxy";

/**
 * Runs a one-shot daemon script to completion and returns its parsed JSON
 * result: ns.exec's `script` on `host`, polls ns.isRunning (via a plain
 * setTimeout, not ns.sleep — that would add its own reference to whatever
 * file calls this), then ns.read's `resultFile` once it exits and
 * JSON.parses it.
 *
 * Shared by anything that offloads ns.* calls too RAM-heavy to reference
 * directly from ui.app.ts's own reachable code — see `daemons/cloud-list.daemon.ts`
 * and friends, and the RAM-cost model section in CLAUDE.md, for why. Throws
 * if the script can't be launched, or exits without writing a result.
 */
export async function runDaemon(
    ns: QueuedNS,
    addChildPid: (pid: number) => void,
    script: string,
    host: string,
    resultFile: string,
    args: (string | number | boolean)[] = []
): Promise<any> {
    const pid = await ns.exec(script, host, 1, ...args);
    if (pid === 0) {
        throw new Error(`Couldn't launch ${script} on ${host} — enough free RAM?`);
    }
    addChildPid(pid);
    while (await ns.isRunning(pid)) {
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const raw = await ns.read(resultFile);
    if (!raw) {
        throw new Error(`${script} produced no output — check its log for errors.`);
    }
    return JSON.parse(raw);
}
