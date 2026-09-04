import React from '@react'

/**
 * React's equivalent of Vue's provide/inject (see `ns-queue-context.ts` for
 * the fuller explanation) for a synchronous "would this ns.* method be
 * dispatchable right now" check — `cgd.daemon.queue.can(path)` (see
 * `cgd/types.ts`'s `CgdQueue.can`), alongside `useCgdActions()`'s compound-
 * action dispatcher and `useQueuedNs()`'s raw call dispatch. Provided from
 * `ui/components/app-grid/index.tsx`, resolved against whichever daemon is
 * currently registered on every call (same live-getter treatment as
 * `callAction`/`useQueuedNs()` there) — a daemon swap in the background is
 * picked up without a fresh `ui.app.js` launch.
 *
 * Same catch as `ns-queue-context.ts`/`cgd-actions-context.ts`: since React
 * is a runtime global here rather than an imported package, the Context
 * object has to be created from that runtime reference.
 * `initCgdCapabilityContext` does that once, and `useCgdCapability` is the
 * hook descendant components call to read the value it provides.
 */
let CgdCapabilityContext: any = null

export function initCgdCapabilityContext() {
  CgdCapabilityContext = React.createContext(null)
  return CgdCapabilityContext
}

/**
 * Returns a `(path: string) => boolean` check — e.g.
 * `useCgdCapability()('hacknet.numNodes')`. Dotted-string, not the
 * `string[]` shape `CgdQueue.can` itself takes, since that's how every
 * allow-list entry is actually written (see `daemons/lv1.daemon.ts`'s
 * `TIER_1_METHODS`) and how the rejection message `enqueueCall` would
 * otherwise throw already formats it. Returns `false` (never throws) when
 * no daemon is currently registered at all — nothing is dispatchable
 * without one, same as `callAction`'s "no daemon" handling in app-grid,
 * just synchronous instead of a rejected promise.
 */
export function useCgdCapability(): (path: string) => boolean {
  if (!CgdCapabilityContext) {
    throw new Error('useCgdCapability() called before initCgdCapabilityContext() ran')
  }
  const canCall = React.useContext(CgdCapabilityContext)
  if (!canCall) {
    throw new Error('useCgdCapability() called outside of a CgdCapabilityContext.Provider')
  }
  return canCall as any
}
