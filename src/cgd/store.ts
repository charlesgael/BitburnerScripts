import type { CgdNamespace, CgdStore, CgdStoreState } from './types'

const INITIAL_STATE: CgdStoreState = {
  homeRam: { used: 0, max: 0 },
  stats: {},
  xpFarmStatus: {},
}

/**
 * Hand-rolled, dependency-free vanilla store: `getState`/`setState`/
 * `subscribe`, nothing more. Chosen over pulling in `zustand` specifically
 * so the per-slice "only re-render when the thing you actually subscribed
 * to changes" behavior could be had for zero added dependencies — see
 * `docs/epic-cgd-namespace.md`'s "Store implementation" section. That
 * selective-re-render behavior lives in the *consumer* (a React hook built
 * on `useSyncExternalStore`, added when `ui.app.ts`'s apps start reading
 * from this — this file only needs to notify listeners on every
 * `setState`, not decide who should care).
 *
 * `setState` is a shallow merge at the top level (`homeRam`/`stats` fields
 * individually), which is what lets a daemon push only `{ stats }` on a
 * routine refresh without clobbering `homeRam`, or vice versa — but see
 * `daemon-core.ts`: a tier's stat-push always sets the *whole* `stats`
 * object each cycle (replace, not merge, at that field's own level), so a
 * stat no longer produced after a tier downgrade disappears cleanly.
 */
function createCgdStore(): CgdStore {
  let state = INITIAL_STATE
  const listeners = new Set<() => void>()

  function getState(): CgdStoreState {
    return state
  }

  function setState(partial: Partial<CgdStoreState>): void {
    state = { ...state, ...partial }
    for (const listener of listeners) listener()
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { getState, setState, subscribe }
}

/**
 * Returns `cgd.store`, creating it if this is the first daemon (of any
 * tier, ever, this session) to find it missing. Every daemon calls this on
 * startup rather than unconditionally creating its own — see
 * `docs/epic-cgd-namespace.md`'s "Store lifecycle": the store must stay the
 * same object instance across daemon generations, or an already-subscribed
 * consumer holding the old reference would silently stop seeing updates.
 */
export function ensureCgdStore(cgd: CgdNamespace): CgdStore {
  if (!cgd.store) {
    cgd.store = createCgdStore()
  }
  return cgd.store
}
