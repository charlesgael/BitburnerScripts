import { QueuedNS } from "./ns-proxy";
import { runDaemon } from "./run-daemon";

/**
 * Shared constants/types/helpers for the "Slave Nodes" feature: letting the
 * player check off an already-rooted, non-purchased server (found the
 * normal way — cracked/backdoored on the network) into the same worker role
 * a purchased ("cloud") server plays for the Programs/XP Farm/Share apps.
 * Priceless early game, before the player can afford their first real cloud
 * server.
 *
 * A designated slave node has no in-game marker of its own the way a
 * purchased server has `purchasedByPlayer` — so this file's job is to *be*
 * that marker: `SLAVE_NODE_FILE` is a JSON array of hostnames the player has
 * designated, written by the Cloud Servers app's checklist tab and read
 * back by `daemons/cloud-list.daemon.ts`, which folds them straight into
 * the same `CloudServerRow[]` snapshot purchased servers already flow
 * through (see that daemon's header comment). That's the whole trick: every
 * consumer of `fetchCloudList`/`CLOUD_LIST_SCRIPT` (Share, XP Farm,
 * Programs' task manager, and the Cloud Servers app's own list) picks up
 * slave nodes for free, tagged `isSlave: true` on each row, with no changes
 * needed on their end.
 *
 * ns.read/ns.write are 0 GB (see `ui/apps/cloud-servers/`'s header comment),
 * so the app can touch `SLAVE_NODE_FILE` directly through the queued ns
 * without any RAM concern — same convention as `xp-farm-config.ts`.
 */
export const SLAVE_NODE_FILE = "slave-nodes.txt";

/** The network-scan daemon backing the checklist tab: walks the whole
 * network (not just the player's purchased servers, which is all
 * `cloud-list.daemon.ts` itself knows how to enumerate) for every rooted,
 * non-purchased, non-`home` host — checked or not, the checklist itself
 * cross-references this against the already-designated list. Kept separate
 * from `cloud-list.daemon.ts` since `ns.scan` is only needed for this
 * discovery step, not for reading back an already-designated list. */
export const SLAVE_NODE_HOSTS_SCRIPT = "daemons/slave-node-hosts.daemon.js";
export const SLAVE_NODE_HOSTS_RESULT_FILE = "slave-node-hosts-result.txt";

/** One host on the network eligible to be a slave node — same shape as
 * `CloudServerRow` minus `isSlave` (designation is looked up separately,
 * against the `CloudServerRow[]` snapshot — see this file's header
 * comment). */
export interface SlaveNodeHost {
    hostname: string;
    ram: number;
    usedRam: number;
}

/** The set of hostnames currently designated as slave nodes, or [] if the
 * file doesn't exist yet / is empty / unparsable. */
export async function readSlaveNodes(ns: QueuedNS): Promise<string[]> {
    const raw = await ns.read(SLAVE_NODE_FILE);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/** Overwrites the designated list with `hosts` — the only way it ever
 * changes; `daemons/cloud-list.daemon.ts` only ever reads (and self-heals)
 * it. */
export async function writeSlaveNodes(ns: QueuedNS, hosts: string[]): Promise<void> {
    await ns.write(SLAVE_NODE_FILE, JSON.stringify(hosts), "w");
}

/** Runs `daemons/slave-node-hosts.daemon.js` on `host` (default "home") and
 * returns every rooted, non-purchased, non-`home` host it found. */
export async function fetchSlaveNodeHosts(
    ns: QueuedNS,
    addChildPid: (pid: number) => void,
    host = "home"
): Promise<SlaveNodeHost[]> {
    const result = await runDaemon(ns, addChildPid, SLAVE_NODE_HOSTS_SCRIPT, host, SLAVE_NODE_HOSTS_RESULT_FILE);
    return result.hosts;
}
