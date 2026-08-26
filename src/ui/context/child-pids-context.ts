/**
 * React's equivalent of Vue's provide/inject (see `ns-queue-context.ts` for
 * the fuller explanation) for the running script's child-process tracking.
 *
 * `ui.app.ts` owns `state.childPids` and kills everything left in it from
 * `ns.atExit` on cleanup. Any app that spawns a script — e.g. `ns.exec`/
 * `ns.run` through the queued ns from `ns-queue-context.ts` — calls
 * `useAddChildPid()` to register the resulting pid, so it gets killed
 * along with everything else on cleanup instead of leaking an orphaned
 * script.
 *
 * Same catch as `ns-queue-context.ts`: since React is a runtime global here
 * rather than an imported package, the Context object has to be created
 * from that runtime reference. `initChildPidsContext` does that once (see
 * `ui/components/app-grid.tsx`), and `useAddChildPid` is the hook descendant
 * components call to read the value it provides.
 */
let ChildPidsContext: any = null;
let ReactRef: any = null;

export function initChildPidsContext(React: any) {
    ReactRef = React;
    ChildPidsContext = React.createContext(null);
    return ChildPidsContext;
}

/** Returns a function that registers a spawned script's pid with
 * `state.childPids` (see `ui.app.ts`) so `ns.atExit` kills it on cleanup. */
export function useAddChildPid(): (pid: number) => void {
    if (!ChildPidsContext) {
        throw new Error("useAddChildPid() called before initChildPidsContext() ran");
    }
    const addChildPid = ReactRef.useContext(ChildPidsContext);
    if (!addChildPid) {
        throw new Error("useAddChildPid() called outside of a ChildPidsContext.Provider");
    }
    return addChildPid;
}
