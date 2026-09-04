import type { CloudServerRow } from '../../../utils/cloud-list'
import type { CloudServersState } from '../logic/use-cloud-servers'
import React from '@react'
import { formatRam } from '../../../../utils/format/game'

/**
 * One purchased server's card: hostname + used/total RAM, a thin usage
 * bar, and its Delete button (with an inline confirm step).
 */
export function CloudServerCard({
  cs,
  s,
}: {
  cs: CloudServersState
  s: CloudServerRow
}) {
  const usedPct = s.maxRam > 0 ? Math.min(100, (s.ramUsed / s.maxRam) * 100) : 0
  return (
    <div className="bb-card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span className="bb-wrap" style={{ flex: 1 }}>
          {s.hostname}
          {' ('}
          {formatRam(s.ramUsed)}
          /
          {formatRam(s.maxRam)}
          )
        </span>
        <button
          onClick={() => cs.handleDeleteClick(s.hostname)}
          disabled={cs.busy || s.ramUsed > 0}
          title={
            s.ramUsed > 0
              ? 'Can\'t delete: processes are running on this server'
              : undefined
          }
          className="bb-btn bb-btn-danger"
        >
          {cs.deleteBusyHost === s.hostname
            ? '...'
            : cs.confirmDeleteHost === s.hostname
              ? 'Confirm?'
              : 'Delete'}
        </button>
      </div>
      {/* Thin per-server RAM usage bar. */}
      <div className="bb-progress bb-progress--thin">
        <div
          className={`bb-progress-fill${usedPct > 90 ? ' bb-progress-fill--danger' : ''}`}
          style={{ width: `${usedPct}%` }}
        />
      </div>
    </div>
  )
}
