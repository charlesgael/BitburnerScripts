import {
    AppAvailabilityContext,
    AppComponentProps,
    AppDefinition,
} from "../types";
import { useQueuedNs } from "../context/ns-queue-context";
import { useAddChildPid } from "../context/child-pids-context";
import { useHomeRam } from "../context/home-ram-context";
import { theme, wrapText } from "../utils/theme";

/**
 * This app is a thin launcher — it never calls ns.singularity.* itself.
 * Training actually happens in `daemons/train.daemon.ts`, spawned/killed via
 * ns.exec/ns.kill. See that file for why: universityCourse/gymWorkout/
 * stopAction/isBusy are collectively ~88GB, and Bitburner charges a script
 * for every ns.* function it merely references, reachable or not — calling
 * them directly from here would permanently add that to ui.app.ts's RAM
 * footprint, since it's always running. exec/kill/isRunning/getPlayer/ps
 * cost a few cents on the GB by comparison. `home`'s used/max RAM comes
 * from `useHomeRam()` (see `ui/context/home-ram-context.ts`) rather than
 * this app polling ns.getServerUsedRam/getServerMaxRam on its own timer.
 */
type StatKey =
    | "hacking"
    | "charisma"
    | "strength"
    | "defense"
    | "dexterity"
    | "agility";

const STATS: { key: StatKey; label: string }[] = [
    { key: "hacking", label: "Hacking" },
    { key: "charisma", label: "Charisma" },
    { key: "strength", label: "Strength" },
    { key: "defense", label: "Defense" },
    { key: "dexterity", label: "Dexterity" },
    { key: "agility", label: "Agility" },
];

const DAEMON_SCRIPT = "daemons/train.daemon.js";
const DAEMON_HOST = "home";

function formatDuration(totalSeconds: number): string {
    if (!isFinite(totalSeconds) || totalSeconds < 0) return "—";
    const s = Math.round(totalSeconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

function TrainerContent({ React }: AppComponentProps) {
    const ns = useQueuedNs();
    const addChildPid = useAddChildPid();

    const [levels, setLevels] = React.useState(() =>
        Object.fromEntries(STATS.map((s) => [s.key, 0]))
    );
    const [selectedStat, setSelectedStat] = React.useState(STATS[0].key);
    const [targetLevel, setTargetLevel] = React.useState(50);
    const [focus, setFocusEnabled] = React.useState(true);
    const [pid, setPid] = React.useState(null); // non-null while we know a daemon is running
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(null);
    const [sessionStartLevel, setSessionStartLevel] = React.useState(null);
    const [sessionStartTime, setSessionStartTime] = React.useState(null);
    const [daemonRam, setDaemonRam] = React.useState(0); // GB daemons/train.daemon.js needs to run

    const homeRam = useHomeRam();
    const training = pid != null;
    const freeRam = homeRam.max - homeRam.used;
    // daemons/train.daemon.js statically references every ns.singularity.* call in
    // any of its branches (that's exactly why it's a separate script — see
    // the header comment), so its RAM cost is the same fixed ~88GB no
    // matter which stat/target is picked; this is just "is there enough
    // room to launch it at all".
    const insufficientRam = !training && daemonRam > freeRam;

    // This component remounts every time the window is opened. Re-fetch
    // every stat's current level, and check for an already-running
    // daemons/train.daemon.js via ns.ps (cheap) — from a previous open of this
    // window, or however else it got started — instead of assuming
    // nothing's happening and risking a duplicate launch.
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const player = await ns.getPlayer();
            if (cancelled) return;
            const nextLevels: Record<string, number> = {};
            for (const s of STATS) nextLevels[s.key] = player.skills[s.key];
            setLevels(nextLevels);

            const processes = await ns.ps(DAEMON_HOST);
            if (cancelled) return;
            const proc = processes.find((p) => p.filename === DAEMON_SCRIPT);
            if (!proc) {
                // No daemon running — default the target to just above
                // wherever the initially-selected stat already is, same
                // rule the stat dropdown's onChange applies.
                setTargetLevel(nextLevels[STATS[0].key] + 1);
                return;
            }

            const [stat, target, focusArg] = proc.args;
            if (!STATS.some((s) => s.key === stat)) return;

            setSelectedStat(stat as StatKey);
            setTargetLevel(Number(target));
            setFocusEnabled(focusArg === undefined ? true : Boolean(focusArg));
            setPid(proc.pid);
            setSessionStartLevel(nextLevels[stat as string]);
            setSessionStartTime(Date.now());
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // daemons/train.daemon.js's RAM cost is fixed for the life of the file, so this
    // only needs fetching once.
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const cost = await ns.getScriptRam(DAEMON_SCRIPT, DAEMON_HOST);
            if (!cancelled) setDaemonRam(cost);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // While we're tracking a daemon: poll the level, and notice if it
    // exited on its own (target reached, or killed some other way) so the
    // button doesn't stay stuck on "Stop Training".
    React.useEffect(() => {
        if (pid == null) return;

        const interval = setInterval(() => {
            (async () => {
                const stillRunning = await ns.isRunning(pid);
                if (!stillRunning) {
                    setPid(null);
                    return;
                }
                const player = await ns.getPlayer();
                setLevels((prev: Record<string, number>) => ({
                    ...prev,
                    [selectedStat]: player.skills[selectedStat as StatKey],
                }));
            })();
        }, 2000);

        return () => clearInterval(interval);
    }, [pid, selectedStat]);

    async function toggleTraining() {
        setBusy(true);
        setError(null);
        try {
            if (pid != null) {
                await ns.kill(pid);
                setPid(null);
                return;
            }

            const currentLevel = levels[selectedStat] ?? 0;
            if (currentLevel >= targetLevel) {
                setError("Already at or above the target level.");
                return;
            }

            // Defensive: the button is already disabled in this case, but
            // free RAM can change between renders (another script started,
            // this poll hasn't caught up yet, ...).
            if (daemonRam > freeRam) {
                setError(
                    `Not enough free RAM: ${DAEMON_SCRIPT} needs ${daemonRam.toFixed(
                        2
                    )} GB, only ` +
                        `${freeRam.toFixed(2)} GB is free on ${DAEMON_HOST}.`
                );
                return;
            }

            const newPid = await ns.exec(
                DAEMON_SCRIPT,
                DAEMON_HOST,
                1,
                selectedStat,
                targetLevel,
                focus
            );
            if (newPid === 0) {
                setError(
                    `Couldn't launch ${DAEMON_SCRIPT} — enough RAM? Is it deployed to ${DAEMON_HOST}?`
                );
                return;
            }

            addChildPid(newPid);
            setPid(newPid);
            setSessionStartLevel(currentLevel);
            setSessionStartTime(Date.now());
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }

    const currentLevel = levels[selectedStat] ?? 0;
    const minTargetLevel = currentLevel + 1; // can't train toward a level you're already at/past
    const progressPct =
        targetLevel > 0 ? Math.min(100, (currentLevel / targetLevel) * 100) : 0;

    let eta: number | null = null;
    if (training && sessionStartLevel != null && sessionStartTime != null) {
        const levelsGained = currentLevel - sessionStartLevel;
        if (levelsGained > 0) {
            const elapsedSec = (Date.now() - sessionStartTime) / 1000;
            const secPerLevel = elapsedSec / levelsGained;
            eta = secPerLevel * Math.max(0, targetLevel - currentLevel);
        }
    }

    const fieldStyle = {
        background: theme.well,
        color: theme.primary,
        border: `1px solid ${theme.primary}`,
        borderRadius: "4px",
        padding: "4px",
        fontFamily: "inherit",
    };

    return (
        <div>
            {error ? (
                <div
                    style={{
                        color: theme.error,
                        marginBottom: "8px",
                        fontSize: "12px",
                        ...wrapText,
                    }}
                >
                    {error}
                </div>
            ) : null}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    marginBottom: "12px",
                }}
            >
                {!training ? (
                    <label
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                            fontSize: "12px",
                        }}
                    >
                        Stat
                        <select
                            value={selectedStat}
                            onChange={(ev: any) => {
                                const stat = ev.target.value;
                                setSelectedStat(stat);
                                setTargetLevel((levels[stat] ?? 0) + 1);
                            }}
                            style={fieldStyle}
                        >
                            {STATS.map((s) => (
                                <option key={s.key} value={s.key}>
                                    {s.label} (Lv. {levels[s.key] ?? 0})
                                </option>
                            ))}
                        </select>
                    </label>
                ) : null}
                {!training ? (
                    <label
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                            fontSize: "12px",
                        }}
                    >
                        Target level
                        <input
                            type="number"
                            min={minTargetLevel}
                            value={targetLevel}
                            onChange={(ev: any) =>
                                setTargetLevel(
                                    Math.max(
                                        minTargetLevel,
                                        Number(ev.target.value) ||
                                            minTargetLevel
                                    )
                                )
                            }
                            style={fieldStyle}
                        />
                    </label>
                ) : null}
                <label
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "12px",
                    }}
                >
                    <input
                        type="checkbox"
                        checked={focus}
                        disabled={training}
                        onChange={(ev: any) =>
                            setFocusEnabled(ev.target.checked)
                        }
                    />
                    Focus
                </label>
            </div>
            {training ? (
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
                                width: `${progressPct}%`,
                                background: theme.primary,
                                transition: "width 0.3s ease",
                            }}
                        />
                    </div>
                    <div
                        style={{
                            fontSize: "11px",
                            opacity: 0.85,
                            marginTop: "4px",
                            display: "flex",
                            justifyContent: "space-between",
                        }}
                    >
                        <span>
                            {currentLevel} / {targetLevel} (
                            {progressPct.toFixed(0)}%)
                        </span>
                        <span>
                            {eta === null
                                ? "Estimating…"
                                : `~${formatDuration(eta)} left`}
                        </span>
                    </div>
                </div>
            ) : null}
            {insufficientRam ? (
                <div
                    style={{
                        color: theme.error,
                        fontSize: "11px",
                        marginBottom: "6px",
                        ...wrapText,
                    }}
                >
                    Needs {daemonRam.toFixed(2)} GB free on {DAEMON_HOST} to
                    launch daemons/train.daemon.js — only {freeRam.toFixed(2)}{" "}
                    GB is free. Free up RAM (e.g. stop other scripts) and this
                    unlocks automatically.
                </div>
            ) : null}
            <button
                onClick={toggleTraining}
                disabled={busy || insufficientRam}
                title={
                    insufficientRam
                        ? "Not enough free RAM to launch daemons/train.daemon.js"
                        : undefined
                }
                style={{
                    width: "100%",
                    background: training ? theme.errorDark : theme.button,
                    color: training ? theme.error : theme.primary,
                    border: `1px solid ${
                        training ? theme.error : theme.primary
                    }`,
                    borderRadius: "4px",
                    padding: "6px 10px",
                    cursor: busy || insufficientRam ? "default" : "pointer",
                    opacity: busy || insufficientRam ? 0.6 : 1,
                    fontFamily: "inherit",
                }}
            >
                {busy
                    ? "..."
                    : training
                    ? "Stop Training"
                    : insufficientRam
                    ? "Not Enough RAM"
                    : "Start Training"}
            </button>
        </div>
    );
}

// daemons/train.daemon.ts is all ns.singularity.* calls (see its header
// comment), which need either owned SF4 or, before it's ever been owned,
// simply being in the middle of playing BitNode 4 itself (the
// "Singularity" BitNode) — a plain `minSourceFile: { n: 4, lvl: 1 }` can't
// express that OR, hence the escape-hatch lambda instead (see `ui/utils/
// app-availability.ts`).
function trainerAvailable(ctx: AppAvailabilityContext): true | string {
    if ((ctx.ownedSF.get(4) ?? 0) >= 1 || ctx.currentNode === 4) return true;
    return "Needs Source-File 4 (or being in BitNode 4) for Singularity access.";
}

export const TrainerApp: AppDefinition = {
    id: "trainer",
    icon: "💪",
    label: "Trainer",
    Content: TrainerContent,
    minRam: 90.1,
    isAvailable: trainerAvailable,
};
