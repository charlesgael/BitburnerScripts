import type { ContractLogSummary } from '../../../../contracts/state-file/make-stats'
import React from '@react'
import { CONTRACTS_LOG_FILE, parseContractLog } from '../../../../contracts/state-file'
import { summarizeContractLog } from '../../../../contracts/state-file/make-stats'
import { formatDuration, formatHour } from '../../../../utils/format/dates'
import { LoadingDot } from '../../../components/feedback/loading-dot'
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

  const { state, execute: refresh } = useAsyncState<ContractLogSummary | null>(async () => {
    return summarizeContractLog(parseContractLog(await ns._read(CONTRACTS_LOG_FILE)))
  }, null, { resetOnExecute: false })
  const [lastHour, setLastHour] = React.useState(Date.now() - hourDuration)

  // [] — mount once. Without it this effect reruns on every render, tearing
  // down and re-arming the interval each time (it happens to still poll
  // roughly every 3s here because refresh() itself triggers those renders,
  // but that's incidental, not something to rely on).
  React.useEffect(() => {
    const interval = setInterval(async () => {
      await refresh()
      setLastHour(Date.now() - hourDuration)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <>
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
