import { AppDefinition } from "../types";
import { HelloWorldApp } from "./hello-world";
import { createTaskManagerApp } from "./task-manager";
import { TrainerApp } from "./trainer";
import { CloudServersApp } from "./cloud-servers";
import { ShareApp } from "./share";
import { XpFarmApp } from "./xp-farm";

/**
 * The actual sidebar-launchable "Programs" app — which .js files it can
 * spawn, and what to call them, is fixed here in code (see
 * `task-manager.tsx` for the generic, reusable task-manager part: spawning
 * any of these on `home` or a non-reserved cloud server, and the flat
 * running-tasks list with per-task Tail/Kill).
 */
const ProgramsApp = createTaskManagerApp("programs", "Programs", "🚀", [
    { script: "netmapper.app.js", label: "Netmapper" },
    { script: "cracker.app.js", label: "Cracker" },
    { script: "backdoor.app.js", label: "Backdoor Installer" },
    { script: "backdoor.lite.app.js", label: "List Backdoors", oneShot: true },
    { script: "flooder.app.js", label: "Flooder" },
    { script: "hacknet.app.js", label: "Hacknet" },
]);

/**
 * Registry of every app shown in the sidebar grid (see
 * `ui/components/app-grid.tsx`). To add a new app: create a file next to
 * `hello-world.tsx` exporting an `AppDefinition`, then list it here.
 */
export const APPS: AppDefinition[] = [
    /*HelloWorldApp, */ ProgramsApp,
    /*TrainerApp, */ CloudServersApp,
    ShareApp,
    XpFarmApp,
];
