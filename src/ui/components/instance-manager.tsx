import type { ScriptArg } from '@ns'
import React from '@react'
import { useQueuedNs } from '../context/ns-queue-context'

export function InstanceManager(props: {
  scriptFile: string
  host: string
}) {
  const {
    scriptFile,
    host,
  } = props

  const [running, setRunning] = React.useState(0)
  const [args, setArgs] = React.useState<ScriptArg[]>([])
  const [_error, setError] = React.useState<string | null>(null)
  const [_loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const ns = useQueuedNs()

  async function refresh() {
    setLoading(true)
    try {
      const process = await ns._ps(host)
        .then(processes => processes.find(it => it.filename === scriptFile))
      setRunning(process?.pid ?? 0)
      setArgs(process?.args ?? [])
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    void refresh()
    const interval = setInterval(refresh, 3000)
    return () => clearInterval(interval)
  }, [])

  async function openLog() {
    if (running && args) {
      await ns._ui._openTail(scriptFile, host, ...args)
      ns._ui._moveTail(285, 5, running)
    }
  }

  async function toggle() {
    setError(null)
    setBusy(true)
    try {
      if (running) {
        await ns._kill(scriptFile, host)
        setRunning(0)
      }
      else {
        const pid = await ns._exec(scriptFile, host, 1)
        if (pid === 0) {
          setError(`Couldn't launch ${scriptFile} — enough free RAM on ${host}?`)
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
      <button
        onClick={() => void openLog()}
        disabled={!running}
        className="bb-icon-link"
        title={running ? 'Open log' : 'App not running'}
      >
        📃
      </button>
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
