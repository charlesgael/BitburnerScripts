import { AppDefinition } from "../../types";
import { createTaskManagerApp } from "../task-manager";

/**
 * The actual sidebar-launchable "Programs" app — which .js files it can
 * spawn, and what to call them, is fixed here in code (see
 * `../task-manager/index.ts` for the generic, reusable task-manager part:
 * spawning any of these on `home` or a non-reserved cloud server, and the
 * flat running-tasks list with per-task Tail/Kill).
 */
export const ProgramsApp: AppDefinition = createTaskManagerApp("programs", "Programs", "🚀", [
    { script: "netmapper.app.js", label: "Netmapper" },
    { script: "cracker.app.js", label: "Cracker" },
    { script: "flooder.app.js", label: "Flooder" },
    { script: "backdoor.lite.app.js", label: "List Backdoors", oneShot: true },
    { script: "backdoor.app.js", label: "Backdoor Installer" },
    { script: "next-targets.app.js", label: "Next Targets", oneShot: true },
    { script: "hacknet.app.js", label: "Hacknet" },
]);
