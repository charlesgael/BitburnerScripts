import type { GoLiveState, GoLogSummary } from '../../../../go/state-file'
import React from '@react'
import {
  GO_GAME_LOG_FILE,
  GO_HOST,
  GO_LIVE_STATE_FILE,
  GO_SCRIPT,
  parseGameLog,
  parseLiveState,
  summarizeGameLog,
} from '../../../../go/state-file'
import { useQueuedNs } from '../../../context/ns-queue-context'

/**
 * All state/behavior for the IPvGO liveboard panel. See `../index.ts`'s
 * header comment for the overall design — this app never references
 * `ns.go.*` itself (tier 1's dispatch allow-list doesn't even include it);
 * everything here is `read`/`exec`/`kill`/`isRunning`/`ui.openTail`, all
 * already on that allow-list (see `daemons/lv1.daemon.ts`), reading the two
 * files `go.app.ts` writes (see `go/state-file.ts`).
 */
export function useGo() {
  const ns = useQueuedNs()

  const [liveState, setLiveState] = React.useState<GoLiveState | null>(null)
  const [summary, setSummary] = React.useState<GoLogSummary | null>(null)
  const [running, setRunning] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
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
      const [processes] = await Promise.all([
        ns._ps(GO_HOST),
        refreshLiveState(),
        refreshLog(),
      ])
      setRunning(processes.find(it => it.filename === GO_SCRIPT)?.pid ?? 0)
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
      ns._ps(GO_HOST).then(pr => pr.find(it => it.filename === GO_SCRIPT)?.pid ?? 0).then(setRunning).catch(() => {})
      // ns._isRunning(GO_SCRIPT, GO_HOST).then(setRunning).catch(() => {})
      refreshLiveState().catch(() => {})
      if (tick % LOG_POLL_EVERY_N_TICKS === 0)
        refreshLog().catch(() => {})
    }, LIVE_POLL_MS)
    return () => clearInterval(interval)
  }, [])

  async function openLog() {
    const {
      args,
      pid,
    } = await ns._ps(GO_HOST).then(pr => pr.find(it => it.filename === GO_SCRIPT)) ?? {}
    if (args && pid) {
      await ns._ui._openTail(GO_SCRIPT, GO_HOST, ...args)
      ns._ui._moveTail(285, 5, pid)
    }
  }

  async function toggle() {
    setError(null)
    setBusy(true)
    try {
      if (running) {
        await ns._kill(running)
        setRunning(0)
      }
      else {
        const pid = await ns._exec(GO_SCRIPT, GO_HOST, 1)
        if (pid === 0) {
          setError(`Couldn't launch ${GO_SCRIPT} — enough free RAM on ${GO_HOST}?`)
        }
        else {
          // Not tracked via addChildPid on purpose, same reasoning as
          // every other Programs-launched daemon: this is meant to
          // outlive this window/ui.app.js, not die with it.
          setRunning(pid)
        }
      }
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setBusy(false)
    }
  }

  return {
    liveState,
    summary,
    running,
    busy,
    loading,
    error,
    refresh,
    openLog,
    toggle,
  }
}

/** Everything a rendering component under `../components/` needs. */
export type GoState = ReturnType<typeof useGo>
