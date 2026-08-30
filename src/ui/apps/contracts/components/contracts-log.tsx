import type { ContractsLogEntry } from '../../../../contracts/state-file/types'
import React from '@react'
import { formatMediumHour } from '../../../../utils/format/dates'
import CheckCircle from '../../../svg/check-circle.svg'
import CrossCircle from '../../../svg/cross-circle.svg'

export type ContractType
  = | 'mathematics'
    | 'array'
    | 'dynamic-programming'
    | 'matrix'
    | 'string'
    | 'pathfinding'
    | 'graph'
    | 'encoding'
    | 'compression'
    | 'encryption'
    | 'unknown'

const CONTRACT_TYPES: Record<string, ContractType> = {
  'Algorithmic Stock Trader I': 'dynamic-programming',
  'Algorithmic Stock Trader II': 'dynamic-programming',
  'Algorithmic Stock Trader III': 'dynamic-programming',
  'Algorithmic Stock Trader IV': 'dynamic-programming',
  'Array Jumping Game II': 'dynamic-programming',
  'Array Jumping Game': 'dynamic-programming',
  'Compression I: RLE Compression': 'compression',
  'Compression II: LZ Decompression': 'compression',
  'Compression III: LZ Compression': 'compression',
  'Encryption I: Caesar Cipher': 'encryption',
  'Encryption II: Vigenère Cipher': 'encryption',
  'Find All Valid Math Expressions': 'mathematics',
  'Find Largest Prime Factor': 'mathematics',
  'Generate IP Addresses': 'string',
  'HammingCodes: Encoded Binary to Integer': 'encoding',
  'HammingCodes: Integer to Encoded Binary': 'encoding',
  'Merge Overlapping Intervals': 'array',
  'Minimum Path Sum in a Triangle': 'dynamic-programming',
  'Proper 2-Coloring of a Graph': 'graph',
  'Sanitize Parentheses in Expression': 'string',
  'Shortest Path in a Grid': 'pathfinding',
  'Spiralize Matrix': 'matrix',
  'Subarray with Maximum Sum': 'array',
  'Total Ways to Sum II': 'dynamic-programming',
  'Total Ways to Sum': 'dynamic-programming',
  'Unique Paths in a Grid I': 'dynamic-programming',
  'Unique Paths in a Grid II': 'dynamic-programming',
}

export const CONTRACT_TYPE_COLORS: Record<ContractType, string> = {
  'mathematics': '#F2C94C',
  'array': '#56CCF2',
  'dynamic-programming': '#BB86FC',
  'matrix': '#4DD0C8',
  'string': '#FF8A80',
  'pathfinding': '#6FCF97',
  'graph': '#7986CB',
  'encoding': '#F48FB1',
  'compression': '#F2A65A',
  'encryption': '#64B5F6',
  'unknown': '#9E9E9E',
}

export function ContractsLog(props: {
  log: ContractsLogEntry[]
} & React.HTMLAttributes<HTMLDivElement>) {
  const {
    log,
    ...divProps
  } = props

  const hour = 60 * 60 * 1000
  const getList = () => {
    const minTs = Date.now() - hour
    return log
      .filter(({ ts }) => ts >= minTs)
      .map(e => ({ ...e, time: formatMediumHour(e.ts), type: CONTRACT_TYPES[e.title] ?? 'unknown' }))
      .sort(({ ts: tsA }, { ts: tsB }) => tsB - tsA)
  }

  const [contentArr, setContentArr] = React.useState(getList)

  React.useEffect(() => {
    const interval = setInterval(() => {
      setContentArr(getList())
    })
    return () => clearInterval(interval)
  }, [])

  return (
    <div
      {...divProps}
      className="bb-card"
    >
      <div className="bb-card-header">Recent Contracts (1h)</div>

      <div
        style={{
          margin: '-11px -8px -7px',
        }}
      >
        <table className="bb-table" width="100%">
          <tbody>
            <tr>
              <th className="smallest">Time</th>
              <th>Title</th>
              <th>Host</th>
              <th>Type</th>
              <th className="smallest">Solved</th>
              <th>Reward</th>
            </tr>

            {contentArr.map(({ ts, time, title, host, solved, reward, type }) => (
              <tr key={ts}>
                <td className="smallest">{time}</td>
                <td>{title}</td>
                <td>{host}</td>
                <td>
                  <span
                    className="bb-pill"
                    style={{
                      background: `color-mix(in srgb, ${CONTRACT_TYPE_COLORS[type]} 15%, transparent)`,
                      color: CONTRACT_TYPE_COLORS[type],
                    }}
                  >
                    {type}
                  </span>
                </td>
                <td className="smallest" style={{ textAlign: 'center' }}>{solved ? <CheckCircle style={{ color: 'var(--bb-theme-success)' }} /> : <CrossCircle style={{ color: 'var(--bb-theme-error)' }} />}</td>
                <td>{reward}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}
