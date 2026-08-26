import { AppComponentProps, AppDefinition } from "../types";
import { useQueuedNs } from "../context/ns-queue-context";
import { useAddChildPid } from "../context/child-pids-context";
import { useHomeRam } from "../context/home-ram-context";
import { theme, wrapText } from "../utils/theme";
import { runDaemon } from "../utils/run-daemon";
import { CLOUD_LIST_SCRIPT, CLOUD_LIST_RESULT_FILE, CloudListResult, CloudServerRow } from "../utils/cloud-list";
import { pickCloudServerName } from "../utils/cloud-names";

/**
 * Lets the player buy, list, and delete purchased ("cloud") servers.
 *
 * This app never references `ns.cloud.*` (or `ns.getServerMoneyAvailable`)
 * itself — Bitburner charges a script for every ns.* function it merely
 * *references* anywhere in its reachable code, whether or not that code
 * path runs, and since this file is always part of ui.app.js's bundle,
 * writing those here would permanently inflate its footprint (even
 * getServerMoneyAvailable's mere 0.1GB isn't worth paying for, since the
 * game's own overview panel already shows current money live). Instead
 * all of that work happens in three tiny one-shot scripts —
 * `daemons/cloud-list.daemon.ts`, `daemons/cloud-buy.daemon.ts`, `daemons/cloud-delete.daemon.ts`
 * — spawned via ns.exec and polled via ns.isRunning, the same pattern
 * `daemons/train.daemon.ts`/`daemons/restart.daemon.ts` use. Each daemon writes its result
 * as JSON to a fixed file, which this app reads back with ns.read (0 GB).
 * exec/kill/isRunning/getScriptRam are all already part of ui.app.js's
 * footprint via the Trainer/Programs apps, so using them here is free.
 * `home`'s used/max RAM (used below to gate launching the buy/delete
 * daemons) comes from `useHomeRam()` (see `ui/context/home-ram-context.ts`)
 * instead of this app polling ns.getServerUsedRam/getServerMaxRam on its
 * own timer.
 */
const DAEMON_HOST = "home";
const BUY_SCRIPT = "daemons/cloud-buy.daemon.js";
const BUY_RESULT_FILE = "cloud-buy-result.txt";
const DELETE_SCRIPT = "daemons/cloud-delete.daemon.js";
const DELETE_RESULT_FILE = "cloud-delete-result.txt";

interface ActionResult {
    ok: boolean;
    hostname?: string;
    error?: string;
}

function formatMoney(n: number): string {
    return `$${Math.floor(n).toLocaleString()}`;
}

function CloudServersContent({ React }: AppComponentProps) {
    const ns = useQueuedNs();
    const addChildPid = useAddChildPid();

    const [servers, setServers]: [CloudServerRow[], (v: CloudServerRow[]) => void] = React.useState([]);
    const [moneyAvailable, setMoneyAvailable] = React.useState(0);
    const [serverLimit, setServerLimit] = React.useState(0);
    const [costByRam, setCostByRam]: [Record<number, number>, (v: Record<number, number>) => void] = React.useState(
        {}
    );
    const [listLoading, setListLoading] = React.useState(true);
    const [listError, setListError]: [string | null, (v: string | null) => void] = React.useState(null);

    const [buyHostname, setBuyHostname] = React.useState("");
    const [buyRam, setBuyRam] = React.useState(2);
    const [buyBusy, setBuyBusy] = React.useState(false);
    const [buyError, setBuyError]: [string | null, (v: string | null) => void] = React.useState(null);

    const [confirmDeleteHost, setConfirmDeleteHost]: [string | null, (v: string | null) => void] =
        React.useState(null);
    const [deleteBusyHost, setDeleteBusyHost]: [string | null, (v: string | null) => void] = React.useState(null);
    const [deleteError, setDeleteError]: [string | null, (v: string | null) => void] = React.useState(null);

    const [daemonRam, setDaemonRam] = React.useState({ list: 0, buy: 0, delete: 0 });

    const homeRam = useHomeRam();
    const busy = listLoading || buyBusy || deleteBusyHost != null;
    const freeRam = homeRam.max - homeRam.used;

    async function refreshList() {
        setListLoading(true);
        setListError(null);
        try {
            const result: CloudListResult = await runDaemon(
                ns,
                addChildPid,
                CLOUD_LIST_SCRIPT,
                DAEMON_HOST,
                CLOUD_LIST_RESULT_FILE
            );
            setServers(result.servers);
            setMoneyAvailable(result.moneyAvailable);
            setServerLimit(result.serverLimit);
            setCostByRam(result.costByRam);
            // Default the RAM picker to the cheapest tier the player can
            // currently afford, if nothing sensible (or no longer
            // affordable) is selected.
            const tiers = Object.keys(result.costByRam)
                .map(Number)
                .sort((a, b) => a - b);
            const affordableTiers = tiers.filter((t) => result.costByRam[t] <= result.moneyAvailable);
            if (tiers.length > 0 && (!tiers.includes(buyRam) || result.costByRam[buyRam] > result.moneyAvailable)) {
                setBuyRam(affordableTiers.length > 0 ? affordableTiers[0] : tiers[0]);
            }
        } catch (err) {
            setListError(err instanceof Error ? err.message : String(err));
        } finally {
            setListLoading(false);
        }
    }

    // This component remounts every time the window is opened — fetch
    // everything fresh rather than trusting stale state.
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const [listRam, buyRam_, deleteRam] = await Promise.all([
                ns.getScriptRam(CLOUD_LIST_SCRIPT, DAEMON_HOST),
                ns.getScriptRam(BUY_SCRIPT, DAEMON_HOST),
                ns.getScriptRam(DELETE_SCRIPT, DAEMON_HOST),
            ]);
            if (cancelled) return;
            setDaemonRam({ list: listRam, buy: buyRam_, delete: deleteRam });
        })();
        void refreshList();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function handleBuy() {
        // Leaving the field blank isn't an error — fall back to a random
        // themed name (see `ui/utils/cloud-names.ts`) rather than forcing
        // the player to come up with one.
        const hostname = buyHostname.trim() || pickCloudServerName(servers.map((s) => s.hostname));
        setBuyError(null);
        if (daemonRam.buy > freeRam) {
            setBuyError(`Not enough free RAM to launch ${BUY_SCRIPT} (needs ${daemonRam.buy.toFixed(2)} GB).`);
            return;
        }
        setBuyBusy(true);
        try {
            const result: ActionResult = await runDaemon(ns, addChildPid, BUY_SCRIPT, DAEMON_HOST, BUY_RESULT_FILE, [
                hostname,
                buyRam,
            ]);
            if (!result.ok) {
                setBuyError(result.error ?? "Purchase failed.");
                return;
            }
            setBuyHostname("");
            await refreshList();
        } catch (err) {
            setBuyError(err instanceof Error ? err.message : String(err));
        } finally {
            // No manual RAM refresh needed: HomeRamContext updates on its
            // own schedule (see ui/utils/home-ram-poller.ts) regardless of
            // what this app does.
            setBuyBusy(false);
        }
    }

    function handleDeleteClick(hostname: string) {
        if (confirmDeleteHost === hostname) {
            void doDelete(hostname);
        } else {
            setConfirmDeleteHost(hostname);
        }
    }

    async function doDelete(hostname: string) {
        setConfirmDeleteHost(null);
        setDeleteError(null);
        if (daemonRam.delete > freeRam) {
            setDeleteError(`Not enough free RAM to launch ${DELETE_SCRIPT} (needs ${daemonRam.delete.toFixed(2)} GB).`);
            return;
        }
        setDeleteBusyHost(hostname);
        try {
            const result: ActionResult = await runDaemon(ns, addChildPid, DELETE_SCRIPT, DAEMON_HOST, DELETE_RESULT_FILE, [
                hostname,
            ]);
            if (!result.ok) {
                setDeleteError(result.error ?? "Delete failed.");
                return;
            }
            await refreshList();
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : String(err));
        } finally {
            // No manual RAM refresh needed: HomeRamContext updates on its
            // own schedule (see ui/utils/home-ram-poller.ts) regardless of
            // what this app does.
            setDeleteBusyHost(null);
        }
    }

    const ramTiers = Object.keys(costByRam)
        .map(Number)
        .sort((a, b) => a - b);
    const selectedCost = costByRam[buyRam] ?? 0;
    const atServerLimit = servers.length >= serverLimit && serverLimit > 0;
    const insufficientMoney = selectedCost > moneyAvailable;
    const buyDisabled = buyBusy || atServerLimit || insufficientMoney;

    const fieldStyle = {
        background: theme.well,
        color: theme.primary,
        border: `1px solid ${theme.primary}`,
        borderRadius: "4px",
        padding: "4px",
        fontFamily: "inherit",
    };

    const buttonStyle = (danger = false) => ({
        background: danger ? theme.errorDark : theme.button,
        color: danger ? theme.error : theme.primary,
        border: `1px solid ${danger ? theme.error : theme.primary}`,
        borderRadius: "4px",
        padding: "4px 10px",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "12px",
    });

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "10px" }}>
                <span>
                    Servers: {servers.length} / {serverLimit || "?"}
                </span>
                <button onClick={() => void refreshList()} disabled={busy} style={buttonStyle()}>
                    {listLoading ? "..." : "Refresh"}
                </button>
            </div>

            {listError ? (
                <div style={{ color: theme.error, fontSize: "11px", marginBottom: "8px", ...wrapText }}>
                    {listError}
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
                {servers.length === 0 && !listLoading ? (
                    <div style={{ gridColumn: "1 / -1", fontSize: "12px", opacity: 0.7 }}>
                        No purchased servers yet.
                    </div>
                ) : (
                    servers.map((s: CloudServerRow) => {
                        const usedPct = s.ram > 0 ? Math.min(100, (s.usedRam / s.ram) * 100) : 0;
                        return (
                            <div
                                key={s.hostname}
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
                                    <button
                                        onClick={() => handleDeleteClick(s.hostname)}
                                        disabled={busy}
                                        style={buttonStyle(true)}
                                    >
                                        {deleteBusyHost === s.hostname
                                            ? "..."
                                            : confirmDeleteHost === s.hostname
                                              ? "Confirm?"
                                              : "Delete"}
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
                    })
                )}
            </div>

            {deleteError ? (
                <div style={{ color: theme.error, fontSize: "11px", marginBottom: "8px", ...wrapText }}>
                    {deleteError}
                </div>
            ) : null}

            {/* --- Buy form --- */}
            <div style={{ paddingTop: "10px" }}>
                <label
                    style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", marginBottom: "8px" }}
                >
                    Hostname
                    <input
                        type="text"
                        value={buyHostname}
                        placeholder="blank = random name"
                        disabled={busy || atServerLimit}
                        onChange={(ev: any) => setBuyHostname(ev.target.value)}
                        style={fieldStyle}
                    />
                </label>
                <label
                    style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", marginBottom: "8px" }}
                >
                    RAM
                    <select
                        value={buyRam}
                        disabled={busy || atServerLimit || ramTiers.length === 0}
                        onChange={(ev: any) => setBuyRam(Number(ev.target.value))}
                        style={fieldStyle}
                    >
                        {ramTiers.map((ram) => (
                            <option key={ram} value={ram} disabled={costByRam[ram] > moneyAvailable}>
                                {ram} GB — {formatMoney(costByRam[ram])}
                            </option>
                        ))}
                    </select>
                </label>
                {atServerLimit ? (
                    <div style={{ color: theme.error, fontSize: "11px", marginBottom: "8px", ...wrapText }}>
                        Server limit reached ({serverLimit}). Delete one to buy another.
                    </div>
                ) : null}
                {buyError ? (
                    <div style={{ color: theme.error, fontSize: "11px", marginBottom: "8px", ...wrapText }}>
                        {buyError}
                    </div>
                ) : null}
                <button
                    onClick={() => void handleBuy()}
                    disabled={buyDisabled}
                    title={insufficientMoney ? "Not enough money" : undefined}
                    style={{
                        ...buttonStyle(),
                        width: "100%",
                        opacity: buyDisabled ? 0.6 : 1,
                        cursor: buyDisabled ? "default" : "pointer",
                    }}
                >
                    {buyBusy ? "..." : `Buy (${formatMoney(selectedCost)})`}
                </button>
            </div>
        </div>
    );
}

export const CloudServersApp: AppDefinition = {
    id: "cloud-servers",
    icon: "🖥️",
    label: "Cloud S.",
    Content: CloudServersContent,
    // Wide enough to open already showing two ~260px server cards per row
    // (see the grid in CloudServersContent above) instead of the default
    // window width falling back to a single column.
    preferredWidth: 570,
    preferredHeight: 420,
    minWidth: 290,
};
