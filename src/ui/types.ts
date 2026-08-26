/**
 * Shared types for the ui/ tree.
 */

/** The game's exposed React/ReactDOM globals, plus the document/window they
 * came from. Grabbed once via `getReactGlobals` and threaded through to
 * every component that needs to render. */
export interface ReactGlobals {
    doc: any;
    win: any;
    React: any;
    ReactDOM: any;
}

/** Shorthand for `React.createElement`. */
export type ReactCreateElement = (type: any, props?: any, ...children: any[]) => any;

/** Props every app's `Content` component receives. */
export interface AppComponentProps {
    /** The runtime React object (`window.React`) — use it for
     * `React.createElement`, and for hooks like `React.useState`. For ns
     * calls, use the `useQueuedNs()` hook (see
     * `ui/context/ns-queue-context.ts`) instead of calling ns directly. */
    React: any;
}

/**
 * One entry in the sidebar app grid. Register new apps in `ui/apps/index.ts`
 * — the grid and modal in `ui/components/app-grid.tsx` don't need to change.
 */
export interface AppDefinition {
    id: string;
    icon: string;
    label: string;
    /** The app's modal body. Rendered as a real React component (via
     * `e(app.Content, props)`) rather than called directly, so it can use
     * hooks — e.g. `useQueuedNs()` for ns.* calls, `React.useState` for
     * local state. */
    Content: (props: AppComponentProps) => any;
    /** Initial window size (CSS px) when this app is opened, e.g. an app
     * whose content is a wide responsive grid (see `cloud-servers.tsx`)
     * can ask to start wider than the default so it opens already showing
     * multiple columns instead of the single-column fallback width. Purely
     * a starting point — `ui/components/app-grid.tsx`'s window is still
     * freely resizable (drag the bottom-right corner) and still clamped to
     * the same `minWidth`/`maxWidth`/`maxHeight` every window gets, so an
     * omitted or oversized value just falls back to that default sizing
     * rather than breaking layout. */
    preferredWidth?: number;
    preferredHeight?: number;
    /** Per-app floor for the window's resizable size (CSS px), for an app
     * whose content breaks down (e.g. a table or grid mangling) below the
     * shared 280×120 default every other app gets — see the `minWidth`/
     * `minHeight` clamp in `ui/components/app-grid.tsx`. Omit to just use
     * that default; only raise this, never below it. */
    minWidth?: number;
    minHeight?: number;
    /** Optional floor on `home`'s max RAM (GB) below which this app isn't
     * worth opening at all — distinct from a specific action's actual RAM
     * cost, which individual apps already check for themselves once open
     * (e.g. `trainer.tsx`'s `insufficientRam`, checked against the daemon's
     * real measured cost). When set, unless 80% of `home`'s current max RAM
     * is at least this much (leaving the other 20% as headroom for whatever
     * else is already running there), the app is unavailable — see
     * `ui/utils/app-availability.ts`. Omit for apps with no such floor. */
    minRam?: number;
    /** Optional required active level of a numbered Source-File, e.g.
     * `{ n: 4, lvl: 1 }` for anything gated on Singularity access. Checked
     * against `ns.getResetInfo().ownedSF` — see
     * `ui/utils/app-availability.ts`. Omit for apps with no SF requirement. */
    minSourceFile?: { n: number; lvl: number };
    /** Escape hatch for availability rules `minRam`/`minSourceFile` can't
     * express (e.g. OR-ing multiple conditions, or checking some other
     * player state entirely). Return `true` when the app should be
     * openable, or a string explaining why not — shown as the disabled
     * icon's tooltip in `ui/components/app-grid.tsx`. Evaluated in addition
     * to (AND'd with) `minRam`/`minSourceFile` when those are also set; see
     * `ui/utils/app-availability.ts`. */
    isAvailable?: (ctx: AppAvailabilityContext) => true | string;
}

/** Live player state `ui/utils/app-availability.ts` checks an app's
 * `minRam`/`minSourceFile`/`isAvailable` against — assembled once in
 * `ui/components/app-grid.tsx` from data `ui.app.ts` already fetches (see
 * that file's `setHomeRam`/`setOwnedSF`), not from a fresh `ns.*` call of
 * its own. */
export interface AppAvailabilityContext {
    homeRam: { used: number; max: number };
    /** SF number → active level, straight from `ns.getResetInfo().ownedSF`.
     * A source file not present in the map (or present at level 0) counts
     * as not owned — same convention `ResetInfo.ownedSF` itself documents. */
    ownedSF: Map<number, number>;
    /** `ns.getResetInfo().currentNode` — the BitNode currently being played.
     * Mainly here for `isAvailable` lambdas gating on Singularity access:
     * `ns.singularity.*` also works without owning SF4 yet while playing
     * inside BitNode 4 itself (the "Singularity" BitNode), which a plain
     * `minSourceFile: { n: 4, lvl: 1 }` can't express — see
     * `ui/apps/trainer/`. */
    currentNode: number;
}
