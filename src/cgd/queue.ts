import type { NS } from '@ns'
import type { CgdActionHandlers, CgdQueue, CgdQueuedTask, CgdTier } from './types'
import { dispatchCall, isPathAllowed } from './dispatch'

/**
 * Creates the queue a daemon registers at `cgd.daemon.queue`. `tier` and
 * `allowedPaths` are baked in at creation time (a daemon only ever runs at
 * one tier, with one fixed dispatchable surface, for its whole life), so
 * every call built by `enqueueCall` below carries its own gate check — the
 * queue's `drain` loop (run only by the daemon's own idle loop, against the
 * real `ns`) never has to special-case tier itself.
 *
 * `allowedPaths` must be exactly the set of paths that tier's own
 * `lv*.daemon.ts` file also reserves RAM for via a literal decoy reference
 * — see `dispatch.ts`'s `isPathAllowed` header comment for why a call
 * outside that set isn't just refused, it's actively dangerous (a runtime
 * "RAM USAGE ERROR" that kills the whole daemon, discovered via live
 * testing — see `docs/epic-cgd-namespace.md`).
 *
 * Same serialization mechanics as the original (pre-epic)
 * `ui/utils/ns-queue.ts`: Bitburner throws if two `ns.*` calls from one
 * script overlap, so the daemon's own idle loop is the sole thing that ever
 * calls `drain()`, one entry at a time. Two differences from that original:
 *   - `enqueueCall` takes a `{path, args}` request rather than a ready-to-
 *     run closure, so the tier gate is enforced in exactly one place —
 *     daemon-side, at the moment the real `ns` is about to be touched —
 *     rather than trusting whatever a remote caller's proxy already
 *     believed the tier to be.
 *   - `rejectAll`, used by a daemon's `_stop()` (see `daemon-core.ts`) so a
 *     caller mid-await on a now-dead daemon gets a real rejection instead
 *     of hanging forever.
 *
 * `actionHandlers` (empty by default — only tier 2+ currently register any)
 * backs `enqueueAction`: a named compound operation, not a raw `ns.*` method
 * path — see `types.ts`'s `CgdActionHandler` for why these don't need the
 * same decoy/allow-list treatment `enqueueCall` does.
 */
export function createCgdQueue(
  tier: CgdTier,
  allowedPaths: ReadonlySet<string>,
  actionHandlers: CgdActionHandlers = {},
): CgdQueue {
  const pending: CgdQueuedTask[] = []

  function enqueueCall(path: string[], args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      pending.push({
        invoke: (ns) => {
          if (!isPathAllowed(tier, allowedPaths, path)) {
            throw new Error(`"${path.join('.')}" is not available at daemon tier ${tier}.`)
          }
          return dispatchCall(ns, path, args)
        },
        resolve,
        reject,
      })
    })
  }

  function can(path: string[]): boolean {
    return isPathAllowed(tier, allowedPaths, path)
  }

  function enqueueAction(name: string, args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      pending.push({
        invoke: (ns) => {
          const handler = actionHandlers[name]
          if (!handler) {
            throw new Error(`Action "${name}" is not available at daemon tier ${tier}.`)
          }
          return handler(ns, ...args)
        },
        resolve,
        reject,
      })
    })
  }

  async function drain(ns: NS): Promise<boolean> {
    const task = pending.shift()
    if (!task)
      return false
    try {
      task.resolve(await task.invoke(ns))
    }
    catch (err) {
      task.reject(err)
    }
    return true
  }

  function size(): number {
    return pending.length
  }

  function rejectAll(err: unknown): void {
    while (pending.length > 0) {
      pending.shift()?.reject(err)
    }
  }

  return { enqueueCall, can, enqueueAction, drain, size, rejectAll }
}
