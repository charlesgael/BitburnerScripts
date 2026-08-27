import { NS } from "@ns";
import { runTieredDaemon } from "../cgd/daemon-core";
import { makeStatPusher } from "../cgd/stat-push";
import { BASELINE_STAT_PROVIDERS } from "../cgd/stats";

/**
 * Tier 0: the cheapest daemon that still holds `window.cgd.daemon` — no
 * caller-facing methods at all (`isPathAllowed` already refuses everything
 * at tier 0 before ever consulting an allow-list, so this passes an empty
 * one), just the handoff/registration protocol every tier shares via
 * `cgd/daemon-core.ts` plus the baseline stat push (home RAM/karma/hacknet
 * — see `cgd/stats.ts`'s header comment on why tier 0 still computes these
 * despite having zero caller-facing dispatch). Exists so `start.ts` (a
 * later phase) always has *something* minimal to fall back to, and so "a
 * daemon is running" and "a daemon can actually do anything" are
 * independently observable states.
 *
 * Usage: `run daemons/lv0.daemon.js`
 */
const NO_METHODS: ReadonlySet<string> = new Set();

export async function main(ns: NS): Promise<void> {
    await runTieredDaemon(ns, 0, "daemons/lv0.daemon.js", NO_METHODS, {
        onIdle: makeStatPusher(BASELINE_STAT_PROVIDERS),
    });
}
