import type { NS } from '@ns'

export function noDupe(ns: NS) {
  const scriptName = ns.getScriptName()
  const dupe = ns.ps(ns.getHostname()).find(p => p.filename === ns.getScriptName() && p.pid !== ns.pid)
  if (dupe) {
    ns.tprint(`WARNING: ${scriptName} is already running (pid ${dupe.pid}) - exiting.`)
    ns.exit()
  }
}
