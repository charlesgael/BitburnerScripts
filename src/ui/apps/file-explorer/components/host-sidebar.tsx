import { theme, wrapText } from "../../../utils/theme";
import { FileExplorerState } from "../logic/use-file-explorer";

/** The left-hand "drives" list — home, purchased/cloud servers, and any
 * previously-scanned host (see `../index.ts`'s header comment). */
export function HostSidebar({ React, fx }: { React: any; fx: FileExplorerState }) {
    return (
        <div style={{ width: "154px", flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
            {fx.hostsLoading ? (
                <div style={{ opacity: 0.7, fontSize: "11px" }}>Loading…</div>
            ) : (
                fx.hosts.map((h) => (
                    <button
                        key={h.hostname}
                        onClick={() => fx.selectHost(h.hostname)}
                        title={h.hostname}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            textAlign: "left",
                            background: h.hostname === fx.selectedHost ? theme.button : "transparent",
                            color: theme.primary,
                            border: `1px solid ${h.hostname === fx.selectedHost ? theme.primary : "transparent"}`,
                            borderRadius: "4px",
                            padding: "4px 6px",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            fontSize: "11px",
                        }}
                    >
                        <span>{h.icon}</span>
                        <span style={{ ...wrapText, flex: 1 }}>{h.hostname}</span>
                    </button>
                ))
            )}
        </div>
    );
}
