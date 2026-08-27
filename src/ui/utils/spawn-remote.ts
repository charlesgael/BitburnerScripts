import { QueuedNS } from "./ns-proxy";

/**
 * Copies `script` from `home` to `host` and starts it there — directly
 * through the queue (`_scp` then `_exec`, both on tier 1's allow-list), not
 * via a separately-spawned one-shot daemon the way this used to work
 * (`daemons/spawn-remote.daemon.ts`, deleted — see its own header comment
 * for why it existed pre-epic: `ns.scp`/`ns.exec` referenced directly would
 * have permanently inflated `ui.app.js`, before this epic moved all of that
 * behind the persistent daemon's queue instead).
 *
 * `ns.exec` requires the target file to already exist on the destination
 * server (see `NetscriptDefinitions.d.ts`), and unlike `home` — which
 * Viteburner deploys scripts to directly — a purchased ("cloud") server
 * never has them until something `ns.scp`'s them over first. This is what
 * actually makes the Programs app's cloud-server dropdown, and Share's
 * cloud-host cards, work.
 *
 * No atomicity guarantee between the copy and the launch (see
 * `ns-proxy.ts`'s own atomicity caveat) — fine here, nothing else contends
 * over this exact script+host pair mid-call in practice.
 */
export interface SpawnRemoteResult {
    ok: boolean;
    pid?: number;
    error?: string;
}

export async function spawnRemote(
    ns: QueuedNS,
    script: string,
    host: string,
    threads: number,
    args: (string | number | boolean)[]
): Promise<SpawnRemoteResult> {
    const copied = await ns._scp(script, host);
    if (!copied) {
        return { ok: false, error: `Couldn't copy ${script} to ${host} — does it exist on home?` };
    }
    const pid = await ns._exec(script, host, threads, ...args);
    return pid !== 0
        ? { ok: true, pid }
        : {
              ok: false,
              error: `Couldn't start ${script} on ${host} — enough free RAM? Already running with different args?`,
          };
}
