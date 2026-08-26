import { useQueuedNs } from "../../../context/ns-queue-context";
import { useAddChildPid } from "../../../context/child-pids-context";
import { useHomeRam } from "../../../context/home-ram-context";
import { fetchCloudList, CloudServerRow } from "../../../utils/cloud-list";
import { spawnRemote } from "../../../utils/spawn-remote";
import { readXpFarmHosts } from "../../../utils/xp-farm-config";
import { ManagedAppDefinition, Task } from "./types";
import { taskKey } from "./task-key";

/**
 * All state/behavior for one `createTaskManagerApp` instance. See
 * `../index.ts`'s header comment for the full design (why cloud servers
 * come from the shared `fetchCloudList` snapshot instead of polling RAM
 * per host, why `oneShot` apps are excluded from the running-task scan,
 * why spawned pids aren't tracked via `useAddChildPid`, etc).
 */
export function useTaskManager(React: any, apps: ManagedAppDefinition[], runnableApps: ManagedAppDefinition[]) {
    const ns = useQueuedNs();
    const addChildPid = useAddChildPid();
    const homeRam = useHomeRam();

    const [appRam, setAppRam] = React.useState(() => Object.fromEntries(apps.map((a) => [a.script, 0])));
    const [cloudServers, setCloudServers]: [CloudServerRow[], (v: CloudServerRow[]) => void] = React.useState([]);
    const [tasks, setTasks]: [Task[], (v: Task[] | ((prev: Task[]) => Task[])) => void] = React.useState([]);
    // Which app's cloud-host popup menu is open, if any — at most one
    // at a time. Keyed by script.
    const [openMenuFor, setOpenMenuFor] = React.useState(null as string | null);
    const [spawnBusy, setSpawnBusy] = React.useState(() => new Set());
    // Keyed by taskKey() — a task's own (script, host) pair — since
    // several tasks for the same script can be busy independently.
    const [taskBusy, setTaskBusy] = React.useState(() => new Set());
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(null as string | null);

    // Non-fatal on failure (e.g. not enough free RAM on home to launch
    // the list daemon right now — fetchCloudList itself falls back to a
    // stale cached list when that happens, see its header comment) —
    // only goes empty if there's no cached list either, in which case
    // this app just offers "home" as the only spawn target and can't
    // find any task running on a cloud server until the list recovers.
    async function refreshCloudServers(): Promise<CloudServerRow[]> {
        try {
            const [result, xpFarmHosts] = await Promise.all([fetchCloudList(ns, addChildPid), readXpFarmHosts(ns)]);
            const dedicated = new Set(xpFarmHosts);
            const available = result.servers.filter((s) => !dedicated.has(s.hostname));
            setCloudServers(available);
            return available;
        } catch {
            setCloudServers([]);
            return [];
        }
    }

    // Scans each candidate host's process list once (`ns.ps`) rather than
    // calling `ns.isRunning(script, host, ...args)` per app — the latter
    // requires an exact args match, which breaks for an app like
    // `flooder.app.js` whose args (`buildArgs`, see `../logic/types.ts`)
    // change at spawn time and can't be predicted here. Matching by
    // filename alone, and capturing each match's real PID, is also what
    // lets `killTask`/`tailTask` below address the process directly
    // (`ns.kill(pid)`/`ns.ui.openTail(pid)`) instead of needing to guess
    // the args it was actually launched with.
    async function refreshTasks(cloud: CloudServerRow[]) {
        const candidateHosts = ["home", ...cloud.map((c) => c.hostname)];
        const runnableScripts = new Set(runnableApps.map((a) => a.script));
        const found: Task[] = [];
        for (const host of candidateHosts) {
            const processes = await ns.ps(host);
            for (const p of processes) {
                if (runnableScripts.has(p.filename)) {
                    found.push({ script: p.filename, host, pid: p.pid });
                }
            }
        }
        setTasks(found);
    }

    async function refreshAll() {
        const cloud = await refreshCloudServers();
        await refreshTasks(cloud);
    }

    // This component remounts every time the window is opened, so local
    // state can't be trusted to reflect reality — re-detect every
    // app's RAM cost and what's actually running (started from a
    // previous open, or from outside this UI entirely) instead of
    // assuming stale/default values.
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            const ramEntries = await Promise.all(
                apps.map(async (a) => [a.script, await ns.getScriptRam(a.script, "home")] as const)
            );
            if (cancelled) return;
            setAppRam(Object.fromEntries(ramEntries));
            await refreshAll();
            if (!cancelled) setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Hosts this app could spawn on right now: `home` plus every
    // non-reserved cloud server that isn't already running this
    // specific app and has enough free RAM for it.
    function hostOptions(app: ManagedAppDefinition): { host: string; freeRam: number }[] {
        const required = (appRam[app.script] ?? 0) * (app.threads ?? 1);
        const runningHosts = new Set(tasks.filter((t) => t.script === app.script).map((t) => t.host));
        const options: { host: string; freeRam: number }[] = [];
        if (!runningHosts.has("home")) {
            const freeRam = homeRam.max - homeRam.used;
            if (freeRam >= required) options.push({ host: "home", freeRam });
        }
        for (const cs of cloudServers) {
            if (runningHosts.has(cs.hostname)) continue;
            const freeRam = cs.ram - cs.usedRam;
            if (freeRam >= required) options.push({ host: cs.hostname, freeRam });
        }
        return options;
    }

    async function spawnTask(app: ManagedAppDefinition, host: string) {
        // `buildArgs` (see `../logic/types.ts`) is only consulted here, at
        // the moment of spawning — never for run-detection/kill/tail, which
        // are PID-based and don't need to know a task's args at all.
        const args = [...(app.args ?? []), ...(app.buildArgs ? await app.buildArgs(ns) : [])];
        setError(null);
        setSpawnBusy((prev: Set<string>) => new Set(prev).add(app.script));
        try {
            let pid: number;
            if (host === "home") {
                pid = await ns.exec(app.script, "home", app.threads ?? 1, ...args);
                if (pid === 0) {
                    throw new Error(`Couldn't start ${app.script} on home — enough free RAM?`);
                }
            } else {
                const result = await spawnRemote(ns, addChildPid, app.script, host, app.threads ?? 1, args);
                if (!result.ok || !result.pid) {
                    throw new Error(result.error ?? `Couldn't start ${app.script} on ${host}.`);
                }
                pid = result.pid;
            }
            if (!app.oneShot) {
                setTasks((prev: Task[]) => [...prev, { script: app.script, host, pid }]);
            }
            await refreshCloudServers();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSpawnBusy((prev: Set<string>) => {
                const next = new Set(prev);
                next.delete(app.script);
                return next;
            });
        }
    }

    async function killTask(task: Task) {
        const key = taskKey(task);
        setError(null);
        setTaskBusy((prev: Set<string>) => new Set(prev).add(key));
        try {
            await ns.kill(task.pid);
            setTasks((prev: Task[]) => prev.filter((t) => taskKey(t) !== key));
            await refreshCloudServers();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setTaskBusy((prev: Set<string>) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    }

    async function tailTask(task: Task) {
        await ns.ui.openTail(task.pid);
    }

    const homePct = homeRam.max > 0 ? Math.min(100, (homeRam.used / homeRam.max) * 100) : 0;

    return {
        homeRam,
        homePct,
        appRam,
        tasks,
        openMenuFor,
        setOpenMenuFor,
        spawnBusy,
        taskBusy,
        loading,
        error,
        hostOptions,
        spawnTask,
        killTask,
        tailTask,
    };
}

/** Everything a rendering component under `../components/` needs. */
export type TaskManagerState = ReturnType<typeof useTaskManager>;
