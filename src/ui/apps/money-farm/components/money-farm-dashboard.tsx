import type { ProcessInfo } from '@ns'
import React from '@react'
import { formatMoney, formatNumber } from '../../../../utils/format/game'
import { HeroStat } from '../../../components/hero-stat'
import { InstanceManager } from '../../../components/instance-manager'
import { TitlebarPulldown } from '../../../components/window/titlebar-pulldown'
import { TitlebarToolbar } from '../../../components/window/titlebar-toolbar'
import { useQueuedNs } from '../../../context/ns-queue-context'
import { AUTO_HACK_HOST, AUTO_HACK_SCRIPT } from '../../../utils/hwgw-config'
import { useMoneyFarm } from '../logic/use-money-farm'
import { MoneyFarmContent } from './money-farm-content'

/**
 * hwgw's status colors — `HwgwMode` is `'null' | 'prep' | 'farm' | 'done'`,
 * and `farm`/`done` both read as "farming" (see `server-card.tsx`'s
 * `MODE_LABEL`) — hwgw's progression is monotonic (never regresses back
 * out of farm the way money-farm's `weaken`/`grow-prep`/`farm` cycle did),
 * so there's no mode-split-over-time chart here the way the old,
 * log-derived dashboard had: a single current-mode label already tells the
 * whole story for a target that never goes backward.
 */
const MODE_COLORS: Record<string, string> = {
  farm: 'var(--bb-theme-success)',
  done: 'var(--bb-theme-success)',
  prep: 'var(--bb-theme-warning)',
  null: 'var(--bb-theme-secondary)',
}

/**
 * Root dashboard. Kept at this path/id (see `../index.ts`'s header
 * comment) but rewired for hwgw — `daemons/money-farm.daemon.ts` and its
 * whole log/RAM-partition machinery are deleted, along with the RAM-
 * reservation bar and the log-derived mode-split/"prev 2h" trend table
 * that depended on them (neither has an hwgw equivalent: hwgw doesn't
 * partition RAM between targets, and it has no persisted event log —
 * `lib/hwgw/workers.ts`'s `getRunningScript`-based totals are live-only,
 * no rolling-window history to show a trend from — both deliberate cuts,
 * not oversights).
 *
 * `InstanceManager` now targets `auto-hack.app.js` (the thing that watches
 * `known-servers.json` and launches one `hwgw/start.js` per target) rather
 * than `daemons/money-farm.daemon.js`, with `count` below feeding its
 * `--count` arg — the "how many best-scoring targets to run at once" knob
 * `auto-hack.app.ts` needs to do anything useful at all. Its host argument
 * mirrors `use-money-farm.ts`'s own "nothing toggled -> whole eligible
 * fleet" fallback exactly (`mf.enabled` if non-empty, else the `cloud`
 * keyword `auto-hack.app.ts`'s own `computeDedicated` expands) — the two
 * have to agree, since `use-money-farm.ts`'s status scan has no other way
 * to know which hosts `auto-hack.app.js` was actually told to use.
 */
export function MoneyFarmDashboard() {
  const ns = useQueuedNs()
  const mf = useMoneyFarm()
  const [running, setRunning] = React.useState(false)
  const [count, setCount] = React.useState(5)

  // `pid` comes from `lib/hwgw/workers.ts`'s own orchestrator scan (the
  // same `ns.ps('home')` pass mode already comes from) — null for a target
  // whose orchestrator has died but whose workers are still looping (hwgw
  // has no self-healing), which is the one case there's nothing to tail.
  function openTargetTail(pid: number | null) {
    if (pid !== null)
      void ns._ui._openTail(pid)
  }

  // `mf.targets`, not a flatten of `mf.status` — the latter is host-keyed
  // (built by walking `byHost`, see `use-money-farm.ts`'s own header
  // comment), so a target whose orchestrator is alive but hasn't landed a
  // worker on any scanned host yet (still prepping, or its own
  // `waitForHost` loop still waiting on free RAM — common with many
  // concurrent instances) would silently be missing from a table built
  // that way. `mf.targets` is every target `scanHwgwOrchestrators` found,
  // full stop.
  const targetRows = React.useMemo(
    () => Object.values(mf.targets).sort((a, b) => b.moneyPerHour - a.moneyPerHour),
    [mf.targets],
  )

  function updateProcessInfo(running: ProcessInfo | undefined) {
    if (running) {
      const countIdx = running.args.indexOf('--count')
      setCount(running.args[countIdx + 1] as number)
      setRunning(true)
    }
    else {
      setRunning(false)
    }
  }

  const totalMoneyPerHour = targetRows.reduce((sum, t) => sum + t.moneyPerHour, 0)
  const activeTargets = targetRows.filter(t => t.mode === 'farm' || t.mode === 'done').length

  return (
    <>
      <TitlebarToolbar>
        <TitlebarPulldown width={640}>
          <MoneyFarmContent mf={mf} />
        </TitlebarPulldown>
        <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          Targets:
          <input
            className="bb-field"
            type="number"
            min={0}
            value={count}
            disabled={running}
            onChange={e => setCount(Math.max(0, Number(e.target.value) ?? 1))}
            style={{ width: '3.5em' }}
          />
        </span>
        <InstanceManager
          filename={AUTO_HACK_SCRIPT}
          host={AUTO_HACK_HOST}
          args={[...(count > 0 ? ['--count', count] : []), ...(mf.enabled.size > 0 ? [...mf.enabled] : ['cloud'])]}
          onRunning={updateProcessInfo}
        />
        <button
          onClick={() => void mf.refresh()}
          disabled={mf.loading}
          className="bb-icon-link"
        >
          🗘
        </button>
      </TitlebarToolbar>

      {targetRows.length > 0
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
                  value={formatMoney(totalMoneyPerHour)}
                  sub={`across ${formatNumber(activeTargets)} active target(s)`}
                  iconColor="var(--bb-theme-info)"
                />
                <HeroStat
                  title="Total earned"
                  value={formatMoney(targetRows.reduce((sum, t) => sum + t.moneyMade, 0))}
                  sub="since each target's own worker started"
                  iconColor="var(--bb-theme-info)"
                />
                <HeroStat
                  title="Targets tracked"
                  value={formatNumber(targetRows.length)}
                  sub={`${formatNumber(activeTargets)} farming`}
                  iconColor="var(--bb-theme-info)"
                />
              </div>

              <div className="bb-card" style={{ marginBottom: 6 }}>
                <div className="bb-card-header">Per-target performance</div>
                <div style={{ margin: '-11px -8px -7px' }}>
                  <table className="bb-table" width="100%">
                    <tbody>
                      <tr>
                        <th>Target</th>
                        <th className="smallest">Status</th>
                        <th className="smallest">$ / Hour</th>
                        <th className="smallest">XP / Hour</th>
                        <th className="smallest">Sec. Excess</th>
                        <th className="smallest">$ Deficit</th>
                      </tr>
                      {targetRows.map(t => (
                        <tr
                          key={t.target}
                          onClick={() => openTargetTail(t.pid)}
                          title={t.pid !== null ? 'Open tail' : 'Orchestrator not running — nothing to tail'}
                          style={{ cursor: t.pid !== null ? 'pointer' : 'default' }}
                        >
                          <td className="bb-wrap">{t.target}</td>
                          <td className="smallest">
                            <span
                              className="bb-pill"
                              style={{
                                background: `color-mix(in srgb, ${MODE_COLORS[t.mode] ?? MODE_COLORS.null} 15%, transparent)`,
                                color: MODE_COLORS[t.mode] ?? MODE_COLORS.null,
                              }}
                            >
                              {t.mode}
                            </span>
                          </td>
                          <td className="smallest">{formatMoney(t.moneyPerHour)}</td>
                          <td className="smallest">{formatNumber(t.expPerHour, 1)}</td>
                          {/* `?? 0` guards a daemon still running pre-upgrade code (these two
                              fields are newer than the rest of HwgwTargetStatus) rather than
                              a real value — a stale object just lacks the key entirely, so
                              this renders "0" instead of formatNumber/formatMoney's own
                              undefined-handling ("NaN"/"undefined" text). */}
                          <td className="smallest">{formatNumber(t.securityExcess ?? 0, 2)}</td>
                          <td className="smallest">{formatMoney(t.moneyDeficit ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )
        : (
            <div style={{ opacity: 0.6, fontSize: 12, marginTop: 6 }}>
              No hwgw activity yet — enable a host below and start
              auto-hack.app.js.
            </div>
          )}
    </>
  )
}
