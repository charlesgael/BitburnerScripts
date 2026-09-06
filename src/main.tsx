import type { NS } from '@ns'
import type { SteadyFarmLiveStats } from './lib/steady-farm/summary'
import React from '@react'
import { computeSteadyFarmStats } from './lib/steady-farm/summary'
import { sendTerminal } from './utils/send-terminal'

function StartBtn({ filename, children, clear }: { filename: string, children: any, clear?: boolean }) {
  async function click() {
    await sendTerminal(`run ${filename}`)
    if (clear)
      await sendTerminal('clear')
  }

  return (
    <button style={{ padding: '5px 10px', fontFamily: 'inherit', whiteSpace: 'nowrap' }} onClick={click}>{children}</button>
  )
}

/**
 * Steady Farm's whole reason for existing is running unattended while
 * offline — this is where that pays off in something visible: a one-shot
 * "here's what happened" summary at login, rather than a live dashboard
 * for something you won't be watching in real time. Purely presentational
 * — `main` computes `stats` beforehand via `computeSteadyFarmStats`, so
 * this component itself does nothing but render already-known values.
 */
function SteadyFarmSummary({ stats }: { stats: SteadyFarmLiveStats }) {
  return (
    <div>
      {`Steady Farm: ${stats.totalMoney.toLocaleString()} (${stats.moneyPerHour.toLocaleString(undefined, { maximumFractionDigits: 0 })}/h), `}
      {`${stats.totalExp.toLocaleString(undefined, { maximumFractionDigits: 0 })} hacking XP (${stats.expPerHour.toLocaleString(undefined, { maximumFractionDigits: 0 })}/h).`}
    </div>
  )
}

export async function main(ns: NS) {
  // Every currently-running steady-farm.daemon.js instance's own online +
  // offline totals, read straight off ns.getRunningScript — see
  // computeSteadyFarmStats's own header comment for why no log/checkpoint
  // file is needed for this.
  const stats = computeSteadyFarmStats(ns)

  ns.tprintRaw(
    <>
      <div>Welcome back, let's start hacking!</div>
      {stats && <SteadyFarmSummary stats={stats} />}
      <p><StartBtn filename="start.js" clear>Run ui.app</StartBtn></p>
    </>,
  )
}
