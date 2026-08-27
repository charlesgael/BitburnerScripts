import { NS } from "@ns";
import { CgdDaemon } from "../../cgd/types";

/**
 * `NS` with every property name prefixed with `_` (recursively, into every
 * nested namespace too) and every method's return type wrapped in a
 * `Promise` (already-async methods left as-is, not double-wrapped). Plain
 * data fields (e.g. `args`) are left untouched — see the "methods only"
 * caveat on `createQueuedNs` below.
 *
 * The `_` prefix isn't cosmetic — it's the same fix as `cgd.daemon`'s own
 * `_getTier`/`_stop`, applied to this proxy's entire surface. Every call
 * site (`use-trainer.ts`, `use-file-explorer.ts`, ...) writes ordinary,
 * ergonomic code like `queuedNs.exec(...)` — and Bitburner's RAM analyzer
 * flags *any* identifier token that lexically matches a real `ns.*` name,
 * regardless of the receiver's actual type (see `cgd/dispatch.ts`'s header
 * comment, and `docs/epic-cgd-namespace.md`'s "Validated assumptions" §2/§5
 * for the proof: `run-daemon.ts`'s literal `.exec(`/`.isRunning(` on a
 * `QueuedNS`-typed parameter, and a bare `const share = ...` declaration,
 * both got billed to `ui.app.js` despite `ns`/`share` never being the real
 * `ns`). Every ordinary call site written this way was silently inflating
 * `ui.app.js`'s measured cost by the full price of each method it called
 * through the queue — completely defeating the point of routing through a
 * daemon in the first place. `queuedNs._exec(...)` instead: `_exec` doesn't
 * lexically match any real `ns.*` name (same reason `_isBusy` didn't match
 * `isBusy`), so the analyzer has nothing to flag, while the Proxy below
 * strips the leading `_` before building the real dispatch path, so the
 * call still resolves to genuine `ns.exec` on the daemon's real `ns`.
 *
 * `QueuedNS`'s type only exposes the underscore-prefixed names — there's no
 * non-prefixed escape hatch — so forgetting the `_` is a compile error, not
 * a silent RAM leak waiting to be discovered the hard way again.
 */
type Underscored<T> = {
    [K in keyof T as K extends string ? `_${K}` : never]: T[K] extends (...args: infer A) => infer R
        ? (...args: A) => Promise<Awaited<R>>
        : T[K] extends any[]
          ? T[K]
          : T[K] extends object
            ? Underscored<T[K]>
            : T[K];
};

/**
 * A handful of NS methods are declared with multiple overloads where
 * `Underscored` above only keeps the LAST one — a mapped type's
 * `T[K] extends (...args: infer A) => infer R ? ... : ...` conditional,
 * applied to a multi-signature function type, infers `A`/`R` from just the
 * final overload, silently dropping the rest. `ns.kill` is one:
 * `NetscriptDefinitions.d.ts` declares both `kill(pid: number): boolean`
 * and `kill(filename: string, host?: string, ...args): boolean`, but only
 * the latter survives into `Underscored<NS>["_kill"]`. `ui/apps/task-manager/`
 * needs the PID form specifically (see its header comment on why
 * script+host+args matching doesn't work for an app with dynamic args), so
 * it's patched back in here as an intersected extra call signature — safer
 * than reworking `Underscored` itself, which would risk subtly changing
 * every other already-working call site's inferred type.
 */
type QueuedNsOverloadFixups = {
    _kill(pid: number): Promise<boolean>;
};

export type QueuedNS = Underscored<NS> & QueuedNsOverloadFixups;

/**
 * Wraps a "current daemon" getter in a Proxy that reads almost exactly like
 * calling `ns` directly, just with every property `_`-prefixed (see this
 * file's header comment for why that's load-bearing, not stylistic):
 *
 *   const ns = createQueuedNs(() => cgd.daemon);
 *   const host = await ns._getHostname();
 *   const hashes = await ns._hacknet._numHashes();
 *
 * Every property access returns a further proxy — so nested namespaces
 * like `ns._hacknet.*` or `ns._stock.*` resolve correctly without this code
 * needing to know NS's shape up front — stripping each segment's leading
 * `_` and accumulating the real, unprefixed path (never a literal
 * `.methodName(` call in this file's own source either way; see the note
 * below) until the result is actually called, at which point it calls
 * `getDaemon()` and sends `daemon.queue.enqueueCall(realPath, args)` — a
 * `{path, args}` request, not a ready-to-run closure — so the daemon itself
 * is the one place that resolves the call against the real `ns` and
 * enforces its own tier's allow-list (see `cgd/dispatch.ts`).
 *
 * A property access that doesn't start with `_` returns `undefined` rather
 * than continuing the proxy chain — both because `QueuedNS`'s type never
 * offers one (so this should only ever happen from something probing the
 * object dynamically, e.g. a library checking `.then`), and because
 * silently accepting it would defeat the whole point: a stray non-prefixed
 * call is exactly the mistake this exists to catch.
 *
 * Takes a *getter* rather than a fixed `CgdQueue`/`CgdDaemon` reference on
 * purpose: `ui.app.ts` only builds this proxy once, at mount time, but the
 * daemon it should talk to can change afterward without `ui.app.ts` itself
 * relaunching — a different tier taking over via the handoff protocol (see
 * `cgd/daemon-core.ts`). A fixed reference would keep pointing at that
 * *old* daemon's now-dead queue: nothing drains it anymore once that
 * daemon's process has exited, so a call through it would neither resolve
 * nor reject — it would just hang forever, silently (this happened for
 * real: clicking Restart after a background tier switch closed the old UI
 * fine but the relaunch call itself never completed). Calling `getDaemon()`
 * fresh on every dispatch — typically `() => cgd.daemon`, a live read off
 * the one shared namespace object — means a background daemon swap just
 * gets picked up automatically, and a call made while no daemon is
 * registered at all rejects immediately instead of hanging.
 *
 * Caveat — atomicity: each call through this proxy is its own queue entry,
 * so another queued call can be interleaved between two calls made back to
 * back (e.g. `await ns._getServerMoneyAvailable(...)` then, separately,
 * `await ns._purchaseServer(...)`). There is currently no equivalent of the
 * old single-closure escape hatch for a multi-step atomic operation — that
 * would need its own daemon-side handler (a literal, tier-costed one) if a
 * future call site needs it.
 *
 * Caveat — methods only: this can only wrap function calls. A handful of
 * NS members are plain data, not methods (e.g. `ns.args`) — those aren't
 * callable, so route them through the proxy and it'll try to invoke a
 * non-function. They're static for the life of the script anyway, so just
 * read them once off the real `ns` at startup instead.
 */
export function createQueuedNs(getDaemon: () => CgdDaemon | undefined): QueuedNS {
    return makeNsProxy(getDaemon, []) as unknown as QueuedNS;
}

function makeNsProxy(getDaemon: () => CgdDaemon | undefined, path: string[]): any {
    // The Proxy target has to be a function (not a plain object) for the
    // `apply` trap below to fire — that's what lets the same proxy be both
    // property-accessed (`._hacknet`) and called (`(...)`).
    const target = () => {};

    return new Proxy(target, {
        get(_target, prop) {
            if (typeof prop !== "string" || !prop.startsWith("_")) return undefined;
            return makeNsProxy(getDaemon, [...path, prop.slice(1)]);
        },
        apply(_target, _thisArg, args) {
            const daemon = getDaemon();
            if (!daemon) {
                return Promise.reject(
                    new Error(`No cgd daemon is currently registered — can't call "${path.join(".")}".`)
                );
            }
            return daemon.queue.enqueueCall(path, args);
        },
    });
}
