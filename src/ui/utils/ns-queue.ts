import { NS } from "@ns";

interface QueuedTask<T = any> {
    run: (ns: NS) => T | Promise<T>;
    resolve: (value: T) => void;
    reject: (err: unknown) => void;
}

/**
 * Serializes ns.* calls that would otherwise race across React event
 * handlers and the script's own main loop. Bitburner only tolerates one
 * in-flight Netscript call at a time per script — firing two concurrently
 * (e.g. a button's onClick calling an ns function while the main loop is
 * mid ns.sleep) throws a "concurrent calls" runtime error.
 *
 * Anything that needs to call ns — a React handler, another module — calls
 * `run()` and gets back a promise instead of calling ns directly:
 *
 *   const queue = createNsQueue();
 *   const money = await queue.run((ns) => ns.getServerMoneyAvailable("home"));
 *
 * The script's own main loop is the only thing that actually touches `ns`
 * for these tasks, one at a time, by draining the queue:
 *
 *   while (state.running) {
 *       const ranTask = await queue.drain(ns);
 *       if (!ranTask) await ns.sleep(1000);
 *   }
 */
export function createNsQueue() {
    const pending: QueuedTask[] = [];

    function run<T>(task: (ns: NS) => T | Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            pending.push({ run: task, resolve, reject });
        });
    }

    /**
     * Runs the next queued task (if any) against `ns`. Returns true if a
     * task was consumed, false if the queue was empty — callers should
     * `ns.sleep` when this returns false instead of busy-looping.
     */
    async function drain(ns: NS): Promise<boolean> {
        const task = pending.shift();
        if (!task) return false;
        try {
            task.resolve(await task.run(ns));
        } catch (err) {
            task.reject(err);
        }
        return true;
    }

    function size(): number {
        return pending.length;
    }

    return { run, drain, size };
}

export type NsQueue = ReturnType<typeof createNsQueue>;
export type RunNs = NsQueue["run"];
