import type { NS, Server } from '@ns'
import React from '@react'
import { getCgdStore } from './cgd/store'
import { STEADY_FARM_DAEMON_SCRIPT } from './lib/steady-farm/config'
import { formatMediumHour } from './utils/format/dates'
import { noDupe } from './utils/ns/nodupe'

const SERVER_FILE = `known-servers.json`

function DisplayWait() {
  const store = getCgdStore().use(s => s.steadyFarm)

  const hosts = store?.perTarget ?? []
  const ready = hosts.filter(it => it.mode === 'farm').sort(({ target: A }, { target: B }) => A.localeCompare(B))
  const notReady = hosts.filter(it => it.mode !== 'farm').sort(({ target: A }, { target: B }) => A.localeCompare(B))

  return (
    <div style={{ display: 'flex' }}>
      <div style={{ width: 220 }}>
        <div>Ready</div>
        {ready.map(it => <div key={it.target}>{it.target}</div>)}
      </div>
      <div style={{ width: 220 }}>
        <div>Not Ready</div>
        {notReady.map(it => <div key={it.target}>{it.target}</div>)}
      </div>
    </div>
  )
}

export async function main(ns: NS) {
  ns.disableLog(`ALL`)
  ns.tprintRaw(<DisplayWait />)
  noDupe(ns)

  const deployed: string[] = []
  const delay = 60_000
  const ignored: string[] = ns.args.map(String)
  const pids: number[] = []

  ns.atExit(() => {
    for (const s of pids) {
      ns.kill(s)
    }
  })

  do {
    const servers: Server[] = JSON.parse(ns.read(SERVER_FILE))
    ns.print(`\nReloaded ${SERVER_FILE}`)

    for (const server of servers) {
      if (!ns.serverExists(server.hostname))
        continue
      if (ignored.includes(server.hostname))
        continue
      if (server.purchasedByPlayer)
        continue
      if (!server.hasAdminRights)
        continue
      if (deployed.includes(server.hostname))
        continue

      ns.print(`INFO: Acquired server ${server.hostname}`)

      const pid = ns.run(STEADY_FARM_DAEMON_SCRIPT, {
        threads: 1,
        preventDuplicates: true,
      }, '--target', server.hostname, 'mony')
      if (pid === 0) {
        ns.print(`ERROR: failed to launch ${STEADY_FARM_DAEMON_SCRIPT} on ${server.hostname}`)
      }
      else {
        deployed.push(server.hostname)
        pids.push(pid)
      }
    }

    ns.print(
      `Running ${deployed.length}, search again at ${formatMediumHour(Date.now() + delay)}.`,
    )
    await ns.sleep(delay)
    // repeat is a const set once from `ns.args` above (run-once vs.
    // persistent-loop mode) — intentionally never reassigned.
  } while (true)
}
