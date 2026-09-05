import type { NS, Server } from '@ns'
import { parseArgs } from './utils/args'

function findServers(ns: NS, current: Server, knownServers: Server[]) {
  const hosts = ns.scan(current.hostname)
  if (current.hostname !== `home`) {
    hosts.shift()
  }

  const servers = hosts.map(host => ns.getServer(host))
  for (const server of servers) {
    const index = knownServers.findIndex(
      s => server.hostname === s.hostname,
    )
    if (index < 0) {
      ns.print(`Found: ${server.hostname}`)
      knownServers.push(server)
    }
    else {
      knownServers.splice(index, 1, server)
    }
    findServers(ns, server, knownServers)
  }
}

export async function main(ns: NS) {
  ns.disableLog(`ALL`)
  const args = parseArgs(ns, [
    { long: 'delay', defaultValue: 60, description: 'Delay between passes', short: 'delay' },
  ] as const)
  const delay = args.delay * 1000
  const filename = `known-servers.json`
  const servers: Server[] = []

  const repeat = !args._.includes('once')

  if (ns.fileExists(filename)) {
    ns.rm(filename)
    ns.print(`Deleted existing ${filename}`)
  }

  let lastServerCount = servers.length

  do {
    ns.print(`\nSearching for new servers...`)
    findServers(ns, ns.getServer(`home`), servers)

    if (lastServerCount === servers.length) {
      ns.print(`No new servers found.`)
    }
    lastServerCount = servers.length
    ns.print(`Writing ${filename}...`)
    ns.write(filename, JSON.stringify(servers), `w`)

    if (repeat) {
      ns.print(
        `Will search again at ${new Date(
          Date.now() + delay,
        ).toLocaleTimeString(undefined, { hour12: false })}.`,
      )
      await ns.sleep(delay)
    }
    // repeat is a const set once from `ns.args` above (run-once vs.
    // persistent-loop mode) — intentionally never reassigned.
    // eslint-disable-next-line no-unmodified-loop-condition
  } while (repeat)
}
