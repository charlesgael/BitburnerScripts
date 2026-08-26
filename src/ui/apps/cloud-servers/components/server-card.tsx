import { theme, wrapText } from "../../../utils/theme";
import { CloudServerRow } from "../../../utils/cloud-list";
import { CloudServersState } from "../logic/use-cloud-servers";
import { buttonStyle } from "./styles";

/** One purchased server's card: hostname + used/total RAM, a thin usage
 * bar, and its Delete button (with an inline confirm step). */
export function ServerCard({ React, cs, s }: { React: any; cs: CloudServersState; s: CloudServerRow }) {
    const usedPct = s.ram > 0 ? Math.min(100, (s.usedRam / s.ram) * 100) : 0;
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
                    {s.hostname} ({s.usedRam.toFixed(1)} / {s.ram} GB)
                </span>
                <button onClick={() => cs.handleDeleteClick(s.hostname)} disabled={cs.busy} style={buttonStyle(true)}>
                    {cs.deleteBusyHost === s.hostname ? "..." : cs.confirmDeleteHost === s.hostname ? "Confirm?" : "Delete"}
                </button>
            </div>
            {/* Thin per-server RAM usage bar. */}
            <div
                style={{
                    position: "relative",
                    height: "3px",
                    borderRadius: "2px",
                    background: theme.backgroundPrimary,
                    border: `1px solid ${theme.primary}`,
                    overflow: "hidden",
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        width: `${usedPct}%`,
                        background: usedPct > 90 ? theme.error : theme.primary,
                        transition: "width 0.2s ease",
                    }}
                />
            </div>
        </div>
    );
}
