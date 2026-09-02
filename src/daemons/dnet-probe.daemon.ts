import type { NS } from '@ns'
import { parseArgs } from '../utils/args' // cpy
import { tryAuth } from '../utils/dnet/auth' // cpy
import { getColonizedStore } from '../utils/dnet/colonized' // cpy
import { scpRun } from '../utils/scp-run' // cpy

/**
 * Kills any OTHER already-running copy of this exact script on the current
 * host. A one-shot script deployed fresh via scpRun always reads the
 * current file on exec — but nothing kills whatever was already running
 * here from an earlier pass, and a script that's been alive since before
 * a code change keeps executing whatever was loaded into memory at ITS OWN
 * launch, regardless of the file on disk having since changed. Without
 * this, stale generations from prior mutation ticks pile up indefinitely,
 * still running old code, silently multiplying the real authenticate()/
 * heartbleed() traffic hitting the network on top of whatever's fresh.
 */
export function preemptStaleInstances(ns: NS, script: string, host: string): void {
  for (const proc of ns.ps(host)) {
    if (proc.filename === script && proc.pid !== ns.pid) {
      ns.kill(proc.pid)
    }
  }
}

/**
 * Opens every not-yet-seen .cache file sitting on `host`. `opened` tracks
 * filenames already handled this process's lifetime — openCache()'s doc
 * doesn't say whether the file gets removed once opened, so this dedupes
 * regardless, rather than assuming and risking a repeat opening (or a
 * repeat scan doing nothing useful) on every call.
 */
function openNewCaches(ns: NS, host: string, opened: Set<string>): void {
  for (const file of ns.ls(host)) {
    if (!file.endsWith('.cache') || opened.has(file))
      continue
    opened.add(file)
    const res = ns.dnet.openCache(file, false)
    console.log(`dnet-probe$ INFO [${host}] opened cache ${file}:`, res)
  }
}

function logInfoFiles(ns: NS, host: string): void {
  const files = ns.ls(host)
    .filter(f => !f.endsWith('.cache') && !f.startsWith('daemons/'))

  console.debug(`dnet-probe$ INFO [${host}] Filesystem`, Object.fromEntries(files.map(f => [f, ns.read(f)])))
}

/**
 * Replicating one-shot probe/connector for dark net
 */
export async function main(ns: NS) {
  const args = parseArgs(ns, [
    { long: 'retry', defaultValue: false, description: 'Re-attempt hosts already marked failed this pass, instead of skipping them.' },
  ] as const, [
    { name: 'port', description: 'On which port to communicate', optional: true },
  ] as const)
  const me = ns.getHostname()
  const script = ns.getScriptName()
  const colonized = getColonizedStore()
  colonized[me] = 'online'

  // --- CACHE

  const openedCaches = new Set<string>()
  openNewCaches(ns, me, openedCaches)
  logInfoFiles(ns, me)

  // --- INFECT
  const reachable = ns.dnet.probe()

  for (const host of reachable) {
    try {
      // Already handled (by us, or a racing neighbor) this pass — unless
      // it's 'failed' and --retry was passed, which propagates to every
      // future generation automatically via the ...ns.args forward below.
      // 'tentative' is never bypassed: it exists purely to protect against
      // a concurrent racer on the SAME pass.
      const state = colonized[host]
      if (state === 'online' || state === 'tentative') {
        continue
      }
      if (state === 'failed' && !args.retry) {
        continue
      }

      // Set before tryAuth() is even called, not just before scpRun() —
      // tryAuth() can take real time, and this is what stops a racing
      // neighbor from starting a duplicate crack attempt on `host` while
      // this one is still in flight.
      colonized[host] = 'tentative'

      const res = await tryAuth(ns, host)
      if (res.type === 'failure') {
        colonized[host] = 'failed'
        console.log(`dnet-probe$ FAIL [${me}->${host}]`, res.error, res.server)
        continue
      }

      colonized[host] = 'online'
      preemptStaleInstances(ns, script, host)
      scpRun(ns, script, host, undefined, [], 1, ...ns.args)
    }
    catch (e) {
      // Whatever state this host was in (most likely still 'tentative' —
      // the exception almost certainly interrupted tryAuth() itself),
      // don't leave it stuck there forever blocking the rest of this pass.
      colonized[host] = 'failed'
      console.log(`dnet-probe$ ERROR [${me}->${host}] vanished mid-pass: ${e}`)
    }
  }

  // --- BLACKMAIL

  while (true) {
    const _res = await ns.dnet.phishingAttack()
    // "Very occasionally you can retrieve a cache file from the attempt" —
    // openCache() isn't part of the DarknetResult itself, so re-scan for
    // anything new after each attempt rather than only ever once at startup.
    openNewCaches(ns, me, openedCaches)
  }
}
