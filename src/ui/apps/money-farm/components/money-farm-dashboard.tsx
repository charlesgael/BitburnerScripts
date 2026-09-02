import React from '@react'
import { getCgdStore } from '../../../../cgd/store'
import { InstanceManager } from '../../../components/instance-manager'
import { TitlebarPulldown } from '../../../components/window/titlebar-pulldown'
import { TitlebarToolbar } from '../../../components/window/titlebar-toolbar'
import { useMoneyFarm } from '../logic/use-money-farm'
import { MoneyFarmContent } from './money-farm-content'

const AUTO_COLORS = ['#3366CC', '#DC3912', '#FF9900', '#109618']

export function MoneyFarmDashboard() {
  const mf = useMoneyFarm()
  const moneyFarm = getCgdStore().use(s => s.moneyFarm)

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
          <div className="bb-progress">
            {moneyFarm.perTarget.map(({ target, reserved, used }, idx) => (
              <div
                key={target}
                style={{
                  width: `${(reserved / moneyFarm.totalRam * 100).toFixed(1)}%`,
                  background: `color-mix(in srgb, ${AUTO_COLORS[idx % AUTO_COLORS.length]} 50%, transparent)`,
                  height: '100%',
                  display: 'inline-block',
                }}
              >
                <div
                  key={target}
                  style={{
                    width: `${(used / moneyFarm.totalRam * 100).toFixed(1)}%`,
                    background: AUTO_COLORS[idx % AUTO_COLORS.length],
                    height: '100%',
                  }}
                />
              </div>
            ))}
          </div>
          <div>
            {moneyFarm.perTarget.map(({ target, reserved, mode }, idx) => (
              <div
                key={target}
                style={{
                  width: `${(reserved / moneyFarm.totalRam * 100).toFixed(0)}%`,
                  textAlign: 'center',
                  color: AUTO_COLORS[idx % AUTO_COLORS.length],
                  display: 'inline-block',
                }}
              >
                {target}
                {': '}
                {mode}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
