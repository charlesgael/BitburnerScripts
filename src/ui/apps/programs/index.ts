import { AppDefinition } from "../../types";
import { createTaskManagerApp } from "../task-manager";
import { readSlaveNodes } from "../../utils/slave-nodes";

/**
 * The actual sidebar-launchable "Programs" app — which .js files it can
 * spawn, and what to call them, is fixed here in code (see
 * `../task-manager/index.ts` for the generic, reusable task-manager part:
 * spawning any of these on `home` or a non-reserved cloud server, and the
 * flat running-tasks list with per-task Tail/Kill).
 *
 * `flooder.app.js` gets `buildArgs` instead of a fixed `args`: it needs the
 * current slave-node hostnames (see `ui/utils/slave-nodes.ts`) so it never
 * hijacks a server the player has designated for Programs/XP Farm/Share,
 * and that list can change at any time from the Cloud Servers app — a
 * fixed `args` array baked in here could only ever reflect whatever it was
 * at build time.
 */
export const ProgramsApp: AppDefinition = createTaskManagerApp("programs", "Programs", "🚀", [
    { script: "netmapper.app.js", label: "Netmapper" },
    { script: "cracker.app.js", label: "Cracker" },
    { script: "flooder.app.js", label: "Flooder", buildArgs: readSlaveNodes },
    { script: "backdoor.lite.app.js", label: "List Backdoors", oneShot: true },
    { script: "backdoor.app.js", label: "Backdoor Installer" },
    { script: "next-targets.app.js", label: "Next Targets", oneShot: true },
    { script: "hacknet.app.js", label: "Hacknet" },
]);
