import type { NS } from '@ns'
import { parseArgs } from '../utils/args'

export async function main(ns: NS) {
  const args = parseArgs(ns, [])

  const srvs = args._.map(String)
  if (!srvs.length) {
    ns.tprint('ERROR: At least one server is required')
  }

  for (let i = 0; i < srvs.length; i++) {
    const srv = srvs[i]

    if (ns.fileExists(srv)) {
      try {
        const servers = JSON.parse(ns.read(srv))
        if (Array.isArray(servers)) {
          srvs.push(...servers.map(String))
        }
      }
      catch {}
    }
    if (ns.serverExists(srv)) {
      ns.killall(srv)
    }
  }
}
