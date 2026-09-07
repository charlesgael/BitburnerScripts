import type { ProcessInfo, ScriptArg } from '@ns'
import type { MutableRefObject } from 'react'
import React, { useEffect, useState } from '@react'
import { useQueuedNs } from '../context/ns-queue-context'
import { TitlebarPulldown } from './window/titlebar-pulldown'

export function InstanceManager(props: {
  /** Script name. */
  filename: string
  /** Number of threads script is running with */
  threads?: number
  /** Script's arguments */
  args?: ScriptArg[]
  /** Target host */
  host: string
  // args?: ScriptArg[]
  onRunning?: (process: ProcessInfo | undefined) => void

  toggleFnRef?: MutableRefObject<(() => Promise<void>) | null>
}) {
  const {
    host,
    onRunning,
    toggleFnRef,
    ...goal
  } = props

  const [running, setRunning] = useState<ProcessInfo | undefined>()
  const [_error, setError] = useState<string | null>(null)
  const [_loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const ns = useQueuedNs()

  async function refresh() {
    setLoading(true)
    try {
      const running = await ns._ps(host)
        .then(processes => processes.find(it => it.filename === goal.filename))
      setRunning(running)
      void refreshLog(running)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setLoading(false)
    }
  }

  async function refreshLog(running?: ProcessInfo) {
    if (running) {
      const lines = await ns._getScriptLogs(running.pid)
      setLog(lines)
    }
  }

  useEffect(() => { // call refresh every 3s
    void refresh()
    const interval = setInterval(refresh, 3000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (toggleFnRef)
      toggleFnRef.current = toggle

    return () => {
      if (toggleFnRef)
        toggleFnRef.current = null
    }
  }, [toggleFnRef])

  useEffect(() => { // call onRunning when running changes
    onRunning?.(running)
  }, [running, onRunning])

  // async function openLog() {
  //   if (running) {
  //     await ns._ui._openTail(goal.filename, host, ...running.args)
  //     ns._ui._moveTail(285, 5, running.pid)
  //   }
  // }

  async function toggle() {
    setError(null)
    setBusy(true)
    try {
      if (running) {
        await ns._kill(running.pid)
        setRunning(undefined)
      }
      else {
        const pid = await ns._exec(goal.filename, host, goal.threads || 1, ...(goal.args || []))
        if (pid === 0) {
          setError(`Couldn't launch ${goal.filename} — enough free RAM on ${host}?`)
        }
        else {
          // Not tracked via addChildPid on purpose, same reasoning as
          // every other Programs-launched daemon: this is meant to
          // outlive this window/ui.app.js, not die with it.
          setRunning({
            pid,
            filename: goal.filename,
            args: goal.args || [],
            temporary: false,
            threads: goal.threads || 1,
          })
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

  return (
    <>
      <span
        style={{
          color: running ? 'var(--bb-theme-success)' : 'var(--bb-theme-error)',
          padding: '0 6px',
          cursor: 'default',
        }}
        title={running ? 'Running' : 'Stopped'}
      >
        ⏺
        {' '}
        {running ? 'Live' : 'Halted'}
      </span>
      {/* <button
        onClick={() => void openLog()}
        disabled={!running}
        className="bb-icon-link"
        title={running ? 'Open log' : 'App not running'}
      >
        📃
      </button> */}
      <TitlebarPulldown btnText="📃" disabled={log.length === 0} width={550}>
        {log.map((line, idx) => <div key={idx}>{line}</div>)}
      </TitlebarPulldown>
      <button
        className="bb-icon-link"
        style={{
          color: running ? 'var(--bb-theme-error)' : 'var(--bb-theme-success)',
        }}
        title={running ? 'Stop' : 'Launch'}
        onClick={toggle}
        disabled={busy}
      >
        {running ? '◼' : '▶'}
      </button>
    </>
  )
}
