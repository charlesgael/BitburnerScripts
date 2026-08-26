import { theme, wrapText } from "../../../utils/theme";
import { CloudServerRow } from "../../../utils/cloud-list";
import {
    XP_FARM_GROW_SCRIPT,
    XP_FARM_WEAKEN_SCRIPT,
} from "../../../utils/xp-farm-config";
import { XpFarmState } from "../logic/use-xp-farm";
import { buttonStyle } from "./styles";

// The clickable "Ng"/"Mw" thread counts in each card's status line — styled
// as an inline text link rather than a button, since it sits inside a
// plain sentence rather than its own row.
const linkStyle = {
    textDecoration: "underline",
    cursor: "pointer",
};

/** One dedicated (or dedicatable) server's card: hostname/RAM + Enable/
 * Disable, and — once enabled — its current target/thread status line. */
export function ServerCard({
    React,
    xf,
    s,
}: {
    React: any;
    xf: XpFarmState;
    s: CloudServerRow;
}) {
    const isEnabled = xf.enabled.has(s.hostname);
    const isOccupied = xf.busyHost === s.hostname;
    const assignment = xf.status[s.hostname];

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                padding: "8px",
                fontSize: "12px",
                background: theme.well,
                border: `1px solid ${theme.primaryDark}`,
                borderRadius: "6px",
                minWidth: 0,
            }}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "8px",
                }}
            >
                <span style={{ ...wrapText, flex: 1 }}>
                    {s.hostname} ({s.ram} GB)
                </span>
                <button
                    onClick={() => void xf.toggle(s.hostname)}
                    disabled={isOccupied}
                    style={buttonStyle(isEnabled)}
                >
                    {isOccupied ? "..." : isEnabled ? "Disable" : "Enable"}
                </button>
            </div>
            {isEnabled ? (
                <div style={{ fontSize: "11px", opacity: 0.75, ...wrapText }}>
                    {assignment ? (
                        <span>
                            → {assignment.target} (
                            {assignment.growThreads > 0 ? (
                                <span
                                    onClick={() =>
                                        void xf.openLoopLog(
                                            XP_FARM_GROW_SCRIPT,
                                            s.hostname,
                                            assignment.target
                                        )
                                    }
                                    title="Open this host's grow loop log"
                                    style={linkStyle}
                                >
                                    {assignment.growThreads}g
                                </span>
                            ) : (
                                `${assignment.growThreads}g`
                            )}
                            {" / "}
                            {assignment.weakenThreads > 0 ? (
                                <span
                                    onClick={() =>
                                        void xf.openLoopLog(
                                            XP_FARM_WEAKEN_SCRIPT,
                                            s.hostname,
                                            assignment.target
                                        )
                                    }
                                    title="Open this host's weaken loop log"
                                    style={linkStyle}
                                >
                                    {assignment.weakenThreads}w
                                </span>
                            ) : (
                                `${assignment.weakenThreads}w`
                            )}
                            )
                        </span>
                    ) : (
                        "→ starting…"
                    )}
                </div>
            ) : null}
        </div>
    );
}
