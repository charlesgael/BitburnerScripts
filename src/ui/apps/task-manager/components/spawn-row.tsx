import { theme, wrapText } from "../../../utils/theme";
import { ManagedAppDefinition } from "../logic/types";
import { TaskManagerState } from "../logic/use-task-manager";

/** Same spawn row for both loop apps and one-shot reports: the main button
 * always targets `home` directly — no picker in the way for the common
 * case — and a small "▾" button to its right opens a popup listing only
 * the non-reserved cloud servers with room for this app (and, for a loop
 * app, not already running it — see `useTaskManager`'s `hostOptions`);
 * picking one spawns there instead. A one-shot script often reads a file
 * local to whatever host it runs on (e.g. `backdoor.lite.app.js` reads
 * `known-servers.json.txt`, which `netmapper.app.js` only writes on the
 * host *it* was spawned on) — that's why one-shot apps get the same host
 * choice as loop apps instead of being locked to `home`. Since `tasks`
 * never contains a one-shot app's script, `hostOptions` naturally never
 * excludes a host for one-shot apps as "already running" — only the RAM
 * check applies. */
export function SpawnRow({ React, tm, app }: { React: any; tm: TaskManagerState; app: ManagedAppDefinition }) {
    const required = (tm.appRam[app.script] ?? 0) * (app.threads ?? 1);
    const options = tm.hostOptions(app);
    const homeOption = options.find((o) => o.host === "home");
    const cloudOptions = options.filter((o) => o.host !== "home");
    const alreadyOnHome = tm.tasks.some((t) => t.script === app.script && t.host === "home");
    const isOccupied = tm.spawnBusy.has(app.script);
    const homeDisabled = isOccupied || tm.loading || !homeOption;
    const hasCloudOption = cloudOptions.length > 0;
    const menuOpen = tm.openMenuFor === app.script;

    const runLabel = app.oneShot ? "Run" : "Spawn";
    const mainLabel = isOccupied ? "..." : alreadyOnHome ? "Running" : !homeOption ? "No RAM" : runLabel;
    const mainTitle = alreadyOnHome
        ? "Already running on home — see Running Tasks below"
        : !homeOption
          ? "Not enough free RAM on home"
          : undefined;
    const spawnBorderColor = theme.primary;

    const mainButton = (
        <button
            onClick={() => void tm.spawnTask(app, "home")}
            disabled={homeDisabled}
            title={mainTitle}
            style={{
                minWidth: "60px",
                background: theme.button,
                color: theme.primary,
                borderTop: `1px solid ${spawnBorderColor}`,
                borderBottom: `1px solid ${spawnBorderColor}`,
                borderLeft: `1px solid ${spawnBorderColor}`,
                borderRight: hasCloudOption ? "none" : `1px solid ${spawnBorderColor}`,
                borderRadius: hasCloudOption ? "4px 0 0 4px" : "4px",
                padding: "4px 10px",
                cursor: homeDisabled ? "default" : "pointer",
                opacity: homeDisabled ? 0.6 : 1,
                fontFamily: "inherit",
                fontSize: "12px",
            }}
        >
            {mainLabel}
        </button>
    );

    // A compact "▾" button, to the right of the main button, that toggles a
    // small popup menu listing only the compatible cloud servers — cheaper
    // on space than a native <select>, which always reserves room for its
    // widest option even closed. Wrapped in its own `position: relative`
    // box so the popup (position: absolute) anchors to it; gets a z-index
    // above the click-catching backdrop below only while its menu is open,
    // so the popup — and the arrow button itself, to keep toggling it
    // closed working — aren't hidden behind it.
    const cloudMenuButton = hasCloudOption ? (
        <div
            style={{
                position: "relative",
                display: "flex",
                ...(menuOpen ? { zIndex: 2 } : {}),
            }}
        >
            <button
                onClick={() => tm.setOpenMenuFor(menuOpen ? null : app.script)}
                disabled={isOccupied}
                title="Spawn on a cloud server instead"
                style={{
                    boxSizing: "border-box",
                    background: theme.button,
                    color: theme.primary,
                    border: `1px solid ${theme.primary}`,
                    borderRadius: "0 4px 4px 0",
                    padding: "0 6px",
                    fontFamily: "inherit",
                    fontSize: "10px",
                    cursor: isOccupied ? "default" : "pointer",
                }}
            >
                ▾
            </button>
            {menuOpen ? (
                <div
                    style={{
                        position: "absolute",
                        top: "100%",
                        right: 0,
                        marginTop: "2px",
                        background: theme.well,
                        border: `1px solid ${theme.primary}`,
                        borderRadius: "4px",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                        minWidth: "170px",
                        overflow: "hidden",
                    }}
                >
                    {cloudOptions.map((o) => (
                        <button
                            key={o.host}
                            onClick={() => {
                                tm.setOpenMenuFor(null);
                                void tm.spawnTask(app, o.host);
                            }}
                            style={{
                                display: "block",
                                width: "100%",
                                textAlign: "left",
                                background: "transparent",
                                color: theme.primary,
                                border: "none",
                                borderBottom: `1px solid ${theme.well}`,
                                padding: "6px 8px",
                                cursor: "pointer",
                                fontFamily: "inherit",
                                fontSize: "11px",
                            }}
                        >
                            {o.host} ({o.freeRam.toFixed(1)} GB free)
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    ) : null;

    return (
        <div
            style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "8px",
                padding: "6px 0",
                borderBottom: `1px solid ${theme.well}`,
            }}
        >
            <span style={{ fontSize: "12px", ...wrapText }}>
                {app.label} ({required.toFixed(2)} GB)
            </span>
            <div style={{ display: "flex" }}>
                {mainButton}
                {cloudMenuButton}
            </div>
        </div>
    );
}
