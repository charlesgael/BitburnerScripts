import React from '@react'
import { TitlebarToolbar } from '../../../components/window/titlebar-toolbar'
import { useGo } from '../logic/use-go'
import { GoBoard } from './go-board'
import { GoSummaryTable } from './go-summary-table'

/**
 * Root component: controls, the live board + score + event feed, and the
 * game-log win-rate summary underneath. See `../index.ts`'s header comment
 * for what this app does and why it never touches `ns.go.*` itself.
 */
export function GoContent() {
  const go = useGo()
  const state = go.liveState

  return (
    <>

      <TitlebarToolbar>
        <span
          style={{
            color: go.running ? 'var(--bb-theme-success)' : 'var(--bb-theme-error)',
            padding: '0 6px',
            cursor: 'default',
          }}
          title={go.running ? 'Running' : 'Stopped'}
        >
          ⏺
          {' '}
          {go.running ? 'Live' : 'Halted'}
        </span>
        <button
          onClick={() => void go.openLog()}
          disabled={!go.running}
          className="bb-icon-link"
          title={go.running ? 'Open log' : 'App not running'}
        >
          📃
        </button>
        <button
          className="bb-icon-link"
          style={{
            color: go.running ? 'var(--bb-theme-error)' : 'var(--bb-theme-success)',
          }}
          title={go.running ? 'Stop' : 'Launch'}
          onClick={() => void go.toggle()}
          disabled={go.busy}
        >
          {go.running ? '◼' : '▶'}
        </button>
      </TitlebarToolbar>
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            marginBottom: '8px',
            gap: '6px',
          }}
        >
          <div>
            {state ? ` — ${state.engine} engine` : ''}
            , rotating factions
          </div>
        </div>

        {go.error
          ? (
              <div className="bb-text-error bb-wrap" style={{ fontSize: '11px', marginBottom: '8px' }}>
                {go.error}
              </div>
            )
          : null}

        {!state
          ? (
              <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '12px' }}>
                No game data yet — start the player to begin.
              </div>
            )
          : (
              <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <GoBoard board={state.board} lastMove={state.lastMove} />

                <div style={{ minWidth: '180px', flex: 1, fontSize: '11px' }}>
                  <div style={{ marginBottom: '6px' }}>
                    vs
                    {' '}
                    <b>{state.opponent}</b>
                    {' '}
                    (
                    {state.boardSize}
                    x
                    {state.boardSize}
                    )
                  </div>
                  <div style={{ marginBottom: '6px' }}>
                    Black (us)
                    {' '}
                    <b>{state.blackScore.toFixed(1)}</b>
                    {' '}
                    — White
                    {' '}
                    <b>{state.whiteScore.toFixed(1)}</b>
                    {' '}
                    (komi
                    {' '}
                    {state.komi}
                    )
                  </div>
                  <div style={{ marginBottom: '8px', opacity: 0.8 }}>
                    {state.currentPlayer === 'None' ? 'Game over — starting next…' : `${state.currentPlayer} to move`}
                  </div>
                  <div
                    className="bb-panel"
                    style={{ maxHeight: '150px', overflow: 'auto', padding: '4px 6px' }}
                  >
                    {state.recentEvents.length === 0
                      ? <div style={{ opacity: 0.6 }}>No events yet.</div>
                      : [...state.recentEvents].reverse().map(event => (
                        // Each event string already carries its own
                        // "[HH:MM:SS] " prefix from go.app.ts's pushEvent,
                        // so it's effectively unique within this capped
                        // rolling feed — no separate index-based key needed
                        // (and an index key would be wrong here anyway:
                        // the whole array shifts as new events arrive).
                          <div key={event} className="bb-wrap" style={{ marginBottom: '2px' }}>{event}</div>
                        ))}
                  </div>
                </div>
              </div>
            )}

        <GoSummaryTable summary={go.summary} />
      </div>
    </>
  )
}
