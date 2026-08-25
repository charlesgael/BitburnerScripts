import { QueuedNS } from "./ns-proxy";
import { runDaemon } from "./run-daemon";

/**
 * Shared constants/types/helper for `spawn-remote.daemon.ts`, which copies
 * a script onto a purchased ("cloud") server and starts it there — see
 * that daemon's header comment for why a plain `ns.exec` on its own isn't
 * enough. Used by the Programs app's cloud-server dropdown.
 */
export const SPAWN_REMOTE_SCRIPT = "spawn-remote.daemon.js";
export const SPAWN_REMOTE_RESULT_FILE = "spawn-remote-result.txt";

export interface SpawnRemoteResult {
    ok: boolean;
    pid?: number;
    error?: string;
}

/** Copies `script` from home to `host` and execs it there with `threads`/`args`. */
export async function spawnRemote(
    ns: QueuedNS,
    addChildPid: (pid: number) => void,
    script: string,
    host: string,
    threads: number,
    args: (string | number | boolean)[]
): Promise<SpawnRemoteResult> {
    return runDaemon(ns, addChildPid, SPAWN_REMOTE_SCRIPT, "home", SPAWN_REMOTE_RESULT_FILE, [
        script,
        host,
        threads,
        ...args,
    ]);
}
