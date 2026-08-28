import type { CgdNamespace } from './types'

/**
 * Reaches `window.cgd` the same way `ui/utils/react-globals.ts` already
 * reaches React/ReactDOM: `eval("window")` returns the *real* browser
 * window, identical across every script's process — confirmed by an actual
 * cross-script closure test before this epic was built (see
 * `docs/epic-cgd-namespace.md`'s "Validated assumptions"), not assumed.
 * `window.cgd` is this project's one shared namespace for anything that
 * needs to survive past the script that created it: the persistent
 * daemon's queue, live stats, and `ui.app.ts`'s own mounted React trees.
 *
 * Lazily creates the `{ reactApps: {} }` skeleton the first time anything
 * asks for it — `daemon`/`store` stay absent until something actually
 * registers them (a daemon's handoff protocol; `store.ts`'s lazy-create-if-
 * missing rule). Safe to call from any script.
 *
 * Wiped only by a full page reload (a browser refresh, or whatever an
 * augmentation install/BitNode reset does internally) — expected and fine,
 * since that also wipes every running script this project depends on, and
 * `start.ts` (a later phase) rebuilds everything fresh afterward. Nothing
 * here needs to treat that as an error case to recover from.
 */
export function getCgd(win: any): CgdNamespace {
  if (!win.cgd) {
    win.cgd = { reactApps: {} } as CgdNamespace
  }
  return win.cgd as CgdNamespace
}
