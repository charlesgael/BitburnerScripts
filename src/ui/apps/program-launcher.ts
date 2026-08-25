import { AppComponentProps, AppDefinition } from "../types";
import { useQueuedNs } from "../context/ns-queue-context";
import { useAddChildPid } from "../context/child-pids-context";
import { theme, wrapText } from "../utils/theme";
import { fetchCloudList, CloudServerRow } from "../utils/cloud-list";
import { spawnRemote } from "../utils/spawn-remote";

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
 *
 * Whenever at least one purchased ("cloud") server has enough free RAM to
 * run a program, its button grows a small "▾" that opens a popup menu
 * listing only those compatible servers — picking one spawns there instead
 * of the program's configured host, via `spawn-remote.daemon.ts` (which
 * ns.scp's the script over first — unlike `home`, a cloud server never has
 * it already — then execs it there; see that daemon's header comment). If
 * no cloud server qualifies, the button is unchanged. Cloud-server
 * capacity comes from `cloud-list.daemon.js` (via `ui/utils/cloud-list.ts`),
 * the same mechanism the Cloud Servers app uses, so this file never
 * references `ns.cloud.*` (or `ns.scp`) directly — see those utils' header
 * comments for why. Since a program can now be running on a cloud server
 * instead of its configured host, the "is it running" check also scans
 * every cloud server (not just the configured host) so Kill still works
 * after reopening this window.
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

        // runningHost[script] is the host it's actually running on — its
        // configured host, or a cloud server it was spawned on via the
        // dropdown below — or null if it isn't running anywhere.
        const [runningHost, setRunningHost] = React.useState(() =>
            Object.fromEntries(programs.map((p) => [p.script, null as string | null]))
        );
        const [busy, setBusy] = React.useState(() => new Set());
        const [scriptRam, setScriptRam] = React.useState(() =>
            Object.fromEntries(programs.map((p) => [p.script, 0]))
        );
        const [ramByHost, setRamByHost] = React.useState(() =>
            Object.fromEntries(hosts.map((h) => [h, { used: 0, max: 0 } as RamUsage]))
        );
        const [cloudServers, setCloudServers]: [CloudServerRow[], (v: CloudServerRow[]) => void] = React.useState([]);
        // Which program's cloud-host menu is open, if any — at most one at
        // a time.
        const [openMenuFor, setOpenMenuFor] = React.useState(null as string | null);
        const [error, setError] = React.useState(null as string | null);

        async function refreshRam() {
            for (const host of hosts) {
                const [used, max] = await Promise.all([ns.getServerUsedRam(host), ns.getServerMaxRam(host)]);
                setRamByHost((prev: Record<string, RamUsage>) => ({ ...prev, [host]: { used, max } }));
            }
        }

        // Non-fatal on failure (e.g. not enough free RAM to launch the list
        // daemon right now) — the compatibility dropdown just won't offer
        // anything until it succeeds.
        async function refreshCloudServers(): Promise<CloudServerRow[]> {
            try {
                const result = await fetchCloudList(ns, addChildPid);
                setCloudServers(result.servers);
                return result.servers;
            } catch {
                setCloudServers([]);
                return [];
            }
        }

        // This component remounts every time the modal is opened, so local
        // state can't be trusted to reflect reality — re-detect what's
        // actually running (started from a previous open, or from outside
        // this UI entirely — on the configured host or any cloud server),
        // each script's RAM cost, and current RAM usage, instead of
        // assuming stale/default values.
        React.useEffect(() => {
            let cancelled = false;
            (async () => {
                const cloudList = await refreshCloudServers();
                if (cancelled) return;

                for (const program of programs) {
                    const host = program.host ?? "home";
                    const args = program.args ?? [];

                    const ramPerThread = await ns.getScriptRam(program.script, host);
                    if (cancelled) return;
                    setScriptRam((prev: Record<string, number>) => ({
                        ...prev,
                        [program.script]: ramPerThread,
                    }));

                    let foundHost: string | null = null;
                    if (await ns.isRunning(program.script, host, ...args)) {
                        foundHost = host;
                    } else {
                        for (const cs of cloudList) {
                            if (cs.hostname === host) continue;
                            if (await ns.isRunning(program.script, cs.hostname, ...args)) {
                                foundHost = cs.hostname;
                                break;
                            }
                        }
                    }
                    if (cancelled) return;
                    setRunningHost((prev: Record<string, string | null>) => ({
                        ...prev,
                        [program.script]: foundHost,
                    }));
                }
                if (!cancelled) await refreshRam();
            })();
            return () => {
                cancelled = true;
            };
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

        async function toggle(program: ProgramDefinition) {
            const configuredHost = program.host ?? "home";
            const args = program.args ?? [];
            const runningAt = runningHost[program.script];

            setError(null);
            setBusy((prev: Set<string>) => new Set(prev).add(program.script));
            try {
                if (runningAt) {
                    await ns.kill(program.script, runningAt, ...args);
                    setRunningHost((prev: Record<string, string | null>) => ({
                        ...prev,
                        [program.script]: null,
                    }));
                } else {
                    const requiredRam = (scriptRam[program.script] ?? 0) * (program.threads ?? 1);
                    const hostRam = ramByHost[configuredHost] ?? { used: 0, max: 0 };
                    const freeRam = hostRam.max - hostRam.used;
                    // Defensive: the button is already disabled in this case,
                    // but don't call exec if RAM ran out between renders.
                    if (requiredRam > freeRam) return;

                    const pid = await ns.exec(program.script, configuredHost, program.threads ?? 1, ...args);
                    if (pid !== 0) {
                        setRunningHost((prev: Record<string, string | null>) => ({
                            ...prev,
                            [program.script]: configuredHost,
                        }));
                    } else {
                        setError(
                            `Couldn't start ${program.script} on ${configuredHost} — enough free RAM? Already running with different args?`
                        );
                    }
                }
                await refreshRam();
                await refreshCloudServers();
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setBusy((prev: Set<string>) => {
                    const next = new Set(prev);
                    next.delete(program.script);
                    return next;
                });
            }
        }

        // Spawns on a specific cloud server picked from the dropdown,
        // instead of the program's configured host.
        async function spawnOnCloudHost(program: ProgramDefinition, host: string) {
            const args = program.args ?? [];
            setError(null);
            setBusy((prev: Set<string>) => new Set(prev).add(program.script));
            try {
                const requiredRam = (scriptRam[program.script] ?? 0) * (program.threads ?? 1);
                const cs = cloudServers.find((s) => s.hostname === host);
                const freeRam = cs ? cs.ram - cs.usedRam : 0;
                // Defensive: the dropdown only lists compatible hosts, but
                // free RAM can change between renders.
                if (requiredRam > freeRam) return;

                // Unlike `home` (which Viteburner deploys scripts to
                // directly), a cloud server never has the script on it
                // already — spawnRemote copies it over (ns.scp) before
                // exec'ing, both inside spawn-remote.daemon.ts so neither
                // call's RAM cost lands on ui.app.js. See that daemon's
                // header comment.
                const result = await spawnRemote(ns, addChildPid, program.script, host, program.threads ?? 1, args);
                if (result.ok && result.pid) {
                    setRunningHost((prev: Record<string, string | null>) => ({
                        ...prev,
                        [program.script]: host,
                    }));
                } else {
                    setError(result.error ?? `Couldn't start ${program.script} on ${host}.`);
                }
                await refreshCloudServers();
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setBusy((prev: Set<string>) => {
                    const next = new Set(prev);
                    next.delete(program.script);
                    return next;
                });
            }
        }

        async function openLog(program: ProgramDefinition) {
            const host = runningHost[program.script] ?? program.host ?? "home";
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
            const runningAt = runningHost[program.script];
            const isRunning = runningAt != null;
            const isPending = busy.has(program.script);
            const requiredRam = (scriptRam[program.script] ?? 0) * (program.threads ?? 1);
            const hostRam = ramByHost[program.host ?? "home"] ?? { used: 0, max: 0 };
            const freeRam = hostRam.max - hostRam.used;
            const insufficientRam = !isRunning && requiredRam > freeRam;
            const disabled = isPending || insufficientRam;

            // Cloud servers with enough free RAM to run this program right
            // now — only offered while it isn't already running somewhere.
            const compatibleCloudHosts = isRunning
                ? []
                : cloudServers.filter((cs) => cs.ram - cs.usedRam >= requiredRam);
            const hasCloudOption = compatibleCloudHosts.length > 0;

            const spawnBorderColor = isRunning ? theme.error : theme.primary;
            const spawnButton = e(
                "button",
                {
                    onClick: () => toggle(program),
                    disabled,
                    title: insufficientRam ? "Not enough free RAM" : undefined,
                    style: {
                        minWidth: "60px",
                        background: isRunning ? theme.errorDark : theme.button,
                        color: isRunning ? theme.error : theme.primary,
                        // Every side set individually and unconditionally
                        // (rather than a `border` shorthand plus a
                        // conditionally-omitted borderRight override) so
                        // there's no shorthand-vs-longhand ordering to get
                        // wrong: each side always gets a real string, never
                        // an omitted/undefined one.
                        borderTop: `1px solid ${spawnBorderColor}`,
                        borderBottom: `1px solid ${spawnBorderColor}`,
                        borderLeft: `1px solid ${spawnBorderColor}`,
                        borderRight: hasCloudOption ? "none" : `1px solid ${spawnBorderColor}`,
                        borderRadius: hasCloudOption ? "4px 0 0 4px" : "4px",
                        padding: "4px 10px",
                        cursor: disabled ? "default" : "pointer",
                        opacity: disabled ? 0.6 : 1,
                        fontFamily: "inherit",
                    },
                },
                isPending ? "..." : isRunning ? "Kill" : insufficientRam ? "No RAM" : "Spawn"
            );

            const menuOpen = openMenuFor === program.script;

            // A compact "▾" button that toggles a small popup menu listing
            // only the compatible cloud servers — cheaper on space than a
            // native <select>, which always reserves room for its widest
            // option even closed. Wrapped in its own `position: relative`
            // box so the popup (position: absolute) anchors to it; gets a
            // z-index above the click-catching backdrop below only while
            // its menu is open, so the popup — and the arrow button itself,
            // to keep toggling it closed working — aren't hidden behind it.
            const cloudMenuButton = hasCloudOption
                ? e(
                      "div",
                      {
                          // `display: flex` here (rather than just on the row
                          // above) is what makes the arrow button stretch to
                          // match spawnButton's height: the row's flex already
                          // stretches *this* wrapper div to that height, and
                          // making the wrapper itself a flex container in turn
                          // stretches its own child (the button, which has no
                          // explicit height) to fill it.
                          style: {
                              position: "relative",
                              display: "flex",
                              ...(menuOpen ? { zIndex: 2 } : {}),
                          },
                      },
                      e(
                          "button",
                          {
                              onClick: () => setOpenMenuFor(menuOpen ? null : program.script),
                              disabled: isPending,
                              title: "Spawn on a cloud server instead",
                              style: {
                                  boxSizing: "border-box",
                                  background: theme.button,
                                  color: theme.primary,
                                  border: `1px solid ${theme.primary}`,
                                  borderRadius: "0 4px 4px 0",
                                  padding: "0 6px",
                                  fontFamily: "inherit",
                                  fontSize: "10px",
                                  cursor: isPending ? "default" : "pointer",
                              },
                          },
                          "▾"
                      ),
                      menuOpen
                          ? e(
                                "div",
                                {
                                    style: {
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
                                    },
                                },
                                ...compatibleCloudHosts.map((cs) =>
                                    e(
                                        "button",
                                        {
                                            key: cs.hostname,
                                            onClick: () => {
                                                setOpenMenuFor(null);
                                                void spawnOnCloudHost(program, cs.hostname);
                                            },
                                            style: {
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
                                            },
                                        },
                                        `${cs.hostname} (${(cs.ram - cs.usedRam).toFixed(1)} GB free)`
                                    )
                                )
                            )
                          : null
                  )
                : null;

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
                    e("div", { style: { display: "flex" } }, spawnButton, cloudMenuButton)
                )
            );
        });

        // Invisible click-catcher that closes an open cloud-host menu when
        // the player clicks anywhere else. Sits at z-index 1 — below the
        // open row's z-index 2 above, so that row's button and popup still
        // receive their own clicks — and above everything else (which is
        // unpositioned, so it stacks below any explicitly positioned
        // sibling regardless of DOM order).
        const menuBackdrop = openMenuFor
            ? e("div", { onClick: () => setOpenMenuFor(null), style: { position: "fixed", inset: 0, zIndex: 1 } })
            : null;

        const errorBanner = error
            ? e("div", { style: { color: theme.error, fontSize: "11px", marginBottom: "8px", ...wrapText } }, error)
            : null;

        return e("div", null, menuBackdrop, errorBanner, ramBar, ...rows);
    }

    return {
        id,
        icon,
        label,
        Content: ProgramLauncherContent,
    };
}
