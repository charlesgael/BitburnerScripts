/**
 * Bitburner React UI Template
 * ----------------------------
 * A self-contained sidebar UI built with React, rendered via the game's
 * exposed React/ReactDOM globals. See `src/ui/` for the pieces:
 *  - `ui/utils/react-globals.ts` — grabs React/ReactDOM/document/window
 *  - `ui/utils/mount.ts`         — container create/cleanup/reattach helpers
 *  - `ui/components/status-panel.tsx` — live status line + kill switch
 *  - `ui/components/app-grid.tsx`     — sidebar app icon grid + modal
 *  - `ui/apps/`                      — one file per app, registered in
 *                                      `ui/apps/index.ts`
 *
 * This script mounts once and exits — it does **not** keep a loop running.
 * All `ns.*` access apps need happens through `window.cgd.daemon`'s queue
 * (a separately-running, persistent daemon — see `daemons/lv*.daemon.ts`),
 * not through this script's own (very short-lived) `ns`. See
 * `docs/epic-cgd-namespace.md` for the full design this implements —
 * particularly section 3, which this file is the execution of.
 *
 * Mounted React trees are tracked in `window.cgd.reactApps`, not this
 * script's own state: a fresh launch dismounts whatever's already there
 * (however it got there — a previous launch, possibly from a different
 * build) before mounting its own, which is what makes running this
 * repeatedly safe/idempotent instead of needing a "refuse a second
 * instance" guard the way the old, always-running version needed. `run
 * ui.app.js stop` unmounts and does nothing else.
 *
 * Requires a daemon to already be registered at `cgd.daemon` — this script
 * doesn't start one itself (that's `start.ts`, a later phase); for now,
 * run e.g. `daemons/lv1.daemon.js` first.
 *
 * Usage: `run ui.app.js` (mount/replace) or `run ui.app.js stop` (unmount).
 */

import type { NS } from '@ns'
import type { CgdNamespace } from './cgd/types'
import { ReactDOM } from '@react'
import { getCgd } from './cgd/window-cgd'
import { APPS } from './ui/apps'
import { createAppGrid } from './ui/components/app-grid'
import { createOverviewStats } from './ui/components/overview-stats'
import { createStatusPanel } from './ui/components/status-panel'
import { mountContainer, startReattachGuardian, unmountContainer } from './ui/utils/mount'
import { createQueuedNs } from './ui/utils/ns-proxy'
import { getWinGlobals } from './ui/utils/react-globals'

/**
 * Dismounts whatever's currently registered in `cgd.reactApps` (however it
 * got there) and clears the registry. Each handle is fully self-contained
 * — it closes over whatever `ReactDOM`/container/etc. it needs from its own
 * creation context, so this function needs nothing beyond `cgd` itself; the
 * handles work identically regardless of which script instance created
 * them, the same way `eval("window")` itself resolves to the one real
 * window no matter which script asks for it.
 */
function unmountReactApps(cgd: CgdNamespace): void {
  cgd.reactApps.launcher?.unmount()
  cgd.reactApps.status?.unmount()
  cgd.reactApps.overview?.unmount()
  cgd.reactApps = {}
}

export async function main(ns: NS) {
  ns.disableLog('ALL')

  const globals = getWinGlobals()
  if (!globals || !ReactDOM) {
    ns.tprint(
      `ERROR: can't reach DOM elements`,
    )
  }
  const { doc, win } = globals

  const cgd = getCgd(win)

  if (ns.args[0] === 'stop') {
    unmountReactApps(cgd)
    return
  }

  if (!cgd.daemon) {
    ns.tprint(
      'ERROR: no cgd daemon is registered — start one first (e.g. `run daemons/lv1.daemon.js`), then run ui.app.js again. (A later phase adds start.ts to automate this.)',
    )
    return
  }
  const daemon = cgd.daemon // only used below for its _getTier() snapshot — see getDaemon's own comment
  if (!cgd.store) {
    // Shouldn't happen — every daemon ensures the store before
    // registering itself (see cgd/daemon-core.ts) — stay defensive
    // rather than dereference null below.
    ns.tprint('ERROR: cgd.daemon is registered but cgd.store is missing — restart the daemon.')
    return
  }
  const store = cgd.store

  // Replace whatever's currently mounted rather than refusing to start a
  // second instance: this script no longer keeps a process alive to
  // refuse a duplicate the way the old always-running version did, so
  // tearing down and remounting is now the only guard, and it's always
  // safe/idempotent — see docs/epic-cgd-namespace.md section 3.
  unmountReactApps(cgd)

  // A live getter, not the `daemon` reference captured above: the daemon
  // actually running can change after this script's already exited (a
  // different tier taking over via the handoff protocol), without
  // ui.app.ts itself relaunching. `createQueuedNs`/`createAppGrid`'s
  // action dispatcher both re-resolve this on every call, so a background
  // daemon swap gets picked up automatically instead of every subsequent
  // call hanging forever against a dead queue — see `ns-proxy.ts`'s own
  // comment for why that's not hypothetical (it happened).
  const getDaemon = () => cgd.daemon
  const queuedNs = createQueuedNs(getDaemon)

  const statusContainer = await mountContainer(doc, 'sidebar-extra-hook-3', 'ui-app')
  const gridContainer = await mountContainer(doc, 'sidebar-extra-hook-0', 'ui-app-grid')

  function addChildPid(_pid: number) {
    // Tracking child pids to kill-on-cleanup doesn't have a clean
    // equivalent anymore: this script's own process exits almost
    // immediately after mounting, and every app that spawns something
    // does so from a React handler firing long after that — there's no
    // live process left to hang a kill-on-exit off of the way the old
    // ns.atExit-based cleanup did. Left as a no-op (rather than removed)
    // so app code calling useAddChildPid() — file-explorer,
    // cloud-servers, task-manager, programs — keeps compiling
    // unchanged; those call sites go away on their own once they
    // migrate off one-shot spawned daemons onto the tiered daemon's
    // queue (see docs/epic-cgd-namespace.md section 5a).
  }

  const statusPanel = createStatusPanel(
    statusContainer,
    getDaemon,
    () => {
      // Deferred, not called synchronously: unmounting the very tree
      // this click handler's own component lives in, from inside the
      // handler, races React's own reconciliation of the event
      // currently firing — see this file's header and status-
      // panel.tsx's own comment. A macrotask boundary (setTimeout 0)
      // lets that event finish first.
      setTimeout(() => {
        try {
          unmountReactApps(cgd)
        }
        catch (err) {
          // console.error, not ns.tprint: this callback's own
          // `ns` was captured from a main() call long since
          // returned by the time a button is clicked — plain
          // console output doesn't depend on whether Bitburner
          // still considers that reference live.
          console.error('ui.app.js stop failed:', err)
        }
      }, 0)
    },
    () => {
      setTimeout(async () => {
        try {
          unmountReactApps(cgd)
          cgd.daemon?._stop()
        }
        catch (err) {
          console.error('ui.app.js full stop failed:', err)
        }
      }, 0)
    },
    () => {
      setTimeout(async () => {
        try {
          unmountReactApps(cgd)
          // Goes through the daemon's queue, not a raw
          // ns.exec(...): this closure's own `ns` was captured
          // from this main() call, which has long since returned
          // by the time a button is actually clicked — whether
          // Bitburner still considers that `ns` reference live is
          // untested, unlike the daemon's own `ns`, which is
          // still genuinely in use by a running process. See
          // docs/epic-cgd-namespace.md's "Validated assumptions"
          // — this specific case (a captured `ns`, rather than a
          // plain closure/DOM handle, outliving its owning
          // script) was never actually tested, so this doesn't
          // rely on it. `exec` with an explicit host rather than
          // `run` (`ns.run` is just `ns.exec` with the host
          // implied) — `exec` was already needed on tier 1 for
          // other things, so this avoids growing the allow-list
          // for a one-off.
          await queuedNs._exec('ui.app.js', 'home', 1)
        }
        catch (err) {
          // Without this, a rejected queuedNs.exec(...) (no
          // daemon registered, tier disallows it, whatever) would
          // be an unhandled rejection inside a bare setTimeout
          // callback — easy to miss entirely, and the UI would
          // just stay unmounted with no visible explanation.
          console.error('ui.app.js restart failed:', err)
        }
      }, 0)
    },
  )
  const appGrid = createAppGrid(
    gridContainer,
    APPS,
    queuedNs,
    addChildPid,
    store,
    daemon._getTier(),
    getDaemon,
  )
  // `ownedSF`/`currentNode` (feeding an app's `minSourceFile`/`isAvailable`
  // check — see ui/utils/app-availability.ts) are fetched internally by
  // `createAppGrid` now, not here: it needs to retry that fetch itself if
  // the daemon starts at tier 0 (which would reject `_getResetInfo`, same
  // as every other dispatch call) and only later gets replaced by a
  // higher tier in the background — see `app-grid.tsx`'s
  // `fetchResetInfoIfNeeded` for the fuller reasoning.

  const overviewStats = createOverviewStats()
  overviewStats.start(doc, store)

  const stopGridReattach = startReattachGuardian(doc, gridContainer, 'sidebar-extra-hook-0')
  const stopStatusReattach = startReattachGuardian(doc, statusContainer, 'sidebar-extra-hook-3')

  statusPanel.render()
  appGrid.render()

  cgd.reactApps = {
    launcher: {
      unmount: () => {
        stopGridReattach()
        appGrid.destroy()
        unmountContainer(ReactDOM, gridContainer)
      },
    },
    status: {
      unmount: () => {
        stopStatusReattach()
        statusPanel.destroy()
        unmountContainer(ReactDOM, statusContainer)
      },
    },
    overview: {
      unmount: () => {
        overviewStats.destroy(doc)
      },
    },
  }

  // No loop, no ns.atExit — this function just returns here. Everything
  // it mounted lives on independent of this process (real DOM/React
  // state, and closures registered in cgd.reactApps for the next launch
  // — or explicit `stop` — to tear back down), the same way
  // `assets.app.ts` injects its <style> element and exits.
}
