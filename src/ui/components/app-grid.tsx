import { AppDefinition, ReactGlobals } from "../types";
import { initNsQueueContext } from "../context/ns-queue-context";
import { initChildPidsContext } from "../context/child-pids-context";
import { initHomeRamContext, HomeRam } from "../context/home-ram-context";
import { QueuedNS } from "../utils/ns-proxy";
import { theme } from "../utils/theme";

interface OpenWindow {
    id: string;
    x: number;
    y: number;
    z: number;
    refreshCount: number;
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
    let focusedId: string | null = null;
    let nextZ = 0;

    function openApp(id: string) {
        const existing = state.windows.find((w) => w.id === id);
        if (existing) {
            bringToFront(id);
            return;
        }
        // Cascade each new window a bit further down/right than the last,
        // wrapping so a long session doesn't march windows off-screen.
        const offset = (state.windows.length % 8) * 28;
        state.windows.push({ id, x: 280 + offset, y: 80 + offset, z: ++nextZ, refreshCount: 0 });
        focusedId = id;
        render();
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

    function bringToFront(id: string) {
        const win = state.windows.find((w) => w.id === id);
        if (!win) return;
        win.z = ++nextZ;
        focusedId = id;
        render();
    }

    // --- Dragging: plain mousedown/mousemove/mouseup on `doc`, since a
    // drag can move the pointer outside the window's own DOM node.
    let drag: { id: string; startX: number; startY: number; originX: number; originY: number } | null = null;

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
        drag = { id, startX: ev.clientX, startY: ev.clientY, originX: win.x, originY: win.y };
        doc.body.style.userSelect = "none"; // avoid selecting page text while dragging fast
        doc.addEventListener("mousemove", onDragMove);
        doc.addEventListener("mouseup", onDragEnd);
    }

    function onKeyDown(ev: KeyboardEvent) {
        if (ev.key === "Escape" && focusedId) closeApp(focusedId);
    }
    doc.addEventListener("keydown", onKeyDown);

    function render() {
        const icons = apps.map((app) => (
            <button
                key={app.id}
                onClick={() => openApp(app.id)}
                title={app.label}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "2px",
                    background: theme.backgroundPrimary,
                    border: `1px solid ${theme.primary}`,
                    borderRadius: "6px",
                    color: theme.primary,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    padding: "6px 2px",
                }}
            >
                <span style={{ fontSize: "18px", lineHeight: 1 }}>{app.icon}</span>
                <span style={{ fontSize: "9px", opacity: 0.85, textAlign: "center" }}>{app.label}</span>
            </button>
        ));

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
                    onMouseDown={() => bringToFront(win.id)}
                    className="un-scale"
                    style={{
                        position: "fixed",
                        left: `${win.x}px`,
                        top: `${win.y}px`,
                        zIndex: 20000 + win.z,
                        background: theme.backgroundPrimary,
                        border: `1px solid ${theme.primary}`,
                        borderRadius: "8px",
                        color: theme.primary,
                        fontFamily: "Consolas, monospace",
                        minWidth: "280px",
                        maxWidth: "420px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                        display: "flex",
                        flexDirection: "column",
                    }}
                >
                    <div
                        // Title bar: drag handle + close button.
                        onMouseDown={(ev: any) => startDrag(win.id, ev)}
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "8px 10px",
                            borderBottom: `1px solid ${theme.primaryDark}`,
                            cursor: "move",
                            fontWeight: "bold",
                            userSelect: "none",
                        }}
                    >
                        <span>
                            {app.icon} {app.label}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <button
                                // Dragging starts on the title bar's mousedown before
                                // this click fires — stop it from also being read as
                                // a drag-start on the button itself.
                                onMouseDown={(ev: any) => ev.stopPropagation()}
                                onClick={() => refreshApp(win.id)}
                                title="Refresh"
                                style={{
                                    background: "transparent",
                                    border: "none",
                                    color: theme.primary,
                                    cursor: "pointer",
                                    fontSize: "14px",
                                    fontFamily: "inherit",
                                }}
                            >
                                🗘
                            </button>
                            <button
                                onMouseDown={(ev: any) => ev.stopPropagation()}
                                onClick={() => closeApp(win.id)}
                                title="Close"
                                style={{
                                    background: "transparent",
                                    border: "none",
                                    color: theme.error,
                                    cursor: "pointer",
                                    fontSize: "14px",
                                    fontFamily: "inherit",
                                }}
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                    <div style={{ padding: "12px" }}>
                        {/* Keying on refreshCount forces React to unmount and
                        remount the app's Content on refresh, re-running its
                        mount-time effects instead of leaving stale state in
                        place. */}
                        <app.Content key={`${win.id}-${win.refreshCount}`} React={React} />
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

    return { render, destroy, setHomeRam };
}
