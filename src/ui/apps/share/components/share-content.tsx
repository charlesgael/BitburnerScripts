import { AppComponentProps } from "../../../types";
import { useShare } from "../logic/use-share";
import { ShareHostCard } from "./share-host-card";

/** Root component: the refresh header and the per-host card grid. See
 * `../index.ts`'s header comment for what this app does and why. */
export function ShareContent({ React }: AppComponentProps) {
    const share = useShare(React);

    return (
        <div>
            <div
                style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    fontSize: "12px",
                    marginBottom: "8px",
                }}
            >
                <button
                    onClick={() => void share.refresh()}
                    disabled={share.loading}
                    className="bb-btn"
                >
                    {share.loading ? "..." : "Refresh"}
                </button>
            </div>

            {share.error ? (
                <div
                    className="bb-text-error bb-wrap"
                    style={{
                        fontSize: "11px",
                        marginBottom: "8px",
                    }}
                >
                    {share.error}
                </div>
            ) : null}

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: "8px",
                }}
            >
                {share.hosts.map((host) => (
                    <ShareHostCard
                        key={host.hostname}
                        React={React}
                        ns={share.ns}
                        host={host}
                        onUsedRamChange={share.updateCloudUsedRam}
                    />
                ))}
            </div>
        </div>
    );
}
