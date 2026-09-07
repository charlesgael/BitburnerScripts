import type { NS, ProcessInfo } from '@ns'

/**
 * Exits immediately (`ns.exit()`) if another instance of this exact script
 * is already running on the current host, so a script that shouldn't have
 * more than one live copy at a time can guard its own entry point against an
 * accidental double-launch.
 */
export function noDupe(ns: NS) {
  const dupe = hasDupe(ns)
  if (dupe) {
    ns.tprint(`WARNING: ${dupe.filename} is already running (pid ${dupe.pid}) - exiting.`)
    ns.exit()
  }
}

export function hasDupe(ns: NS): ProcessInfo | undefined {
  const dupe = ns.ps(ns.getHostname()).find(p => p.filename === ns.getScriptName() && p.pid !== ns.pid)
  return dupe
}
