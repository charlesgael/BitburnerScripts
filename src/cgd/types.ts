import type { NS } from '@ns'
import type { Mode } from '../ui/utils/money-farm-log/types'
import type { StatValue } from './stats'

/**
 * Shared types for the `window.cgd` namespace — the mechanism that lets a
 * persistent daemon (see `src/daemons/lv*.daemon.ts`) answer `ns.*` calls on
 * behalf of `ui.app.ts` and its apps without either of them needing to keep
 * a `while` loop running. See `docs/epic-cgd-namespace.md` for the full
 * design this implements.
 *
 * This file is purely type-level — imported by both the daemon side
 * (`src/daemons/lv*.daemon.ts`, `src/cgd/*.ts`) and the consumer side
 * (`ui.app.ts` and friends, in a later phase) so the independently-deployed
 * script bundles agree on the shape of the plain object they actually share
 * via `eval("window")`. Types are erased before deploy, so nothing here
 * costs RAM or bundle size on its own — see `window-cgd.ts` for the one
 * runtime piece (the lazy-init accessor).
 */

/**
 * The tiers a daemon can run at — see `docs/epic-cgd-namespace.md`'s tier
 * table for what each one actually adds. Numbers are stable identifiers,
 * not a contiguous range that gets renumbered when a new tier is inserted
 * — existing `minDaemonTier` values on apps (added in a later phase) stay
 * valid across that.
 */
export type CgdTier = 0 | 1 | 2 | 3 | 4

/**
 * Bumped whenever `CgdDaemon`/`CgdNamespace`'s shape changes in a way an
 * older-build daemon or consumer could misread. Checked (not enforced) by
 * whichever side notices a mismatch — see `window-cgd.ts`.
 */
export const CGD_SCHEMA_VERSION = 1

/**
 * One item in flight on a daemon's queue — see `queue.ts`. Shape mirrors
 * the original (pre-epic) `ui/utils/ns-queue.ts`, since deleted — `ns-
 * proxy.ts` and `ui.app.ts` both talk to `cgd.daemon.queue` now instead of
 * a queue `ui.app.ts` owned itself.
 */
export interface CgdQueuedTask {
  invoke: (ns: NS) => unknown | Promise<unknown>
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
}

/**
 * A tier-owned compound operation — one hand-written function that may call
 * `ns.*` more than once as a single atomic step (e.g. a network BFS, or
 * "fetch a list AND self-heal a config file"), unlike `dispatchCall`'s
 * single raw method forward. See `queue.ts`'s `enqueueAction` and
 * `lv2.daemon.ts`'s handlers for the pattern this exists for.
 *
 * Notably, these need NO decoy/allow-list dance the way `dispatch.ts`'s
 * raw-path forwarding does: a handler's own body writes genuine, literal
 * `ns.someMethod(...)` calls, so Bitburner's static analyzer counts them
 * the ordinary way just by the function being defined — see
 * `docs/epic-cgd-namespace.md`'s "Validated assumptions" §3. Looking one up
 * by name (`actionHandlers[name]`) and calling it isn't itself an `ns.*`
 * call, so it isn't billed or trackable as "dynamic ns usage" at all —
 * only what the handler's own body does is.
 */
export type CgdActionHandler = (ns: NS, ...args: any[]) => unknown | Promise<unknown>
export type CgdActionHandlers = Record<string, CgdActionHandler>

/**
 * The daemon-owned request queue at `cgd.daemon.queue`. Two entry points
 * for an external caller (both used by client-side proxies — see
 * `ui/utils/ns-proxy.ts` for `enqueueCall`):
 *   - `enqueueCall(path, args)` — a single raw `ns.*` method forward (e.g.
 *     `["hacknet", "numNodes"]`), gated by that tier's `allowedPaths` allow-
 *     list (see `dispatch.ts`'s `isPathAllowed`).
 *   - `enqueueAction(name, args)` — a named compound operation this tier
 *     registered (see `CgdActionHandler` above) — `name` isn't an `ns.*`
 *     method path at all, just a key into that tier's own handler map.
 * Both take plain data, never a ready-to-run closure, specifically so
 * either gate is enforced in exactly one place, daemon-side, using
 * whichever tier is *actually* running rather than whatever the caller
 * might believe it to be.
 */
export interface CgdQueue {
  enqueueCall: (path: string[], args: unknown[]) => Promise<unknown>
  enqueueAction: (name: string, args: unknown[]) => Promise<unknown>
  /**
   * Synchronous check for whether `path` (e.g. `["hacknet", "numNodes"]`)
   * would currently be dispatchable via `enqueueCall` — the same
   * `isPathAllowed` gate `enqueueCall` itself consults at actual dispatch
   * time (see `dispatch.ts`), surfaced up front so a caller can decide
   * whether to show/attempt something without round-tripping a call just
   * to find out it'll reject. No queue round-trip needed: `allowedPaths`
   * is fixed for this queue's whole life, so this never has to wait for
   * an actual drain tick the way `enqueueCall` does.
   */
  can: (path: string[]) => boolean
  /**
   * Runs the next queued call (if any) against `ns`. Returns `true` if
   * one was consumed, `false` if the queue was empty — callers should
   * `ns.sleep` when this returns `false` instead of busy-looping. Only
   * ever called by the daemon's own idle loop against the real `ns`.
   */
  drain: (ns: NS) => Promise<boolean>
  size: () => number
  /**
   * Rejects every currently-pending call with `err` and empties the
   * queue — called once by a daemon's `_stop()` cleanup so nothing
   * enqueued against it is left hanging forever once it's gone.
   */
  rejectAll: (err: unknown) => void
}

/**
 * What a daemon registers at `window.cgd.daemon`. Present only while a
 * daemon is alive *and* ready to serve — assignment is deferred until the
 * drain loop is actually running (see `daemon-core.ts`), so this object's
 * mere presence is a trustworthy readiness signal, not just an existence
 * one.
 */
export interface CgdDaemon {
  version: number
  tier: CgdTier
  queue: CgdQueue
  /**
   * `_`-prefixed per this epic's naming convention — keeps this name
   * distinct from any real (or future) `ns.*` method text, so it can
   * never trip Bitburner's identifier-text RAM analyzer the way
   * `ns-queue.ts`'s original `run`→`enqueue` rename had to dodge once
   * already (see that file's header comment).
   */
  _getTier: () => CgdTier
  /**
   * Rejects every pending queue entry, then clears `window.cgd.daemon`
   * — wired to this daemon's own `ns.atExit`, so it fires regardless of
   * how the process ends (falls off `main()`, killed, throws).
   */
  _stop: () => void
}

/**
 * `cgd.store`'s data shape. `homeRam` is broken out from the generic
 * `stats` record (rather than being just another entry in it) because
 * `ui/utils/app-availability.ts`'s `ramShortfallReason` needs the raw
 * numbers for gating math, not a pre-formatted display string — see
 * `docs/epic-cgd-namespace.md`'s "Store lifecycle"/"Stat rendering"
 * sections. `stats` is replaced wholesale (not merged) on every push, so a
 * stat no longer produced after a tier downgrade disappears cleanly rather
 * than going stale — see the design doc's tier-downgrade note.
 *
 * No longer carries an `xpFarmStatus` field: that used to be pushed here by
 * `daemons/xp-farm.daemon.ts` every 15s, which wasn't reactive enough (a
 * player could toggle a host and wait up to a full cycle to see it reflect)
 * and occasionally never resolved into a render at all. `ui/apps/xp-farm/`
 * now polls `ns.ps(host)` directly (tier 1's `ps` is already on the
 * allow-list — see `daemons/lv1.daemon.ts`) for the actual grow/weaken
 * processes and their live thread counts on each enabled host, rather than
 * trusting what the daemon last computed — see `use-xp-farm.ts`.
 */
export interface CgdStoreState {
  homeRam: { used: number, max: number }
  stats: Record<string, StatValue>
  /**
   * Fleet-wide RAM breakdown for Money Farm's exclusive host partitions
   * (see `daemons/money-farm.daemon.ts`'s partitioning section), pushed by
   * that daemon itself every `STATE_CHECK_INTERVAL` tick — not a tiered
   * daemon like every other writer of this store, but `window-cgd.ts`'s
   * lazy accessor is explicitly safe to call from any script. Optional:
   * absent until money-farm.daemon.ts has actually run this session, and
   * cleared back to `undefined` on its `ns.atExit` so a stale snapshot
   * doesn't linger once every dedicated host is disabled and it exits.
   * `reserved`/`used` are raw GB (not a `StatValue`) for the same reason
   * `homeRam` is its own field rather than folded into `stats`: a future
   * consumer computing against these numbers needs them raw, not a
   * pre-formatted display string.
   */
  moneyFarm?: {
    /**
     * Total capacity (GB) of every host currently in `managedHosts` — the
     * whole dedicated fleet, not the sum of what's reserved or in use.
     * `sum(perTarget[].reserved)` is always `<= totalRam`; the gap is
     * genuinely idle, unassigned capacity (not its own field — a consumer
     * computes `totalRam - sum(perTarget[].reserved)` for it). Only moves
     * when a host is claimed/released via the config file, independent of
     * partition activity.
     */
    totalRam: number
    perTarget: { target: string, mode: Mode, reserved: number, used: number }[]
  }
}

/**
 * Hand-rolled, dependency-free vanilla store at `window.cgd.store` — see
 * `store.ts`. Stable and long-lived: created once, lazily, by whichever
 * daemon first finds it missing, and reused across every subsequent daemon
 * generation/tier swap rather than recreated — see the design doc's "Store
 * lifecycle" section for why (a fresh instance per daemon would silently
 * strand any already-subscribed consumer holding the old reference).
 */
export interface CgdStore {
  getState: () => CgdStoreState
  setState: (partial: Partial<CgdStoreState>) => void
  subscribe: (listener: () => void) => () => void
  use: <T>(getter: (state: CgdStoreState) => T) => T
}

export interface CgdReactAppHandle {
  unmount: () => void
}

/**
 * `window.cgd.reactApps` — one entry per mounted piece of `ui.app.ts`'s
 * UI. A fresh `ui.app.ts` launch dismounts whichever of these already
 * exist (calling `unmount()` on each) before mounting its own and
 * overwriting this object — see `docs/epic-cgd-namespace.md` section 3 and
 * `ui.app.ts` itself.
 */
export interface CgdReactApps {
  launcher?: CgdReactAppHandle
  overview?: CgdReactAppHandle
  status?: CgdReactAppHandle
}

/** The full `window.cgd` shape. */
export interface CgdNamespace {
  daemon?: CgdDaemon
  store?: CgdStore
  reactApps: CgdReactApps
}
