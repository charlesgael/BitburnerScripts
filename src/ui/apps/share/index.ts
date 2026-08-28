import type { AppDefinition } from '../../types'
import { ShareContent } from './components/share-content'

/**
 * Lets the player dedicate spare RAM — on `home` or any purchased ("cloud")
 * server — to `ns.share()`, boosting reputation gain from faction work while
 * it runs. One card per host, each independently toggled and threaded, laid
 * out as the same card grid as the XP Farm app (`../xp-farm/`).
 *
 * Unlike XP Farm, there's no self-managing orchestrator daemon + config file
 * here: every card directly `ns.exec`/`ns.kill`s its own copy of
 * `daemons/share.daemon.js` (a tiny loop around `ns.share()`, unchanged from
 * before this app grew multi-host support), the same way the original
 * single-host version of this app always worked. That's enough on its own
 * because `ns.exec`/`ns.kill`/`ns.isRunning`/`ns.ps`/`ns.getScriptRam` are
 * already part of `ui.app.js`'s footprint (via the Trainer/Programs/Cloud
 * Servers apps) — an orchestrator would only earn its keep if this app
 * needed to keep managing hosts while closed, which it doesn't: an already-
 * running share daemon is simply re-detected via `ns.ps` next time a card
 * mounts, same as before.
 *
 * `ns.share()` itself (2.4GB) still can't be referenced directly from this
 * file — see `daemons/share.daemon.ts`'s header comment — hence it staying
 * its own tiny script, launched with N threads via `ns.exec` rather than
 * called here.
 *
 * Launching on `home` is a plain `ns.exec` (the script's already there,
 * deployed by Viteburner). Launching on a cloud server goes through
 * `spawnRemote` (`ui/utils/spawn-remote.ts`), which `ns.scp`'s the script
 * over first through the daemon queue — same path the Programs app's
 * cloud-server dropdown uses.
 *
 * Only `home` reserves RAM (see `logic/use-share-host-card.ts`'s
 * `MIN_RESERVED_RAM_GB`/`RESERVED_RAM_FRACTION`) — it's the one host running
 * everything else (hack/grow/weaken daemons, one-off Singularity actions,
 * this very UI, ...), so sharing needs to leave it headroom. Purchased
 * servers have no such competing use once dedicated, so their entire free
 * RAM is offered.
 *
 * Cloud servers already dedicated to `../xp-farm/` are excluded from the
 * list — same reasoning as `../task-manager/`'s own exclusion:
 * `daemons/xp-farm.daemon.ts` has exclusive control of those and
 * `ns.killall`s them the moment it claims one, so a share daemon started
 * there would just get killed out from under it moments later.
 *
 * All per-host state/behavior lives in `logic/use-share-host-card.ts`; the
 * app-level card list lives in `logic/use-share.ts`. `components/` is plain
 * presentational JSX driven off those hooks' return values.
 */
export const ShareApp: AppDefinition = {
  id: 'share',
  icon: '🤝',
  label: 'Share',
  Content: ShareContent,
  // Wide enough to open already showing two ~220px host cards per row —
  // same reasoning as the XP Farm/Cloud Servers apps' own preferredWidth.
  preferredWidth: 700,
  preferredHeight: 440,
  minWidth: 550,
  minHeight: 400,
}
