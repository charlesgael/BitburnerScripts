import type { NS } from '@ns'
import type { CgdActionHandlers } from '../cgd/types'
import { runTieredDaemon } from '../cgd/daemon-core'
import { makeStatPusher } from '../cgd/stat-push'
import { BASELINE_STAT_PROVIDERS } from '../cgd/stats'

/**
 * Tier 1's dispatchable surface — an explicit, enumerated list, not "every
 * NS method except cloud/singularity" as an earlier version of this design
 * assumed. Live testing found that a caller dispatching something through
 * `cgd/dispatch.ts`'s computed access that wasn't *also* referenced
 * literally somewhere in this tier's own reachable source doesn't fail
 * gracefully — Bitburner tracks actual dynamic `ns.*` usage at runtime and
 * kills the whole daemon with a "RAM USAGE ERROR" the moment that usage
 * exceeds what was reserved at launch (see `reserveTier1Ram` below, and
 * `docs/epic-cgd-namespace.md`). So this list is exactly, and only, what
 * `reserveTier1Ram` backs with a literal decoy reference — widening it
 * means adding to both, by hand; there's no way to generate one from the
 * other, since a loop over strings is itself just computed access again.
 *
 * Originally just the set of methods `ui.app.ts` used to reference directly
 * before this epic moved them here — but rewiring `ui/utils/ns-proxy.ts` in
 * phase 2 meant every app's OWN direct `queuedNs.*` call sites started
 * routing through this same allow-list immediately too, not only the calls
 * this epic deliberately migrates later (see `docs/epic-cgd-namespace.md`'s
 * execution order, phase 3). Rather than let each one surface one at a time
 * as "not available at daemon tier 1" errors while clicking around, this
 * list was built from a full audit of every `ui/apps/**` file's actual
 * `queuedNs.*`/`useQueuedNs()` call sites (`ui.openTail`/`read`/`write`/
 * `mv`/`getServerUsedRam`/`getHostname` are what that audit added on top of
 * the original set) — still an explicit, curated list, not a broad guess at
 * "general NS surface," just informed by what's actually used today rather
 * than only what `ui.app.ts` itself used to call. Grows further as new apps
 * or new calls get added.
 *
 * Exported so higher tiers can build on it directly — `lv2.daemon.ts`
 * imports this (and `reserveTier1Ram`/`TIER_1_ACTIONS` below) rather than
 * duplicating it, the `lv1 ← lv2 ← lv3 ← lv4` chain from
 * `docs/epic-cgd-namespace.md`'s import-chain section made concrete.
 */
export const TIER_1_METHODS: readonly string[] = [
  'exec',
  'kill',
  'scp',
  'rm',
  'ls',
  'isRunning',
  'fileExists',
  'getScriptRam',
  'getResetInfo',
  'getPlayer',
  'hacknet.numNodes',
  'hacknet.getNodeStats',
  'ps',
  'ui.openTail',
  'read',
  'write',
  'mv',
  'getServerUsedRam',
  'getHostname',
]

/**
 * Referenced-but-never-called, on purpose — see `TIER_1_METHODS`'s header
 * comment above and `cgd/dispatch.ts`'s `isPathAllowed`. Each line must be
 * a literal property access (not `ns[name]`, which is exactly the computed
 * form that doesn't get counted) so Bitburner's static RAM calculator
 * actually reserves for it; `void` just discards the read without invoking
 * anything, so this has zero runtime effect beyond existing in the
 * compiled script's reachable text. Every `TIER_1_METHODS` entry gets its
 * own line here even where `cgd/stat-push.ts` already references the same
 * method literally elsewhere (e.g. `getServerUsedRam`, `getPlayer`,
 * `hacknet.*`) — redundant references cost nothing extra (RAM is per
 * distinct function, not per occurrence), and this way `reserveTier1Ram`
 * alone stays the authoritative, self-contained source of what's reserved,
 * instead of that guarantee depending on `stat-push.ts` never changing.
 */
export function reserveTier1Ram(ns: NS): void {
  void ns.exec
  void ns.kill
  void ns.scp
  void ns.rm
  void ns.ls
  void ns.isRunning
  void ns.fileExists
  void ns.getScriptRam
  void ns.getResetInfo
  void ns.getPlayer
  void ns.hacknet.numNodes
  void ns.hacknet.getNodeStats
  void ns.ps
  void ns.ui.openTail
  void ns.read
  void ns.write
  void ns.mv
  void ns.getServerUsedRam
  void ns.getHostname
}

/**
 * Compound actions registered at tier 1 — none currently. `cloudList` was
 * briefly registered here (read-only cloud-server enumeration, reasoned to
 * be foundational plumbing several other apps depend on) but measured live
 * at 11.55 GB total for tier 1 once it pulled in `getServer` (2.00 GB),
 * `cloud.getServerNames` (1.05 GB), and friends — too heavy for tier 1,
 * which is meant to stay a cheap, viable baseline for a starter player
 * (~8 GB ceiling). Moved to tier 2 instead (see `lv2.daemon.ts`), alongside
 * `cloudBuy`/`cloudDelete`, which already needed `cloud.*` there. Apps that
 * depended on cloud-server listing at tier 1 (Share, XP Farm, File
 * Explorer, Programs) degrade gracefully below tier 2 for now — Programs
 * gets adjusted separately to conditionally offer cloud spawn targets only
 * once tier 2 is actually available, rather than this tier carrying the
 * cost permanently for everyone.
 *
 * Kept as an (empty) exported object rather than removed outright so
 * `lv2.daemon.ts`'s `...TIER_1_ACTIONS` spread keeps working unchanged if a
 * genuinely tier-1-appropriate action shows up later.
 */
export const TIER_1_ACTIONS: CgdActionHandlers = {}

/**
 * Tier 1: the daemon's real baseline. Every method in `TIER_1_METHODS`
 * becomes reachable through `window.cgd.daemon.queue`, which is what lets
 * `ui.app.ts` itself shrink back toward the ~1.6 GB base-script-overhead
 * floor now that it no longer holds these calls directly. Stat push is the
 * same baseline set as tier 0 (see `cgd/stats.ts`'s header comment) — tier
 * 1's distinguishing feature over tier 0 is dispatch capability, not
 * additional stats; those arrive with tier 2 and tier 4.
 *
 * Usage: `run daemons/lv1.daemon.js`
 */
export async function main(ns: NS): Promise<void> {
  // Actually called, not just defined: an uncalled, non-exported,
  // side-effect-free local function is exactly the shape a bundler's
  // dead-code elimination could legally strip from the deployed output —
  // which would silently remove the very references this exists to keep
  // present. Calling it (its body still does nothing observable) is the
  // safe way to guarantee it survives the build.
  reserveTier1Ram(ns)
  await runTieredDaemon(ns, 1, 'daemons/lv1.daemon.js', new Set(TIER_1_METHODS), {
    actionHandlers: TIER_1_ACTIONS,
    onIdle: makeStatPusher(BASELINE_STAT_PROVIDERS),
  })
}
