import { AppComponentProps, AppDefinition } from "../types";
import { useQueuedNs } from "../context/ns-queue-context";
import { useAddChildPid } from "../context/child-pids-context";
import { useHomeRam } from "../context/home-ram-context";
import { theme, wrapText } from "../utils/theme";
import { fetchCloudList, CloudServerRow } from "../utils/cloud-list";
import { readXpFarmHosts } from "../utils/xp-farm-config";
import { spawnRemote } from "../utils/spawn-remote";

/**
 * Lets the player dedicate spare RAM — on `home` or any purchased ("cloud")
 * server — to `ns.share()`, boosting reputation gain from faction work while
 * it runs. One card per host, each independently toggled and threaded, laid
 * out as the same card grid as the XP Farm app (`ui/apps/xp-farm.tsx`).
 *
 * Unlike XP Farm, there's no self-managing orchestrator daemon + config file
 * here: every card directly `ns.exec`/`ns.kill`s its own copy of
 * `daemons/share.daemon.js` (a tiny loop around `ns.share()`, unchanged from
 * before this app grew multi-host support), the same way the original
 * single-host version of this app always worked. That's enough on its own
 * because `ns.exec`/`ns.kill`/`ns.isRunning`/`ns.ps`/`ns.getScriptRam` are
 * already part of `ui.app.js`'s footprint (via the Trainer/Programs/Cloud
 * Servers apps) — an orchestrator would only earn its keep if this app
 * needed to keep managing hosts while closed, which it doesn't: an already-
 * running share daemon is simply re-detected via `ns.ps` next time a card
 * mounts, same as before.
 *
 * `ns.share()` itself (2.4GB) still can't be referenced directly from this
 * file — see `daemons/share.daemon.ts`'s header comment — hence it staying
 * its own tiny script, launched with N threads via `ns.exec` rather than
 * called here.
 *
 * Launching on `home` is a plain `ns.exec` (the script's already there,
 * deployed by Viteburner). Launching on a cloud server goes through
 * `spawnRemote` (`ui/utils/spawn-remote.ts`), which `ns.scp`'s the script
 * over first via `daemons/spawn-remote.daemon.ts` — same path the Programs
 * app's cloud-server dropdown uses, and for the same reason: a cloud server
 * never has the script until something copies it there, and `ns.scp` is too
 * RAM-heavy to reference directly here.
 *
 * Only `home` reserves RAM (`MIN_RESERVED_RAM_GB`/`RESERVED_RAM_FRACTION`
 * below) — it's the one host running everything else (hack/grow/weaken
 * daemons, one-off Singularity actions, this very UI, ...), so sharing needs
 * to leave it headroom. Purchased servers have no such competing use once
 * dedicated, so their entire free RAM is offered.
 *
 * Cloud servers already dedicated to `ui/apps/xp-farm.tsx` are excluded from
 * the list — same reasoning as `ui/apps/task-manager.tsx`'s own exclusion:
 * `daemons/xp-farm.daemon.ts` has exclusive control of those and
 * `ns.killall`s them the moment it claims one, so a share daemon started
 * there would just get killed out from under it moments later.
 */
const DAEMON_SCRIPT = "daemons/share.daemon.js";
// Where daemons/cloud-list.daemon.js itself runs to produce the purchased-
// server snapshot — same convention as the XP Farm/Programs apps.
const CLOUD_LIST_HOST = "home";

/** `home` RAM below `max(MIN_RESERVED_RAM_GB, RESERVED_RAM_FRACTION * home's
 * max RAM)` is never offered to the share daemon, so there's always headroom
 * left for everything else that runs there. Scaling the reserve with
 * `home`'s own max RAM (rather than a flat GB amount) means it keeps pace as
 * `home` gets upgraded — a flat reserve sized for a small early-game `home`
 * would be pointlessly small once `home` is in the multi-TB range. */
const MIN_RESERVED_RAM_GB = 5;
const RESERVED_RAM_FRACTION = 0.2;

/** 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, ... (each doubling split at its
 * midpoint) up to (and including) maxThreads itself, so "give everything
 * currently shareable" is always the last option. Empty if there isn't even
 * enough shareable RAM for a single thread. */
function threadTiers(maxThreads: number): number[] {
    if (maxThreads < 1) return [];
    const tiers: number[] = [1];
    for (let pow = 2; pow < maxThreads; pow *= 2) {
        tiers.push(pow);
        const mid = pow * 1.5;
        if (mid < maxThreads) tiers.push(mid);
    }
    tiers.push(maxThreads);
    return Array.from(new Set(tiers)).sort((a, b) => a - b);
}

interface ShareHost {
    hostname: string;
    maxRam: number;
    usedRam: number;
    isHome: boolean;
}

function ShareHostCard({
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
    const addChildPid = useAddChildPid();

    const [pid, setPid] = React.useState(null); // non-null while a share daemon is running here
    const [runningThreads, setRunningThreads] = React.useState(0);
    const [selectedThreads, setSelectedThreads] = React.useState(1);
    const [threadsChosenByUser, setThreadsChosenByUser] = React.useState(false);
    const [costPerThread, setCostPerThread] = React.useState(0);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(null);

    const sharing = pid != null;
    const freeRam = host.maxRam - host.usedRam;
    const reservedRam = host.isHome
        ? Math.max(MIN_RESERVED_RAM_GB, host.maxRam * RESERVED_RAM_FRACTION)
        : 0;
    const shareableRam = Math.max(0, freeRam - reservedRam);
    const maxThreads =
        costPerThread > 0 ? Math.floor(shareableRam / costPerThread) : 0;
    const tiers = threadTiers(maxThreads);

    // Re-detect an already-running daemons/share.daemon.js on this host (from
    // a previous open of this window, or however else it got started) via
    // ns.ps rather than assuming nothing's happening. costPerThread is read
    // from home's own copy of the script regardless of which host this card
    // is for — it's the same file everywhere, and home's copy is guaranteed
    // to exist (Viteburner deploys it there) even before a cloud host has
    // ever had it scp'd over.
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const cost = await ns.getScriptRam(DAEMON_SCRIPT, "home");
            if (cancelled) return;
            setCostPerThread(cost);

            const processes = await ns.ps(host.hostname);
            if (cancelled) return;
            const proc = processes.find(
                (p: { filename: string }) => p.filename === DAEMON_SCRIPT
            );
            if (proc) {
                setPid(proc.pid);
                setRunningThreads(proc.threads);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [host.hostname]);

    // Default the selection to the largest tier — "share everything
    // currently shareable" — as long as the player hasn't manually picked a
    // tier of their own; and re-clamp to the new largest tier if free RAM
    // shrinks out from under a manual pick. `threadsChosenByUser` (rather
    // than just checking `selectedThreads === 1`) is what makes this fire on
    // first mount too: the initial `useState(1)` is otherwise itself a valid
    // tier, so a plain "is the current pick still valid?" check would never
    // trigger and the select would silently start on 1 instead of the max.
    React.useEffect(() => {
        if (sharing || tiers.length === 0) return;
        if (!threadsChosenByUser || !tiers.includes(selectedThreads)) {
            setSelectedThreads(tiers[tiers.length - 1]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tiers.join(",")]);

    // While sharing: notice if the daemon exited on its own (e.g. killed
    // some other way) so the button doesn't stay stuck on "Stop Sharing".
    React.useEffect(() => {
        if (pid == null) return;
        const interval = setInterval(() => {
            (async () => {
                const stillRunning = await ns.isRunning(pid);
                if (!stillRunning) {
                    setPid(null);
                    setRunningThreads(0);
                }
            })();
        }, 2000);
        return () => clearInterval(interval);
    }, [pid]);

    // `host.usedRam` is a snapshot from ShareContent's last cloud-list
    // fetch — for a cloud host, that only ever happens on mount or a manual
    // Refresh click, so starting/stopping a share daemon here would
    // otherwise leave that snapshot stale until one of those. Left
    // uncorrected, a stale (too-high) usedRam after Stop makes this card
    // think there's still no free RAM, showing the "not enough RAM" message
    // until the player manually refreshes. `home`'s own entry doesn't need
    // this — it comes live from useHomeRam(), refreshed by ui.app.ts's main
    // loop regardless of what this card does — so this only bothers
    // fetching for cloud hosts. ns.getServerUsedRam is already part of
    // ui.app.js's footprint (see ui/stats/registry.ts), so calling it here
    // adds nothing new on top of that.
    async function syncUsedRam() {
        if (host.isHome) return;
        try {
            const usedRam = await ns.getServerUsedRam(host.hostname);
            onUsedRamChange(host.hostname, usedRam);
        } catch {
            // Best-effort — a manual Refresh will still fix it if this fails.
        }
    }

    async function toggleSharing() {
        setBusy(true);
        setError(null);
        try {
            if (pid != null) {
                await ns.kill(pid);
                setPid(null);
                setRunningThreads(0);
                await syncUsedRam();
                return;
            }

            // Defensive: the button is already disabled in this case, but
            // free RAM can change between renders.
            const requiredRam = selectedThreads * costPerThread;
            if (selectedThreads < 1 || requiredRam > shareableRam) {
                setError(
                    `Not enough free RAM: ${selectedThreads} thread(s) needs ${requiredRam.toFixed(
                        2
                    )} GB, only ` +
                        `${shareableRam.toFixed(2)} GB is shareable on ${
                            host.hostname
                        }` +
                        (host.isHome
                            ? ` (${reservedRam.toFixed(2)} GB kept in reserve).`
                            : ".")
                );
                return;
            }

            if (host.isHome) {
                const newPid = await ns.exec(
                    DAEMON_SCRIPT,
                    host.hostname,
                    selectedThreads
                );
                if (newPid === 0) {
                    setError(
                        `Couldn't launch ${DAEMON_SCRIPT} — enough RAM? Is it deployed to ${host.hostname}?`
                    );
                    return;
                }
                setPid(newPid);
            } else {
                const result = await spawnRemote(
                    ns,
                    addChildPid,
                    DAEMON_SCRIPT,
                    host.hostname,
                    selectedThreads,
                    []
                );
                if (!result.ok || !result.pid) {
                    setError(
                        result.error ??
                            `Couldn't launch ${DAEMON_SCRIPT} on ${host.hostname}.`
                    );
                    return;
                }
                setPid(result.pid);
            }
            setRunningThreads(selectedThreads);
            await syncUsedRam();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }

    const insufficientRam = !sharing && tiers.length === 0;

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
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
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
                <span style={{ ...wrapText, flex: 1, fontWeight: "bold" }}>
                    {host.hostname}
                </span>
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
                        background:
                            host.usedRam > 90 ? theme.error : theme.primary,
                        transition: "width 0.2s ease",
                    }}
                />
            </div>

            {host.isHome ? (
                <div style={{ fontSize: "10px", opacity: 0.6 }}>
                    {reservedRam.toFixed(1)} GB kept in reserve
                </div>
            ) : null}

            {error ? (
                <div style={{ color: theme.error, ...wrapText }}>{error}</div>
            ) : null}

            {insufficientRam ? (
                <div
                    style={{
                        color: theme.error,
                        fontSize: "11px",
                        ...wrapText,
                    }}
                >
                    Needs at least {costPerThread.toFixed(2)} GB shareable to
                    share a single thread — only {shareableRam.toFixed(2)} GB is
                    shareable here.
                </div>
            ) : (
                <React.Fragment>
                    {!sharing ? (
                        <select
                            value={selectedThreads}
                            onChange={(ev: any) => {
                                setThreadsChosenByUser(true);
                                setSelectedThreads(Number(ev.target.value));
                            }}
                            style={fieldStyle}
                        >
                            {tiers.map((threads) => (
                                <option key={threads} value={threads}>
                                    {(threads * costPerThread).toFixed(0)} GB —{" "}
                                    {threads} thread
                                    {threads === 1 ? "" : "s"}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <div>
                            Sharing{" "}
                            {(runningThreads * costPerThread).toFixed(0)} GB —{" "}
                            {runningThreads} thread
                            {runningThreads === 1 ? "" : "s"}.
                        </div>
                    )}
                    <button
                        onClick={() => void toggleSharing()}
                        disabled={busy}
                        style={buttonStyle(sharing)}
                    >
                        {busy
                            ? "..."
                            : sharing
                            ? "Stop Sharing"
                            : "Start Sharing"}
                    </button>
                </React.Fragment>
            )}
        </div>
    );
}

function ShareContent({ React }: AppComponentProps) {
    const ns = useQueuedNs();
    const addChildPid = useAddChildPid();
    const homeRam = useHomeRam();

    const [cloudServers, setCloudServers]: [
        CloudServerRow[],
        (
            v: CloudServerRow[] | ((prev: CloudServerRow[]) => CloudServerRow[])
        ) => void
    ] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(null);

    async function refresh() {
        setLoading(true);
        setError(null);
        try {
            const [cloudList, xpFarmHosts] = await Promise.all([
                fetchCloudList(ns, addChildPid, CLOUD_LIST_HOST),
                readXpFarmHosts(ns),
            ]);
            const dedicated = new Set(xpFarmHosts);
            setCloudServers(
                cloudList.servers.filter(
                    (s: CloudServerRow) => !dedicated.has(s.hostname)
                )
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }

    // This component remounts every time the window is opened — fetch the
    // cloud-server list fresh rather than trusting stale state. `home`'s own
    // RAM comes live from useHomeRam() (see ui/context/home-ram-context.ts)
    // and needs no fetch of its own.
    React.useEffect(() => {
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Patches a single cloud host's usedRam in place — how a card reports
    // back the RAM it just consumed/freed by starting/stopping a share
    // daemon, without waiting on a full Refresh (see ShareHostCard's
    // syncUsedRam for why that matters).
    function updateCloudUsedRam(hostname: string, usedRam: number) {
        setCloudServers((prev: CloudServerRow[]) =>
            prev.map((s) => (s.hostname === hostname ? { ...s, usedRam } : s))
        );
    }

    const hosts: ShareHost[] = [
        {
            hostname: "home",
            maxRam: homeRam.max,
            usedRam: homeRam.used,
            isHome: true,
        },
        ...cloudServers.map((s) => ({
            hostname: s.hostname,
            maxRam: s.ram,
            usedRam: s.usedRam,
            isHome: false,
        })),
    ];

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
                    onClick={() => void refresh()}
                    disabled={loading}
                    style={{
                        background: theme.button,
                        color: theme.primary,
                        border: `1px solid ${theme.primary}`,
                        borderRadius: "4px",
                        padding: "4px 10px",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: "12px",
                    }}
                >
                    {loading ? "..." : "Refresh"}
                </button>
            </div>

            {error ? (
                <div
                    style={{
                        color: theme.error,
                        fontSize: "11px",
                        marginBottom: "8px",
                        ...wrapText,
                    }}
                >
                    {error}
                </div>
            ) : null}

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns:
                        "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: "8px",
                }}
            >
                {hosts.map((host) => (
                    <ShareHostCard
                        key={host.hostname}
                        React={React}
                        ns={ns}
                        host={host}
                        onUsedRamChange={updateCloudUsedRam}
                    />
                ))}
            </div>
        </div>
    );
}

export const ShareApp: AppDefinition = {
    id: "share",
    icon: "🤝",
    label: "Share",
    Content: ShareContent,
    // Wide enough to open already showing two ~220px host cards per row —
    // same reasoning as the XP Farm/Cloud Servers apps' own preferredWidth.
    preferredWidth: 700,
    preferredHeight: 440,
    minWidth: 550,
    minHeight: 400,
};
