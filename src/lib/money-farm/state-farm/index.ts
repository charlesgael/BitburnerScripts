import type { NS } from '@ns'
import type { AddLogInput, MoneyFarmLogEntry } from './types'
import { parseLog } from '../../../utils/log-helper'
import { buildMoneyFarmRollup } from './mk-stats'
import { moneyFarmLogEntrySchema } from './types'

/**
 * Money Farm's activity log — one line per completed hack()/grow()/
 * weaken() call, written by `daemons/money-farm.daemon.ts` (via
 * `addMoneyFarmLog` below) after draining `ports.lib.ts`'s
 * `MONEY_FARM_PORT`, which `hack.daemon.ts`/`grow.daemon.ts`/
 * `weaken.daemon.ts` write a status object to after each completed action
 * when launched with `--port` — see those files' own header comments for
 * why `money`/`deltaSecurity` are sometimes filled in by the daemon rather
 * than the worker itself (a per-thread RAM-cost concern, not a laziness
 * one).
 *
 * `'update-server'` isn't a completed hack/grow/weaken call at all —
 * `tickSession` writes one every `STATE_CHECK_INTERVAL` tick, for every
 * session in the chain, carrying the target's actual live
 * `money`/`maxMoney`/`security`/`minSecurity` (via `ns.getServer`). Every
 * hack/grow/weaken entry's `deltaSecurity` is a *change*, not an absolute
 * value, from one worker's own action, and grow's in particular is never
 * exact (see `grow.daemon.ts`'s header comment), so summing deltas alone
 * drifts from reality over time — `update-server`'s `security` is a
 * checkpoint a reader should re-anchor its running total to rather than
 * trusting an ever-compounding sum. The two fields are named differently
 * on purpose (`deltaSecurity` vs. `security`) so a reader can't
 * accidentally sum an `update-server` entry's absolute value into a
 * running delta total.
 *
 * Mirrors `contracts/state-file/`'s exact shape (`logSchema` wrapping a
 * content schema, `parseLog` for schema-validated reads) — this file is
 * that pattern's money-farm equivalent, kept under `ui/utils/` alongside
 * `money-farm-config.ts` rather than a separate top-level folder, matching
 * how the rest of this feature's shared constants/types are organized.
 */
export const MONEY_FARM_LOG_FILE = 'log/money-farm-log.txt'
/**
 * Raw entries retained on disk before a rollup collapses the rest (see
 * `addMoneyFarmLog`/`rollupIfNeeded` below) — purely a tradeoff between
 * per-poll parse cost (the dashboard reads+parses+summarizes this file
 * every 3s, see `money-farm-dashboard.tsx`'s `refreshLogStats`) and how
 * much fine-grained recent detail stays queryable, *not* how much total
 * history survives (a rollup entry keeps the running totals forever
 * regardless of this number). Tune freely.
 */
export const MONEY_FARM_LOG_MAX_ENTRIES = 5000
export const MONEY_FARM_LOG_CLEAN_ROUNDS = 100

export function parseMoneyFarmLog(raw: string): MoneyFarmLogEntry[] {
  return parseLog(raw, moneyFarmLogEntrySchema)
}

/*
 * Deliberately doesn't go through `utils/log-helper.ts`'s `addLog`/
 * `trimLogIfNeeded` — that pair shares one module-level `saves` counter
 * across *every* log any script writes (contracts-log included), so
 * calling `addLog` here with no explicit `cleanDelay`/`maxEntries` would
 * fall back to its defaults (`AUTO_CLEAN_ROUNDS`/`LOG_MAX_ENTRIES`) and,
 * because that shared counter keeps ticking regardless of which file
 * triggered it, could periodically re-trigger `trimLogIfNeeded`'s plain
 * lossy truncation against *this* file — exactly the bug this rollup
 * exists to fix. This file owns its own counter and its own trim path
 * instead, and leaves `log-helper.ts` (and every other log using it)
 * untouched.
 */
let saves = 0

export function addMoneyFarmLog(ns: NS, obj: AddLogInput) {
  ns.write(MONEY_FARM_LOG_FILE, `${JSON.stringify({ ts: Date.now(), ...obj })}\n`, 'a')
  saves++

  if (saves % MONEY_FARM_LOG_CLEAN_ROUNDS === 0)
    rollupIfNeeded(ns)
}

/**
 * Money-farm's own trim: instead of `trimLogIfNeeded`'s plain "keep the
 * most recent `maxEntries` lines, discard the rest," the discarded head is
 * folded into one compact `'rollup'` entry (`buildMoneyFarmRollup`,
 * `mk-stats.ts`) prepended to the retained tail — so `summarizeMoneyLog`
 * keeps reporting accurate lifetime totals no matter how many times this
 * fires, and the file never grows past `MONEY_FARM_LOG_MAX_ENTRIES + 1`
 * lines. Chained rollups (a previous rollup entry falling into a later
 * collapsed chunk) are handled transparently by `buildMoneyFarmRollup`
 * itself, so at most one rollup line ever exists at a time.
 */
function rollupIfNeeded(ns: NS): void {
  const raw = ns.read(MONEY_FARM_LOG_FILE)
  if (!raw)
    return

  // Cheap pre-check on raw line count before paying for a full
  // schema-validated parse, mirroring `trimLogIfNeeded`'s own pattern.
  const lines = raw.split('\n').filter(l => l.trim())
  if (lines.length <= MONEY_FARM_LOG_MAX_ENTRIES)
    return

  const entries = parseMoneyFarmLog(raw)
  // A line that failed to parse (e.g. a crash-truncated write) inflates
  // `lines.length` without being real recorded data — don't force a
  // rewrite over that alone.
  if (entries.length <= MONEY_FARM_LOG_MAX_ENTRIES)
    return

  const sorted = [...entries].sort((a, b) => a.ts - b.ts)
  const toKeep = sorted.slice(-MONEY_FARM_LOG_MAX_ENTRIES)
  const toCollapse = sorted.slice(0, sorted.length - toKeep.length)
  if (toCollapse.length === 0)
    return

  const boundaryTs = toKeep.length > 0 ? toKeep[0].ts : Date.now()
  const rollupEntry = buildMoneyFarmRollup(toCollapse, boundaryTs)

  const outLines = rollupEntry
    ? [JSON.stringify(rollupEntry), ...toKeep.map(e => JSON.stringify(e))]
    : toKeep.map(e => JSON.stringify(e))

  ns.write(MONEY_FARM_LOG_FILE, `${outLines.join('\n')}\n`, 'w')
}
