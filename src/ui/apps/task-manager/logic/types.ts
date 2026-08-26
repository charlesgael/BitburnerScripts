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
    /** Args to run it with — also used to match the right instance when
     * checking whether it's already running, tailing, or killing it.
     * Defaults to []. */
    args?: (string | number | boolean)[];
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
}

/** One currently-running instance of a non-`oneShot` managed app: which
 * app's `script`, and which host it's actually running on. */
export interface Task {
    script: string;
    host: string;
}
