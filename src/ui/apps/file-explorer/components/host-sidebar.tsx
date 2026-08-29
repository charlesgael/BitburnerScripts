import type { FileExplorerState } from '../logic/use-file-explorer'
import React from '@react'

/**
 * The left-hand "drives" list — home, purchased/cloud servers, and any
 * previously-scanned host (see `../index.ts`'s header comment).
 */
export function HostSidebar({ fx }: { fx: FileExplorerState }) {
  return (
    <div style={{ width: '154px', flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {fx.hostsLoading
        ? (
            <div style={{ opacity: 0.7, fontSize: '11px' }}>Loading…</div>
          )
        : (
            fx.hosts.map(h => (
              <button
                key={h.hostname}
                onClick={() => fx.selectHost(h.hostname)}
                title={h.hostname}
                className={`bb-list-item${h.hostname === fx.selectedHost ? ' bb-list-item--selected' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  textAlign: 'left',
                  padding: '4px 6px',
                  fontSize: '11px',
                }}
              >
                <span>{h.icon}</span>
                <span className="bb-wrap" style={{ flex: 1 }}>
                  {h.hostname}
                </span>
              </button>
            ))
          )}
    </div>
  )
}
