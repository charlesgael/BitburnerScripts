import type { NS } from '@ns'
import { getCgd } from './cgd/window-cgd'
import { parseArgs } from './utils/args'

/**
 * One-shot bootstrap: ensures a tiered daemon is running (auto-picking the
 * highest tier `home` can currently afford, unless a specific tier/remote
 * is given), waits for it to actually be ready, then runs `assets.app.js`
 * and `ui.app.js`. Safe to rerun any time — each of its three steps is
 * independently idempotent (the daemon's own handoff protocol, `assets.app.ts`'s
 * re-injectable `<style>`, `ui.app.ts`'s mount-in-place rewrite), so this
 * never needs special-casing for "already did this." See
 * `docs/epic-cgd-namespace.md` section 4.
 *
 * Deliberately kept RAM-thin: only current/max RAM arithmetic,
 * `ns.getScriptRam`, `ns.exec`, `ns.hasRootAccess`, and `ns.scp` — never an
 * import of any daemon tier's own handler/action modules, which would
 * permanently bake their RAM cost into this script and defeat the point of
 * it being a cheap bootstrap.
 *
 * Usage: `run start.js [tier] [remote]`
 *   - `tier` (optional number): force this specific tier instead of
 *     auto-selecting. Only actually (re)starts anything if no daemon is
 *     currently registered, or one is but at a *different* tier than this
 *     — asking for the tier that's already running is a no-op, not a
 *     needless handoff.
 *   - `remote` (optional string, default `"home"`): run the daemon there
 *     instead. No RAM-reserve guard applies off `home` — see the design
 *     doc's "Remote daemon placement" section — just enough free RAM for
 *     the daemon script to fit, and root access.
 */

// Daemon files that actually exist today, in descending tier order — see
// docs/epic-cgd-namespace.md's execution order: lv3/lv4 were never built
// (tier 4 was decided against; nothing has needed tier 3 yet). Extend this
// list if/when a higher tier gets built.
const AVAILABLE_TIERS: { tier: number, script: string }[] = [
  { tier: 2, script: 'daemons/lv2.daemon.js' },
  { tier: 1, script: 'daemons/lv1.daemon.js' },
  { tier: 0, script: 'daemons/lv0.daemon.js' },
]

const READY_POLL_MS = 100
const READY_TIMEOUT_MS = 5000

/**
 * `min(home's max − 5GB, home's max × 0.8)` — whichever reserve is larger,
 * reusing the same 20%-headroom convention `ui/utils/app-availability.ts`'s
 * `ramShortfallReason` already applies elsewhere, rather than inventing a
 * new rule. Only applies on `home` — a remote/slave target has no reserve
 * requirement, just needs the daemon to fit at all.
 */
function homeUsableCeiling(maxRam: number): number {
  return Math.min(maxRam - 5, maxRam * 0.8)
}

/**
 * Picks the highest tier from `AVAILABLE_TIERS` whose script fits within
 * `freeRam` (already reserve-adjusted by the caller for `home`). Cost is
 * always measured from `home` regardless of the launch target — Viteburner
 * deploys there, and a script's RAM cost depends only on its own content,
 * not which host it's measured from (same convention `xp-farm.daemon.ts`
 * already relies on).
 */
function chooseTier(ns: NS, freeRam: number): { tier: number, script: string } | null {
  for (const candidate of AVAILABLE_TIERS) {
    const cost = ns.getScriptRam(candidate.script, 'home')
    if (cost > 0 && cost <= freeRam)
      return candidate
  }
  return null
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog('ALL')

  const args = parseArgs(ns, [
    {
      short: 'f',
      long: 'force',
      defaultValue: false,
      description: 'Force daemon replacement',
    },
  ])

  const win = eval('window')
  const cgd = getCgd(win)

  const forcedTier = args._[0] !== undefined ? args._[0] : undefined
  const remote = args._[1] !== undefined ? String(args._[1]) : 'home'

  const currentTier = cgd.daemon?._getTier()
  const needsDaemon = !cgd.daemon || (forcedTier !== undefined && forcedTier !== currentTier)

  if (needsDaemon || args['--force']) {
    let target: { tier: number, script: string } | null
    if (forcedTier !== undefined && forcedTier !== 'max') {
      target = AVAILABLE_TIERS.find(t => t.tier === forcedTier) ?? null
      if (!target) {
        ns.tprint(`ERROR: start.js — tier ${forcedTier} isn't built yet.`)
        return
      }
    }
    else {
      const maxRam = ns.getServerMaxRam('home')
      const usedRam = ns.getServerUsedRam('home')
      const freeRam = homeUsableCeiling(maxRam) - usedRam
      target = chooseTier(ns, freeRam)
      if (!target) {
        ns.tprint(
          `ERROR: start.js — not enough free RAM on home for even the cheapest daemon tier (need ${homeUsableCeiling(
            maxRam,
          ).toFixed(1)} GB of headroom, ${freeRam.toFixed(1)} GB available).`,
        )
        return
      }
    }

    if (remote !== 'home') {
      if (!ns.hasRootAccess(remote)) {
        ns.tprint(`ERROR: start.js — no root access on ${remote}, can't launch the daemon there.`)
        return
      }
      const copied = ns.scp(target.script, remote)
      if (!copied) {
        ns.tprint(`ERROR: start.js — couldn't copy ${target.script} to ${remote}.`)
        return
      }
    }

    const cost = ns.getScriptRam(target.script, 'home')
    const freeOnTarget = ns.getServerMaxRam(remote) - ns.getServerUsedRam(remote)
    if (cost > freeOnTarget) {
      ns.tprint(
        `ERROR: start.js — ${target.script} needs ${cost.toFixed(2)} GB, only ${freeOnTarget.toFixed(
          2,
        )} GB free on ${remote}.`,
      )
      return
    }

    const pid = ns.exec(target.script, remote, 1)
    if (pid === 0) {
      ns.tprint(`ERROR: start.js — couldn't launch ${target.script} on ${remote}.`)
      return
    }

    // ns.exec starts the daemon asynchronously — its own handoff/setup
    // (see cgd/daemon-core.ts) hasn't necessarily finished by the time
    // this line resolves, especially if it's replacing a previous
    // daemon. Wait for it to actually register at the tier just
    // launched before moving on to ui.app.js, which checks for a live
    // daemon at its own startup and would otherwise frequently lose
    // this exact race on a cold start.
    const start = Date.now()
    while (cgd.daemon?._getTier() !== target.tier && Date.now() - start < READY_TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, READY_POLL_MS))
    }
    if (cgd.daemon?._getTier() !== target.tier) {
      ns.tprint(
        `WARNING: start.js — ${target.script} didn't register within ${READY_TIMEOUT_MS}ms; continuing anyway.`,
      )
    }
  }

  const assetsPid = ns.exec('assets.app.js', 'home', 1)
  if (assetsPid === 0) {
    ns.tprint('WARNING: start.js — couldn\'t launch assets.app.js (not enough RAM?).')
  }

  const uiPid = ns.exec('ui.app.js', 'home', 1)
  if (uiPid === 0) {
    ns.tprint('ERROR: start.js — couldn\'t launch ui.app.js (not enough RAM?).')
  }
}
