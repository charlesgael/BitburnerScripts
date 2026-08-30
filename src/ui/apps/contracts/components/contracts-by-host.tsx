import type { ContractLogSummary } from '../../../../contracts/state-file/make-stats'
import React from '@react'
import { Bar } from './bar'

export function ContractsByHost(props: {
  byHost: ContractLogSummary['byHost']
} & React.HTMLAttributes<HTMLDivElement>) {
  const {
    byHost,
    ...divProps
  } = props

  const max = Math.max(...Object.values(byHost).map(it => it.total))
  const hostsArr = Object.entries(byHost)
    .sort(([, { total: A }], [, { total: B }]) => B - A)
    .map(([host, { solved, failed, total }]) => [host, solved / max, failed / max, total] as const)

  return (
    <div
      {...divProps}
      className="bb-card"
    >
      <div className="bb-card-header">Contracts by Host</div>

      <div
        style={{
          maxHeight: 300,
          overflowY: 'auto',
          margin: -8,
          padding: 8,
        }}
      >
        <table style={{ width: '100%' }}>
          <tbody>
            {hostsArr.map(([host, solved, failed, total], idx) => (
              <tr
                key={host}
                style={{
                  background: idx % 2 ? 'var(--bb-theme-backgroundprimary)' : 'var(--bb-theme-backgroundsecondary)',
                }}
              >
                <td style={{ width: 0, whiteSpace: 'nowrap' }}>
                  {host}
                </td>
                <td style={{ width: 0 }}>
                  (
                  {total}
                  )
                </td>
                <td>
                  <Bar
                    height={4}
                    segments={[
                      { pct: solved, color: 'var(--bb-theme-success)' },
                      { pct: failed, color: 'var(--bb-theme-error)' },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
