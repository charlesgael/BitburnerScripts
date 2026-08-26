import { useAddChildPid } from "../../../context/child-pids-context";
import { useQueuedNs } from "../../../context/ns-queue-context";
import { CloudServerRow, fetchCloudList } from "../../../utils/cloud-list";
import {
    readXpFarmHosts,
    readXpFarmStatus,
    writeXpFarmHosts, XpFarmStatus, XP_FARM_DAEMON_HOST,
    XP_FARM_DAEMON_SCRIPT,
    XP_FARM_LOOP_DELAY
} from "../../../utils/xp-farm-config";

const CLOUD_HOST = "home";
const STATUS_POLL_MS = 3000;

/**
 * All XP Farm state and behavior. See `../index.ts`'s header comment for
 * the full design (why this app never calls `ns.grow`/`ns.weaken`/etc
 * itself, the daemon's self-managing lifecycle, why dedicated hosts are
 * excluded from the Programs app, ...).
 */
export function useXpFarm(React: any) {
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
        // Not tracked via addChildPid on purpose — see `../index.ts`'s
        // header comment: the daemon is meant to outlive this window/
        // ui.app.js.
        setDaemonRunning(true);
        return null;
    }

    // Manual override of the daemon's otherwise self-managing lifecycle
    // (see `../index.ts`'s header comment) — a single button whose label
    // flips between Spawn and Kill depending on whether the orchestrator is
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

    return {
        servers,
        enabled,
        status,
        daemonRunning,
        daemonBusy,
        loading,
        busyHost,
        error,
        refresh,
        openLog,
        openLoopLog,
        toggleDaemon,
        toggle,
    };
}

/** Everything a rendering component under `../components/` needs. */
export type XpFarmState = ReturnType<typeof useXpFarm>;
