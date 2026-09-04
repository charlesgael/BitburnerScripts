import type { CgdDaemon, CgdQueue, CgdStore, CgdTier } from '../../../cgd/types'
import type { AppDefinition } from '../../types'
import type { QueuedNS } from '../../utils/ns-proxy'
import type { OpenWindow } from './types'
import React, { getWinGlobals, ReactDOM } from '@react'
import { initCgdActionsContext } from '../../context/cgd-actions-context'
import { initCgdCapabilityContext } from '../../context/cgd-capability-context'
import { initChildPidsContext } from '../../context/child-pids-context'
import { initDaemonTierContext } from '../../context/daemon-tier-context'
// import { initHomeRamContext } from '../context/home-ram-context'
import { initNsQueueContext } from '../../context/ns-queue-context'
import { isAppVisible, isAvailableReason, ramShortfallReason } from '../../utils/app-availability'

/**
 * Small icon launcher grid, meant for a sidebar hook. Clicking an icon opens
 * that app's content in its own floating window — draggable by its title
 * bar, closed via its ✕ button or Escape (closes whichever window was last
 * focused). Multiple windows can be open at once, and none of them block
 * clicks on the rest of the page — there's no modal backdrop.
 *
 * Add more apps by extending `ui/apps/index.ts` — this component doesn't
 * change.
 *
 * Call `destroy()` (e.g. from `ns.atExit`) to remove the listeners this
 * component registers on `doc` (Escape key, and any in-progress drag).
 */
export function createAppGrid(
  container: any,
  apps: AppDefinition[],
  queuedNs: QueuedNS,
  addChildPid: (pid: number) => void,
  cgdStore: CgdStore,
  initialDaemonTier: CgdTier,
  getDaemon: () => CgdDaemon | undefined,
) {
  const { doc } = getWinGlobals()
  // Provides the queued `ns` proxy, the child-pid tracker, `home`'s live
  // RAM, the running daemon's tier, and its compound-action dispatcher to
  // every app's Content component via context, so none of them need to be
  // passed down as an explicit prop from here.
  const NsQueueContext = initNsQueueContext()
  const ChildPidsContext = initChildPidsContext()
  const DaemonTierContext = initDaemonTierContext()
  const CgdActionsContext = initCgdActionsContext()
  const CgdCapabilityContext = initCgdCapabilityContext()

  // Resolves against whichever daemon is *currently* registered on every
  // call, not whatever was registered when this grid was created — same
  // reasoning as `ns-proxy.ts`'s `createQueuedNs`: a fixed reference would
  // keep pointing at a since-replaced daemon's dead queue and hang
  // forever instead of failing (or succeeding against the new one).
  const callAction: CgdQueue['enqueueAction'] = (name, args) => {
    const daemon = getDaemon()
    if (!daemon) {
      return Promise.reject(new Error(`No cgd daemon is currently registered — can't run action "${name}".`))
    }
    return daemon.queue.enqueueAction(name, args)
  }

  // Same live-getter resolution as `callAction` above, just synchronous —
  // `CgdQueue.can` never needs a queue round-trip (see its own doc
  // comment), so this can return a plain boolean instead of a promise.
  const canCall = (path: string): boolean => {
    return getDaemon()?.queue.can(path.split('.')) ?? false
  }

  const state: { windows: OpenWindow[] } = { windows: [] }
  // Sourced from cgd.store (see docs/epic-cgd-namespace.md's "Store
  // lifecycle") rather than pushed in externally — subscribed just below
  // so HomeRamContext's consumers see every update the daemon pushes,
  // independent of whichever daemon generation currently produces it.
  let homeRam = cgdStore.getState().homeRam
  const unsubscribeCgdStore = cgdStore.subscribe(() => {
    const state = cgdStore.getState()
    if (state.homeRam !== homeRam) {
      homeRam = state.homeRam
      render()
    }
  })
  // `ownedSF`/`currentNode` themselves can't change without a BitNode/aug
  // reset, which kills this script too — but *fetching* them can't happen
  // until the daemon tier actually allows it (tier 0 rejects
  // `_getResetInfo` outright, same as every other dispatch call — see
  // `cgd/dispatch.ts`'s `isPathAllowed`), so `fetchResetInfoIfNeeded`
  // below retries once the tier poller (further down) notices tier 0
  // isn't the story anymore, instead of this being a pure one-shot.
  let ownedSF: Map<number, number> = new Map()
  let currentNode = 0
  let resetInfoFetched = false
  let focusedId: string | null = null
  let nextZ = 0
  // Mutable, updated when daemon updates and checks the availability of
  // Tor Router to the player
  let torRouter: boolean = false

  // Mutable, not the plain parameter it started as: the daemon actually
  // running can change in the background (a different tier taking over
  // via the handoff protocol) without `ui.app.ts` itself relaunching to
  // notice — found live, the hard way: switching from tier 0 to tier 1
  // left the grid showing its tier-0 (empty) view forever until the next
  // manual `ui.app.js` relaunch. The poller below (`getDaemon`, the same
  // live getter `callAction`/`ns-proxy.ts` already use) catches that
  // instead of trusting the tier this grid happened to be created with.
  let daemonTier: CgdTier = initialDaemonTier

  /**
   * Fetches `ownedSF`/`currentNode` through the queue once the tier
   * actually allows it — called once eagerly below, and again by the
   * tier poller whenever `daemonTier` changes, so a grid created at tier
   * 0 (which skips this at `ui.app.ts` mount time — see that file) picks
   * it up as soon as a real tier takes over, without needing a relaunch.
   */
  async function fetchResetInfoIfNeeded() {
    if (resetInfoFetched || daemonTier <= 0)
      return
    resetInfoFetched = true // set eagerly — a concurrent tick shouldn't double-fetch
    try {
      const info = await queuedNs._getResetInfo()
      ownedSF = info.ownedSF
      currentNode = info.currentNode
      render()
    }
    catch {
      resetInfoFetched = false // let the next tier-poll tick (or app open) retry
    }
  }
  void fetchResetInfoIfNeeded()

  const TOR_ROUTER_POLL_MS = 10000
  async function refreshTorRouter() {
    try {
      const res = await queuedNs._hasTorRouter()
      if (res !== torRouter) {
        torRouter = res
        render()
      }
    }
    catch {}
  }
  void refreshTorRouter()
  const torRouterPollId = setInterval(refreshTorRouter, TOR_ROUTER_POLL_MS)

  const TIER_POLL_MS = 1000
  const tierPollId = setInterval(() => {
    const next = getDaemon()?._getTier() ?? 0
    if (next === daemonTier)
      return
    daemonTier = next
    render()
    void fetchResetInfoIfNeeded()
    void refreshTorRouter()
  }, TIER_POLL_MS)

  // Two different treatments in the grid below (see
  // `ui/utils/app-availability.ts`'s own header comments for why they're
  // split): `minRam`, and an `isAvailable` lambda returning a string, both
  // show the icon disabled with that string as a reason (something the
  // player can act on without leaving the app grid) — combined into one
  // `disabledReason` below. `minSourceFile`/`minDaemonTier`, and an
  // `isAvailable` lambda returning `false`, leave the icon out of the grid
  // entirely instead (`visible` below) — nothing to explain to the player.
  function disabledReason(app: AppDefinition): string | null {
    return ramShortfallReason(app, { homeRam }) ?? isAvailableReason(app.isAvailable, { ownedSF, currentNode, daemonTier, homeRam, torRouter })
  }
  function visible(app: AppDefinition): boolean {
    return isAppVisible(app, { ownedSF, currentNode, daemonTier, homeRam, torRouter })
  }

  function openApp(id: string) {
    const existing = state.windows.find(w => w.id === id)
    if (existing) {
      bringToFront(id)
      return
    }
    const app = apps.find(a => a.id === id)
    // Belt-and-suspenders alongside the disabled/hidden icon below —
    // this is what actually stops the window from opening.
    if (app && (!visible(app) || disabledReason(app)))
      return
    // Cascade each new window a bit further down/right than the last,
    // wrapping so a long session doesn't march windows off-screen.
    const offset = (state.windows.length % 8) * 28
    state.windows.push({
      id,
      x: 280 + offset,
      y: 80 + offset,
      z: ++nextZ,
      refreshCount: 0,
      width: app?.preferredWidth,
      height: app?.preferredHeight,
    })
    focusedId = id
    render()
  }

  // Applies a window's preferred starting size (if any) to its DOM node
  // exactly once, imperatively — see the `width`/`height` comment on
  // `OpenWindow` for why this can't just be a normal React style prop.
  // The `node.style.width` check is what makes this idempotent: it's
  // re-run as a ref callback on every render (see below), but only ever
  // acts the first time, before either this or a native resize-handle
  // drag has put an explicit width/height on the node.
  function sizeWindowNode(win: OpenWindow, node: any) {
    if (!node || node.style.width)
      return
    if (win.width)
      node.style.width = `${win.width}px`
    if (win.height)
      node.style.height = `${win.height}px`
  }

  function closeApp(id: string) {
    state.windows = state.windows.filter(w => w.id !== id)
    if (focusedId === id)
      focusedId = null
    render()
  }

  // Forces the app's Content component to remount (see the `key` used
  // below) rather than trying to poke each app into refetching itself —
  // every app already fetches fresh data in a mount-time `useEffect`
  // (see e.g. `cloud-servers.tsx`'s "remounts every time the window is
  // opened" comment), so remounting is a generic recompute that works
  // for any app without each one needing its own refresh plumbing.
  function refreshApp(id: string) {
    const win = state.windows.find(w => w.id === id)
    if (!win)
      return
    win.refreshCount++
    render()
  }

  function bringToFront(id: string) {
    const win = state.windows.find(w => w.id === id)
    if (!win)
      return
    win.z = ++nextZ
    focusedId = id
    render()
  }

  // --- Dragging: plain mousedown/mousemove/mouseup on `doc`, since a
  // drag can move the pointer outside the window's own DOM node.
  let drag: {
    id: string
    startX: number
    startY: number
    originX: number
    originY: number
  } | null = null

  function onDragMove(ev: MouseEvent) {
    if (!drag)
      return
    const win = state.windows.find(w => w.id === drag!.id)
    if (!win)
      return
    win.x = Math.max(0, drag.originX + (ev.clientX - drag.startX))
    win.y = Math.max(0, drag.originY + (ev.clientY - drag.startY))
    render()
  }

  function onDragEnd() {
    drag = null
    doc.body.style.userSelect = ''
    doc.removeEventListener('mousemove', onDragMove)
    doc.removeEventListener('mouseup', onDragEnd)
  }

  function startDrag(id: string, ev: any) {
    bringToFront(id)
    const win = state.windows.find(w => w.id === id)
    if (!win)
      return
    drag = {
      id,
      startX: ev.clientX,
      startY: ev.clientY,
      originX: win.x,
      originY: win.y,
    }
    doc.body.style.userSelect = 'none' // avoid selecting page text while dragging fast
    doc.addEventListener('mousemove', onDragMove)
    doc.addEventListener('mouseup', onDragEnd)
  }

  function onKeyDown(ev: KeyboardEvent) {
    if (ev.key === 'Escape' && focusedId)
      closeApp(focusedId)
  }
  doc.addEventListener('keydown', onKeyDown)

  function makePortalContainer() {
    const { doc } = getWinGlobals()

    const existing = doc.getElementById('windows-portal')
    if (existing)
      return existing

    const winTarget = doc.createElement('div')
    winTarget.id = 'windows-portal'
    winTarget.style.position = 'absolute'
    winTarget.style.top = '0px'
    winTarget.style.left = '0px'
    doc.body.appendChild(winTarget)

    return winTarget
  }

  function render() {
    // Apps failing minSourceFile/minDaemonTier, or whose isAvailable
    // returns false, are left out of the icon list entirely (see visible()
    // above) — filter before map rather than returning null from within
    // it, so there's no gap left in the grid where a hidden icon would've
    // sat.
    const icons = apps.filter(visible).map((app) => {
      const reason = disabledReason(app)
      return (
        <button
          key={app.id}
          onClick={() => openApp(app.id)}
          disabled={reason != null}
          title={reason ?? app.label}
          className="bb-icon-btn"
        >
          <span style={{ fontSize: '18px', lineHeight: 1 }}>
            {app.icon}
          </span>
          <span
            style={{
              fontSize: '11px',
              opacity: 0.85,
              textAlign: 'center',
            }}
          >
            {app.label}
          </span>
        </button>
      )
    })

    const grid = icons.length
      ? (
          <div
            key="grid"
            className="un-scale"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))',
              gap: '8px',
              padding: '8px',
              borderTop: 'solid 1px rgb(68, 68, 68)',
            }}
          >
            {icons}
          </div>
        )
      : null

    const windows = state.windows.map((win) => {
      const app = apps.find(a => a.id === win.id)
      if (!app)
        return null

      return (
        <div
          key={win.id}
          ref={(node: any) => sizeWindowNode(win, node)}
          onMouseDown={() => bringToFront(win.id)}
          className="un-scale bb-window"
          style={{
            position: 'fixed',
            left: `${win.x}px`,
            top: `${win.y}px`,
            zIndex: 20000 + win.z,
            minWidth: `${app.minWidth ?? 280}px`,
            maxWidth: '90vw',
            minHeight: `${app.minHeight ?? 120}px`,
            // Cap the window to the viewport and let the player
            // drag its own bottom-right corner (native CSS
            // resize handle) to grow/shrink it — without this,
            // a window cascaded low on screen (see `offset` in
            // openApp) or one whose app content is simply
            // taller than the remaining viewport has no way to
            // reach content past the screen edge, since the
            // page itself doesn't scroll. `overflow: hidden`
            // here (rather than auto) means the window itself
            // never grows a scrollbar — only the content area
            // below the title bar does, so the title bar stays
            // put while the body scrolls under it.
            maxHeight: 'calc(100vh - 40px)',
            overflow: 'hidden',
            resize: 'both',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            // Title bar: drag handle + close button.
            onMouseDown={(ev: any) => startDrag(win.id, ev)}
            className="bb-window-titlebar"
          >
            <span>
              {app.icon}
              {' '}
              {app.label}
            </span>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0px',
              }}
            >
              {app.refreshBtn && (
                <button
                // Dragging starts on the title bar's mousedown before
                // this click fires — stop it from also being read as
                // a drag-start on the button itself.
                  onMouseDown={(ev: any) => ev.stopPropagation()}
                  onClick={() => refreshApp(win.id)}
                  title="Refresh"
                  className="bb-icon-link"
                >
                  🗘
                </button>
              )}
              <button
                onMouseDown={(ev: any) => ev.stopPropagation()}
                onClick={() => closeApp(win.id)}
                title="Close"
                className="bb-icon-link bb-icon-link--danger"
              >
                ✕
              </button>
            </div>
          </div>
          <div
            style={{
              // Grow to fill whatever height the outer window
              // (native-resized or viewport-capped) leaves
              // available, and scroll internally rather than
              // letting content spill past the window's own
              // bottom edge. `minHeight: 0` is required for a
              // flex child to actually shrink below its
              // content's natural size instead of forcing the
              // window taller than its maxHeight.
              flex: '1 1 auto',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              ...(!app.unmanaged && {
                padding: '12px',
                overflowY: 'auto',
              }),
            }}
          >
            {/* Keying on refreshCount forces React to unmount and
                        remount the app's Content on refresh, re-running its
                        mount-time effects instead of leaving stale state in
                        place. */}
            <app.Content
              key={`${win.id}-${win.refreshCount}`}
            />
          </div>
        </div>
      )
    })

    const portalContainer = makePortalContainer()

    ReactDOM.render(
      <NsQueueContext.Provider value={queuedNs}>
        <ChildPidsContext.Provider value={addChildPid}>
          <DaemonTierContext.Provider value={daemonTier}>
            <CgdActionsContext.Provider value={callAction}>
              <CgdCapabilityContext.Provider value={canCall}>
                {grid}
                {portalContainer ? ReactDOM.createPortal(windows, portalContainer, 'windows-portal') : windows}
              </CgdCapabilityContext.Provider>
            </CgdActionsContext.Provider>
          </DaemonTierContext.Provider>
        </ChildPidsContext.Provider>
      </NsQueueContext.Provider>,
      container,
    )
  }

  function destroy() {
    doc.removeEventListener('keydown', onKeyDown)
    doc.removeEventListener('mousemove', onDragMove)
    doc.removeEventListener('mouseup', onDragEnd)
    unsubscribeCgdStore()
    clearInterval(tierPollId)
    clearInterval(torRouterPollId)
  }

  return { render, destroy }
}
