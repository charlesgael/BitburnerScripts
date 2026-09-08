import type { NS } from '@ns'
import { parseArgs } from '../utils/args'

export async function main(ns: NS) {
  const args = parseArgs(ns, [])

  const srvs = args._.map(String)
  if (!srvs.length) {
    ns.tprint('ERROR: At least one server is required')
  }

  for (const srv of srvs) {
    if (!ns.serverExists(srv))
      continue
    ns.killall(srv)
  }
}
