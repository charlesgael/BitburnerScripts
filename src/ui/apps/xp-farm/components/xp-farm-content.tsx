import React from '@react';
import { InstanceManager } from '../../../components/instance-manager';
import { TitlebarToolbar } from '../../../components/window/titlebar-toolbar';
import type { CloudServerRow } from '../../../utils/cloud-list';
import { useXpFarm } from '../logic/use-xp-farm';
import { XpFarmServerCard } from './server-card';

/**
 * Root component: the dedicated-count/refresh header, the daemon status
 * row, and the per-server card grid. See `../index.ts`'s header comment
 * for what this app does and why.
 */
export function XpFarmContent() {
  const xf = useXpFarm()

  // A CSS grid of cards rather than a stacked list — same idea and same
  // 260px column width as the Cloud Servers app's own server grid (see
  // `ui/apps/cloud-servers/index.ts`'s header comment on its grid):
  // `auto-fill` + `minmax` wraps however many currently fit, so widening
  // the window reflows into more columns instead of a fixed-width list
  // stranded in empty space.
  const cards = xf.servers.map((s: CloudServerRow) => (
    <XpFarmServerCard key={s.hostname} xf={xf} s={s} />
  ))

  return (
    <>
      <TitlebarToolbar>
        <InstanceManager
          filename="daemons/xp-farm.daemon.js"
          host="home"
        />
        <button
          onClick={() => void xf.refresh()}
          disabled={xf.loading}
          className="bb-icon-link"
        >
          🗘
        </button>
      </TitlebarToolbar>
      <div>
        {xf.error
          ? (
              <div
                className="bb-text-error bb-wrap"
                style={{
                  fontSize: '11px',
                  marginBottom: '8px',
                }}
              >
                {xf.error}
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
          {xf.servers.length === 0 && !xf.loading
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
