import type { Server } from '@ns'
import React from '@react'
import { formatRam } from '../../utils/format/game'
import { ProgressBar } from './progress-bar'

export function ServerCard({
  server,
  reserve,
  children,
}: {
  server: Server
  reserve?: number
  children?: any
}) {
  return (

    <div className="bb-card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <span className="bb-wrap" style={{ flex: 1, fontWeight: 'bold' }}>
          {server.hostname}
        </span>
        <span style={{ opacity: 0.75 }}>
          {formatRam(server.ramUsed)}
          {' '}
          /
          {' '}
          {formatRam(server.maxRam)}
        </span>
      </div>
      {/* Thin per-server RAM usage bar, with a blue band marking the
              reserve zone kept off-limits to sharing on `home`. */}
      <ProgressBar
        progress={server.ramUsed}
        max={server.maxRam}
        guard={reserve}
      />

      {reserve
        ? (
            <div style={{ fontSize: '10px', opacity: 0.6 }}>
              {formatRam(reserve)}
              {' '}
              kept in reserve
            </div>
          )
        : null}

      {children}
    </div>
  )
}
