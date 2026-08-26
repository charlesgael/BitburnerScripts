import { AppComponentProps } from "../../../types";
import { theme, wrapText } from "../../../utils/theme";
import { useTrainer, STATS } from "../logic/use-trainer";
import { formatDuration } from "../logic/format-duration";

const DAEMON_HOST = "home";

/** Root component: stat/target picker, progress bar while training, and
 * the Start/Stop Training button. See `../index.ts`'s header comment for
 * what this app does and why. */
export function TrainerContent({ React }: AppComponentProps) {
    const t = useTrainer(React);

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
            {t.error ? (
                <div
                    style={{
                        color: theme.error,
                        marginBottom: "8px",
                        fontSize: "12px",
                        ...wrapText,
                    }}
                >
                    {t.error}
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
                {!t.training ? (
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
                            value={t.selectedStat}
                            onChange={(ev: any) => {
                                const stat = ev.target.value;
                                t.setSelectedStat(stat);
                                t.setTargetLevel((t.levels[stat] ?? 0) + 1);
                            }}
                            style={fieldStyle}
                        >
                            {STATS.map((s) => (
                                <option key={s.key} value={s.key}>
                                    {s.label} (Lv. {t.levels[s.key] ?? 0})
                                </option>
                            ))}
                        </select>
                    </label>
                ) : null}
                {!t.training ? (
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
                            min={t.minTargetLevel}
                            value={t.targetLevel}
                            onChange={(ev: any) =>
                                t.setTargetLevel(Math.max(t.minTargetLevel, Number(ev.target.value) || t.minTargetLevel))
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
                        checked={t.focus}
                        disabled={t.training}
                        onChange={(ev: any) => t.setFocusEnabled(ev.target.checked)}
                    />
                    Focus
                </label>
            </div>
            {t.training ? (
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
                                width: `${t.progressPct}%`,
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
                            {t.currentLevel} / {t.targetLevel} ({t.progressPct.toFixed(0)}%)
                        </span>
                        <span>{t.eta === null ? "Estimating…" : `~${formatDuration(t.eta)} left`}</span>
                    </div>
                </div>
            ) : null}
            {t.insufficientRam ? (
                <div
                    style={{
                        color: theme.error,
                        fontSize: "11px",
                        marginBottom: "6px",
                        ...wrapText,
                    }}
                >
                    Needs {t.daemonRam.toFixed(2)} GB free on {DAEMON_HOST} to launch daemons/train.daemon.js — only{" "}
                    {t.freeRam.toFixed(2)} GB is free. Free up RAM (e.g. stop other scripts) and this unlocks
                    automatically.
                </div>
            ) : null}
            <button
                onClick={t.toggleTraining}
                disabled={t.busy || t.insufficientRam}
                title={t.insufficientRam ? "Not enough free RAM to launch daemons/train.daemon.js" : undefined}
                style={{
                    width: "100%",
                    background: t.training ? theme.errorDark : theme.button,
                    color: t.training ? theme.error : theme.primary,
                    border: `1px solid ${t.training ? theme.error : theme.primary}`,
                    borderRadius: "4px",
                    padding: "6px 10px",
                    cursor: t.busy || t.insufficientRam ? "default" : "pointer",
                    opacity: t.busy || t.insufficientRam ? 0.6 : 1,
                    fontFamily: "inherit",
                }}
            >
                {t.busy ? "..." : t.training ? "Stop Training" : t.insufficientRam ? "Not Enough RAM" : "Start Training"}
            </button>
        </div>
    );
}
