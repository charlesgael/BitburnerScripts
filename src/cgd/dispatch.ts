import { NS } from "@ns";
import { CgdTier } from "./types";

/**
 * Executes one queued call against the real `ns`, given as a property
 * *path* (e.g. `["hacknet", "numNodes"]`) plus args — never as a literal
 * `ns.someMethod(...)` call written anywhere in this file's own source.
 *
 * This distinction is the whole reason a persistent daemon's RAM cost can
 * be a deliberate, tier-by-tier choice instead of permanently including
 * every method any app might ever call through it: Bitburner's RAM
 * analyzer charges a script for every `ns.*` method name that appears as
 * literal call-syntax anywhere in its reachable source text — regardless
 * of what the receiver actually resolves to at runtime. Proof of both
 * directions of this already exists in the pre-epic codebase:
 *   - `ui/utils/ns-queue.ts`'s own header comment documents the false
 *     positive: `queue.run(...)` got billed as `ns.run` despite `queue`
 *     not being `ns` at all — the analyzer matched the *text* `.run(`,
 *     not the receiver's real type.
 *   - `ui/utils/run-daemon.ts` types its `ns` parameter as `QueuedNS` (a
 *     Proxy, meant to be free) but still writes `ns.exec(...)`/
 *     `ns.isRunning(...)` as literal source text — which is exactly why
 *     `exec`/`isRunning` show up in `ui.app.js`'s real RAM breakdown today
 *     despite believing they were "only" going through a free proxy.
 * The reverse holds just as reliably: a *computed* property access
 * (`receiver[method](...args)`, `method` a runtime string) has no literal
 * `.methodName(` text for that same analyzer to find, so it costs nothing
 * beyond whatever else this file happens to reference literally (currently
 * nothing).
 *
 * Every tier's daemon MUST route any call it forwards on a caller's behalf
 * through this function (see `queue.ts`'s `enqueueCall`) — writing a
 * literal `.methodName(` anywhere in a daemon file, even on a generically-
 * typed parameter, silently bills that tier for it, the same way
 * `run-daemon.ts` already accidentally does today.
 */
export function dispatchCall(ns: NS, path: string[], args: unknown[]): unknown {
    let receiver: any = ns;
    for (let i = 0; i < path.length - 1; i++) {
        receiver = receiver[path[i]];
    }
    const method = path[path.length - 1];
    return receiver[method](...args);
}

/**
 * Whether `path` (e.g. `["hacknet", "numNodes"]`) may be dispatched through
 * a queue built with `allowedPaths` — an **explicit, enumerated** set of
 * dotted method paths (`"hacknet.numNodes"`, not just a namespace prefix),
 * owned by each tier's own `lv*.daemon.ts` file (see e.g. `lv1.daemon.ts`'s
 * `TIER_1_METHODS`), never by this file.
 *
 * This is NOT a "policy, not RAM" boundary the way an earlier version of
 * this file described it — it turned out to be load-bearing for RAM after
 * all. Live testing found that Bitburner tracks actual dynamic `ns.*` usage
 * at *runtime* and kills a script if that ever exceeds what was reserved
 * for it at launch (a "RAM USAGE ERROR... circumvented the static RAM
 * calculation") — so `dispatchCall`'s computed access doesn't make a call
 * free, it just makes it invisible to the static allocation, which then
 * crashes the whole daemon the first time something under-provisioned
 * actually runs. `allowedPaths` exists precisely so nothing reaches
 * `dispatchCall` that its own tier's file didn't also reserve RAM for via a
 * literal (`void ns.someMethod;`) decoy reference — see `lv1.daemon.ts` for
 * the pattern. Widening a tier's dispatchable surface means adding BOTH a
 * decoy line AND the path string here, kept in sync by hand (there's no way
 * to generate the decoy from the list programmatically — a loop over
 * strings would just be computed access again, exactly what doesn't get
 * counted).
 */
export function isPathAllowed(tier: CgdTier, allowedPaths: ReadonlySet<string>, path: string[]): boolean {
    if (tier <= 0) return false; // tier 0: no caller-facing methods at all
    return allowedPaths.has(path.join("."));
}
