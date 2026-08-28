import type { CgdTier } from '../../cgd/types'

/**
 * React's equivalent of Vue's provide/inject (see `ns-queue-context.ts` for
 * the fuller explanation) for the currently-running `cgd` daemon's tier.
 *
 * Fetched once by `ui.app.ts` right after mount (`daemon._getTier()` — a
 * plain property read, not an `ns.*` call) and provided from
 * `ui/components/app-grid.tsx`, the same way `ownedSF`/`currentNode` are:
 * none of these can change without either a fresh `ui.app.js` launch (tier)
 * or a BitNode/aug reset (SF/node) to notice, so there's no poller here,
 * just a value fixed for the life of this mount. An app whose `isAvailable`
 * needs it — see `ui/apps/task-manager/logic/use-task-manager.ts`'s
 * `appAvailable`, which assembles its own `AppAvailabilityContext` — reads
 * it with `useDaemonTier()` instead of needing raw `window`/`cgd` access
 * threaded through as a prop.
 *
 * Same catch as `ns-queue-context.ts`: since React is a runtime global here
 * rather than an imported package, the Context object has to be created
 * from that runtime reference. `initDaemonTierContext` does that once (see
 * `ui/components/app-grid.tsx`), and `useDaemonTier` is the hook descendant
 * components call to read the value it provides.
 */
let DaemonTierContext: any = null
let ReactRef: any = null

export function initDaemonTierContext(React: any) {
  ReactRef = React
  DaemonTierContext = React.createContext(null)
  return DaemonTierContext
}

/**
 * Reads the currently-running daemon's tier, provided by the nearest
 * `DaemonTierContext.Provider` (set up in `ui/components/app-grid.tsx`).
 */
export function useDaemonTier(): CgdTier {
  if (!DaemonTierContext) {
    throw new Error('useDaemonTier() called before initDaemonTierContext() ran')
  }
  const daemonTier = ReactRef.useContext(DaemonTierContext)
  if (daemonTier == null) {
    throw new Error('useDaemonTier() called outside of a DaemonTierContext.Provider')
  }
  return daemonTier
}
