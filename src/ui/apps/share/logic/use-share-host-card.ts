import { useAddChildPid } from "../../../context/child-pids-context";
import { spawnRemote } from "../../../utils/spawn-remote";
import { ShareHost } from "./types";
import { threadTiers } from "./thread-tiers";

const DAEMON_SCRIPT = "daemons/share.daemon.js";

/** `home` RAM below `max(MIN_RESERVED_RAM_GB, RESERVED_RAM_FRACTION * home's
 * max RAM)` is never offered to the share daemon, so there's always headroom
 * left for everything else that runs there. Scaling the reserve with
 * `home`'s own max RAM (rather than a flat GB amount) means it keeps pace as
 * `home` gets upgraded — a flat reserve sized for a small early-game `home`
 * would be pointlessly small once `home` is in the multi-TB range. */
const MIN_RESERVED_RAM_GB = 5;
const RESERVED_RAM_FRACTION = 0.2;

/** All state/behavior for one host's share card: detecting an already-
 * running `daemons/share.daemon.js`, picking a thread tier, and starting/
 * stopping it. See `../index.ts`'s header comment for the launch-path
 * reasoning (`ns.exec` on home, `spawnRemote` elsewhere). */
export function useShareHostCard(
    React: any,
    ns: any,
    host: ShareHost,
    onUsedRamChange: (hostname: string, usedRam: number) => void
) {
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
    const reservedRam = host.isHome ? Math.max(MIN_RESERVED_RAM_GB, host.maxRam * RESERVED_RAM_FRACTION) : 0;
    const shareableRam = Math.max(0, freeRam - reservedRam);
    const maxThreads = costPerThread > 0 ? Math.floor(shareableRam / costPerThread) : 0;
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
            const proc = processes.find((p: { filename: string }) => p.filename === DAEMON_SCRIPT);
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
                    `Not enough free RAM: ${selectedThreads} thread(s) needs ${requiredRam.toFixed(2)} GB, only ` +
                        `${shareableRam.toFixed(2)} GB is shareable on ${host.hostname}` +
                        (host.isHome ? ` (${reservedRam.toFixed(2)} GB kept in reserve).` : ".")
                );
                return;
            }

            if (host.isHome) {
                const newPid = await ns.exec(DAEMON_SCRIPT, host.hostname, selectedThreads);
                if (newPid === 0) {
                    setError(`Couldn't launch ${DAEMON_SCRIPT} — enough RAM? Is it deployed to ${host.hostname}?`);
                    return;
                }
                setPid(newPid);
            } else {
                const result = await spawnRemote(ns, addChildPid, DAEMON_SCRIPT, host.hostname, selectedThreads, []);
                if (!result.ok || !result.pid) {
                    setError(result.error ?? `Couldn't launch ${DAEMON_SCRIPT} on ${host.hostname}.`);
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

    return {
        sharing,
        reservedRam,
        shareableRam,
        costPerThread,
        tiers,
        selectedThreads,
        setSelectedThreads,
        setThreadsChosenByUser,
        runningThreads,
        busy,
        error,
        insufficientRam,
        toggleSharing,
    };
}

/** Everything `ShareHostCard` needs from this hook. */
export type ShareHostCardState = ReturnType<typeof useShareHostCard>;
