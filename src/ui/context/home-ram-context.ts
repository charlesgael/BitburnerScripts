import React from '@react'
/**
 * React's equivalent of Vue's provide/inject (see `ns-queue-context.ts` for
 * the fuller explanation) for `home`'s live used/max RAM.
 *
 * Several apps (Trainer, Cloud Servers, Share, Programs) each used to poll
 * `ns.getServerUsedRam("home")`/`ns.getServerMaxRam("home")` on their own
 * `setInterval`, only while their own window happened to be open. Instead,
 * `ui.app.ts`'s main loop fetches it once, on a schedule, from its idle
 * branch — the same "ran nothing this tick, spend the idle time
 * productively" branch `ui/components/overview-stats.ts` already uses (see
 * `ui/utils/home-ram-poller.ts`) — and pushes the result into
 * `createAppGrid`'s `setHomeRam`, which re-renders with a new Provider
 * value. Every open app window sees the same live number via `useHomeRam()`
 * below, updated in lockstep, instead of each maintaining its own
 * redundant poll.
 *
 * Same catch as `ns-queue-context.ts`: since React is a runtime global here
 * rather than an imported package, the Context object has to be created
 * from that runtime reference. `initHomeRamContext` does that once (see
 * `ui/components/app-grid.tsx`), and `useHomeRam` is the hook descendant
 * components call to read the value it provides.
 */
export interface HomeRam {
  used: number
  max: number
}

let HomeRamContext: any = null

export function initHomeRamContext() {
  HomeRamContext = React.createContext(null)
  return HomeRamContext
}

/**
 * Reads `home`'s current `{ used, max }` RAM, kept fresh by
 * `ui.app.ts`'s main loop (see `ui/utils/home-ram-poller.ts`) and provided
 * by the nearest `HomeRamContext.Provider` (set up in
 * `ui/components/app-grid.tsx`).
 */
export function useHomeRam(): HomeRam {
  if (!HomeRamContext) {
    throw new Error('useHomeRam() called before initHomeRamContext() ran')
  }
  const homeRam = React.useContext(HomeRamContext)
  if (!homeRam) {
    throw new Error('useHomeRam() called outside of a HomeRamContext.Provider')
  }
  return homeRam as any
}
