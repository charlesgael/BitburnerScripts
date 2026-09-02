import type { NS, Server } from '@ns'
import { SHARE_DAEMON_SCRIPT } from './ui/utils/share-config' // cpy
import { loadKnownServers, logError, printNextRun, purgeStaleHosts, readIgnoredHostnames, registerFloodCleanup } from './utils/flood-daemon.lib' // cpy

const threadRam = 4 // mem of daemon script

async function execShare(ns: NS, server: Server) {
  const execDelay = 500

  const copied = ns.scp(
    SHARE_DAEMON_SCRIPT,
    server.hostname,
    `home`,
  )
  if (!copied) {
    await logError(
      ns,
      `scp of share scripts to ${server.hostname} failed.`,
    )
    return
  }

  const threads = Math.floor(ns.getServerMaxRam(server.hostname) / threadRam)

  if (threads) {
    const pid = ns.exec(
      SHARE_DAEMON_SCRIPT,
      server.hostname,
      threads,
      server.hostname,
    )
    if (pid === 0) {
      await logError(
        ns,
        `exec of ${SHARE_DAEMON_SCRIPT} on ${server.hostname} (${threads} threads -> ${server.hostname}) failed - `
        + `likely not enough free RAM (${ns.getServerMaxRam(
          server.hostname,
        )}GB max, ${ns.getServerUsedRam(
          server.hostname,
        )}GB used) or a duplicate is already running.`,
      )
    }
    await ns.sleep(execDelay)
  }
  else {
    await logError(
      ns,
      `Can't exec ${SHARE_DAEMON_SCRIPT} on ${server.hostname} (not enough total RAM to even fire a single thread)`,
    )
  }
}

export async function main(ns: NS) {
  ns.disableLog(`ALL`)
  const tenMinutes = 1000 * 60 * 10
  const serverFile = `known-servers.json.txt`
  const sharing: Server[] = []

  const ignoredHostnames = readIgnoredHostnames(ns)
  const touchedHosts = new Set<string>()
  registerFloodCleanup(ns, touchedHosts, `flooder-cleanup`)

  while (true) {
    // Ground truth for which hosts are cloud servers, straight from the
    // Cloud API rather than relying on known-servers.json.txt's cached
    // `purchasedByPlayer` flag (which could be stale, or wrong for a
    // server bought/deleted since netmapper.app.ts last wrote the
    // file) — re-fetched every cycle since the player can buy/delete
    // cloud servers at any time.
    const cloudHostnames = new Set(ns.cloud.getServerNames())
    purgeStaleHosts([sharing], cloudHostnames, ignoredHostnames)

    const servers = await loadKnownServers(
      ns,
      serverFile,
      cloudHostnames,
      ignoredHostnames,
      hostname => sharing.some(s => s.hostname === hostname),
    )
    ns.print(`\nReloaded ${serverFile}`)

    let foundServer = false
    for (const server of servers) {
      foundServer = true
      try {
        ns.print(`${server.hostname} - Sharing`)
        ns.killall(server.hostname)

        await execShare(ns, server)
        sharing.push(server)
        touchedHosts.add(server.hostname)
      }
      catch (e) {
        await logError(
          ns,
          `Failed to share on ${server.hostname}: ${e}`,
        )
      }
    }

    if (!foundServer) {
      ns.print(`No known shareable servers.`)
    }

    printNextRun(ns, tenMinutes)
    await ns.sleep(tenMinutes)
  }
}
