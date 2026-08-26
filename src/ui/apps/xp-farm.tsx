import { AppComponentProps, AppDefinition } from "../types";
import { useQueuedNs } from "../context/ns-queue-context";
import { useAddChildPid } from "../context/child-pids-context";
import { theme, wrapText } from "../utils/theme";
import { fetchCloudList, CloudServerRow } from "../utils/cloud-list";
import {
    XP_FARM_DAEMON_HOST,
    XP_FARM_DAEMON_SCRIPT,
    XP_FARM_GROW_SCRIPT,
    XP_FARM_WEAKEN_SCRIPT,
    XP_FARM_LOOP_DELAY,
    XpFarmStatus,
    readXpFarmHosts,
    readXpFarmStatus,
    writeXpFarmHosts,
} from "../utils/xp-farm-config";

/**
 * Lets the player dedicate purchased ("cloud") servers to grinding hacking
 * XP: toggling a server here just writes it in/out of `xp-farm-config.txt`
 * (via `readXpFarmHosts`/`writeXpFarmHosts` — both 0 GB, see that file's
 * header comment) and makes sure `daemons/xp-farm.daemon.ts` is running to act
 * on it. Everything RAM-heavy — picking a target, splitting grow/weaken
 * threads, actually launching them — happens entirely in that daemon; this
 * app never calls `ns.grow`/`ns.weaken`/`ns.getServer`/`ns.scan`/`ns.killall`
 * itself, for the same reason the Cloud Servers/Share apps offload their own
 * heavy calls (see those files' header comments, and the RAM-cost model
 * section in CLAUDE.md).
 *
 * Deliberately no RAM bar (unlike the Programs app this otherwise mirrors):
 * a dedicated server's RAM is entirely the daemon's business, not something
 * spawning one more thing from here would ever compete with.
 *
 * The daemon is a self-managing background process, not something this app
 * starts/stops directly the way Share's daemon is: enabling a server just
 * ensures it's running (launches it if it isn't — `ns.isRunning` first, so
 * this never launches a second copy even if every row gets toggled on in a
 * row), and disabling the last one doesn't kill it — it notices its config
 * list went empty on its own next cycle and exits by itself. Its pid is
 * deliberately never passed to `useAddChildPid()` (same choice as
 * `ui/apps/share.tsx`): it's meant to keep running across a UI restart, not
 * die with this window or with ui.app.js itself.
 *
 * Once a server is dedicated, `ui/apps/task-manager.tsx` (the Programs
 * app) excludes it from its own cloud-server dropdown — the daemon has
 * exclusive control (it `ns.killall`s the host the moment it claims it, and
 * again the moment it's released) and Programs launching something there
 * too would just get killed out from under it.
 */
const CLOUD_HOST = "home";
const STATUS_POLL_MS = 3000;

function XpFarmContent({ React }: AppComponentProps) {
    const ns = useQueuedNs();
    const addChildPid = useAddChildPid();

    const [servers, setServers]: [CloudServerRow[], (v: CloudServerRow[]) => void] = React.useState([]);
    const [enabled, setEnabled]: [Set<string>, (v: Set<string>) => void] = React.useState(() => new Set());
    const [status, setStatus]: [XpFarmStatus, (v: XpFarmStatus) => void] = React.useState({});
    const [daemonRunning, setDaemonRunning] = React.useState(false);
    const [daemonBusy, setDaemonBusy] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [busyHost, setBusyHost]: [string | null, (v: string | null) => void] = React.useState(null);
    const [error, setError]: [string | null, (v: string | null) => void] = React.useState(null);

    async function refresh() {
        setLoading(true);
        setError(null);
        try {
            const [cloudList, hosts, latestStatus, running] = await Promise.all([
                fetchCloudList(ns, addChildPid, CLOUD_HOST),
                readXpFarmHosts(ns),
                readXpFarmStatus(ns),
                ns.isRunning(XP_FARM_DAEMON_SCRIPT, XP_FARM_DAEMON_HOST),
            ]);
            setServers(cloudList.servers);
            setEnabled(new Set(hosts));
            setStatus(latestStatus);
            setDaemonRunning(running);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }

    // This component remounts every time the window is opened — fetch
    // everything fresh rather than trusting stale state.
    React.useEffect(() => {
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // While open, keep the per-host target/thread display current — cheap
    // (ns.read is 0 GB) and mirrors the Share app's own poll for noticing
    // state that changed for reasons outside this window (there, a daemon
    // that exited on its own; here, the daemon picking a new/better target).
    React.useEffect(() => {
        const interval = setInterval(() => {
            readXpFarmStatus(ns).then(setStatus).catch(() => {});
            ns.isRunning(XP_FARM_DAEMON_SCRIPT, XP_FARM_DAEMON_HOST).then(setDaemonRunning).catch(() => {});
        }, STATUS_POLL_MS);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function openLog() {
        await ns.ui.openTail(XP_FARM_DAEMON_SCRIPT, XP_FARM_DAEMON_HOST);
    }

    // Opens a specific dedicated host's own grow/weaken loop tail, from the
    // "Ng / Mw" thread counts in its card below — filename+host+args have to
    // match exactly what the daemon actually exec'd it with (target,
    // XP_FARM_LOOP_DELAY) for openTail to find the right process, which is
    // why those come from `xp-farm-config.ts` rather than being hardcoded
    // here too.
    async function openLoopLog(script: string, host: string, target: string) {
        await ns.ui.openTail(script, host, target, XP_FARM_LOOP_DELAY);
    }

    async function ensureDaemonRunning(): Promise<string | null> {
        const alreadyRunning = await ns.isRunning(XP_FARM_DAEMON_SCRIPT, XP_FARM_DAEMON_HOST);
        if (alreadyRunning) return null;
        const pid = await ns.exec(XP_FARM_DAEMON_SCRIPT, XP_FARM_DAEMON_HOST, 1);
        if (pid === 0) {
            return `Couldn't launch ${XP_FARM_DAEMON_SCRIPT} — enough free RAM on ${XP_FARM_DAEMON_HOST}?`;
        }
        // Not tracked via addChildPid on purpose — see this file's header
        // comment: the daemon is meant to outlive this window/ui.app.js.
        setDaemonRunning(true);
        return null;
    }

    // Manual override of the daemon's otherwise self-managing lifecycle
    // (see this file's header comment) — a single button whose label flips
    // between Spawn and Kill depending on whether the orchestrator is
    // currently running. Killing it here doesn't touch `xp-farm-config.txt`
    // or any dedicated host's own grow/weaken loops — it's purely stopping
    // the orchestrator; re-spawning it (or re-enabling any server) picks up
    // right where the config file says it should.
    async function toggleDaemon() {
        setError(null);
        setDaemonBusy(true);
        try {
            if (daemonRunning) {
                await ns.kill(XP_FARM_DAEMON_SCRIPT, XP_FARM_DAEMON_HOST);
                setDaemonRunning(false);
            } else {
                const launchError = await ensureDaemonRunning();
                if (launchError) setError(launchError);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setDaemonBusy(false);
        }
    }

    async function toggle(hostname: string) {
        setError(null);
        setBusyHost(hostname);
        try {
            const next = new Set(enabled);
            if (next.has(hostname)) {
                next.delete(hostname);
            } else {
                next.add(hostname);
            }
            await writeXpFarmHosts(ns, [...next]);
            setEnabled(next);

            if (next.size > 0) {
                const launchError = await ensureDaemonRunning();
                if (launchError) {
                    setError(launchError);
                    return;
                }
            }
            // Give the daemon a moment to pick up the change and report
            // status before polling it — not required for correctness (the
            // interval above will catch up regardless), just avoids a beat
            // of stale/empty status right after enabling.
            setTimeout(() => {
                readXpFarmStatus(ns).then(setStatus).catch(() => {});
            }, 500);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusyHost(null);
        }
    }

    const buttonStyle = (danger = false, tiny = false) => ({
        minWidth: tiny ? undefined : "70px",
        background: danger ? theme.errorDark : theme.button,
        color: danger ? theme.error : theme.primary,
        border: `1px solid ${danger ? theme.error : theme.primary}`,
        borderRadius: "4px",
        padding: "4px 10px",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "12px",
    });

    // The clickable "Ng"/"Mw" thread counts in each card's status line (see
    // openLoopLog above) — styled as an inline text link rather than a
    // button, since it sits inside a plain sentence rather than its own row.
    const linkStyle = {
        textDecoration: "underline",
        cursor: "pointer",
    };

    // A CSS grid of cards rather than a stacked list — same idea and same
    // 260px column width as the Cloud Servers app's own server grid (see
    // `ui/apps/cloud-servers.tsx`'s header comment on its grid): `auto-fill`
    // + `minmax` wraps however many currently fit, so widening the window
    // reflows into more columns instead of a fixed-width list stranded in
    // empty space. Same info as before, same place within each card — just
    // a hostname/RAM + Enable/Disable header row with the target/thread
    // status line underneath, instead of a full-width row.
    const cards = servers.map((s: CloudServerRow) => {
        const isEnabled = enabled.has(s.hostname);
        const isOccupied = busyHost === s.hostname;
        const assignment = status[s.hostname];

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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                    <span style={{ ...wrapText, flex: 1 }}>
                        {s.hostname} ({s.ram} GB)
                    </span>
                    <button onClick={() => void toggle(s.hostname)} disabled={isOccupied} style={buttonStyle(isEnabled)}>
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
                                        onClick={() => void openLoopLog(XP_FARM_GROW_SCRIPT, s.hostname, assignment.target)}
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
                                            void openLoopLog(XP_FARM_WEAKEN_SCRIPT, s.hostname, assignment.target)
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
    });

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px", marginBottom: "8px" }}>
                <span>Dedicated: {enabled.size}</span>
                <button onClick={() => void refresh()} disabled={loading} style={buttonStyle()}>
                    {loading ? "..." : "Refresh"}
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
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    Daemon: {daemonRunning ? "Running" : "Stopped"}
                </span>
                <div style={{ display: "flex", gap: "6px" }}>
                    {daemonRunning ? (
                        <button
                            onClick={() => void openLog()} title="Open the daemon's log window" style={buttonStyle(false, true)}>
                            📃
                        </button>
                    ) : null}
                <button onClick={() => void toggleDaemon()} disabled={daemonBusy} style={buttonStyle(daemonRunning)}>
                    {daemonBusy ? "..." : daemonRunning ? "Kill" : "Spawn"}
                    </button>
                </div>
            </div>

            {error ? <div style={{ color: theme.error, fontSize: "11px", marginBottom: "8px", ...wrapText }}>{error}</div> : null}

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                    gap: "8px",
                }}
            >
                {servers.length === 0 && !loading ? (
                    <div style={{ gridColumn: "1 / -1", fontSize: "12px", opacity: 0.7 }}>
                        No purchased servers yet — buy one in the Cloud Servers app first.
                    </div>
                ) : (
                    cards
                )}
            </div>
        </div>
    );
}

export const XpFarmApp: AppDefinition = {
    id: "xp-farm",
    icon: "🏋️",
    label: "XP Farm",
    Content: XpFarmContent,
    // Wide enough to open already showing two ~260px server cards per row —
    // same reasoning as the Cloud Servers app's own preferredWidth.
    preferredWidth: 570,
    preferredHeight: 420,
};
