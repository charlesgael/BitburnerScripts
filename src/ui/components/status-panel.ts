import { ReactGlobals } from "../types";
import { theme } from "../utils/theme";

/**
 * Floating status panel: a live status line plus a "Kill && Cleanup" button.
 *
 * The button only calls `onStop` to flip a flag — it does not touch
 * React/DOM directly, since tearing down from inside a React event handler
 * races with React's own reconciliation and throws a concurrency error. The
 * caller's main loop notices the flag, returns, and real cleanup happens via
 * `ns.atExit` (see `ui/utils/mount.ts#unmountContainer`).
 */
export function createStatusPanel(globals: ReactGlobals, container: any, onStop: () => void) {
    const { React, ReactDOM } = globals;

    function render(statusText?: string) {
        const e = React.createElement;
        ReactDOM.render(
            e(
                "div",
                { style: { padding: "0 16px"} },
                e("div", { style: { marginBottom: "8px", fontWeight: "bold" } }, "Bitburner UI"),
                e("div", { style: { marginBottom: "10px", opacity: 0.85 } }, statusText ?? "Running..."),
                e(
                    "button",
                    {
                        onClick: onStop,
                        style: {
                            background: theme.errorDark,
                            color: theme.error,
                            border: `1px solid ${theme.error}`,
                            borderRadius: "4px",
                            padding: "4px 10px",
                            cursor: "pointer",
                            fontFamily: "inherit",
                        },
                    },
                    "Kill && Cleanup"
                )
            ),
            container
        );
    }

    return { render };
}
