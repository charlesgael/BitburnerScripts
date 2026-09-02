import type { NS, Server } from '@ns'

/**
 * Shared plumbing for the two standalone "flood every reachable server"
 * daemons — `flooder.app.ts` (hack/grow/weaken) and `floodshare.app.ts`
 * (share) — factored out of what used to be near-verbatim duplicated code
 * between them: reading `known-servers.json.txt` on a fixed cadence,
 * skipping cloud/slave-node/home hosts, and cleaning up every host either
 * daemon ever touched on exit.
 *
 * Marked `// cpy` at both import sites (see `plugin/inline-cpy-imports.ts`)
 * rather than a real import: both daemons get `ns.scp`'d standalone to
 * whichever host the task manager spawns them on — including a cloud
 * server via its cloud dropdown, not just `home` — and a real cross-file
 * import would need this file copied to that host too, which never
 * happens. `// cpy` splices this file's declarations directly into each
 * daemon's own compiled output instead, so nothing else needs `scp`'d
 * alongside it. That's also why every import here must stay type-only
 * (the `// cpy` plugin's v1 restriction) — this file only ever imports
 * types from `@ns`.
 */

export async function logError(ns: NS, message: string) {
  const line = `[${new Date().toLocaleTimeString(undefined, {
    hour12: false,
  })}] ${message}`
  ns.print(`ERROR: ${line}`)
}

/**
 * Hosts a flood daemon must never touch as a bank/bot/target — passed in
 * as script args by the Programs app, populated with whichever servers
 * are currently designated as "slave nodes" (see `ui/utils/slave-nodes.ts`)
 * plus the host the daemon itself runs on, so it never kills/hijacks a
 * server the player deliberately carved out for Programs/XP Farm/Share, or
 * itself. Computed once at launch, not re-read live: picking up a newly
 * designated slave node just means restarting the daemon from the Programs
 * app, which recomputes this list fresh every time it spawns (see
 * `ui/apps/programs/index.ts`'s `buildArgs`).
 */
export function readIgnoredHostnames(ns: NS): Set<string> {
  return new Set(ns.args.map(String))
}

/**
 * Registers the shared exit cleanup, once, up front, so it's armed for the
 * whole run — `ns.kill`'d from the Programs app (see
 * `ui/apps/task-manager/`) or exiting on its own both trigger it. Stops
 * every script this daemon ever started, on every host it ever touched, so
 * nothing keeps running unmanaged once there's no daemon left to retarget
 * it. `touchedHosts` is read at call time via closure, not snapshotted
 * here, so it reflects whatever the daemon had actually claimed by the
 * time it died.
 */
export function registerFloodCleanup(ns: NS, touchedHosts: Set<string>, name: string) {
  ns.atExit(() => {
    for (const hostname of touchedHosts) {
      if (ns.serverExists(hostname))
        ns.killall(hostname)
    }
  }, name)
}

/**
 * Drops any hostname from `lists` that has since become a cloud server or
 * a designated slave node — checked fresh every cycle since the player can
 * buy/delete cloud servers, or change slave nodes, at any time. Purges
 * rather than just blocking *new* additions, so a host that slipped in
 * before this check applied (or got reclassified) stops being touched too.
 */
export function purgeStaleHosts(lists: Server[][], cloudHostnames: Set<string>, ignoredHostnames: Set<string>) {
  for (const list of lists) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (cloudHostnames.has(list[i].hostname) || ignoredHostnames.has(list[i].hostname))
        list.splice(i, 1)
    }
  }
}

/** Same purge as {@link purgeStaleHosts}, for a plain hostname list. */
export function purgeStaleHostnames(list: string[], cloudHostnames: Set<string>, ignoredHostnames: Set<string>) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (cloudHostnames.has(list[i]) || ignoredHostnames.has(list[i]))
      list.splice(i, 1)
  }
}

/**
 * Reads and filters `serverFile`: rooted, not `home`, not a cloud server,
 * not a designated slave node, and not already claimed by `alreadyKnown`
 * (the caller's own in-progress lists). `serverFile` is only a cache — it
 * can list a host that no longer exists (e.g. `netmapper.app.js` hasn't
 * refreshed it since the host was deleted/reset) — skipped and logged
 * rather than letting a later `killall()` throw and crash the daemon.
 */
export async function loadKnownServers(
  ns: NS,
  serverFile: string,
  cloudHostnames: Set<string>,
  ignoredHostnames: Set<string>,
  alreadyKnown: (hostname: string) => boolean,
): Promise<Server[]> {
  const servers: Server[] = []
  for (const s of JSON.parse(ns.read(serverFile)) as Server[]) {
    if (
      !s.hasAdminRights
      || s.hostname === `home`
      || cloudHostnames.has(s.hostname) // never bot/target the player's own purchased ("cloud") servers
      || ignoredHostnames.has(s.hostname) // never bot/target a designated slave node either
      || alreadyKnown(s.hostname)
    ) {
      continue
    }
    if (!ns.serverExists(s.hostname)) {
      await logError(
        ns,
        `${s.hostname} is in ${serverFile} but no longer exists - skipping.`,
      )
      continue
    }
    servers.push(s)
  }
  return servers
}

/** Prints the "will search again at HH:MM:SS" line both daemons end their loop on. */
export function printNextRun(ns: NS, delayMs: number) {
  ns.print(
    `Will search again at ${new Date(
      Date.now() + delayMs,
    ).toLocaleTimeString(undefined, { hour12: false })}.`,
  )
}
