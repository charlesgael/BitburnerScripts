import type { NS } from '@ns'
import { formatCompact } from '../utils/format/numbers'

/**
 * Stat providers a tiered daemon computes each idle tick and pushes into
 * `cgd.store` (see `store.ts`) — relocated from the pre-epic
 * `ui/stats/registry.ts`, which lived under `ui/` back when `ui.app.ts`'s
 * own main loop called `compute` directly. Now it's the daemon that owns
 * this: `ui/components/overview-stats.ts` just renders whatever's currently
 * in the store, it no longer computes anything itself.
 *
 * Listed in ascending RAM-cost order so it reads as a menu — skim from the
 * top until you've spent as much as you're willing to on a given tier.
 * These calls are LITERAL (`ns.getServerUsedRam(`, not a computed path) —
 * unlike `cgd/dispatch.ts`'s caller-forwarded calls, a stat provider's own
 * `compute` body is exactly the kind of reference that legitimately costs
 * RAM, on purpose, for whichever tier's daemon file imports this module.
 * See `cgd/dispatch.ts`'s header comment for the fuller contrast.
 *
 * Every provider here currently runs at tier 0 and tier 1 alike (tier 0
 * has no caller-facing dispatch methods, but still computes this same
 * baseline set for the store — see `docs/epic-cgd-namespace.md`'s tier
 * table). Tier-specific additions (tier 2's cloud/slave stats, tier 4's
 * singularity-derived ones) land in their own tier's daemon file as this
 * project reaches those phases, not here.
 *
 * Home RAM is deliberately NOT a provider here despite being part of the
 * same baseline set conceptually — `stat-push.ts` computes it separately,
 * once, because `cgd.store`'s dedicated `homeRam: {used, max}` field (see
 * `types.ts`) needs the raw numbers for `ramShortfallReason`'s gating math,
 * not just a pre-formatted display string. Folding it in here would mean
 * fetching it twice (once for that field, once for the generic `stats`
 * display list) for no reason — `stat-push.ts` derives both from one call.
 *
 * Hacking level and money are deliberately not here — the game's own
 * default overview already shows both.
 */
export type StatValue
  = | { kind: 'text', label: string, value: string }
    | { kind: 'bar', label: string, value: string, pct: number }

export interface StatProvider {
  id: string
  label: string
  /**
   * GB — matches the `RAM cost` line(s) in NetscriptDefinitions.d.ts
   * for whatever `compute` calls; see the comment on each entry.
   */
  ramCost: number
  enabled: boolean
  compute: (ns: NS) => Promise<StatValue>
}

export const BASELINE_STAT_PROVIDERS: StatProvider[] = [
  {
    id: 'karma',
    label: 'Karma',
    // ns.getPlayer — RAM cost: 0.5 GB.
    ramCost: 0.5,
    enabled: true,
    compute: async ns => ({
      kind: 'text',
      label: 'Karma',
      value: (ns.getPlayer()).karma.toFixed(0),
    }),
  },
  {
    id: 'hacknet-revenue',
    label: 'Hacknet',
    // ns.hacknet.numNodes + ns.hacknet.getNodeStats — RAM cost: 0.5 GB
    // each = 1.0 GB. getNodeStats().production is documented as
    // "production per second" (money, for classic Hacknet Nodes), so
    // this sums the live rate across every node rather than a lifetime
    // total.
    ramCost: 1.0,
    enabled: true,
    compute: async (ns) => {
      const count = ns.hacknet.numNodes()
      let perSecond = 0
      for (let i = 0; i < count; i++) {
        perSecond += (ns.hacknet.getNodeStats(i)).production
      }
      return { kind: 'text', label: 'Hacknet', value: `$${formatCompact(perSecond)}/s` }
    },
  },
]
