import type { CgdQueue } from '../../cgd/types'

/**
 * React's equivalent of Vue's provide/inject (see `ns-queue-context.ts` for
 * the fuller explanation) for the running daemon's `enqueueAction` — the
 * compound-operation half of `cgd.daemon.queue` (see `cgd/types.ts`'s
 * `CgdActionHandler`), alongside `useQueuedNs()`'s raw single-method
 * dispatch. Provided from `ui/components/app-grid.tsx`, bound to whichever
 * daemon was registered at mount time — like `useQueuedNs()`, this stops
 * working (rejects) if that daemon later stops; a fresh `ui.app.js` launch
 * is what picks up a new one.
 *
 * Same catch as `ns-queue-context.ts`: since React is a runtime global here
 * rather than an imported package, the Context object has to be created
 * from that runtime reference. `initCgdActionsContext` does that once (see
 * `ui/components/app-grid.tsx`), and `useCgdActions` is the hook descendant
 * components call to read the value it provides.
 */
let CgdActionsContext: any = null
let ReactRef: any = null

export function initCgdActionsContext(React: any) {
  ReactRef = React
  CgdActionsContext = React.createContext(null)
  return CgdActionsContext
}

/**
 * Returns the running daemon's `enqueueAction(name, args)` — e.g.
 * `await useCgdActions()("cloudList", [])`. Most call sites will want a
 * small typed wrapper (see `ui/utils/cloud-list.ts`'s `fetchCloudList`)
 * rather than calling this directly with a bare action-name string.
 */
export function useCgdActions(): CgdQueue['enqueueAction'] {
  if (!CgdActionsContext) {
    throw new Error('useCgdActions() called before initCgdActionsContext() ran')
  }
  const enqueueAction = ReactRef.useContext(CgdActionsContext)
  if (!enqueueAction) {
    throw new Error('useCgdActions() called outside of a CgdActionsContext.Provider')
  }
  return enqueueAction
}
