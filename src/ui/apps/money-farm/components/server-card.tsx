import type { CloudServerRow } from '../../../utils/cloud-list'
import type { MoneyFarmState } from '../logic/use-money-farm'
import React from '@react'
import { formatMoney } from '../../../../utils/format/game'
import { ServerCard } from '../../../components/server-card'

const MODE_LABEL: Record<string, string> = {
  null: 'idling',
  prep: 'prepping',
  farm: 'farming',
  done: 'farming',
}

/**
 * One dedicated (or dedicatable) server's card: hostname/RAM + Enable/
 * Disable, and — once enabled — a status line *per target* currently
 * running a worker there. Plural on purpose: hwgw shares one host pool
 * across every running instance rather than dedicating a whole host per
 * target (see `lib/hwgw/workers.ts`'s header comment), so a card can list
 * more than one target. No per-thread breakdown or tail-log link the way
 * `../../xp-farm/`'s card has: a farming host runs many `h.js`/`g.js`/
 * `w.js` loops at once, so there's no single stable process worth tailing.
 */
export function MoneyFarmServerCard({
  mf,
  s,
}: {
  mf: MoneyFarmState
  s: CloudServerRow
}) {
  const isEnabled = mf.enabled.has(s.hostname)
  const isOccupied = mf.busyHost === s.hostname || mf.bulkBusy
  const assignments = mf.status[s.hostname] ?? []
  const hasProcess = !isEnabled && s.ramUsed > 0

  return (
    <ServerCard
      server={s}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row-reverse',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {!hasProcess
          ? (
              <button
                onClick={() => void mf.toggle(s.hostname)}
                disabled={isOccupied}
                className={`bb-btn bb-btn--wide${isEnabled ? ' bb-btn-danger' : ''}`}
              >
                {isOccupied ? '...' : isEnabled ? 'Stop' : 'Start'}
              </button>
            )
          : (
              <button
                disabled
                className="bb-btn bb-btn--wide bb-btn-warn"
              >
                Occupied
              </button>
            )}
        {isEnabled
          ? (
              <div className="bb-wrap" style={{ fontSize: '11px', opacity: 0.75, textAlign: 'right' }}>
                {assignments.length > 0
                  ? assignments.map(a => (
                      <div key={a.target}>
                        →
                        {' '}
                        {a.target}
                        {' '}
                        (
                        {MODE_LABEL[a.mode] ?? a.mode}
                        {a.moneyPerHour > 0 && `, ${formatMoney(a.moneyPerHour)}/h`}
                        )
                      </div>
                    ))
                  : (
                      '→ idling'
                    )}
              </div>
            )
          : null}
      </div>
    </ServerCard>
  )
}
