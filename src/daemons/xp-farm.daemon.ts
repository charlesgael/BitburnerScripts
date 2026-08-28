import type { NS, Server } from '@ns'
import type { XpFarmAssignment } from '../ui/utils/xp-farm-config'
import {
  XP_FARM_CONFIG_FILE as CONFIG_FILE,
  XP_FARM_LOOP_DELAY as CONTINUOUS,
  XP_FARM_GROW_SCRIPT as GROW_SCRIPT,
  XP_FARM_WEAKEN_SCRIPT as WEAKEN_SCRIPT,
} from '../ui/utils/xp-farm-config'

/**
 * Background orchestrator for the XP Farm feature (`ui/apps/xp-farm/`).
 * Owns every cloud server listed in `xp-farm-config.txt` outright: on each
 * cycle it reconciles that file against reality — claiming newly-listed
 * hosts (killing whatever was already running there, since Programs treats
 * a dedicated host as off-limits once it's in this list — see
 * `ui/apps/task-manager/`'s filtering), releasing hosts that dropped
 * off the list (killall, handing them back to Programs), and re-asserting
 * exclusive control of every already-claimed host — relaunching a loop that
 * died, but also evicting anything foreign that moved onto a dedicated host
 * some other way (e.g. launched by hand once its grow/weaken loop was
 * manually stopped and its RAM freed up) — then sleeps and repeats. Exits
 * on its own once the (pruned, still-existing-servers-only) list goes
 * empty, rather than idling forever with nothing to manage; the app
 * re-launches it the next time a server is (re-)enabled.
 *
 * Every cycle it (re-)picks the single rooted, non-purchased server with the
 * highest `baseDifficulty` among those at or below the player's current
 * hacking level (grow()/weaken() need no hacking-skill check to succeed,
 * unlike hack() — but a target whose `requiredHackingSkill` is far beyond
 * the player's own still takes drastically longer per call, so this keeps
 * throughput reasonable) — XP per completed grow()/weaken() call scales
 * with the target's `baseDifficulty`, not its money or growth rate. Every
 * managed host shares that one target, and switches to it live — no
 * disable/re-enable or daemon restart needed — the moment a better one
 * becomes available (a server gets rooted, or the player's level clears its
 * requirement), since the target can only ever improve cycle over cycle,
 * never regress. It then fills the host's RAM with grow/weaken threads in a
 * ratio (via
 * `ns.weakenAnalyze`/`ns.growthAnalyzeSecurity`) that keeps the target's
 * security roughly flat forever, instead of grow-only threads slowly
 * driving security — and therefore every future call's time — upward.
 * Both actions never fail and give identical XP per completion; weaken
 * only exists here to offset grow's own security creep, not because it
 * scores extra XP on its own (see the "Weaken Grind" conversation this
 * feature grew out of).
 *
 * Split into its own script for the usual reason (see the RAM-cost model
 * section in CLAUDE.md): ns.getServer/ns.scan/ns.killall/ns.scp/etc. would
 * otherwise permanently inflate ui.app.js, which is always running. Here,
 * that cost only applies while at least one server is actually dedicated.
 *
 * Enforces "never two instances at once" itself (not just via the app's own
 * isRunning check before launching it) by scanning `ns.ps("home")` for
 * another already-running copy on startup and bailing out if found — so a
 * manual `run daemons/xp-farm.daemon.js` from the terminal can't end up
 * fighting the app-launched instance over the same hosts.
 */
const CHECK_INTERVAL = 15000

type Assignment = XpFarmAssignment

function readHosts(ns: NS): string[] {
  const raw = ns.read(CONFIG_FILE)
  if (!raw)
    return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

/**
 * Every hostname reachable from `home`, found once per cycle rather than
 * cached — the player can root new servers at any time, each one a
 * potentially better target than whatever was picked before.
 */
function scanNetwork(ns: NS): string[] {
  const seen = new Set<string>(['home'])
  const queue = ['home']
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const neighbor of ns.scan(current)) {
      if (!seen.has(neighbor)) {
        seen.add(neighbor)
        queue.push(neighbor)
      }
    }
  }
  return [...seen]
}

/**
 * The rooted, non-purchased server with the highest `baseDifficulty`
 * (more XP per grow/weaken completion) among those whose hacking-skill
 * requirement the player has already met (keeps per-call time reasonable).
 * null if nothing qualifies (e.g. nothing rooted yet besides home).
 */
function pickTarget(ns: NS): string | null {
  const hackingLevel = ns.getHackingLevel()
  let best: Server | null = null
  for (const hostname of scanNetwork(ns)) {
    if (hostname === 'home')
      continue
    const server = ns.getServer(hostname)
    if (!server.hasAdminRights || server.purchasedByPlayer)
      continue
    if ((server.requiredHackingSkill ?? 0) > hackingLevel)
      continue
    if (best === null || (server.baseDifficulty ?? 0) > (best.baseDifficulty ?? 0)) {
      best = server
    }
  }
  return best?.hostname ?? null
}

/**
 * Splits `totalThreads` between weaken and grow so that, cycle over cycle,
 * weaken's security decrease roughly matches grow's security increase —
 * computed from the actual live multipliers rather than a hardcoded ratio,
 * so it stays correct across BitNodes/augmentations that alter them.
 */
function splitThreads(ns: NS, totalThreads: number): { growThreads: number, weakenThreads: number } {
  if (totalThreads <= 1)
    return { growThreads: 0, weakenThreads: totalThreads }
  const weakenPerThread = ns.weakenAnalyze(1)
  const growPerThread = ns.growthAnalyzeSecurity(1)
  const ratio = growPerThread > 0 ? weakenPerThread / growPerThread : 12.5
  const weakenThreads = Math.min(totalThreads - 1, Math.max(1, Math.round(totalThreads / (ratio + 1))))
  return { growThreads: totalThreads - weakenThreads, weakenThreads }
}

/**
 * Re-asserts exclusive control of an already-claimed host and launches
 * whichever of its two loops (per `assignment`) aren't already running —
 * safe to call every cycle: never launches a duplicate of one that's
 * already alive, but recovers one that died some other way (e.g. manually
 * killed), and — the point of the foreign-process check — evicts anything
 * else that moved in on the RAM that freed up (a program launched by hand,
 * or anything else) instead of quietly leaving the host un-dedicated in
 * practice just because it's still *listed* as dedicated. A host with a
 * foreign process gets its whole process list wiped and both loops
 * relaunched fresh, rather than trying to identify and kill only the
 * intruder — simpler, and "this host runs nothing but its assigned
 * grow/weaken loops" is the invariant this daemon exists to hold.
 */
function enforceOwnership(ns: NS, host: string, assignment: Assignment) {
  const foreign = ns.ps(host).some(p => p.filename !== GROW_SCRIPT && p.filename !== WEAKEN_SCRIPT)
  if (foreign) {
    ns.print(`${host}: foreign process detected — reclaiming exclusive control.`)
    ns.killall(host)
  }
  if (assignment.weakenThreads > 0 && !ns.isRunning(WEAKEN_SCRIPT, host, assignment.target, CONTINUOUS)) {
    ns.print(`${host}: (re)launching weaken loop against ${assignment.target}.`)
    ns.exec(WEAKEN_SCRIPT, host, assignment.weakenThreads, assignment.target, CONTINUOUS)
  }
  if (assignment.growThreads > 0 && !ns.isRunning(GROW_SCRIPT, host, assignment.target, CONTINUOUS)) {
    ns.print(`${host}: (re)launching grow loop against ${assignment.target}.`)
    ns.exec(GROW_SCRIPT, host, assignment.growThreads, assignment.target, CONTINUOUS)
  }
}

/**
 * Seizes exclusive control of a newly-dedicated host, splits its RAM into
 * grow/weaken threads for `target`, and starts its loops. Returns null (and
 * leaves the host unmanaged, to be retried next cycle) if there's not even
 * enough RAM for one thread. `target` is passed in (computed once per cycle
 * in `main`, shared by every host) rather than picked per-host — there's
 * only ever one globally-best target at a time, not a per-host one.
 */
function claim(ns: NS, host: string, target: string): Assignment | null {
  ns.killall(host)

  // Measured from "home" (where Viteburner always deploys these scripts),
  // not `host` — a freshly-claimed cloud server never has them yet at this
  // point (that's what the scp below is for), and getScriptRam returns 0
  // for a script that doesn't exist on the given host, which would make
  // every claim silently fail forever. RAM cost only depends on the
  // script's own content, not which host it's measured from, so this is
  // exactly as accurate.
  const scriptRam = ns.getScriptRam(GROW_SCRIPT, 'home')
  const totalThreads = scriptRam > 0 ? Math.floor(ns.getServerMaxRam(host) / scriptRam) : 0
  if (totalThreads < 1) {
    ns.print(`${host}: skipping — not enough RAM for even one grow/weaken thread (${scriptRam.toFixed(2)} GB each).`)
    return null
  }

  ns.scp([GROW_SCRIPT, WEAKEN_SCRIPT], host)
  const { growThreads, weakenThreads } = splitThreads(ns, totalThreads)
  const assignment: Assignment = { target, growThreads, weakenThreads }
  enforceOwnership(ns, host, assignment)
  ns.print(`${host}: farming ${target} — ${growThreads} grow thread(s), ${weakenThreads} weaken thread(s).`)
  return assignment
}

export async function main(ns: NS) {
  ns.disableLog('ALL')

  // Refuse to run alongside another live instance of this exact script —
  // see the header comment above.
  const dupe = ns.ps('home').find(p => p.filename === ns.getScriptName() && p.pid !== ns.pid)
  if (dupe) {
    ns.tprint(`WARNING: daemons/xp-farm.daemon.js is already running (pid ${dupe.pid}) — exiting.`)
    return
  }

  ns.print(`Started. Checking xp-farm-config.txt every ${CHECK_INTERVAL / 1000}s.`)
  const managed = new Map<string, Assignment>()

  while (true) {
    const configured = readHosts(ns)
    // Self-heal: a dedicated server can be deleted (via the Cloud
    // Servers app) without ever being explicitly un-dedicated first —
    // drop it from the config file too, instead of leaving a phantom
    // entry the app would keep showing as enabled forever.
    const validHosts = configured.filter(h => ns.serverExists(h))
    if (validHosts.length !== configured.length) {
      ns.write(CONFIG_FILE, JSON.stringify(validHosts), 'w')
    }
    const hostSet = new Set(validHosts)

    for (const host of [...managed.keys()]) {
      if (hostSet.has(host))
        continue
      if (ns.serverExists(host))
        ns.killall(host) // release: hand it back to Programs
      ns.print(`${host}: released — no longer in xp-farm-config.txt.`)
      managed.delete(host)
    }

    // Computed once per cycle, not per host — there's only ever one
    // globally-best target at a time (see pickTarget), so every host
    // shares it rather than each re-running the same network scan.
    const bestTarget = pickTarget(ns)

    if (bestTarget) {
      for (const host of validHosts) {
        if (managed.has(host))
          continue
        const assignment = claim(ns, host, bestTarget)
        if (assignment)
          managed.set(host, assignment)
      }
    }

    for (const [host, assignment] of managed) {
      // A better target can appear mid-run — a server gets rooted, or
      // the player's hacking level clears its requirement — without
      // this host ever being disabled/re-enabled. Since pickTarget
      // always returns the single best currently-qualifying target,
      // any difference here is strictly an upgrade, never a
      // downgrade, so switching unconditionally is safe. The old
      // loops are running with the old target baked into their args,
      // so isRunning(..., newTarget, ...) would find nothing and just
      // launch a second set alongside them if they weren't killed
      // first — killall here (not just relying on enforceOwnership's
      // own foreign-process check, which only looks at filenames and
      // wouldn't recognize a same-script-different-target process as
      // foreign) clears them out before the retargeted relaunch.
      if (bestTarget && bestTarget !== assignment.target) {
        ns.print(`${host}: switching target ${assignment.target} → ${bestTarget}.`)
        ns.killall(host)
        assignment.target = bestTarget
      }
      enforceOwnership(ns, host, assignment)
    }

    if (validHosts.length === 0) {
      ns.print('No dedicated servers left — exiting. The app relaunches this when one is enabled again.')
      break
    }

    await ns.sleep(CHECK_INTERVAL)
  }
}
