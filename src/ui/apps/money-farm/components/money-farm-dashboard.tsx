import React from '@react'
import { InstanceManager } from '../../../components/instance-manager'
import { TitlebarPulldown } from '../../../components/window/titlebar-pulldown'
import { TitlebarToolbar } from '../../../components/window/titlebar-toolbar'
import { useMoneyFarm } from '../logic/use-money-farm'
import { MoneyFarmContent } from './money-farm-content'

export function MoneyFarmDashboard() {
  const mf = useMoneyFarm()

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

    </>
  )
}
