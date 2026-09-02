import React from '@react'
import { TitlebarToolbar } from '../../../components/window/titlebar-toolbar'
import type { CloudServerRow } from '../../../utils/cloud-list'
import { useCloudServers } from '../logic/use-cloud-servers'
import { BuyForm } from './buy-form'
import { CloudServerCard } from './server-card'
import { SlaveNodeChecklist } from './slave-node-checklist'

type Tab = 'purchased' | 'slaves'

/**
 * Root component: a Purchased/Slave Nodes tab strip sharing its row with
 * the Refresh button, and whichever tab's own content (count line included)
 * below it. See `../index.ts`'s header comment for what this app does and
 * why.
 */
export function CloudServersContent() {
  const cs = useCloudServers()
  const [tab, setTab] = React.useState<Tab>('purchased')

  return (
    <>
      <TitlebarToolbar>
        <button onClick={() => void cs.refreshAll()} disabled={cs.busy} className="bb-icon-link">
          🗘
        </button>
      </TitlebarToolbar>
      <div>
        <div
          className="bb-divider-bottom"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
            paddingBottom: '6px',
          }}
        >
          <div className="bb-tabs">
            <button
              onClick={() => setTab('purchased')}
              className={`bb-tab${tab === 'purchased' ? ' bb-tab--active' : ''}`}
            >
              Purchased
            </button>
            <button
              onClick={() => setTab('slaves')}
              className={`bb-tab${tab === 'slaves' ? ' bb-tab--active' : ''}`}
            >
              Slave Nodes
            </button>
          </div>
        </div>

        {tab === 'purchased'
          ? (
              <div>
                <div style={{ fontSize: '12px', marginBottom: '8px' }}>
                  Servers:
                  {' '}
                  {cs.cloudServers.length}
                  {' / '}
                  {cs.serverLimit || '?'}
                </div>

                {cs.listError
                  ? (
                      <div className="bb-text-error bb-wrap" style={{ fontSize: '11px', marginBottom: '8px' }}>
                        {cs.listError}
                      </div>
                    )
                  : null}

                {/* --- Purchased server list ---
                    A CSS grid of cards rather than a stacked list: `auto-fill` +
                    `minmax` picks however many ~200px columns currently fit and
                    wraps the rest onto new rows, so widening the floating window
                    (see the resize handle added in `ui/components/app-grid.tsx`)
                    reflows this into more columns instead of leaving a fixed-width
                    list stranded in the middle of empty space. 200px keeps each
                    card's "hostname (used / total GB)" + Delete button row (the
                    original single-column layout) from cramping before it falls
                    back to wrapping (`.bb-wrap`). No max-height/overflow of its own — the
                    window's own content area (also in app-grid.tsx) already
                    scrolls when everything together doesn't fit. */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                    gap: '8px',
                    marginBottom: '14px',
                  }}
                >
                  {cs.cloudServers.length === 0 && !cs.listLoading
                    ? (
                        <div style={{ gridColumn: '1 / -1', fontSize: '12px', opacity: 0.7 }}>
                          No purchased servers yet.
                        </div>
                      )
                    : (
                        cs.cloudServers.map((s: CloudServerRow) => (
                          <CloudServerCard key={s.hostname} cs={cs} s={s} />
                        ))
                      )}
                </div>

                {cs.deleteError
                  ? (
                      <div className="bb-text-error bb-wrap" style={{ fontSize: '11px', marginBottom: '8px' }}>
                        {cs.deleteError}
                      </div>
                    )
                  : null}

                <BuyForm cs={cs} />
              </div>
            )
          : (
              <div>
                {/* --- Slave nodes ---
                    A checkbox per rooted, non-purchased server on the network —
                    check it to designate that host as a worker for
                    Programs/XP Farm/Share, the same role a purchased server
                    plays. See `ui/utils/slave-nodes.ts`'s header comment for
                    the full design. */}
                <div style={{ fontSize: '12px', marginBottom: '8px' }}>
                  Slave Nodes:
                  {cs.slaveServers.length}
                </div>

                {cs.slaveHostsError
                  ? (
                      <div className="bb-text-error bb-wrap" style={{ fontSize: '11px', marginBottom: '8px' }}>
                        {cs.slaveHostsError}
                      </div>
                    )
                  : null}
                {cs.toggleSlaveError
                  ? (
                      <div className="bb-text-error bb-wrap" style={{ fontSize: '11px', marginBottom: '8px' }}>
                        {cs.toggleSlaveError}
                      </div>
                    )
                  : null}

                <SlaveNodeChecklist cs={cs} />
              </div>
            )}
      </div>
    </>
  )
}
