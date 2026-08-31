import type { CloudServerRow } from '../../../utils/cloud-list'
import React from '@react'
import { formatRam } from '../../../../utils/format/game'
import { ServerCard } from '../../../components/server-card'
import { useShareHostCard } from '../logic/use-share-host-card'
/**
 * One host's share card: usage bar, thread-tier picker (or the running
 * thread count while sharing), and its Start/Stop Sharing button.
 */
export function ShareHostCard({
  ns,
  host,
  onRamUsedChange,
}: {
  ns: any
  host: CloudServerRow
  onRamUsedChange: (hostname: string, ramUsed: number) => void
}) {
  const card = useShareHostCard(ns, host, onRamUsedChange)

  return (

    <ServerCard
      server={host}
      reserve={card.reservedRam}
    >

      {card.error ? <div className="bb-text-error bb-wrap">{card.error}</div> : null}

      {card.insufficientRam
        ? (
            <div className="bb-text-error bb-wrap" style={{ fontSize: '11px' }}>
              Needs at least
              {' '}
              {formatRam(card.costPerThread)}
              {' '}
              shareable to share a single thread — only
              {' '}
              {formatRam(card.shareableRam)}
              {' '}
              is shareable here.
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
                          {formatRam(threads * card.costPerThread)}
                        </option>
                      ))}
                    </select>
                  )
                : (
                    <div>
                      Sharing
                      {' '}
                      {formatRam(card.runningThreads * card.costPerThread)}
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
