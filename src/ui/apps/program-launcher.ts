import { AppComponentProps, AppDefinition } from "../types";
import { useQueuedNs } from "../context/ns-queue-context";
import { useAddChildPid } from "../context/child-pids-context";
import { theme } from "../utils/theme";

/**
 * One script a `createProgramLauncherApp` instance can spawn/kill. This is
 * configured in code (see `ui/apps/index.ts`), not editable from the UI.
 */
export interface ProgramDefinition {
    /** Path to the script to run, e.g. "flooder.app.js". */
    script: string;
    /** Label shown next to the spawn/kill button (its RAM cost is appended
     * automatically once it's known — see `ns.getScriptRam` below). */
    label: string;
    /** Host to run it (and look for it running) on. Defaults to "home". */
    host?: string;
    /** Args to run it with — also used to match the right instance when
     * checking whether it's already running, or killing it. Defaults to []. */
    args?: (string | number | boolean)[];
    /** Thread count to spawn with. Defaults to 1. */
    threads?: number;
}

type RamUsage = { used: number; max: number };

/**
 * Builds an app that lists `programs`, each with a single button that spawns
 * the script if it isn't running, or kills it if it is. The list — which
 * .js files, what to call them — is a parameter of this factory, fixed in
 * source; there's no in-UI way to add or edit entries.
 *
 * Each label is shown with its RAM cost (`ns.getScriptRam`), and spawning is
 * blocked — button disabled — when there isn't enough free RAM on the
 * program's host to cover it. A RAM bar for the primary host (the first
 * program's `host`, or "home") sits above the list as a general "how much
 * room do I have" indicator; the per-program spawn check always uses that
 * specific program's own host, not just the bar's host.
 */
export function createProgramLauncherApp(
    id: string,
    label: string,
    icon: string,
    programs: ProgramDefinition[]
): AppDefinition {
    const hosts = Array.from(new Set(programs.map((p) => p.host ?? "home")));
    const primaryHost = programs[0]?.host ?? "home";

    function ProgramLauncherContent({ React }: AppComponentProps) {
        const e = React.createElement;
        const ns = useQueuedNs();
        const addChildPid = useAddChildPid();

        const [runningState, setRunningState] = React.useState(() =>
            Object.fromEntries(programs.map((p) => [p.script, false]))
        );
        const [busy, setBusy] = React.useState(() => new Set());
        const [scriptRam, setScriptRam] = React.useState(() =>
            Object.fromEntries(programs.map((p) => [p.script, 0]))
        );
        const [ramByHost, setRamByHost] = React.useState(() =>
            Object.fromEntries(hosts.map((h) => [h, { used: 0, max: 0 } as RamUsage]))
        );

        async function refreshRam() {
            for (const host of hosts) {
                const [used, max] = await Promise.all([ns.getServerUsedRam(host), ns.getServerMaxRam(host)]);
                setRamByHost((prev: Record<string, RamUsage>) => ({ ...prev, [host]: { used, max } }));
            }
        }

        // This component remounts every time the modal is opened, so local
        // state can't be trusted to reflect reality — re-detect what's
        // actually running (started from a previous open, or from outside
        // this UI entirely), each script's RAM cost, and current RAM usage,
        // instead of assuming stale/default values.
        React.useEffect(() => {
            let cancelled = false;
            (async () => {
                for (const program of programs) {
                    const host = program.host ?? "home";
                    const args = program.args ?? [];
                    const [isRunning, ramPerThread] = await Promise.all([
                        ns.isRunning(program.script, host, ...args),
                        ns.getScriptRam(program.script, host),
                    ]);
                    if (cancelled) return;
                    setRunningState((prev: Record<string, boolean>) => ({
                        ...prev,
                        [program.script]: isRunning,
                    }));
                    setScriptRam((prev: Record<string, number>) => ({
                        ...prev,
                        [program.script]: ramPerThread,
                    }));
                }
                if (!cancelled) await refreshRam();
            })();
            return () => {
                cancelled = true;
            };
        }, []);

        async function toggle(program: ProgramDefinition) {
            const host = program.host ?? "home";
            const args = program.args ?? [];

            setBusy((prev: Set<string>) => new Set(prev).add(program.script));
            try {
                if (runningState[program.script]) {
                    await ns.kill(program.script, host, ...args);
                    setRunningState((prev: Record<string, boolean>) => ({
                        ...prev,
                        [program.script]: false,
                    }));
                } else {
                    const requiredRam = (scriptRam[program.script] ?? 0) * (program.threads ?? 1);
                    const hostRam = ramByHost[host] ?? { used: 0, max: 0 };
                    const freeRam = hostRam.max - hostRam.used;
                    // Defensive: the button is already disabled in this case,
                    // but don't call exec if RAM ran out between renders.
                    if (requiredRam > freeRam) return;

                    const pid = await ns.exec(program.script, host, program.threads ?? 1, ...args);
                    if (pid !== 0) {
                        addChildPid(pid);
                        setRunningState((prev: Record<string, boolean>) => ({
                            ...prev,
                            [program.script]: true,
                        }));
                    }
                    // pid === 0 means exec failed (not enough RAM after all,
                    // bad filename, ...) — leave it marked as not running.
                }
                await refreshRam();
            } finally {
                setBusy((prev: Set<string>) => {
                    const next = new Set(prev);
                    next.delete(program.script);
                    return next;
                });
            }
        }

        async function openLog(program: ProgramDefinition) {
            const host = program.host ?? "home";
            const args = program.args ?? [];
            await ns.ui.openTail(program.script, host, ...args);
        }

        const primaryRam = ramByHost[primaryHost] ?? { used: 0, max: 0 };
        const primaryPct = primaryRam.max > 0 ? Math.min(100, (primaryRam.used / primaryRam.max) * 100) : 0;

        const ramBar = e(
            "div",
            { style: { marginBottom: "12px" } },
            e(
                "div",
                {
                    style: {
                        position: "relative",
                        height: "14px",
                        borderRadius: "4px",
                        background: theme.well,
                        border: `1px solid ${theme.primaryDark}`,
                        overflow: "hidden",
                    },
                },
                e("div", {
                    style: {
                        position: "absolute",
                        inset: 0,
                        width: `${primaryPct}%`,
                        background: primaryPct > 90 ? theme.error : theme.primary,
                        transition: "width 0.2s ease",
                    },
                })
            ),
            e(
                "div",
                { style: { fontSize: "11px", opacity: 0.85, marginTop: "4px", textAlign: "right" } },
                `${primaryHost}: ${primaryRam.used.toFixed(2)} / ${primaryRam.max.toFixed(2)} GB`
            )
        );

        const rows = programs.map((program) => {
            const isRunning = runningState[program.script];
            const isPending = busy.has(program.script);
            const requiredRam = (scriptRam[program.script] ?? 0) * (program.threads ?? 1);
            const hostRam = ramByHost[program.host ?? "home"] ?? { used: 0, max: 0 };
            const freeRam = hostRam.max - hostRam.used;
            const insufficientRam = !isRunning && requiredRam > freeRam;
            const disabled = isPending || insufficientRam;

            return e(
                "div",
                {
                    key: program.script,
                    style: {
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "12px",
                        padding: "6px 0",
                        borderBottom: `1px solid ${theme.well}`,
                    },
                },
                e("span", null, `${program.label} (${requiredRam.toFixed(2)} GB)`),
                e(
                    "div",
                    { style: { display: "flex", gap: "6px" } },
                    isRunning
                        ? e(
                              "button",
                              {
                                  onClick: () => openLog(program),
                                  title: "Open this program's log window",
                                  style: {
                                      background: theme.button,
                                      color: theme.primary,
                                      border: `1px solid ${theme.primary}`,
                                      borderRadius: "4px",
                                      padding: "4px 10px",
                                      cursor: "pointer",
                                      fontFamily: "inherit",
                                  },
                              },
                              "📃"
                          )
                        : null,
                    e(
                        "button",
                        {
                            onClick: () => toggle(program),
                            disabled,
                            title: insufficientRam ? "Not enough free RAM" : undefined,
                            style: {
                                minWidth: "60px",
                                background: isRunning ? theme.errorDark : theme.button,
                                color: isRunning ? theme.error : theme.primary,
                                border: `1px solid ${isRunning ? theme.error : theme.primary}`,
                                borderRadius: "4px",
                                padding: "4px 10px",
                                cursor: disabled ? "default" : "pointer",
                                opacity: disabled ? 0.6 : 1,
                                fontFamily: "inherit",
                            },
                        },
                        isPending ? "..." : isRunning ? "Kill" : insufficientRam ? "No RAM" : "Spawn"
                    )
                )
            );
        });

        return e("div", null, ramBar, ...rows);
    }

    return {
        id,
        icon,
        label,
        Content: ProgramLauncherContent,
    };
}
