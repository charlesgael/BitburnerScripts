/**
 * Bitburner React UI Template
 * ----------------------------
 * A self-contained sidebar UI built with React, rendered via the game's
 * exposed React/ReactDOM globals. See `src/ui/` for the pieces:
 *  - `ui/utils/react-globals.ts` — grabs React/ReactDOM/document/window
 *  - `ui/utils/ensure-assets.ts` — makes sure `assets.app.js` (notyf, custom
 *                                  CSS) has run before anything else starts
 *  - `ui/utils/mount.ts`         — container create/cleanup helpers
 *  - `ui/components/status-panel.tsx` — live status line + kill switch
 *  - `ui/components/app-grid.tsx`     — sidebar app icon grid + modal
 *  - `ui/apps/`                      — one file per app, registered in
 *                                      `ui/apps/index.ts`
 *
 * This entry point just wires those together and owns the cleanup path:
 * `ns.atExit` runs no matter how the script's process ends — falling off
 * the end of main(), a forced `kill`, a script error, or a restart — unlike
 * code placed after the main loop, which only runs on the cooperative path.
 * `main()` refuses to start at all if another instance is already running
 * (see the ns.ps check right at its top) — see that check's comment for why.
 * It also refuses to start if `assets.app.js` hasn't run and can't be
 * auto-launched (not enough free RAM) — see `ensureAssetsLoaded`.
 *
 * Usage: run with `run ui.app.js`.
 */

import { NS } from "@ns";
import { main as buildAssets } from "./assets.app";
import { APPS } from "./ui/apps";
import { createAppGrid } from "./ui/components/app-grid";
import { createOverviewStats } from "./ui/components/overview-stats";
import { createStatusPanel } from "./ui/components/status-panel";
import { createHomeRamPoller } from "./ui/utils/home-ram-poller";
import { mountContainer, reattachIfDetached, unmountContainer } from "./ui/utils/mount";
import { createQueuedNs } from "./ui/utils/ns-proxy";
import { createNsQueue } from "./ui/utils/ns-queue";
import { getReactGlobals } from "./ui/utils/react-globals";

// This file's own deployed name — used below to spot another already-
// running copy of itself. Hardcoded rather than read via
// `ns.getScriptName()` since it's a fixed, known value (same reasoning as
// the hardcoded daemon paths elsewhere in this file).
const SELF_SCRIPT = "ui.app.js";

export async function main(ns: NS) {
    // Refuse to start a second instance: this script mounts into the
    // game's own sidebar hooks and owns the one cleanup path (ns.atExit
    // below) for tearing them back down. Two instances would double-mount,
    // race over the same DOM containers, and each try to kill the other's
    // child scripts. RunOptions.preventDuplicates (see NetscriptDefinitions
    // .d.ts) can't help here — it only guards a single ns.exec/ns.run call,
    // not the player running `ui.app.js` again by hand from the terminal —
    // so this checks ns.ps directly instead. ns.ps is already part of this
    // file's footprint via the Trainer/Share apps it bundles, so this adds
    // nothing new on top of that.
    const others = (ns.ps("home")).filter((p) => p.filename === SELF_SCRIPT && p.pid !== ns.pid);
    if (others.length > 0) {
        ns.tprint(
            `WARNING: ${SELF_SCRIPT} is already running (pid ${others[0].pid}) — not starting a second instance.`
        );
        return;
    }

    ns.disableLog("ALL");

    const globals = getReactGlobals(ns);
    if (!globals) return;
    const { doc, win, ReactDOM } = globals;

    buildAssets(ns)

    // --- Track anything we need to clean up on exit ---
    const state = {
        running: true,
        restarting: false, // set by the Restart button; checked once the loop below stops
        childPids: [] as number[], // e.g. push here if this script ns.exec's other scripts
    };

    // Provided to apps via ChildPidsContext (see ui/context/child-pids-context.ts)
    // so an app that spawns a script can register the pid without needing
    // access to `state` itself — ns.atExit below kills anything left in
    // `state.childPids` on cleanup.
    function addChildPid(pid: number) {
        state.childPids.push(pid);
    }

    // Waits for the game's own sidebar to have rendered these hooks first
    // — see waitForElement in ui/utils/mount.ts — instead of assuming
    // they're already there the instant this script starts.
    const statusContainer = await mountContainer(doc, "sidebar-extra-hook-3", "ui-app");
    const gridContainer = await mountContainer(doc, "sidebar-extra-hook-0", "ui-app-grid");

    // --- Serializes ns.* calls made from React event handlers (e.g. an
    // app's onClick) against this script's own main loop below, so they
    // never run concurrently with each other — Bitburner throws a
    // "concurrent calls" error if two ns calls overlap in one script.
    // `queuedNs` is a Proxy over the queue that reads like `ns` itself
    // (`await queuedNs.getHostname()`) — see `ui/utils/ns-proxy.ts`.
    const nsQueue = createNsQueue();
    const queuedNs = createQueuedNs(nsQueue);

    // --- Button handler: ONLY flips the flag. The loop below notices this
    // and returns naturally, which triggers the atExit cleanup below.
    // (No DOM/React teardown and no ns.exit() directly in this handler —
    // doing that from inside a React event handler races with React's own
    // reconciliation and throws a concurrency error.)
    const statusPanel = createStatusPanel(
        globals,
        statusContainer,
        () => {
            state.running = false;
        },
        () => {
            state.restarting = true;
            state.running = false;
        }
    );
    const appGrid = createAppGrid(globals, gridContainer, APPS, queuedNs, addChildPid);
    // Feeds an app's `minSourceFile`/`isAvailable` check (see ui/utils/app-
    // availability.ts) — fetched once, not polled: neither can change
    // without a BitNode/aug reset, which kills this script too.
    // ns.getResetInfo is a flat 1 GB (see NetscriptDefinitions.d.ts), cheap
    // enough to reference directly here rather than needing its own daemon.
    const resetInfo = ns.getResetInfo();
    appGrid.setResetInfo(resetInfo.ownedSF, resetInfo.currentNode);
    const overviewStats = createOverviewStats();
    // Feeds HomeRamContext (see ui/context/home-ram-context.ts) so every
    // open app window sees home's live RAM without polling for itself.
    const homeRamPoller = createHomeRamPoller((used, max) => appGrid.setHomeRam(used, max));

    // --- The ONE guaranteed cleanup path. ---
    ns.atExit(() => {
        for (const pid of state.childPids) {
            if (ns.isRunning(pid)) ns.kill(pid);
        }
        appGrid.destroy();
        unmountContainer(ReactDOM, statusContainer);
        unmountContainer(ReactDOM, gridContainer);
        // overviewStats writes into the game's own #overview-extra-hook-0,
        // not a container this script created — unmountContainer above
        // doesn't touch it, so it needs its own explicit clear or the last
        // stats/bars refresh wrote stay stuck on the overview panel forever.
        overviewStats.destroy(doc);
    }, "react-ui-template-cleanup");

    statusPanel.render("Initializing...");
    appGrid.render();

    // --- Main loop: drains one queued ns.* call per iteration (see
    // nsQueue above) so only one is ever in flight; when the queue is
    // empty, it uses the idle time to (1) re-attach the UI if the game's
    // own React tree tore down and rebuilt the sidebar hooks it lives in
    // — see reattachIfDetached in ui/utils/mount.ts — (2) refresh the
    // overview panel's live stats (see ui/stats/registry.ts), and (3) poll
    // home's RAM into HomeRamContext (see ui/utils/home-ram-poller.ts),
    // before falling back to a plain heartbeat + ns.sleep. Both
    // overviewStats.refresh and homeRamPoller.refresh take the real `ns`
    // directly, not queuedNs — they're called from this same branch, the
    // sole consumer draining nsQueue, so a *queued* call here would
    // deadlock waiting on a drain that can't happen until it returns.
    let tick = 0;
    while (state.running) {
        const ranTask = await nsQueue.drain(ns);
        if (!ranTask) {
            tick++;
            reattachIfDetached(doc, statusContainer, "sidebar-extra-hook-3");
            reattachIfDetached(doc, gridContainer, "sidebar-extra-hook-0");
            statusPanel.render(`${new Date().toLocaleTimeString()}`);
            await overviewStats.refresh(ns, doc, Date.now());
            await homeRamPoller.refresh(ns, Date.now());
            await ns.sleep(100);
        }
    }

    // Restart: hands off to daemons/restart.daemon.ts (waits a couple seconds, then
    // starts a fresh ui.app.js) rather than calling ns.spawn/ns.run here —
    // see that file for why. Called directly on the real `ns`, not through
    // nsQueue, since the loop above — the queue's only consumer — has
    // already stopped. Deliberately not tracked via addChildPid: it needs
    // to outlive this script, which is about to exit right below.
    if (state.restarting) {
        const pid = ns.exec("daemons/restart.daemon.js", "home", 1);
        if (pid === 0) {
            ns.tprint("WARNING: couldn't launch daemons/restart.daemon.js (not enough RAM?) — run ui.app.js manually.");
        }
    }

    // No cleanup code needed here — the ns.atExit callback registered above
    // fires automatically the moment this function returns (or the script
    // is killed by any other means), so it's guaranteed to run exactly once.
}
