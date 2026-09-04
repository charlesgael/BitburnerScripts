import type { Mode } from '../../../../lib/money-farm/state-farm/types'
import React from '@react'
import { getCgdStore } from '../../../../cgd/store'
import { MONEY_FARM_LOG_FILE, parseMoneyFarmLog } from '../../../../lib/money-farm/state-farm'
import { createLogSummary, summarizeMoneyLog } from '../../../../lib/money-farm/state-farm/mk-stats'
import { formatDuration } from '../../../../utils/format/dates'
import { formatMoney, formatNumber, formatPercent } from '../../../../utils/format/game'
import { HeroStat } from '../../../components/hero-stat'
import { InstanceManager } from '../../../components/instance-manager'
import { TitlebarPulldown } from '../../../components/window/titlebar-pulldown'
import { TitlebarToolbar } from '../../../components/window/titlebar-toolbar'
import { useQueuedNs } from '../../../context/ns-queue-context'
import { useToggle } from '../../../effects/use-toggle'
import { GRAPH_COLORS } from '../../../utils/graph-colors'
import { useAsyncState } from '../../../utils/use-async-state'
import { useMoneyFarm } from '../logic/use-money-farm'
import { MoneyFarmContent } from './money-farm-content'

/**
 * A target with no entry in the live `moneyFarm` RAM allocation isn't
 * currently being worked at all — not a fourth real `Mode`, but the table
 * below needs to say so, so it gets its own key alongside the real ones.
 */
type LiveStatus = Mode | 'offline'

/**
 * Fixed, semantic (not per-target-index) colors for the three farm modes
 * plus `offline` — see `../../../../lib/money-farm/state-farm/types.ts`'s
 * `Mode` — so the per-target status pill and mode-split bar below read the
 * same way for every target instead of an arbitrary `GRAPH_COLORS[idx]`
 * mapping (that's reserved for the RAM-reservation bar above, which has no
 * fixed small vocabulary of values to match against).
 */
const MODE_COLORS: Record<LiveStatus, string> = {
  'farm': 'var(--bb-theme-success)',
  'weaken': 'var(--bb-theme-warning)',
  'grow-prep': 'var(--bb-theme-info)',
  'offline': 'var(--bb-theme-secondary)',
}

const STATUS_ORDER: Record<LiveStatus, number> = {
  'farm': 0,
  'weaken': 0,
  'grow-prep': 0,
  'offline': 1,
}

export function MoneyFarmDashboard() {
  const ns = useQueuedNs()
  const mf = useMoneyFarm()
  const moneyFarm = getCgdStore().use(s => s.moneyFarm)
  let sum = 0

  const [expanded, toggleExpanded] = useToggle(false)

  async function refreshStats() {
    return summarizeMoneyLog(parseMoneyFarmLog(await ns._read(MONEY_FARM_LOG_FILE)))
  }

  const { state, isReady, error, execute: refreshLogStats } = useAsyncState(refreshStats, createLogSummary(), { resetOnExecute: false })
  const altSubtitle = state.durationHours < 2 ? `in ${formatDuration(state.durationMs / 1000)}` : null

  /*
   * Unlike `moneyFarm` above (pushed live into the cgd store by the
   * daemon), the log summary is only ever computed once on mount by
   * `useAsyncState`'s own "immediate" run — poll it on the same cadence
   * `use-money-farm.ts` polls process status on, so the numbers below
   * actually move instead of freezing at whatever they were when this
   * window was opened.
   */
  React.useEffect(() => {
    const interval = setInterval(() => void refreshLogStats(), 3000)
    return () => clearInterval(interval)
  }, [])

  const liveStatusByTarget = React.useMemo(() => {
    const map = new Map<string, Mode>()
    moneyFarm?.perTarget.forEach(p => map.set(p.target, p.mode))
    return map
  }, [moneyFarm])

  const targetRows = React.useMemo(
    () => Object.entries(state.targets)
      .map(([target, summary]) => ({
        target,
        ...summary,
        liveStatus: liveStatusByTarget.get(target) ?? 'offline' as const,
      }))
      .sort((a, b) => STATUS_ORDER[a.liveStatus] - STATUS_ORDER[b.liveStatus] || b.moneyPerHour - a.moneyPerHour),
    [state, liveStatusByTarget],
  )

  return (
    <>
      <TitlebarToolbar>
        <TitlebarPulldown width={640}>
          <MoneyFarmContent mf={mf} />
        </TitlebarPulldown>
        <InstanceManager
          filename="daemons/money-farm.daemon.js"
          host="home"
        />
        <button
          onClick={() => {
            void mf.refresh()
            void refreshLogStats()
          }}
          disabled={mf.loading}
          className="bb-icon-link"
        >
          🗘
        </button>
      </TitlebarToolbar>
      {moneyFarm && (
        <div style={{ display: 'flex', alignItems: 'flex-start', height: '1em', zIndex: 1 }}>
          <button className="bb-btn" style={{ flexShrink: 0, width: '2em', padding: 0, textAlign: 'center' }} onClick={toggleExpanded}>{expanded ? '-' : '+'}</button>
          <div
            className="bb-progress"
            style={{
              flex: 1,
              height: expanded ? `${moneyFarm.perTarget.length + 2}em` : '1em',
              transition: 'height 0.3s ease',
            }}
          >
            {moneyFarm.perTarget.map(({ target, reserved, used, mode }, idx) => ((sum += reserved / moneyFarm.totalRam * 100)
              && (
                <div
                  key={target}
                  style={{
                    width: `calc(${Math.floor(reserved / moneyFarm.totalRam * 10000) / 100}% - 2.1px)`,
                    background: `color-mix(in srgb, ${GRAPH_COLORS[idx % GRAPH_COLORS.length]} 50%, transparent)`,
                    border: `1px solid ${GRAPH_COLORS[idx % GRAPH_COLORS.length]}`,
                    height: '1em',
                    display: 'inline-block',
                    position: 'relative',
                  }}
                >
                  <div
                    key={target}
                    style={{
                      fontFamily: 'Segoe UI',
                      textAlign: 'center',
                      verticalAlign: 'bottom',
                      color: GRAPH_COLORS[idx % GRAPH_COLORS.length],
                      display: 'inline-block',
                      position: 'absolute',
                      top: '1em',
                      left: `50%`,
                      transform: (sum - reserved / moneyFarm.totalRam * 100) > 50 ? 'translate(-100%, 0)' : undefined,
                      borderLeft: (sum - reserved / moneyFarm.totalRam * 100) <= 50 ? `1px solid ${GRAPH_COLORS[idx % GRAPH_COLORS.length]}` : undefined,
                      borderRight: (sum - reserved / moneyFarm.totalRam * 100) > 50 ? `1px solid ${GRAPH_COLORS[idx % GRAPH_COLORS.length]}` : undefined,
                      padding: '0 2px',
                      lineHeight: `${(idx + 1) * 2}em`,
                      height: `${idx + 1}em`,
                      whiteSpace: 'nowrap',
                      zIndex: moneyFarm.perTarget.length - idx,
                    }}
                  >
                    {target}
                    {': '}
                    {mode}
                    {' '}
                    (
                    {formatPercent(used / reserved)}
                    )
                  </div>
                  <div
                    key={target}
                    style={{
                      width: `${(used / reserved * 100).toFixed(1)}%`,
                      background: GRAPH_COLORS[idx % GRAPH_COLORS.length],
                      height: '1em',
                    }}
                  />
                </div>
              )
            ))}
          </div>
        </div>
      )}

      {error
        ? (
            <div className="bb-text-error bb-wrap" style={{ fontSize: 11, marginTop: 6 }}>
              {error instanceof Error ? error.message : String(error)}
            </div>
          )
        : null}

      {state.durationMs > 0
        ? (
            <>
              <div
                style={{
                  display: 'grid',
                  gap: 6,
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  marginTop: 6,
                  marginBottom: 6,
                }}
              >
                <HeroStat
                  title="Money / Hour"
                  value={formatMoney(state.moneyPerHour)}
                  sub={altSubtitle || `${formatMoney(state.moneyPerHour2h)}/h in prev 2h`}
                  iconColor="var(--bb-theme-info)"
                />
                <HeroStat
                  title="Total earned"
                  value={formatMoney(state.totalMoney)}
                  sub={altSubtitle || `+${formatMoney(state.money2h)} in prev 2h`}
                  iconColor="var(--bb-theme-info)"
                />
                <HeroStat
                  title="Hack $ / thread"
                  value={formatMoney(state.hacks.moneyPerThread)}
                  sub={`${formatNumber(state.hacks.count)} hacks, ${formatNumber(state.hacks.averageDuration / 1000, 1)}s avg`}
                  iconColor="var(--bb-theme-info)"
                />
                <HeroStat
                  title="Active Targets"
                  value={`${formatNumber(moneyFarm?.perTarget.length ?? 0)} / ${Object.keys(state.targets).length}`}
                  sub={moneyFarm
                    ? `${formatPercent(moneyFarm.perTarget.reduce((total, p) => total + p.reserved, 0) / moneyFarm.totalRam)} capacity used`
                    : 'daemon offline'}
                  iconColor="var(--bb-theme-info)"
                />
              </div>

              <div className="bb-card" style={{ marginBottom: 6 }}>
                <div className="bb-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Per-target performance</span>
                  <span style={{ fontSize: 11, fontWeight: 'normal', display: 'flex', gap: 8 }}>
                    <span style={{ color: MODE_COLORS.farm }}>■ farm</span>
                    <span style={{ color: MODE_COLORS.weaken }}>■ weaken</span>
                    <span style={{ color: MODE_COLORS['grow-prep'] }}>■ grow-prep</span>
                    <span style={{ color: MODE_COLORS.offline }}>■ offline</span>
                  </span>
                </div>
                <div style={{ margin: '-11px -8px -7px' }}>
                  <table className="bb-table" width="100%">
                    <tbody>
                      <tr>
                        <th>Target</th>
                        <th className="smallest">Status</th>
                        <th style={{ width: 120 }}>Mode split</th>
                        <th className="smallest">$ / Hour</th>
                        <th className="smallest">Uptime</th>
                        <th className="smallest">Sec. excess</th>
                        <th className="smallest">$ deficit</th>
                      </tr>

                      {targetRows.map((t) => {
                        const modeTotal = t.mode.durationMs.weaken + t.mode.durationMs['grow-prep'] + t.mode.durationMs.farm

                        return (
                          <tr key={t.target}>
                            <td className="bb-wrap">{t.target}</td>
                            <td className="smallest">
                              <span
                                className="bb-pill"
                                style={{
                                  background: `color-mix(in srgb, ${MODE_COLORS[t.liveStatus]} 15%, transparent)`,
                                  color: MODE_COLORS[t.liveStatus],
                                }}
                              >
                                {t.liveStatus}
                              </span>
                            </td>
                            <td>
                              {modeTotal > 0
                                ? (
                                    <div style={{ display: 'flex', height: 10, borderRadius: 3, overflow: 'hidden' }}>
                                      {(['weaken', 'grow-prep', 'farm'] as const).map(mode => (
                                        t.mode.durationMs[mode] > 0 && (
                                          <div
                                            key={mode}
                                            title={`${mode}: ${formatPercent(t.mode.durationMs[mode] / modeTotal)}`}
                                            style={{
                                              width: `${t.mode.durationMs[mode] / modeTotal * 100}%`,
                                              background: MODE_COLORS[mode],
                                            }}
                                          />
                                        )
                                      ))}
                                    </div>
                                  )
                                : <span style={{ opacity: 0.5 }}>—</span>}
                            </td>
                            <td className="smallest">{formatMoney(t.moneyPerHour)}</td>
                            <td className="smallest">{formatDuration(t.uptimeMs / 1000)}</td>
                            <td className="smallest">{formatNumber(t.server.averageSecurityExcess, 1)}</td>
                            <td className="smallest">{formatMoney(t.server.averageMoneyDeficit)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )
        : (
            <div style={{ opacity: 0.6, fontSize: 12, marginTop: 6 }}>
              {isReady ? 'No activity logged yet.' : 'Loading stats…'}
            </div>
          )}
    </>
  )
}
