import type { GoLogSummary } from '../../../../go/state-file'

/**
 * Per-opponent win-rate/margin breakdown from `GO_GAME_LOG_FILE`
 * (`go/state-file.ts`'s `summarizeGameLog`) — the "is the current engine
 * actually working" view, distinct from the live board above it. Also
 * shows a per-engine breakdown, but only once the log actually contains
 * more than one engine's games (comparing the default heuristic engine
 * against `--experimental` runs is the whole reason
 * `GoGameLogEntry.engine` exists) — with only one engine represented it'd
 * just repeat the overall line above for no reason.
 */
export function GoSummaryTable({ React, summary }: { React: any, summary: GoLogSummary | null }) {
  if (!summary || summary.games === 0) {
    return (
      <div style={{ fontSize: '11px', opacity: 0.7 }}>
        No completed games logged yet.
      </div>
    )
  }

  return (
    <div>
      <div style={{ fontSize: '12px', marginBottom: '6px' }}>
        {summary.games}
        {' '}
        game(s) —
        {' '}
        {summary.wins}
        W /
        {summary.losses}
        {' '}
        L /
        {summary.ties}
        {' '}
        T (
        {summary.winRate.toFixed(0)}
        % win rate)
      </div>

      {summary.byEngine.length > 1 && (
        <div className="bb-panel" style={{ overflow: 'auto', marginBottom: '8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr className="bb-divider-bottom">
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Engine</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>G</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>W</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>L</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Win%</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Avg margin</th>
              </tr>
            </thead>
            <tbody>
              {summary.byEngine.map(row => (
                <tr key={row.engine} className="bb-divider-bottom">
                  <td style={{ padding: '4px 6px' }}>{row.engine}</td>
                  <td style={{ textAlign: 'right', padding: '4px 6px' }}>{row.games}</td>
                  <td style={{ textAlign: 'right', padding: '4px 6px' }}>{row.wins}</td>
                  <td style={{ textAlign: 'right', padding: '4px 6px' }}>{row.losses}</td>
                  <td style={{ textAlign: 'right', padding: '4px 6px' }}>{row.winRate.toFixed(0)}</td>
                  <td style={{ textAlign: 'right', padding: '4px 6px' }}>
                    {row.avgMargin > 0 ? '+' : ''}
                    {row.avgMargin.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bb-panel" style={{ overflow: 'auto', maxHeight: '160px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr className="bb-divider-bottom">
              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Opponent</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>G</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>W</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>L</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>Win%</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>Avg margin</th>
            </tr>
          </thead>
          <tbody>
            {summary.byOpponent.map(row => (
              <tr key={row.opponent} className="bb-divider-bottom">
                <td style={{ padding: '4px 6px' }}>{row.opponent}</td>
                <td style={{ textAlign: 'right', padding: '4px 6px' }}>{row.games}</td>
                <td style={{ textAlign: 'right', padding: '4px 6px' }}>{row.wins}</td>
                <td style={{ textAlign: 'right', padding: '4px 6px' }}>{row.losses}</td>
                <td style={{ textAlign: 'right', padding: '4px 6px' }}>{row.winRate.toFixed(0)}</td>
                <td style={{ textAlign: 'right', padding: '4px 6px' }}>
                  {row.avgMargin > 0 ? '+' : ''}
                  {row.avgMargin.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
