import { AppAvailabilityContext } from "../../../types";
import { QueuedNS } from "../../../utils/ns-proxy";

/**
 * One script a `createTaskManagerApp` instance can spawn. This is
 * configured in code (see `../../programs/index.ts`), not editable from
 * the UI.
 */
export interface ManagedAppDefinition {
    /** Path to the script to run, e.g. "flooder.app.js". */
    script: string;
    /** Label shown for this app, in both the spawn row and any task it's
     * currently running as. */
    label: string;
    /** Fixed args to run it with. Defaults to []. Unlike before, these no
     * longer double as the key used to detect/kill/tail an already-running
     * instance — see `use-task-manager.ts`'s header comment on why that's
     * PID-based now. */
    args?: (string | number | boolean)[];
    /** Computes extra args at spawn time, appended after `args` — for an app
     * whose args can't be fixed up front (e.g. `flooder.app.js`'s
     * ignored-hosts list, which tracks whichever servers are currently
     * designated as slave nodes and changes as the player (de)designates
     * them in the Cloud Servers app). Only called from `spawnTask`, never
     * consulted for run-detection/kill/tail. */
    buildArgs?: (ns: QueuedNS) => Promise<(string | number | boolean)[]>;
    /** Thread count to spawn with. Defaults to 1. */
    threads?: number;
    /** True for a script that runs once and exits on its own (e.g. a report
     * that just prints to the terminal and returns) rather than looping
     * forever. Still gets the same host picker as any other app (its
     * report may depend on files local to whichever host it runs on — e.g.
     * `backdoor.lite.app.js` reading `known-servers.json.txt` wherever
     * `netmapper.app.js` last wrote it), but is skipped by the
     * running-task list entirely and its button always reads "Run" instead
     * of "Spawn" (see `../index.ts`'s header comment). Defaults to false. */
    oneShot?: boolean;
    /** True to cap this app at one running instance total, across every
     * host — not just per-host like the default (which only stops
     * re-spawning on a host already running it). `flooder.app.js` sets
     * this: it floods every reachable server's port with junk files from
     * wherever it runs, so a second instance anywhere else would just
     * fight the first one over the same targets. Once any instance is
     * detected running (any host), `hostOptions` (see
     * `use-task-manager.ts`) returns no spawn targets at all — home or
     * cloud — until it's killed. Defaults to false (per-host only). */
    singleInstance?: boolean;
    /** Scripts (by filename, matching `Task.script`) that must already be
     * running on the *same host* before this app can spawn there. E.g.
     * `cracker.app.js`/`flooder.app.js`/`backdoor.lite.app.js`/
     * `backdoor.app.js`/`next-targets.app.js` all read
     * `known-servers.json.txt`, which only exists on a host where
     * `netmapper.app.js` is (or has been) running — so they all set
     * `requires: ["netmapper.app.js"]`. Checked per-candidate-host in
     * `hostOptions`: a host is only offered once every required script
     * has a matching `Task` on that same host. Defaults to no
     * requirements. */
    requires?: string[];
    /** Same escape hatch as `AppDefinition.isAvailable` (`ui/types.ts`) —
     * gates this catalog entry on in-game player state beyond RAM/hosts,
     * e.g. `backdoor.app.js` sets `isAvailable: singularityAvailable` (see
     * `ui/utils/singularity-availability.ts`) since it's entirely
     * `ns.singularity.*` calls under the hood, same gate as the Trainer
     * app. Checked once per window-open in `use-task-manager.ts` (it needs
     * `ns.getResetInfo()`, fetched there) — an app failing it is left out
     * of the Spawn list entirely, the same "hide, don't disable" treatment
     * `ui/utils/app-availability.ts`'s `isAppVisible` gives a regular app.
     * Defaults to always available. */
    isAvailable?: (ctx: AppAvailabilityContext) => true | string;
}

/** One currently-running instance of a non-`oneShot` managed app: which
 * app's `script`, which host it's actually running on, and its PID — the
 * latter is how `killTask`/`tailTask` address it (see
 * `use-task-manager.ts`'s header comment on why, not by script+host+args). */
export interface Task {
    script: string;
    host: string;
    pid: number;
}
