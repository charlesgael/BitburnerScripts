import { QueuedNS } from "./ns-proxy";

/**
 * Shared constants/types for the XP Farm feature: the player dedicates a
 * purchased ("cloud") server to grinding hacking XP via continuous grow()/
 * weaken() loops against a picked target (see `ui/apps/xp-farm/` and
 * `daemons/xp-farm.daemon.ts`).
 *
 * The two sides only ever talk through two plain files:
 *   - `XP_FARM_CONFIG_FILE` — a JSON array of hostnames the player has
 *     dedicated. The app writes it (toggling a server in/out); the daemon
 *     reads it periodically and reconciles reality to match.
 *   - `XP_FARM_STATUS_FILE` — JSON written by the daemon each cycle,
 *     reporting what it's actually doing on each managed host (which target
 *     it picked, how many grow/weaken threads). Purely informational for
 *     the app to display — the daemon never reads it back.
 *
 * Neither file is a queue or a lock: the daemon is the sole writer of
 * status, the app is the sole writer of config, and both are single JSON
 * blobs rewritten wholesale (`"w"` mode), never appended to.
 *
 * ns.read/ns.write are 0 GB (see `ui/apps/cloud-servers/`'s header
 * comment for why), so the app can touch these files directly through the
 * queued ns below without any RAM concern — same as the daemon touching
 * them directly through the real ns.
 */
export const XP_FARM_CONFIG_FILE = "xp-farm-config.txt";
export const XP_FARM_STATUS_FILE = "xp-farm-status.txt";
export const XP_FARM_DAEMON_SCRIPT = "daemons/xp-farm.daemon.js";
export const XP_FARM_DAEMON_HOST = "home";

/** The two loop scripts the daemon launches on every managed host, and the
 * fixed "delay between calls" arg (0 — back-to-back forever) it always
 * launches them with. Shared here — rather than each side hardcoding its
 * own copy — so `ui/apps/xp-farm/` can open a specific loop's own tail
 * window (`ns.ui.openTail(script, host, target, XP_FARM_LOOP_DELAY)`) using
 * the exact same filename+args the daemon actually exec'd it with; a
 * mismatch here would mean openTail finds nothing. */
export const XP_FARM_GROW_SCRIPT = "daemons/grow.daemon.js";
export const XP_FARM_WEAKEN_SCRIPT = "daemons/weaken.daemon.js";
export const XP_FARM_LOOP_DELAY = 0;

/** One host's current assignment, as last reported by the daemon. */
export interface XpFarmAssignment {
    target: string;
    growThreads: number;
    weakenThreads: number;
}

export type XpFarmStatus = Record<string, XpFarmAssignment>;

/** The set of hostnames currently dedicated to XP farming, or [] if the
 * config file doesn't exist yet / is empty / unparsable. */
export async function readXpFarmHosts(ns: QueuedNS): Promise<string[]> {
    const raw = await ns._read(XP_FARM_CONFIG_FILE);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/** Overwrites the config file with `hosts` — the only way the dedicated
 * list ever changes; the daemon only ever reads it. */
export async function writeXpFarmHosts(ns: QueuedNS, hosts: string[]): Promise<void> {
    await ns._write(XP_FARM_CONFIG_FILE, JSON.stringify(hosts), "w");
}

/** The daemon's last-reported status, or {} if it hasn't written one yet
 * (e.g. it isn't running, or hasn't completed a cycle since it started). */
export async function readXpFarmStatus(ns: QueuedNS): Promise<XpFarmStatus> {
    const raw = await ns._read(XP_FARM_STATUS_FILE);
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}
