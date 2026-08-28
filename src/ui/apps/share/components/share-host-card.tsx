import type { ShareHost } from '../logic/types'
import { useShareHostCard } from '../logic/use-share-host-card'

/**
 * One host's share card: usage bar, thread-tier picker (or the running
 * thread count while sharing), and its Start/Stop Sharing button.
 */
export function ShareHostCard({
  React,
  ns,
  host,
  onUsedRamChange,
}: {
  React: any
  ns: any
  host: ShareHost
  onUsedRamChange: (hostname: string, usedRam: number) => void
}) {
  const card = useShareHostCard(React, ns, host, onUsedRamChange)
  const usedPct = host.maxRam > 0 ? (host.usedRam / host.maxRam) * 100 : 0
  const reservedPct = host.isHome && host.maxRam > 0 ? (card.reservedRam / host.maxRam) * 100 : 0

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
          {host.hostname}
        </span>
        <span style={{ opacity: 0.75 }}>
          {host.usedRam.toFixed(1)}
          {' '}
          /
          {host.maxRam.toFixed(1)}
          {' '}
          GB
        </span>
      </div>
      {/* Thin per-server RAM usage bar, with a blue band marking the
                reserve zone kept off-limits to sharing on `home`. */}
      <div className="bb-progress bb-progress--thin">
        <div
          className={`bb-progress-fill${usedPct > 90 ? ' bb-progress-fill--danger' : ''}`}
          style={{ width: `${usedPct}%` }}
        />
        {host.isHome ? <div className="bb-progress-guard" style={{ width: `${reservedPct}%` }} /> : null}
      </div>

      {host.isHome
        ? (
            <div style={{ fontSize: '10px', opacity: 0.6 }}>
              {card.reservedRam.toFixed(1)}
              {' '}
              GB kept in reserve
            </div>
          )
        : null}

      {card.error ? <div className="bb-text-error bb-wrap">{card.error}</div> : null}

      {card.insufficientRam
        ? (
            <div className="bb-text-error bb-wrap" style={{ fontSize: '11px' }}>
              Needs at least
              {' '}
              {card.costPerThread.toFixed(2)}
              {' '}
              GB shareable to share a single thread — only
              {' '}
              {card.shareableRam.toFixed(2)}
              {' '}
              GB is shareable here.
            </div>
          )
        : (
            <React.Fragment>
              {!card.sharing
                ? (
                    <select
                      value={card.selectedThreads}
                      onChange={(ev: any) => {
                        card.setThreadsChosenByUser(true)
                        card.setSelectedThreads(Number(ev.target.value))
                      }}
                      className="bb-field bb-field--block"
                    >
                      {card.tiers.map(threads => (
                        <option key={threads} value={threads}>
                          {(threads * card.costPerThread).toFixed(0)}
                          {' '}
                          GB —
                          {threads}
                          {' '}
                          thread
                          {threads === 1 ? '' : 's'}
                        </option>
                      ))}
                    </select>
                  )
                : (
                    <div>
                      Sharing
                      {' '}
                      {(card.runningThreads * card.costPerThread).toFixed(0)}
                      {' '}
                      GB —
                      {card.runningThreads}
                      {' '}
                      thread
                      {card.runningThreads === 1 ? '' : 's'}
                      .
                    </div>
                  )}
              <button
                onClick={() => void card.toggleSharing()}
                disabled={card.busy}
                className={`bb-btn bb-btn--block bb-btn--lg${card.sharing ? ' bb-btn-danger' : ''}`}
              >
                {card.busy ? '...' : card.sharing ? 'Stop Sharing' : 'Start Sharing'}
              </button>
            </React.Fragment>
          )}
    </div>
  )
}
