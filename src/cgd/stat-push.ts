import { NS } from "@ns";
import { CgdStore, CgdStoreState } from "./types";
import { StatProvider, StatValue } from "./stats";

const REFRESH_INTERVAL_MS = 2000;

/**
 * Builds the `onIdle` callback a tier's daemon passes to `runTieredDaemon`
 * (see `daemon-core.ts`) to keep `cgd.store` fresh: home RAM (fetched once,
 * raw, since `cgd.store`'s `homeRam` field needs actual numbers — see
 * `stats.ts`'s header comment on why it isn't just another provider) plus
 * whichever `providers` this tier passes in, all replaced wholesale into
 * `stats` each cycle — not merged — so a stat this tier no longer produces
 * (e.g. after a downgrade from a higher tier) disappears cleanly instead of
 * sitting stale forever. See `docs/epic-cgd-namespace.md`'s tier-downgrade
 * note.
 *
 * Takes the store as a parameter on each call (via `runTieredDaemon`'s
 * `onIdle(ns, store)`) rather than capturing it at creation time: a daemon
 * file builds this pusher *before* `runTieredDaemon` has had a chance to
 * lazily create `cgd.store` (see `daemon-core.ts`'s `ensureCgdStore` call),
 * so capturing it early would just be `undefined`.
 *
 * Throttled to once every `REFRESH_INTERVAL_MS`, same reasoning as the
 * pre-epic `overview-stats.ts`/`home-ram-poller.ts` it replaces: idle ticks
 * fire every ~100ms and none of this changes nearly that often.
 */
export function makeStatPusher(providers: StatProvider[]) {
    let lastRefresh = 0;

    return async function pushStats(ns: NS, store: CgdStore): Promise<void> {
        const now = Date.now();
        if (now - lastRefresh < REFRESH_INTERVAL_MS) return;
        lastRefresh = now;

        let used = 0;
        let max = 0;
        try {
            [used, max] = await Promise.all([ns.getServerUsedRam("home"), ns.getServerMaxRam("home")]);
        } catch {
            // Same reasoning as the per-provider catch below — one failed
            // read here shouldn't blank out (or crash) the rest of this
            // tick's push. See daemon-core.ts's own try/catch for why an
            // uncaught throw reaching the daemon's main loop is worse than
            // just this tick's home-RAM numbers being stale.
        }
        const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;

        const stats: Record<string, StatValue> = {
            "home-ram": { kind: "bar", label: "RAM", value: `${used.toFixed(0)}/${max.toFixed(0)}GB`, pct },
        };
        for (const provider of providers) {
            if (!provider.enabled) continue;
            try {
                stats[provider.id] = await provider.compute(ns);
            } catch {
                // One provider failing (API not unlocked, etc.) shouldn't
                // blank out the rest.
            }
        }

        const next: Pick<CgdStoreState, "homeRam" | "stats"> = { homeRam: { used, max }, stats };
        store.setState(next);
    };
}
