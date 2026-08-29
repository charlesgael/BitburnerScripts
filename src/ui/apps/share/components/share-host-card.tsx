import type { CloudServerRow } from '../../../utils/cloud-list'
import { ServerCard } from '../../../components/server-card'
import { useShareHostCard } from '../logic/use-share-host-card'

/**
 * One host's share card: usage bar, thread-tier picker (or the running
 * thread count while sharing), and its Start/Stop Sharing button.
 */
export function ShareHostCard({
  React,
  ns,
  host,
  onRamUsedChange,
}: {
  React: any
  ns: any
  host: CloudServerRow
  onRamUsedChange: (hostname: string, ramUsed: number) => void
}) {
  const card = useShareHostCard(React, ns, host, onRamUsedChange)

  return (

    <ServerCard
      React={React}
      server={host}
      reserve={card.reservedRam}
    >

      {card.error ? <div className="bb-text-error bb-wrap">{card.error}</div> : null}

      {card.insufficientRam
        ? (
            <div className="bb-text-error bb-wrap" style={{ fontSize: '11px' }}>
              Needs at least
              {' '}
              {card.costPerThread?.toFixed(2)}
              {' '}
              GB shareable to share a single thread — only
              {' '}
              {card.shareableRam?.toFixed(2)}
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
                          {' '}
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
                      {' '}
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
    </ServerCard>
  )
}
