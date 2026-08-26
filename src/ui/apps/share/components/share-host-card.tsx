import { theme, wrapText } from "../../../utils/theme";
import { ShareHost } from "../logic/types";
import { useShareHostCard } from "../logic/use-share-host-card";

/** One host's share card: usage bar, thread-tier picker (or the running
 * thread count while sharing), and its Start/Stop Sharing button. */
export function ShareHostCard({
    React,
    ns,
    host,
    onUsedRamChange,
}: {
    React: any;
    ns: any;
    host: ShareHost;
    onUsedRamChange: (hostname: string, usedRam: number) => void;
}) {
    const card = useShareHostCard(React, ns, host, onUsedRamChange);

    const fieldStyle = {
        background: theme.well,
        color: theme.primary,
        border: `1px solid ${theme.primary}`,
        borderRadius: "4px",
        padding: "4px",
        fontFamily: "inherit",
        width: "100%",
    };

    const buttonStyle = (danger = false) => ({
        width: "100%",
        background: danger ? theme.errorDark : theme.button,
        color: danger ? theme.error : theme.primary,
        border: `1px solid ${danger ? theme.error : theme.primary}`,
        borderRadius: "4px",
        padding: "6px 10px",
        cursor: card.busy ? "default" : "pointer",
        opacity: card.busy ? 0.6 : 1,
        fontFamily: "inherit",
    });

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
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
                    gap: "8px",
                }}
            >
                <span style={{ ...wrapText, flex: 1, fontWeight: "bold" }}>{host.hostname}</span>
                <span style={{ opacity: 0.75 }}>
                    {host.usedRam.toFixed(1)} / {host.maxRam.toFixed(1)} GB
                </span>
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
                        width: `${host.usedRam}%`,
                        background: host.usedRam > 90 ? theme.error : theme.primary,
                        transition: "width 0.2s ease",
                    }}
                />
            </div>

            {host.isHome ? (
                <div style={{ fontSize: "10px", opacity: 0.6 }}>{card.reservedRam.toFixed(1)} GB kept in reserve</div>
            ) : null}

            {card.error ? <div style={{ color: theme.error, ...wrapText }}>{card.error}</div> : null}

            {card.insufficientRam ? (
                <div
                    style={{
                        color: theme.error,
                        fontSize: "11px",
                        ...wrapText,
                    }}
                >
                    Needs at least {card.costPerThread.toFixed(2)} GB shareable to share a single thread — only{" "}
                    {card.shareableRam.toFixed(2)} GB is shareable here.
                </div>
            ) : (
                <React.Fragment>
                    {!card.sharing ? (
                        <select
                            value={card.selectedThreads}
                            onChange={(ev: any) => {
                                card.setThreadsChosenByUser(true);
                                card.setSelectedThreads(Number(ev.target.value));
                            }}
                            style={fieldStyle}
                        >
                            {card.tiers.map((threads) => (
                                <option key={threads} value={threads}>
                                    {(threads * card.costPerThread).toFixed(0)} GB — {threads} thread
                                    {threads === 1 ? "" : "s"}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <div>
                            Sharing {(card.runningThreads * card.costPerThread).toFixed(0)} GB — {card.runningThreads} thread
                            {card.runningThreads === 1 ? "" : "s"}.
                        </div>
                    )}
                    <button onClick={() => void card.toggleSharing()} disabled={card.busy} style={buttonStyle(card.sharing)}>
                        {card.busy ? "..." : card.sharing ? "Stop Sharing" : "Start Sharing"}
                    </button>
                </React.Fragment>
            )}
        </div>
    );
}
