import { AppDefinition } from "../types";
import { HelloWorldApp } from "./hello-world";
import { createProgramLauncherApp } from "./program-launcher";
import { TrainerApp } from "./trainer";
import { CloudServersApp } from "./cloud-servers";
import { ShareApp } from "./share";

/**
 * The actual sidebar-launchable "Programs" app — which .js files it can
 * spawn/kill, and what to call them, is fixed here in code (see
 * `program-launcher.ts` for the generic, reusable part).
 */
const ProgramsApp = createProgramLauncherApp("programs", "Programs", "🚀", [
    { script: "netmapper.app.js", label: "Netmapper" },
    { script: "cracker.app.js", label: "Cracker" },
    { script: "backdoor.app.js", label: "Backdoor Installer" },
    { script: "backdoor.lite.app.js", label: "List Backdoors", oneShot: true },
    { script: "flooder.app.js", label: "Flooder" },
    { script: "hacknet.app.js", label: "Hacknet" },
]);

/**
 * Registry of every app shown in the sidebar grid (see
 * `ui/components/app-grid.ts`). To add a new app: create a file next to
 * `hello-world.ts` exporting an `AppDefinition`, then list it here.
 */
export const APPS: AppDefinition[] = [/*HelloWorldApp, */ProgramsApp, /*TrainerApp, */CloudServersApp, ShareApp];
