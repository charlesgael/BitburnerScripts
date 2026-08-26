import { theme, wrapText } from "../../../utils/theme";
import { ManagedAppDefinition, Task } from "../logic/types";
import { taskKey } from "../logic/task-key";
import { TaskManagerState } from "../logic/use-task-manager";

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

/** One running task's row: its label/host/RAM, and Tail/Kill buttons. */
export function TaskRow({
    React,
    tm,
    task,
    app,
}: {
    React: any;
    tm: TaskManagerState;
    task: Task;
    app: ManagedAppDefinition | undefined;
}) {
    const key = taskKey(task);
    const isOccupied = tm.taskBusy.has(key);
    const ram = (tm.appRam[task.script] ?? 0) * (app?.threads ?? 1);

    return (
        <div
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
                    onClick={() => void tm.tailTask(task)}
                    disabled={isOccupied}
                    title="Open this task's log window"
                    style={buttonStyle()}
                >
                    📃
                </button>
                <button onClick={() => void tm.killTask(task)} disabled={isOccupied} style={buttonStyle(true)}>
                    {isOccupied ? "..." : "Kill"}
                </button>
            </div>
        </div>
    );
}
