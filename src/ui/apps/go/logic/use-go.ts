import type { GoLiveState, GoLogSummary } from '../../../../lib/go/state-file'
import React from '@react'
import {
  GO_GAME_LOG_FILE,
  GO_LIVE_STATE_FILE,
  parseGameLog,
  parseLiveState,
  summarizeGameLog,
} from '../../../../lib/go/state-file'
import { useQueuedNs } from '../../../context/ns-queue-context'

/**
 * All state/behavior for the IPvGO liveboard panel. See `../index.ts`'s
 * header comment for the overall design — this app never references
 * `ns.go.*` itself (tier 1's dispatch allow-list doesn't even include it);
 * everything here is `read`, already on that allow-list (see
 * `daemons/lv1.daemon.ts`), reading the two files `go.app.ts` writes (see
 * `go/state-file.ts`). Whether the player is running/started/stopped is
 * `InstanceManager`'s job (see `go-content.tsx`) — it already owns its own
 * `ns._ps` poll, so this hook doesn't track a second, redundant one.
 */
export function useGo() {
  const ns = useQueuedNs()

  const [liveState, setLiveState] = React.useState<GoLiveState | null>(null)
  const [summary, setSummary] = React.useState<GoLogSummary | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  async function refreshLiveState() {
    const raw = await ns._read(GO_LIVE_STATE_FILE)
    setLiveState(parseLiveState(raw))
  }

  async function refreshLog() {
    const raw = await ns._read(GO_GAME_LOG_FILE)
    setSummary(summarizeGameLog(parseGameLog(raw)))
  }

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([
        refreshLiveState(),
        refreshLog(),
      ])
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setLoading(false)
    }
  }

  // This component remounts every time the window is opened — fetch
  // everything fresh rather than trusting stale state.
  React.useEffect(() => {
    void refresh()
  }, [])

  // While the window's open: the board/score/event-feed change every turn
  // (a few seconds each, typically), so it's polled fairly tight; the game
  // log only changes once per completed game, so it's polled looser off
  // the same tick via a modulo rather than a second interval.
  const LIVE_POLL_MS = 1500
  const LOG_POLL_EVERY_N_TICKS = 4
  React.useEffect(() => {
    let tick = 0
    const interval = setInterval(() => {
      tick++
      refreshLiveState().catch(() => {})
      if (tick % LOG_POLL_EVERY_N_TICKS === 0)
        refreshLog().catch(() => {})
    }, LIVE_POLL_MS)
    return () => clearInterval(interval)
  }, [])

  return {
    liveState,
    summary,
    loading,
    error,
    refresh,
  }
}

/** Everything a rendering component under `../components/` needs. */
export type GoState = ReturnType<typeof useGo>
