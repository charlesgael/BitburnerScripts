import { AppDefinition } from "../types";
import { FileExplorerApp } from "./file-explorer";
import { ProgramsApp } from "./programs";
import { CloudServersApp } from "./cloud-servers";
import { ShareApp } from "./share";
import { XpFarmApp } from "./xp-farm";
import { TrainerApp } from "./trainer";

/**
 * Registry of every app shown in the sidebar grid (see
 * `ui/components/app-grid.tsx`). To add a new app: create a folder next to
 * `hello-world/` containing an `index.ts` that exports an `AppDefinition`
 * (with its own `components/`/`logic/` inside, per the existing apps), then
 * list it here.
 */
export const APPS: AppDefinition[] = [
    /* HelloWorldApp, */
    FileExplorerApp,
    ProgramsApp,
    CloudServersApp,
    ShareApp,
    XpFarmApp,
    TrainerApp,
];
