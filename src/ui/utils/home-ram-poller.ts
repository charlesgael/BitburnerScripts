import { NS } from "@ns";

const REFRESH_INTERVAL_MS = 1000;

/**
 * Polls `home`'s used/max RAM on a schedule and reports changes via
 * `onUpdate` — the same "idle tick" pattern `ui/components/overview-
 * stats.ts` uses: call `refresh(ns, now)` from the main loop's `if
 * (!ranTask)` branch (see `ui.app.ts`), productive use of the time it'd
 * otherwise spend just sleeping, throttled since idle ticks fire every
 * ~100ms and RAM doesn't change nearly that often.
 *
 * Takes the real `ns` directly, not the queued proxy — same reasoning as
 * `overviewStats.refresh`: this runs inside the same branch that's the
 * sole consumer draining `nsQueue`, so a *queued* call here would
 * deadlock. `getServerUsedRam`/`getServerMaxRam` are already part of
 * ui.app.js's footprint via the Trainer/Programs/Cloud Servers/Share apps,
 * so polling them here adds nothing new on top of that.
 *
 * `onUpdate` is wired to `createAppGrid`'s `setHomeRam` (see
 * `ui/components/app-grid.ts`), which re-renders with a new
 * `HomeRamContext` value — see `ui/context/home-ram-context.ts` for why
 * that's the point of this at all.
 */
export function createHomeRamPoller(onUpdate: (used: number, max: number) => void) {
    let lastRefresh = 0;
    let lastUsed = -1;
    let lastMax = -1;

    async function refresh(ns: NS, now: number) {
        if (now - lastRefresh < REFRESH_INTERVAL_MS) return;
        lastRefresh = now;

        const [used, max] = await Promise.all([ns.getServerUsedRam("home"), ns.getServerMaxRam("home")]);
        if (used === lastUsed && max === lastMax) return; // nothing changed — skip the re-render
        lastUsed = used;
        lastMax = max;
        onUpdate(used, max);
    }

    return { refresh };
}
