import { QueuedNS } from "../utils/ns-proxy";

/**
 * React's equivalent of Vue's provide/inject: a `Context.Provider` higher
 * in the tree supplies a value, and any descendant component reads it with
 * a hook (`useContext`) instead of the value being threaded through every
 * component's props in between.
 *
 * The catch here: Bitburner's React is a runtime global (`window.React`),
 * not a package this project imports statically, so the Context object
 * can't be created at module-load time the way `createContext` normally
 * is. `initNsQueueContext` creates it once, right after we grab React
 * (see `ui/components/app-grid.tsx`), and `useQueuedNs` is the hook
 * descendant components call to read the value it provides: a queued,
 * `ns`-shaped proxy (see `ui/utils/ns-proxy.ts`).
 *
 * Note: like any hook, `useQueuedNs()` only works inside a function that
 * React itself invokes as a component — i.e. rendered via
 * `e(SomeComponent, props)` — not a plain helper function you call
 * yourself.
 */
let NsQueueContext: any = null;
let ReactRef: any = null;

export function initNsQueueContext(React: any) {
    ReactRef = React;
    NsQueueContext = React.createContext(null);
    return NsQueueContext;
}

/** Reads the queued `ns` proxy provided by the nearest
 * `NsQueueContext.Provider` (set up in `ui/components/app-grid.tsx`). */
export function useQueuedNs(): QueuedNS {
    if (!NsQueueContext) {
        throw new Error("useQueuedNs() called before initNsQueueContext() ran");
    }
    const queuedNs = ReactRef.useContext(NsQueueContext);
    if (!queuedNs) {
        throw new Error("useQueuedNs() called outside of an NsQueueContext.Provider");
    }
    return queuedNs;
}
