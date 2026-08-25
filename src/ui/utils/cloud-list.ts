import { QueuedNS } from "./ns-proxy";
import { runDaemon } from "./run-daemon";

/**
 * Shared constants/types/helper for reading purchased-server inventory via
 * `daemons/cloud-list.daemon.ts` — used by both the Cloud Servers app (its own
 * list) and the Programs app (to offer spawning on a compatible cloud
 * server). Neither references `ns.cloud.*` directly — see
 * `ui/apps/cloud-servers.ts`'s header comment for why.
 */
export const CLOUD_LIST_SCRIPT = "daemons/cloud-list.daemon.js";
export const CLOUD_LIST_RESULT_FILE = "cloud-list-result.txt";

export interface CloudServerRow {
    hostname: string;
    ram: number;
    usedRam: number;
}

export interface CloudListResult {
    servers: CloudServerRow[];
    moneyAvailable: number;
    serverLimit: number;
    ramLimit: number;
    costByRam: Record<number, number>;
}

/** Runs `daemons/cloud-list.daemon.js` on `host` (default "home") and returns its result. */
export async function fetchCloudList(
    ns: QueuedNS,
    addChildPid: (pid: number) => void,
    host = "home"
): Promise<CloudListResult> {
    return runDaemon(ns, addChildPid, CLOUD_LIST_SCRIPT, host, CLOUD_LIST_RESULT_FILE);
}
