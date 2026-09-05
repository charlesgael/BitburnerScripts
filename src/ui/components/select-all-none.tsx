import React from '@react'

/**
 * A right-aligned "Select All" / "Select None" button pair, shared by every
 * server-selector list that needs bulk selection: the Cloud Servers app's
 * Slave Nodes tab (`ui/apps/cloud-servers/components/slave-node-checklist.tsx`)
 * and the XP Farm / Money Farm dedicated-host grids
 * (`ui/apps/xp-farm/components/xp-farm-content.tsx`,
 * `ui/apps/money-farm/components/money-farm-content.tsx`). Purely
 * presentational — each caller's own hook decides what "all"/"none" means
 * for its list and supplies the disabled state (already-at-that-extreme, or
 * a bulk/per-row operation in flight).
 */
export function SelectAllNone({
  onSelectAll,
  onSelectNone,
  selectAllDisabled,
  selectNoneDisabled,
}: {
  onSelectAll: () => void
  onSelectNone: () => void
  selectAllDisabled?: boolean
  selectNoneDisabled?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '6px',
        marginBottom: '8px',
      }}
    >
      <button
        onClick={onSelectAll}
        disabled={selectAllDisabled}
        className="bb-btn bb-btn--sm"
      >
        Select All
      </button>
      <button
        onClick={onSelectNone}
        disabled={selectNoneDisabled}
        className="bb-btn bb-btn--sm"
      >
        Select None
      </button>
    </div>
  )
}
