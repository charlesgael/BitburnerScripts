/**
 * Bitburner React UI Template
 * ----------------------------
 * A self-contained sidebar UI built with React, rendered via the game's
 * exposed React/ReactDOM globals. See `src/ui/` for the pieces:
 *  - `ui/utils/react-globals.ts` — grabs React/ReactDOM/document/window
 *  - `ui/utils/mount.ts`         — container create/cleanup helpers
 *  - `ui/components/status-panel.ts` — live status line + kill switch
 *  - `ui/components/app-grid.ts`     — sidebar app icon grid + modal
 *  - `ui/apps/`                      — one file per app, registered in
 *                                      `ui/apps/index.ts`
 *
 * This entry point just wires those together and owns the cleanup path:
 * `ns.atExit` runs no matter how the script's process ends — falling off
 * the end of main(), a forced `kill`, a script error, or a restart — unlike
 * code placed after the main loop, which only runs on the cooperative path.
 *
 * Usage: run with `run ui.app.js`.
 */

import { NS } from "@ns";
import { getReactGlobals } from "./ui/utils/react-globals";
import { mountContainer, unmountContainer, reattachIfDetached } from "./ui/utils/mount";
import { createNsQueue } from "./ui/utils/ns-queue";
import { createQueuedNs } from "./ui/utils/ns-proxy";
import { createStatusPanel } from "./ui/components/status-panel";
import { createAppGrid } from "./ui/components/app-grid";
import { createOverviewStats } from "./ui/components/overview-stats";
import { APPS } from "./ui/apps";

export async function main(ns: NS) {
    ns.disableLog("ALL");

    const globals = getReactGlobals(ns);
    if (!globals) return;
    const { doc, ReactDOM } = globals;

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
    const overviewStats = createOverviewStats();

    // --- The ONE guaranteed cleanup path. ---
    ns.atExit(() => {
        for (const pid of state.childPids) {
            if (ns.isRunning(pid)) ns.kill(pid);
        }
        appGrid.destroy();
        unmountContainer(ReactDOM, statusContainer);
        unmountContainer(ReactDOM, gridContainer);
    }, "react-ui-template-cleanup");

    statusPanel.render("Initializing...");
    appGrid.render();

    // --- Main loop: drains one queued ns.* call per iteration (see
    // nsQueue above) so only one is ever in flight; when the queue is
    // empty, it uses the idle time to (1) re-attach the UI if the game's
    // own React tree tore down and rebuilt the sidebar hooks it lives in
    // — see reattachIfDetached in ui/utils/mount.ts — and (2) refresh the
    // overview panel's live stats (see ui/stats/registry.ts), before
    // falling back to a plain heartbeat + ns.sleep. overviewStats.refresh
    // takes the real `ns` directly, not queuedNs — it's called from this
    // same branch, the sole consumer draining nsQueue, so a *queued* call
    // here would deadlock waiting on a drain that can't happen until it
    // returns.
    let tick = 0;
    while (state.running) {
        const ranTask = await nsQueue.drain(ns);
        if (!ranTask) {
            tick++;
            reattachIfDetached(doc, statusContainer, "sidebar-extra-hook-3");
            reattachIfDetached(doc, gridContainer, "sidebar-extra-hook-0");
            statusPanel.render(`${new Date().toLocaleTimeString()}`);
            await overviewStats.refresh(ns, doc, Date.now());
            await ns.sleep(100);
        }
    }

    // Restart: hands off to restart.daemon.ts (waits a couple seconds, then
    // starts a fresh ui.app.js) rather than calling ns.spawn/ns.run here —
    // see that file for why. Called directly on the real `ns`, not through
    // nsQueue, since the loop above — the queue's only consumer — has
    // already stopped. Deliberately not tracked via addChildPid: it needs
    // to outlive this script, which is about to exit right below.
    if (state.restarting) {
        const pid = ns.exec("restart.daemon.js", "home", 1);
        if (pid === 0) {
            ns.tprint("WARNING: couldn't launch restart.daemon.js (not enough RAM?) — run ui.app.js manually.");
        }
    }

    // No cleanup code needed here — the ns.atExit callback registered above
    // fires automatically the moment this function returns (or the script
    // is killed by any other means), so it's guaranteed to run exactly once.
}
