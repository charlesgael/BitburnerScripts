import { ReactGlobals } from "../types";
import { theme } from "../utils/theme";

/**
 * Floating status panel: a live status line plus "Restart" and
 * "Kill && Cleanup" buttons.
 *
 * Both buttons only flip a flag via their callback — they don't touch
 * React/DOM/ns directly, since doing real work from inside a React event
 * handler races with React's own reconciliation and throws a concurrency
 * error. The caller's main loop notices the flag, returns, and real cleanup
 * happens via `ns.atExit` (see `ui/utils/mount.ts#unmountContainer`); for
 * restart specifically, the caller also does the actual `ns.spawn(...)`
 * after that loop has stopped (see `ui.app.ts`).
 */
export function createStatusPanel(
    globals: ReactGlobals,
    container: any,
    onStop: () => void,
    onRestart: () => void
) {
    const { React, ReactDOM } = globals;

    function render(statusText?: string) {
        ReactDOM.render(
            <div style={{ padding: "0 16px" }}>
                <hr className="MuiDivider-root MuiDivider-fullWidth css-8dakje" style={{ margin: "0 -16px 8px" }} />
                <div style={{ marginBottom: "8px", fontWeight: "bold" }}>Bitburner UI</div>
                <div style={{ marginBottom: "10px", opacity: 0.85 }}>{statusText ?? "Running..."}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <button
                        onClick={onRestart}
                        style={{
                            background: theme.button,
                            color: theme.primary,
                            border: `1px solid ${theme.primary}`,
                            borderRadius: "4px",
                            padding: "4px 10px",
                            cursor: "pointer",
                            fontFamily: "inherit",
                        }}
                    >
                        Restart
                    </button>
                    <button
                        onClick={onStop}
                        style={{
                            background: theme.errorDark,
                            color: theme.error,
                            border: `1px solid ${theme.error}`,
                            borderRadius: "4px",
                            padding: "4px 10px",
                            cursor: "pointer",
                            fontFamily: "inherit",
                        }}
                    >
                        Quit
                    </button>
                </div>
            </div>,
            container
        );
    }

    return { render };
}
