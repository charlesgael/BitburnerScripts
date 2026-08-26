import { useQueuedNs } from "../../../context/ns-queue-context";
import { useAddChildPid } from "../../../context/child-pids-context";
import { useHomeRam } from "../../../context/home-ram-context";

export type StatKey = "hacking" | "charisma" | "strength" | "defense" | "dexterity" | "agility";

export const STATS: { key: StatKey; label: string }[] = [
    { key: "hacking", label: "Hacking" },
    { key: "charisma", label: "Charisma" },
    { key: "strength", label: "Strength" },
    { key: "defense", label: "Defense" },
    { key: "dexterity", label: "Dexterity" },
    { key: "agility", label: "Agility" },
];

const DAEMON_SCRIPT = "daemons/train.daemon.js";
const DAEMON_HOST = "home";

/**
 * All Trainer state and behavior. See `../index.ts`'s header comment for
 * why this app never calls `ns.singularity.*` itself and instead launches
 * `daemons/train.daemon.ts`.
 */
export function useTrainer(React: any) {
    const ns = useQueuedNs();
    const addChildPid = useAddChildPid();
    const homeRam = useHomeRam();

    const [levels, setLevels] = React.useState(() => Object.fromEntries(STATS.map((s) => [s.key, 0])));
    const [selectedStat, setSelectedStat] = React.useState(STATS[0].key);
    const [targetLevel, setTargetLevel] = React.useState(50);
    const [focus, setFocusEnabled] = React.useState(true);
    const [pid, setPid] = React.useState(null); // non-null while we know a daemon is running
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(null);
    const [sessionStartLevel, setSessionStartLevel] = React.useState(null);
    const [sessionStartTime, setSessionStartTime] = React.useState(null);
    const [daemonRam, setDaemonRam] = React.useState(0); // GB daemons/train.daemon.js needs to run

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
                    `Not enough free RAM: ${DAEMON_SCRIPT} needs ${daemonRam.toFixed(2)} GB, only ` +
                        `${freeRam.toFixed(2)} GB is free on ${DAEMON_HOST}.`
                );
                return;
            }

            const newPid = await ns.exec(DAEMON_SCRIPT, DAEMON_HOST, 1, selectedStat, targetLevel, focus);
            if (newPid === 0) {
                setError(`Couldn't launch ${DAEMON_SCRIPT} — enough RAM? Is it deployed to ${DAEMON_HOST}?`);
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
    const progressPct = targetLevel > 0 ? Math.min(100, (currentLevel / targetLevel) * 100) : 0;

    let eta: number | null = null;
    if (training && sessionStartLevel != null && sessionStartTime != null) {
        const levelsGained = currentLevel - sessionStartLevel;
        if (levelsGained > 0) {
            const elapsedSec = (Date.now() - sessionStartTime) / 1000;
            const secPerLevel = elapsedSec / levelsGained;
            eta = secPerLevel * Math.max(0, targetLevel - currentLevel);
        }
    }

    return {
        levels,
        selectedStat,
        setSelectedStat,
        targetLevel,
        setTargetLevel,
        focus,
        setFocusEnabled,
        busy,
        error,
        training,
        insufficientRam,
        daemonRam,
        freeRam,
        currentLevel,
        minTargetLevel,
        progressPct,
        eta,
        toggleTraining,
    };
}

/** Everything `TrainerContent` needs from this hook. */
export type TrainerState = ReturnType<typeof useTrainer>;
