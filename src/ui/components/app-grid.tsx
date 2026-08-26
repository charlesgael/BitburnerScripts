import { AppDefinition, ReactGlobals } from "../types";
import { initNsQueueContext } from "../context/ns-queue-context";
import { initChildPidsContext } from "../context/child-pids-context";
import { initHomeRamContext, HomeRam } from "../context/home-ram-context";
import { QueuedNS } from "../utils/ns-proxy";
import { ramShortfallReason, isAppVisible } from "../utils/app-availability";

interface OpenWindow {
    id: string;
    x: number;
    y: number;
    z: number;
    refreshCount: number;
    /** The app's `preferredWidth`/`preferredHeight` (see `ui/types.ts`),
     * captured once at open time. Applied to the DOM node imperatively via
     * a `ref` (see `sizeWindowNode` below) rather than through React's
     * `style` prop, so it only ever sets the *starting* size — if it were
     * a normal style prop, every re-render (e.g. every mousemove while
     * dragging the title bar) would reassert it and stomp whatever size
     * the player dragged the window's own resize handle to. */
    width?: number;
    height?: number;
}

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
    globals: ReactGlobals,
    container: any,
    apps: AppDefinition[],
    queuedNs: QueuedNS,
    addChildPid: (pid: number) => void
) {
    const { React, ReactDOM, doc } = globals;

    // Provides the queued `ns` proxy, the child-pid tracker, and `home`'s
    // live RAM to every app's Content component via context, so none of
    // them need to be passed down as an explicit prop from here.
    const NsQueueContext = initNsQueueContext(React);
    const ChildPidsContext = initChildPidsContext(React);
    const HomeRamContext = initHomeRamContext(React);

    const state: { windows: OpenWindow[] } = { windows: [] };
    // Updated by ui.app.ts's main loop via setHomeRam (see
    // ui/utils/home-ram-poller.ts) — a fresh object each time so
    // HomeRamContext's consumers see the change.
    let homeRam: HomeRam = { used: 0, max: 0 };
    // Set once via setResetInfo (see below) — ui.app.ts fetches this once at
    // startup from ns.getResetInfo() (1 GB, safe to reference directly
    // there) rather than polling it: neither can change without a BitNode/
    // aug reset, which kills this script too.
    let ownedSF: Map<number, number> = new Map();
    let currentNode = 0;
    let focusedId: string | null = null;
    let nextZ = 0;

    // Two different rules, two different treatments in the grid below (see
    // `ui/utils/app-availability.ts`'s own header comments for why they're
    // split): `minRam` shows the icon disabled with a reason (something the
    // player can fix mid-session), while `minSourceFile`/`isAvailable`
    // leaves the icon out of the grid entirely. Both re-evaluated on every
    // render since `homeRam`/`ownedSF`/`currentNode` change live.
    function ramReason(app: AppDefinition): string | null {
        return ramShortfallReason(app, { homeRam, ownedSF, currentNode });
    }
    function visible(app: AppDefinition): boolean {
        return isAppVisible(app, { homeRam, ownedSF, currentNode });
    }

    function openApp(id: string) {
        const existing = state.windows.find((w) => w.id === id);
        if (existing) {
            bringToFront(id);
            return;
        }
        const app = apps.find((a) => a.id === id);
        // Belt-and-suspenders alongside the disabled/hidden icon below —
        // this is what actually stops the window from opening.
        if (app && (!visible(app) || ramReason(app))) return;
        // Cascade each new window a bit further down/right than the last,
        // wrapping so a long session doesn't march windows off-screen.
        const offset = (state.windows.length % 8) * 28;
        state.windows.push({
            id,
            x: 280 + offset,
            y: 80 + offset,
            z: ++nextZ,
            refreshCount: 0,
            width: app?.preferredWidth,
            height: app?.preferredHeight,
        });
        focusedId = id;
        render();
    }

    // Applies a window's preferred starting size (if any) to its DOM node
    // exactly once, imperatively — see the `width`/`height` comment on
    // `OpenWindow` for why this can't just be a normal React style prop.
    // The `node.style.width` check is what makes this idempotent: it's
    // re-run as a ref callback on every render (see below), but only ever
    // acts the first time, before either this or a native resize-handle
    // drag has put an explicit width/height on the node.
    function sizeWindowNode(win: OpenWindow, node: any) {
        if (!node || node.style.width) return;
        if (win.width) node.style.width = `${win.width}px`;
        if (win.height) node.style.height = `${win.height}px`;
    }

    function closeApp(id: string) {
        state.windows = state.windows.filter((w) => w.id !== id);
        if (focusedId === id) focusedId = null;
        render();
    }

    // Forces the app's Content component to remount (see the `key` used
    // below) rather than trying to poke each app into refetching itself —
    // every app already fetches fresh data in a mount-time `useEffect`
    // (see e.g. `cloud-servers.tsx`'s "remounts every time the window is
    // opened" comment), so remounting is a generic recompute that works
    // for any app without each one needing its own refresh plumbing.
    function refreshApp(id: string) {
        const win = state.windows.find((w) => w.id === id);
        if (!win) return;
        win.refreshCount++;
        render();
    }

    // Called from ui.app.ts's main loop (via ui/utils/home-ram-poller.ts)
    // whenever `home`'s used/max RAM changes — re-renders with a new
    // HomeRamContext value, so every open app window reading useHomeRam()
    // picks it up without polling for itself.
    function setHomeRam(used: number, max: number) {
        homeRam = { used, max };
        render();
    }

    // Called once from ui.app.ts, right after ns.getResetInfo() resolves at
    // startup (see that file) — no poller needed since neither piece can
    // change without a reset that kills this script too (see `ownedSF`
    // above).
    function setResetInfo(sf: Map<number, number>, node: number) {
        ownedSF = sf;
        currentNode = node;
        render();
    }

    function bringToFront(id: string) {
        const win = state.windows.find((w) => w.id === id);
        if (!win) return;
        win.z = ++nextZ;
        focusedId = id;
        render();
    }

    // --- Dragging: plain mousedown/mousemove/mouseup on `doc`, since a
    // drag can move the pointer outside the window's own DOM node.
    let drag: {
        id: string;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
    } | null = null;

    function onDragMove(ev: MouseEvent) {
        if (!drag) return;
        const win = state.windows.find((w) => w.id === drag!.id);
        if (!win) return;
        win.x = Math.max(0, drag.originX + (ev.clientX - drag.startX));
        win.y = Math.max(0, drag.originY + (ev.clientY - drag.startY));
        render();
    }

    function onDragEnd() {
        drag = null;
        doc.body.style.userSelect = "";
        doc.removeEventListener("mousemove", onDragMove);
        doc.removeEventListener("mouseup", onDragEnd);
    }

    function startDrag(id: string, ev: any) {
        bringToFront(id);
        const win = state.windows.find((w) => w.id === id);
        if (!win) return;
        drag = {
            id,
            startX: ev.clientX,
            startY: ev.clientY,
            originX: win.x,
            originY: win.y,
        };
        doc.body.style.userSelect = "none"; // avoid selecting page text while dragging fast
        doc.addEventListener("mousemove", onDragMove);
        doc.addEventListener("mouseup", onDragEnd);
    }

    function onKeyDown(ev: KeyboardEvent) {
        if (ev.key === "Escape" && focusedId) closeApp(focusedId);
    }
    doc.addEventListener("keydown", onKeyDown);

    function render() {
        // Apps failing minSourceFile/isAvailable are left out of the icon
        // list entirely (see visible() above) — filter before map rather
        // than returning null from within it, so there's no gap left in the
        // grid where a hidden icon would've sat.
        const icons = apps.filter(visible).map((app) => {
            const reason = ramReason(app);
            return (
                <button
                    key={app.id}
                    onClick={() => openApp(app.id)}
                    disabled={reason != null}
                    title={reason ?? app.label}
                    className="bb-icon-btn"
                >
                    <span style={{ fontSize: "18px", lineHeight: 1 }}>
                        {app.icon}
                    </span>
                    <span
                        style={{
                            fontSize: "11px",
                            opacity: 0.85,
                            textAlign: "center",
                        }}
                    >
                        {app.label}
                    </span>
                </button>
            );
        });

        const grid = (
            <div
                key="grid"
                className="un-scale"
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))",
                    gap: "8px",
                    padding: "8px",
                }}
            >
                {icons}
            </div>
        );

        const windows = state.windows.map((win) => {
            const app = apps.find((a) => a.id === win.id);
            if (!app) return null;

            return (
                <div
                    key={win.id}
                    ref={(node: any) => sizeWindowNode(win, node)}
                    onMouseDown={() => bringToFront(win.id)}
                    className="un-scale bb-window"
                    style={{
                        position: "fixed",
                        left: `${win.x}px`,
                        top: `${win.y}px`,
                        zIndex: 20000 + win.z,
                        minWidth: `${app.minWidth ?? 280}px`,
                        maxWidth: "90vw",
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
                        maxHeight: "calc(100vh - 40px)",
                        overflow: "hidden",
                        resize: "both",
                        display: "flex",
                        flexDirection: "column",
                    }}
                >
                    <div
                        // Title bar: drag handle + close button.
                        onMouseDown={(ev: any) => startDrag(win.id, ev)}
                        className="bb-window-titlebar"
                    >
                        <span>
                            {app.icon} {app.label}
                        </span>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0px",
                            }}
                        >
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
                            padding: "12px",
                            // Grow to fill whatever height the outer window
                            // (native-resized or viewport-capped) leaves
                            // available, and scroll internally rather than
                            // letting content spill past the window's own
                            // bottom edge. `minHeight: 0` is required for a
                            // flex child to actually shrink below its
                            // content's natural size instead of forcing the
                            // window taller than its maxHeight.
                            flex: "1 1 auto",
                            minHeight: 0,
                            overflowY: "auto",
                        }}
                    >
                        {/* Keying on refreshCount forces React to unmount and
                        remount the app's Content on refresh, re-running its
                        mount-time effects instead of leaving stale state in
                        place. */}
                        <app.Content
                            key={`${win.id}-${win.refreshCount}`}
                            React={React}
                        />
                    </div>
                </div>
            );
        });

        ReactDOM.render(
            <NsQueueContext.Provider value={queuedNs}>
                <ChildPidsContext.Provider value={addChildPid}>
                    <HomeRamContext.Provider value={homeRam}>
                        <hr
                            className="MuiDivider-root MuiDivider-fullWidth css-8dakje"
                            style={{ margin: "0 -16px" }}
                        />
                        {grid}
                        {windows}
                    </HomeRamContext.Provider>
                </ChildPidsContext.Provider>
            </NsQueueContext.Provider>,
            container
        );
    }

    function destroy() {
        doc.removeEventListener("keydown", onKeyDown);
        doc.removeEventListener("mousemove", onDragMove);
        doc.removeEventListener("mouseup", onDragEnd);
    }

    return { render, destroy, setHomeRam, setResetInfo };
}
