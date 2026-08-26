import { AppComponentProps, AppDefinition } from "../types";
import { useQueuedNs } from "../context/ns-queue-context";
import { useAddChildPid } from "../context/child-pids-context";
import { useHomeRam } from "../context/home-ram-context";
import { theme, wrapText } from "../utils/theme";
import { fetchCloudList, CloudServerRow } from "../utils/cloud-list";
import { spawnRemote } from "../utils/spawn-remote";
import { readXpFarmHosts } from "../utils/xp-farm-config";

/**
 * One script a `createTaskManagerApp` instance can spawn. This is
 * configured in code (see `ui/apps/index.ts`), not editable from the UI.
 */
export interface ManagedAppDefinition {
    /** Path to the script to run, e.g. "flooder.app.js". */
    script: string;
    /** Label shown for this app, in both the spawn row and any task it's
     * currently running as. */
    label: string;
    /** Args to run it with — also used to match the right instance when
     * checking whether it's already running, tailing, or killing it.
     * Defaults to []. */
    args?: (string | number | boolean)[];
    /** Thread count to spawn with. Defaults to 1. */
    threads?: number;
    /** True for a script that runs once and exits on its own (e.g. a report
     * that just prints to the terminal and returns) rather than looping
     * forever. Still gets the same host picker as any other app (its
     * report may depend on files local to whichever host it runs on — e.g.
     * `backdoor.lite.app.js` reading `known-servers.json.txt` wherever
     * `netmapper.app.js` last wrote it), but is skipped by the
     * running-task list entirely and its button always reads "Run" instead
     * of "Spawn" (see the module doc comment below). Defaults to false. */
    oneShot?: boolean;
}

/** One currently-running instance of a non-`oneShot` managed app: which
 * app's `script`, and which host it's actually running on. */
interface Task {
    script: string;
    host: string;
}

function taskKey(task: Task): string {
    return `${task.script}@${task.host}`;
}

/**
 * Builds a task-manager app: a fixed catalog of scripts (`apps`, fixed in
 * source — see `ui/apps/index.ts`) can each be spawned on `home` or any
 * non-reserved purchased ("cloud") server, and every instance currently
 * running shows up in a flat "Running Tasks" list underneath, each with its
 * own Tail/Kill buttons — independent of which row spawned it. Unlike the
 * single-instance-per-app toggle this app used to be, the same catalog
 * entry can run on several hosts at once; each (script, host) pair is
 * tracked as its own task.
 *
 * "Non-reserved" cloud server means: not one of the hosts
 * `ui/apps/xp-farm.tsx` has dedicated to XP farming (tracked in
 * `xp-farm-config.txt` via `readXpFarmHosts`) — `daemons/xp-farm.daemon.ts`
 * has exclusive control of those and `ns.killall`s them the moment it
 * claims one, so offering them here would just mean whatever got spawned
 * is killed out from under it moments later. This app never references
 * `ns.cloud.*` itself to find cloud servers — see `cloud-servers.tsx`'s
 * header comment for why — instead reading the same
 * `daemons/cloud-list.daemon.js` snapshot the Cloud Servers app uses (via
 * `fetchCloudList`), which conveniently already reports each server's
 * `ram`/`usedRam`, so this file has no need to poll
 * `ns.getServerUsedRam`/`getServerMaxRam` per host itself the way the old
 * per-program-row version of this app did.
 *
 * The running-task list only ever tracks instances of the scripts in
 * `apps` — not a general `ps` across every process on every host — found
 * by scanning `ns.isRunning(script, host, ...args)` across `home` plus
 * every non-reserved cloud server, for every non-`oneShot` app, each time
 * this window opens or a spawn/kill happens. A `oneShot` app (e.g. a report
 * that prints and exits) is excluded from that scan and the task list
 * entirely — by the time a re-render could show it as a task, the script
 * has usually already exited, so tracking it would either never show
 * anything or show a stale task that can no longer actually be killed.
 *
 * Spawning on `home` uses a direct `ns.exec` (the script's already there,
 * deployed by Viteburner); spawning on a cloud server goes through
 * `daemons/spawn-remote.daemon.ts` (via `spawnRemote`), which `ns.scp`'s
 * the script over first since a cloud server never has it already — see
 * that daemon's header comment. Neither path registers the spawned pid via
 * `useAddChildPid()`: these are meant to keep running in the background
 * across `ui.app.ts` restarts, not be torn down when the sidebar UI itself
 * restarts (only the short-lived one-shot orchestrator daemons —
 * `spawn-remote`/`cloud-list`/etc. — get tracked as child pids, so a
 * restart mid-operation doesn't leak one of *those*).
 */
export function createTaskManagerApp(id: string, label: string, icon: string, apps: ManagedAppDefinition[]): AppDefinition {
    const runnableApps = apps.filter((a) => !a.oneShot);
    const appByScript = Object.fromEntries(apps.map((a) => [a.script, a]));

    function TaskManagerContent({ React }: AppComponentProps) {
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

        async function refreshTasks(cloud: CloudServerRow[]) {
            const candidateHosts = ["home", ...cloud.map((c) => c.hostname)];
            const found: Task[] = [];
            for (const app of runnableApps) {
                const args = app.args ?? [];
                for (const host of candidateHosts) {
                    if (await ns.isRunning(app.script, host, ...args)) {
                        found.push({ script: app.script, host });
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
            const args = app.args ?? [];
            setError(null);
            setSpawnBusy((prev: Set<string>) => new Set(prev).add(app.script));
            try {
                if (host === "home") {
                    const pid = await ns.exec(app.script, "home", app.threads ?? 1, ...args);
                    if (pid === 0) {
                        throw new Error(`Couldn't start ${app.script} on home — enough free RAM?`);
                    }
                } else {
                    const result = await spawnRemote(ns, addChildPid, app.script, host, app.threads ?? 1, args);
                    if (!result.ok || !result.pid) {
                        throw new Error(result.error ?? `Couldn't start ${app.script} on ${host}.`);
                    }
                }
                if (!app.oneShot) {
                    setTasks((prev: Task[]) => [...prev, { script: app.script, host }]);
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
            const app = appByScript[task.script];
            const args = app?.args ?? [];
            const key = taskKey(task);
            setError(null);
            setTaskBusy((prev: Set<string>) => new Set(prev).add(key));
            try {
                await ns.kill(task.script, task.host, ...args);
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
            const app = appByScript[task.script];
            const args = app?.args ?? [];
            await ns.ui.openTail(task.script, task.host, ...args);
        }

        const homePct = homeRam.max > 0 ? Math.min(100, (homeRam.used / homeRam.max) * 100) : 0;
        const ramBar = (
            <div style={{ marginBottom: "12px" }}>
                <div
                    style={{
                        position: "relative",
                        height: "14px",
                        borderRadius: "4px",
                        background: theme.well,
                        border: `1px solid ${theme.primaryDark}`,
                        overflow: "hidden",
                    }}
                >
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            width: `${homePct}%`,
                            background: homePct > 90 ? theme.error : theme.primary,
                            transition: "width 0.2s ease",
                        }}
                    />
                </div>
                <div style={{ fontSize: "11px", opacity: 0.85, marginTop: "4px", textAlign: "right" }}>
                    home: {homeRam.used.toFixed(2)} / {homeRam.max.toFixed(2)} GB
                </div>
            </div>
        );

        const errorBanner = error ? (
            <div style={{ color: theme.error, fontSize: "11px", marginBottom: "8px", ...wrapText }}>{error}</div>
        ) : null;

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

        // Same spawn row for both loop apps and one-shot reports: the main
        // button always targets `home` directly — no picker in the way for
        // the common case — and a small "▾" button to its right opens a
        // popup listing only the non-reserved cloud servers with room for
        // this app (and, for a loop app, not already running it — see
        // hostOptions above); picking one spawns there instead. A one-shot
        // script often reads a file local to whatever host it runs on
        // (e.g. `backdoor.lite.app.js` reads `known-servers.json.txt`,
        // which `netmapper.app.js` only writes on the host *it* was
        // spawned on) — that's why one-shot apps get the same host choice
        // as loop apps instead of being locked to `home`. Since `tasks`
        // never contains a one-shot app's script (see the module doc
        // comment), `hostOptions` naturally never excludes a host for
        // one-shot apps as "already running" — only the RAM check applies.
        const spawnRows = apps.map((app) => {
            const required = (appRam[app.script] ?? 0) * (app.threads ?? 1);
            const options = hostOptions(app);
            const homeOption = options.find((o) => o.host === "home");
            const cloudOptions = options.filter((o) => o.host !== "home");
            const alreadyOnHome = tasks.some((t) => t.script === app.script && t.host === "home");
            const isBusy = spawnBusy.has(app.script);
            const homeDisabled = isBusy || loading || !homeOption;
            const hasCloudOption = cloudOptions.length > 0;
            const menuOpen = openMenuFor === app.script;

            const runLabel = app.oneShot ? "Run" : "Spawn";
            const mainLabel = isBusy ? "..." : alreadyOnHome ? "Running" : !homeOption ? "No RAM" : runLabel;
            const mainTitle = alreadyOnHome
                ? "Already running on home — see Running Tasks below"
                : !homeOption
                  ? "Not enough free RAM on home"
                  : undefined;
            const spawnBorderColor = theme.primary;

            const mainButton = (
                <button
                    onClick={() => void spawnTask(app, "home")}
                    disabled={homeDisabled}
                    title={mainTitle}
                    style={{
                        minWidth: "60px",
                        background: theme.button,
                        color: theme.primary,
                        borderTop: `1px solid ${spawnBorderColor}`,
                        borderBottom: `1px solid ${spawnBorderColor}`,
                        borderLeft: `1px solid ${spawnBorderColor}`,
                        borderRight: hasCloudOption ? "none" : `1px solid ${spawnBorderColor}`,
                        borderRadius: hasCloudOption ? "4px 0 0 4px" : "4px",
                        padding: "4px 10px",
                        cursor: homeDisabled ? "default" : "pointer",
                        opacity: homeDisabled ? 0.6 : 1,
                        fontFamily: "inherit",
                        fontSize: "12px",
                    }}
                >
                    {mainLabel}
                </button>
            );

            // A compact "▾" button, to the right of the main button, that
            // toggles a small popup menu listing only the compatible cloud
            // servers — cheaper on space than a native <select>, which
            // always reserves room for its widest option even closed.
            // Wrapped in its own `position: relative` box so the popup
            // (position: absolute) anchors to it; gets a z-index above the
            // click-catching backdrop below only while its menu is open, so
            // the popup — and the arrow button itself, to keep toggling it
            // closed working — aren't hidden behind it.
            const cloudMenuButton = hasCloudOption ? (
                <div
                    style={{
                        position: "relative",
                        display: "flex",
                        ...(menuOpen ? { zIndex: 2 } : {}),
                    }}
                >
                    <button
                        onClick={() => setOpenMenuFor(menuOpen ? null : app.script)}
                        disabled={isBusy}
                        title="Spawn on a cloud server instead"
                        style={{
                            boxSizing: "border-box",
                            background: theme.button,
                            color: theme.primary,
                            border: `1px solid ${theme.primary}`,
                            borderRadius: "0 4px 4px 0",
                            padding: "0 6px",
                            fontFamily: "inherit",
                            fontSize: "10px",
                            cursor: isBusy ? "default" : "pointer",
                        }}
                    >
                        ▾
                    </button>
                    {menuOpen ? (
                        <div
                            style={{
                                position: "absolute",
                                top: "100%",
                                right: 0,
                                marginTop: "2px",
                                background: theme.well,
                                border: `1px solid ${theme.primary}`,
                                borderRadius: "4px",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                                minWidth: "170px",
                                overflow: "hidden",
                            }}
                        >
                            {cloudOptions.map((o) => (
                                <button
                                    key={o.host}
                                    onClick={() => {
                                        setOpenMenuFor(null);
                                        void spawnTask(app, o.host);
                                    }}
                                    style={{
                                        display: "block",
                                        width: "100%",
                                        textAlign: "left",
                                        background: "transparent",
                                        color: theme.primary,
                                        border: "none",
                                        borderBottom: `1px solid ${theme.well}`,
                                        padding: "6px 8px",
                                        cursor: "pointer",
                                        fontFamily: "inherit",
                                        fontSize: "11px",
                                    }}
                                >
                                    {o.host} ({o.freeRam.toFixed(1)} GB free)
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null;

            return (
                <div
                    key={app.script}
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "8px",
                        padding: "6px 0",
                        borderBottom: `1px solid ${theme.well}`,
                    }}
                >
                    <span style={{ fontSize: "12px", ...wrapText }}>
                        {app.label} ({required.toFixed(2)} GB)
                    </span>
                    <div style={{ display: "flex" }}>
                        {mainButton}
                        {cloudMenuButton}
                    </div>
                </div>
            );
        });

        // Invisible click-catcher that closes an open cloud-host menu when
        // the player clicks anywhere else. Sits at z-index 1 — below the
        // open row's z-index 2 above, so that row's button and popup still
        // receive their own clicks — and above everything else (which is
        // unpositioned, so it stacks below any explicitly positioned
        // sibling regardless of DOM order).
        const menuBackdrop = openMenuFor ? (
            <div onClick={() => setOpenMenuFor(null)} style={{ position: "fixed", inset: 0, zIndex: 1 }} />
        ) : null;

        const taskRows = tasks.map((task) => {
            const app = appByScript[task.script];
            const key = taskKey(task);
            const isBusy = taskBusy.has(key);
            const ram = (appRam[task.script] ?? 0) * (app?.threads ?? 1);

            return (
                <div
                    key={key}
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "8px",
                        padding: "6px 0",
                        borderBottom: `1px solid ${theme.well}`,
                    }}
                >
                    <span style={{ fontSize: "12px", ...wrapText }}>
                        {app?.label ?? task.script} @ {task.host} ({ram.toFixed(2)} GB)
                    </span>
                    <div style={{ display: "flex", gap: "6px" }}>
                        <button
                            onClick={() => void tailTask(task)}
                            disabled={isBusy}
                            title="Open this task's log window"
                            style={buttonStyle()}
                        >
                            📃
                        </button>
                        <button onClick={() => void killTask(task)} disabled={isBusy} style={buttonStyle(true)}>
                            {isBusy ? "..." : "Kill"}
                        </button>
                    </div>
                </div>
            );
        });

        return (
            <div>
                {menuBackdrop}
                {errorBanner}
                {ramBar}

                <div style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "4px" }}>Spawn</div>
                {spawnRows}

                <div style={{ fontSize: "12px", fontWeight: "bold", margin: "14px 0 4px" }}>
                    Running Tasks {tasks.length > 0 ? `(${tasks.length})` : ""}
                </div>
                {loading ? (
                    <div style={{ fontSize: "12px", opacity: 0.7 }}>Loading...</div>
                ) : taskRows.length === 0 ? (
                    <div style={{ fontSize: "12px", opacity: 0.7 }}>No tasks running.</div>
                ) : (
                    taskRows
                )}
            </div>
        );
    }

    return {
        id,
        icon,
        label,
        Content: TaskManagerContent,
    };
}
