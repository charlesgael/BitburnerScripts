import { AppComponentProps } from "../../../types";
import { theme, wrapText } from "../../../utils/theme";
import { CloudServerRow } from "../../../utils/cloud-list";
import { useCloudServers } from "../logic/use-cloud-servers";
import { buttonStyle } from "./styles";
import { ServerCard } from "./server-card";
import { BuyForm } from "./buy-form";

/** Root component: the server count/refresh header, the purchased-server
 * card grid, and the buy form. See `../index.ts`'s header comment for what
 * this app does and why. */
export function CloudServersContent({ React }: AppComponentProps) {
    const cs = useCloudServers(React);

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "10px" }}>
                <span>
                    Servers: {cs.servers.length} / {cs.serverLimit || "?"}
                </span>
                <button onClick={() => void cs.refreshList()} disabled={cs.busy} style={buttonStyle()}>
                    {cs.listLoading ? "..." : "Refresh"}
                </button>
            </div>

            {cs.listError ? (
                <div style={{ color: theme.error, fontSize: "11px", marginBottom: "8px", ...wrapText }}>
                    {cs.listError}
                </div>
            ) : null}

            {/* --- Purchased server list ---
            A CSS grid of cards rather than a stacked list: `auto-fill` +
            `minmax` picks however many ~200px columns currently fit and
            wraps the rest onto new rows, so widening the floating window
            (see the resize handle added in `ui/components/app-grid.tsx`)
            reflows this into more columns instead of leaving a fixed-width
            list stranded in the middle of empty space. 200px keeps each
            card's "hostname (used / total GB)" + Delete button row (the
            original single-column layout) from cramping before it falls
            back to `wrapText`. No max-height/overflow of its own — the
            window's own content area (also in app-grid.tsx) already
            scrolls when everything together doesn't fit. */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                    gap: "8px",
                    marginBottom: "14px",
                }}
            >
                {cs.servers.length === 0 && !cs.listLoading ? (
                    <div style={{ gridColumn: "1 / -1", fontSize: "12px", opacity: 0.7 }}>
                        No purchased servers yet.
                    </div>
                ) : (
                    cs.servers.map((s: CloudServerRow) => <ServerCard key={s.hostname} React={React} cs={cs} s={s} />)
                )}
            </div>

            {cs.deleteError ? (
                <div style={{ color: theme.error, fontSize: "11px", marginBottom: "8px", ...wrapText }}>
                    {cs.deleteError}
                </div>
            ) : null}

            <BuyForm React={React} cs={cs} />
        </div>
    );
}
