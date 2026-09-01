import type { CloudServerRow } from '../../../utils/cloud-list'
import type { MoneyFarmState } from '../logic/use-money-farm'
import React from '@react'
import { ServerCard } from '../../../components/server-card'

const MODE_LABEL: Record<string, string> = {
  'weaken': 'weakening',
  'grow-prep': 'prepping',
  'farm': 'farming',
}

/**
 * One dedicated (or dedicatable) server's card: hostname/RAM + Enable/
 * Disable, and — once enabled — its current target/mode status line. No
 * per-thread breakdown or tail-log link the way `../../xp-farm/`'s card
 * has: a farming host runs many short-lived one-shot batch legs (see
 * `daemons/money-farm.daemon.ts`'s header comment), so there's no single
 * stable process worth tailing and no thread count worth displaying as if
 * it were fixed.
 */
export function MoneyFarmServerCard({
  mf,
  s,
}: {
  mf: MoneyFarmState
  s: CloudServerRow
}) {
  const isEnabled = mf.enabled.has(s.hostname)
  const isOccupied = mf.busyHost === s.hostname
  const assignment = mf.status[s.hostname]
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
              <div className="bb-wrap" style={{ fontSize: '11px', opacity: 0.75 }}>
                {assignment
                  ? (
                      <span>
                        →
                        {' '}
                        {assignment.target}
                        {' '}
                        (
                        {MODE_LABEL[assignment.mode] ?? assignment.mode}
                        )
                      </span>
                    )
                  : (
                      '→ starting…'
                    )}
              </div>
            )
          : null}
      </div>
    </ServerCard>
  )
}
