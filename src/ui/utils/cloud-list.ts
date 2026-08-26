import { QueuedNS } from "./ns-proxy";
import { runDaemon } from "./run-daemon";

/**
 * Shared constants/types/helper for reading purchased-server inventory via
 * `daemons/cloud-list.daemon.ts` — used by both the Cloud Servers app (its own
 * list) and the Programs app (to offer spawning on a compatible cloud
 * server). Neither references `ns.cloud.*` directly — see
 * `ui/apps/cloud-servers/`'s header comment for why.
 */
export const CLOUD_LIST_SCRIPT = "daemons/cloud-list.daemon.js";
export const CLOUD_LIST_RESULT_FILE = "cloud-list-result.txt";

export interface CloudServerRow {
    hostname: string;
    ram: number;
    usedRam: number;
    /** True for a player-designated "slave node" (see `ui/utils/slave-nodes.ts`)
     * — a rooted, non-purchased server the player has opted into the same
     * worker role a purchased server plays — false/absent for an actual
     * purchased server. `daemons/cloud-list.daemon.ts` sets this on every row
     * it returns; every consumer of that snapshot (Share, XP Farm, Programs'
     * task manager, and the Cloud Servers app's own list) can treat the two
     * uniformly except where this flag says otherwise (e.g. it can't be
     * `ns.cloud.deleteServer`'d, and doesn't count against the purchased
     * server limit). */
    isSlave?: boolean;
}

export interface CloudListResult {
    servers: CloudServerRow[];
    moneyAvailable: number;
    serverLimit: number;
    ramLimit: number;
    costByRam: Record<number, number>;
}

/**
 * Sorts a copy of `rows` alphabetically by hostname — shared so the Cloud
 * Servers, XP Farm, and Share apps all list purchased servers in the same
 * order instead of whatever order the daemon happened to enumerate them in.
 */
export function sortByHostname<T extends { hostname: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => a.hostname.localeCompare(b.hostname));
}

/**
 * Runs `daemons/cloud-list.daemon.js` on `host` (default "home") and returns
 * its result. If that fails — most commonly because `host` has no free RAM
 * to spare for even this tiny daemon (e.g. it's fully loaded running other
 * scripts) — falls back to whatever the previous run last wrote to
 * `CLOUD_LIST_RESULT_FILE`, stale as it may be, instead of surfacing an
 * empty list. A stale hostname list is still correct for "is this program
 * running on any cloud server" detection (Programs' use of this), which is
 * what would otherwise silently go blind whenever `host` is busy — its own
 * RAM/money figures being momentarily out of date matters much less there
 * than losing track of what's actually running. Only rethrows if there's no
 * previous result to fall back on either.
 */
export async function fetchCloudList(
    ns: QueuedNS,
    addChildPid: (pid: number) => void,
    host = "home"
): Promise<CloudListResult> {
    try {
        return await runDaemon(ns, addChildPid, CLOUD_LIST_SCRIPT, host, CLOUD_LIST_RESULT_FILE);
    } catch (err) {
        try {
            const raw = await ns.read(CLOUD_LIST_RESULT_FILE);
            if (raw) return JSON.parse(raw);
        } catch {
            // Fall through to rethrowing the original error below.
        }
        throw err;
    }
}
