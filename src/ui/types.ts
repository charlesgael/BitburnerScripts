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
}
