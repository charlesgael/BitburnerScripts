import { AppComponentProps } from "../../../types";
import { theme, wrapText } from "../../../utils/theme";
import { CloudServerRow } from "../../../utils/cloud-list";
import { useXpFarm } from "../logic/use-xp-farm";
import { buttonStyle } from "./styles";
import { ServerCard } from "./server-card";

/** Root component: the dedicated-count/refresh header, the daemon status
 * row, and the per-server card grid. See `../index.ts`'s header comment
 * for what this app does and why. */
export function XpFarmContent({ React }: AppComponentProps) {
    const xf = useXpFarm(React);

    // A CSS grid of cards rather than a stacked list — same idea and same
    // 260px column width as the Cloud Servers app's own server grid (see
    // `ui/apps/cloud-servers/index.ts`'s header comment on its grid):
    // `auto-fill` + `minmax` wraps however many currently fit, so widening
    // the window reflows into more columns instead of a fixed-width list
    // stranded in empty space.
    const cards = xf.servers.map((s: CloudServerRow) => (
        <ServerCard key={s.hostname} React={React} xf={xf} s={s} />
    ));

    return (
        <div>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "12px",
                    marginBottom: "8px",
                }}
            >
                <span>Dedicated: {xf.enabled.size}</span>
                <button
                    onClick={() => void xf.refresh()}
                    disabled={xf.loading}
                    style={buttonStyle()}
                >
                    {xf.loading ? "..." : "Refresh"}
                </button>
            </div>

            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "12px",
                    marginBottom: "10px",
                    paddingBottom: "8px",
                    borderBottom: `1px solid ${theme.well}`,
                }}
            >
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                    }}
                >
                    Daemon: {xf.daemonRunning ? "Running" : "Stopped"}
                </span>
                <div style={{ display: "flex", gap: "6px" }}>
                    {xf.daemonRunning ? (
                        <button
                            onClick={() => void xf.openLog()}
                            title="Open the daemon's log window"
                            style={buttonStyle(false, true)}
                        >
                            📃
                        </button>
                    ) : null}
                    <button
                        onClick={() => void xf.toggleDaemon()}
                        disabled={xf.daemonBusy}
                        style={buttonStyle(xf.daemonRunning)}
                    >
                        {xf.daemonBusy
                            ? "..."
                            : xf.daemonRunning
                            ? "Kill"
                            : "Spawn"}
                    </button>
                </div>
            </div>

            {xf.error ? (
                <div
                    style={{
                        color: theme.error,
                        fontSize: "11px",
                        marginBottom: "8px",
                        ...wrapText,
                    }}
                >
                    {xf.error}
                </div>
            ) : null}

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns:
                        "repeat(auto-fill, minmax(260px, 1fr))",
                    gap: "8px",
                }}
            >
                {xf.servers.length === 0 && !xf.loading ? (
                    <div
                        style={{
                            gridColumn: "1 / -1",
                            fontSize: "12px",
                            opacity: 0.7,
                        }}
                    >
                        No purchased servers yet — buy one in the Cloud Servers
                        app first.
                    </div>
                ) : (
                    cards
                )}
            </div>
        </div>
    );
}
