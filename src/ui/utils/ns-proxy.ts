import { NS } from "@ns";
import { NsQueue } from "./ns-queue";

/**
 * `NS` with every method's return type wrapped in a `Promise` (already-async
 * methods are left as-is, not double-wrapped) and every nested namespace
 * (`hacknet`, `stock`, `singularity`, ...) promisified the same way,
 * recursively. Plain data fields (e.g. `args`) are left untouched — see the
 * "methods only" caveat on `createQueuedNs` below.
 *
 * This mirrors what `createQueuedNs`'s Proxy actually does at runtime: every
 * call — sync or async in the real NS — goes through the queue and comes
 * back as a Promise. Typing it as plain `NS` would silently lie about that
 * and let a missing `await` slip past the compiler.
 */
type Promisify<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => infer R
        ? (...args: A) => Promise<Awaited<R>>
        : T[K] extends any[]
          ? T[K]
          : T[K] extends object
            ? Promisify<T[K]>
            : T[K];
};

export type QueuedNS = Promisify<NS>;

/**
 * Wraps an `NsQueue` in a Proxy that reads exactly like calling `ns`
 * directly:
 *
 *   const ns = createQueuedNs(nsQueue);
 *   const host = await ns.getHostname();
 *   const hashes = await ns.hacknet.numHashes();
 *
 * Every property access returns a further proxy — so nested namespaces
 * like `ns.hacknet.*` or `ns.stock.*` resolve correctly without this code
 * needing to know NS's shape up front — and calling the result queues
 * exactly one `nsQueue.enqueue(...)` task that invokes the matching method
 * on the real `ns` and resolves with its return value.
 *
 * Caveat — atomicity: each call through this proxy is its own queue entry,
 * so another queued task can be interleaved between two calls made back to
 * back (e.g. `await ns.getServerMoneyAvailable(...)` then, separately,
 * `await ns.purchaseServer(...)`). For anything that must run as a single
 * uninterrupted step, use `nsQueue.enqueue(ns => { ...multiple calls... })`
 * directly instead of chaining proxy calls.
 *
 * Caveat — methods only: this can only wrap function calls. A handful of
 * NS members are plain data, not methods (e.g. `ns.args`) — those aren't
 * callable, so route them through the proxy and it'll try to invoke a
 * non-function. They're static for the life of the script anyway, so just
 * read them once off the real `ns` at startup instead.
 */
export function createQueuedNs(queue: NsQueue): QueuedNS {
    return makeNsProxy(queue, []) as unknown as QueuedNS;
}

function makeNsProxy(queue: NsQueue, path: string[]): any {
    // The Proxy target has to be a function (not a plain object) for the
    // `apply` trap below to fire — that's what lets the same proxy be both
    // property-accessed (`.hacknet`) and called (`(...)`).
    const target = () => {};

    return new Proxy(target, {
        get(_target, prop) {
            if (typeof prop !== "string") return undefined;
            return makeNsProxy(queue, [...path, prop]);
        },
        apply(_target, _thisArg, args) {
            return queue.enqueue((ns) => {
                let receiver: any = ns;
                for (let i = 0; i < path.length - 1; i++) {
                    receiver = receiver[path[i]];
                }
                const method = path[path.length - 1];
                return receiver[method](...args);
            });
        },
    });
}
