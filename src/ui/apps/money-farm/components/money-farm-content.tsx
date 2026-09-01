import type { CloudServerRow } from '../../../utils/cloud-list'
import React from '@react'
import { InstanceManager } from '../../../components/instance-manager'
import { TitlebarToolbar } from '../../../components/window/titlebar-toolbar'
import { useMoneyFarm } from '../logic/use-money-farm'
import { MoneyFarmServerCard } from './server-card'

/**
 * Root component: the header/refresh toolbar and the per-server card grid.
 * See `../index.ts`'s header comment for what this app does and why —
 * mirrors `../../xp-farm/components/xp-farm-content.tsx` exactly.
 */
export function MoneyFarmContent() {
  const mf = useMoneyFarm()

  const cards = mf.servers.map((s: CloudServerRow) => (
    <MoneyFarmServerCard key={s.hostname} mf={mf} s={s} />
  ))

  return (
    <>
      <TitlebarToolbar>
        <InstanceManager
          filename="daemons/money-farm.daemon.js"
          host="home"
        />
        <button
          onClick={() => void mf.refresh()}
          disabled={mf.loading}
          className="bb-icon-link"
        >
          🗘
        </button>
      </TitlebarToolbar>
      <div>
        <div
          className="bb-text-warning"
          style={{
            fontSize: 12,
            marginBottom: 8,
          }}
        >
          ⚠ This program is not meant to be used with flooder.app.js
        </div>
        {mf.error
          ? (
              <div
                className="bb-text-error bb-wrap"
                style={{
                  fontSize: '11px',
                  marginBottom: '8px',
                }}
              >
                {mf.error}
              </div>
            )
          : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
                        'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '8px',
          }}
        >
          {mf.servers.length === 0 && !mf.loading
            ? (
                <div
                  style={{
                    gridColumn: '1 / -1',
                    fontSize: '12px',
                    opacity: 0.7,
                  }}
                >
                  No purchased servers yet — buy one in the Cloud Servers
                  app first.
                </div>
              )
            : (
                cards
              )}
        </div>
      </div>
    </>
  )
}
