import type { ContractLogSummary } from '../../../../contracts/state-file/make-stats'
import React from '@react'
import { CONTRACTS_HOST, CONTRACTS_LOG_FILE, CONTRACTS_SCRIPT, parseContractLog } from '../../../../contracts/state-file'
import { summarizeContractLog } from '../../../../contracts/state-file/make-stats'
import { formatDuration, formatHour } from '../../../../utils/format/dates'
import { TitlebarToolbar } from '../../../components/window/titlebar-toolbar'
import { useQueuedNs } from '../../../context/ns-queue-context'
import CheckCircle from '../../../svg/check-circle.svg'
import ClockFive from '../../../svg/clock-five.svg'
import CrossCircle from '../../../svg/cross-circle.svg'
import Document from '../../../svg/document.svg'
import { useAsyncState } from '../../../utils/use-async-state'
import { ContractsByHost } from './contracts-by-host'
import { HeroStat } from './hero-stat'
import { RewardsSummary } from './rewards-summary'

export function ContractsDashboard() {
  const ns = useQueuedNs()
  const hourDuration = 60 * 60 * 1000

  const { state, execute: reloadContractLogSummary } = useAsyncState<ContractLogSummary | null>(async () => {
    return summarizeContractLog(parseContractLog(await ns._read(CONTRACTS_LOG_FILE)))
  }, null, { resetOnExecute: false, immediate: false })
  const [lastHour, setLastHour] = React.useState(() => Date.now() - hourDuration)
  const [running, setRunning] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [_loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const [processes] = await Promise.all([
        ns._ps(CONTRACTS_HOST),
        reloadContractLogSummary(),
      ])
      setRunning(processes.find(it => it.filename === CONTRACTS_SCRIPT)?.pid ?? 0)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setLoading(false)
    }
  }

  function openLog() {
    void ns._ui._openTail(CONTRACTS_SCRIPT, CONTRACTS_HOST)
    ns._ui._moveTail(285, 5, running)
  }

  async function toggle() {
    setError(null)
    setBusy(true)
    try {
      if (running) {
        await ns._kill(CONTRACTS_SCRIPT, CONTRACTS_HOST)
        setRunning(0)
      }
      else {
        const pid = await ns._exec(CONTRACTS_SCRIPT, CONTRACTS_HOST, 1)
        if (pid === 0) {
          setError(`Couldn't launch ${CONTRACTS_SCRIPT} — enough free RAM on ${CONTRACTS_HOST}?`)
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

  // [] — mount once. Without it this effect reruns on every render, tearing
  // down and re-arming the interval each time (it happens to still poll
  // roughly every 3s here because refresh() itself triggers those renders,
  // but that's incidental, not something to rely on).
  React.useEffect(() => {
    void refresh()
    const interval = setInterval(async () => {
      await refresh()
      setLastHour(Date.now() - hourDuration)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <>
      <TitlebarToolbar>
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
      </TitlebarToolbar>
      {error
        ? (
            <div
              className="bb-text-error bb-wrap"
              style={{
                fontSize: '11px',
                marginBottom: '8px',
              }}
            >
              {error}
            </div>
          )
        : null}
      {state && (
        <>
          <div
            style={{
              display: 'grid',
              gap: 6,
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              marginBottom: 6,
            }}
          >
            <HeroStat
              title="Total Contracts"
              value={state.total}
              sub="All time"
              icon={<Document />}
              iconColor="var(--bb-theme-info)"
            />
            <HeroStat
              title="Solved"
              value={state.solved}
              // toFixed(1): successRate is a raw fraction (e.g. 5/7), so an
              // unrounded percentage can print a long repeating decimal.
              sub={`${(state.successRate * 100).toFixed(1)}% success rate`}
              icon={<CheckCircle />}
              color="var(--bb-theme-success)"
            />
            <HeroStat
              title="Failed"
              value={state.failed}
              sub={`${((1 - state.successRate) * 100).toFixed(1)}% failure rate`}
              icon={<CrossCircle />}
              color="var(--bb-theme-error)"
            />
            <HeroStat
              title="Contracts Last Hour"
              value={state.contractsLastHour}
              sub={`Since ${formatHour(lastHour)}`}
              icon={<ClockFive />}
              color="var(--bb-theme-cha)"
            />
            <HeroStat
              title="Time Span"
              value={formatDuration(state.duration / 1000)}
              sub="First to last contract"
              icon={<ClockFive />}
              color="var(--bb-theme-money)"
            />
          </div>

          <div
            style={{
              display: 'grid',
              gap: 6,
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gridAutoFlow: 'dense',
              gridAutoRows: '1fr',
            }}
          >
            <RewardsSummary rewards={state.rewards} style={{ gridColumn: 'span 3', height: 'auto' }} />
            <ContractsByHost byHost={state.byHost} style={{ gridColumn: 'span 2', height: 'auto' }} />
          </div>
        </>
      )}
      {/* <ContractSelector onContractSelected={setContract} />
      {contract && <ContractDisplay contract={contract} />} */}
    </>
  )
}
