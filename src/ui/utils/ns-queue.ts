import { NS } from "@ns";

interface QueuedTask<T = any> {
    invoke: (ns: NS) => T | Promise<T>;
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
 * `enqueue()` and gets back a promise instead of calling ns directly:
 *
 *   const queue = createNsQueue();
 *   const money = await queue.enqueue((ns) => ns.getServerMoneyAvailable("home"));
 *
 * The script's own main loop is the only thing that actually touches `ns`
 * for these tasks, one at a time, by draining the queue:
 *
 *   while (state.running) {
 *       const ranTask = await queue.drain(ns);
 *       if (!ranTask) await ns.sleep(1000);
 *   }
 *
 * Deliberately not named `run` (and the per-task callback not `run` either)
 * — Bitburner's RAM analyzer pattern-matches call text against known ns.*
 * function names rather than actually resolving what the receiver is, so a
 * `queue.run(...)`/`task.run(...)` call here would get miscounted as the
 * real `ns.run` (1 GB) despite `queue`/`task` not being `ns` at all. See the
 * "local variable/function name collision" note in the top-level
 * CLAUDE.md's RAM-cost-model section — this hit that exact trap once
 * already (`ns.run` showing up in `ui.app.js`'s RAM breakdown despite the
 * app never calling it), which is why this is called `enqueue`/`invoke`
 * instead.
 */
export function createNsQueue() {
    const pending: QueuedTask[] = [];

    function enqueue<T>(task: (ns: NS) => T | Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            pending.push({ invoke: task, resolve, reject });
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
            task.resolve(await task.invoke(ns));
        } catch (err) {
            task.reject(err);
        }
        return true;
    }

    function size(): number {
        return pending.length;
    }

    return { enqueue, drain, size };
}

export type NsQueue = ReturnType<typeof createNsQueue>;
