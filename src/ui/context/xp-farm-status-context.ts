import type { XpFarmStatus } from '../../cgd/types'

/**
 * React's equivalent of Vue's provide/inject (see `ns-queue-context.ts` for
 * the fuller explanation) for `cgd.store`'s `xpFarmStatus` field — what
 * `daemons/xp-farm.daemon.ts` last reported doing on each managed host
 * (target, grow/weaken thread counts).
 *
 * Replaces the old `xp-farm-status.txt` + a per-window `setInterval` polling
 * it via the queued `ns` (see `ui/utils/xp-farm-config.ts`'s header comment
 * for why): `ui/components/app-grid.tsx` subscribes to `cgd.store` once,
 * same as it already does for `HomeRamContext`, and re-renders with a fresh
 * Provider value the instant the daemon pushes a new status — every open XP
 * Farm window sees it in lockstep, no polling needed.
 *
 * Same catch as `ns-queue-context.ts`: since React is a runtime global here
 * rather than an imported package, the Context object has to be created
 * from that runtime reference. `initXpFarmStatusContext` does that once (see
 * `ui/components/app-grid.tsx`), and `useXpFarmStatus` is the hook
 * descendant components call to read the value it provides.
 */
let XpFarmStatusContext: any = null
let ReactRef: any = null

export function initXpFarmStatusContext(React: any) {
  ReactRef = React
  XpFarmStatusContext = React.createContext(null)
  return XpFarmStatusContext
}

/**
 * Reads the daemon's last-reported XP Farm status, kept fresh via
 * `cgd.store` and provided by the nearest `XpFarmStatusContext.Provider`
 * (set up in `ui/components/app-grid.tsx`).
 */
export function useXpFarmStatus(): XpFarmStatus {
  if (!XpFarmStatusContext) {
    throw new Error('useXpFarmStatus() called before initXpFarmStatusContext() ran')
  }
  const status = ReactRef.useContext(XpFarmStatusContext)
  if (!status) {
    throw new Error('useXpFarmStatus() called outside of an XpFarmStatusContext.Provider')
  }
  return status
}
