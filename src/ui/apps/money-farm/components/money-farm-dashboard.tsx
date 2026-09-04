import React from '@react'
import { getCgdStore } from '../../../../cgd/store'
import { formatPercent } from '../../../../utils/format/game'
import { InstanceManager } from '../../../components/instance-manager'
import { TitlebarPulldown } from '../../../components/window/titlebar-pulldown'
import { TitlebarToolbar } from '../../../components/window/titlebar-toolbar'
import { GRAPH_COLORS } from '../../../utils/graph-colors'
import { useMoneyFarm } from '../logic/use-money-farm'
import { MoneyFarmContent } from './money-farm-content'

export function MoneyFarmDashboard() {
  const mf = useMoneyFarm()
  const moneyFarm = getCgdStore().use(s => s.moneyFarm)
  let sum = 0

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
          onClick={() => void mf.refresh()}
          disabled={mf.loading}
          className="bb-icon-link"
        >
          🗘
        </button>
      </TitlebarToolbar>
      {moneyFarm && (
        <>
          <div className="bb-progress" style={{ height: `${moneyFarm.perTarget.length + 2}em` }}>
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
          {/* <div
            style={{
              position: 'relative',
              height: `${moneyFarm.perTarget.length + 1}em`,
            }}
          >
            {moneyFarm.perTarget.map(({ target, reserved, mode }, idx) => (
              <div
                key={target}
                style={{
                  textAlign: 'center',
                  verticalAlign: 'bottom',
                  color: AUTO_COLORS[idx % AUTO_COLORS.length],
                  display: 'inline-block',
                  position: 'absolute',
                  top: 0,
                  left: `${(reserved / moneyFarm.totalRam * 100 / 2).toFixed(0)}%`,
                  height: `${idx + 1}em`,
                }}
              >
                {target}
                {': '}
                {mode}
              </div>
            ))}
          </div> */}
        </>
      )}
    </>
  )
}
