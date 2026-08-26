import { theme, wrapText } from "../../../utils/theme";
import { ManagedAppDefinition } from "../logic/types";
import { taskKey } from "../logic/task-key";
import { useTaskManager } from "../logic/use-task-manager";
import { SpawnRow } from "./spawn-row";
import { TaskRow } from "./task-row";

/** Body shared by every `createTaskManagerApp` instance — the RAM bar, the
 * spawn rows (one per catalog entry), and the running-task list — driven
 * off `useTaskManager`. See `../index.ts`'s header comment for this app's
 * full design. */
export function TaskManagerBody({
    React,
    apps,
    runnableApps,
    appByScript,
}: {
    React: any;
    apps: ManagedAppDefinition[];
    runnableApps: ManagedAppDefinition[];
    appByScript: Record<string, ManagedAppDefinition>;
}) {
    const tm = useTaskManager(React, apps, runnableApps, appByScript);

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
                        width: `${tm.homePct}%`,
                        background: tm.homePct > 90 ? theme.error : theme.primary,
                        transition: "width 0.2s ease",
                    }}
                />
            </div>
            <div style={{ fontSize: "11px", opacity: 0.85, marginTop: "4px", textAlign: "right" }}>
                home: {tm.homeRam.used.toFixed(2)} / {tm.homeRam.max.toFixed(2)} GB
            </div>
        </div>
    );

    const errorBanner = tm.error ? (
        <div style={{ color: theme.error, fontSize: "11px", marginBottom: "8px", ...wrapText }}>{tm.error}</div>
    ) : null;

    // Invisible click-catcher that closes an open cloud-host menu when the
    // player clicks anywhere else. Sits at z-index 1 — below the open row's
    // z-index 2 (see SpawnRow) — and above everything else (which is
    // unpositioned, so it stacks below any explicitly positioned sibling
    // regardless of DOM order).
    const menuBackdrop = tm.openMenuFor ? (
        <div onClick={() => tm.setOpenMenuFor(null)} style={{ position: "fixed", inset: 0, zIndex: 1 }} />
    ) : null;

    return (
        <div>
            {menuBackdrop}
            {errorBanner}
            {ramBar}

            <div style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "4px" }}>Spawn</div>
            {apps.map((app) => (
                <SpawnRow key={app.script} React={React} tm={tm} app={app} />
            ))}

            <div style={{ fontSize: "12px", fontWeight: "bold", margin: "14px 0 4px" }}>
                Running Tasks {tm.tasks.length > 0 ? `(${tm.tasks.length})` : ""}
            </div>
            {tm.loading ? (
                <div style={{ fontSize: "12px", opacity: 0.7 }}>Loading...</div>
            ) : tm.tasks.length === 0 ? (
                <div style={{ fontSize: "12px", opacity: 0.7 }}>No tasks running.</div>
            ) : (
                tm.tasks.map((task) => (
                    <TaskRow key={taskKey(task)} React={React} tm={tm} task={task} app={appByScript[task.script]} />
                ))
            )}
        </div>
    );
}
