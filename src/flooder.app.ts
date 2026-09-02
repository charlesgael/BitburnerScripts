import type { NS, Server } from '@ns'
import { loadKnownServers, logError, printNextRun, purgeStaleHostnames, purgeStaleHosts, readIgnoredHostnames, registerFloodCleanup } from './utils/flood-daemon.lib' // cpy

const threadRam = 1.75 // mem of daemon script
const hackScript = `daemons/hack.daemon.js`
const growScript = `daemons/grow.daemon.js`
const weakenScript = `daemons/weaken.daemon.js`

class Script {
  constructor(
    public script: string,
    public threads: number,
    public delay: number,
  ) {}
}

function getHGW(ns: NS, server: Server, target: Server) {
  const weakenTime = ns.getWeakenTime(target.hostname)
  const growTime = ns.getGrowTime(target.hostname)
  const hackTime = ns.getHackTime(target.hostname)

  const hgw = [
    new Script(hackScript, 1, weakenTime - hackTime),
    new Script(growScript, 12, weakenTime - growTime),
    new Script(weakenScript, 1, 0),
  ]

  if (server.maxRam < threadRam * 3) {
    hgw.forEach(h => (h.threads = 0))
    return hgw
  }

  let hgwThreads = hgw.reduce((total, h) => (total += h.threads), 0)

  if (server.maxRam < threadRam * hgwThreads) {
    hgw[1].threads = Math.floor(
      (server.maxRam - threadRam * 2) / threadRam,
    )
    return hgw
  }

  const hgwRam = hgwThreads * threadRam
  hgwThreads = Math.floor(server.maxRam / hgwRam)
  hgw.forEach(h => (h.threads *= hgwThreads))
  return hgw
}

async function execGrowth(ns: NS, server: Server) {
  // Explicit source: the daemon scripts are only ever deployed to `home`
  // by Viteburner. Without this, scp() defaults to copying from whatever
  // host flooder.app.ts itself happens to be running on, which silently
  // fails every time when that's not home (it never had these files).
  const copied = ns.scp(weakenScript, server.hostname, `home`)
  if (!copied) {
    await logError(
      ns,
      `scp of ${weakenScript} to ${server.hostname} failed.`,
    )
    return
  }

  const maxThreads = Math.floor(server.maxRam / threadRam)
  const runOptions = {
    threads: maxThreads,
    preventDuplicates: true,
  }
  if (maxThreads === 0)
    return
  const pid = ns.exec(
    weakenScript,
    server.hostname,
    runOptions,
    server.hostname,
    0,
  )
  if (pid === 0) {
    await logError(
      ns,
      `exec of ${weakenScript} on ${server.hostname} (${maxThreads} threads) failed - `
      + `likely not enough free RAM (${ns.getServerMaxRam(
        server.hostname,
      )}GB max, ${ns.getServerUsedRam(
        server.hostname,
      )}GB used) or a duplicate is already running.`,
    )
  }
}

async function execHGW(ns: NS, server: Server, target: Server = server) {
  const hgw = getHGW(ns, server, target)
  const execDelay = 500

  const copied = ns.scp(
    hgw.map(h => h.script),
    server.hostname,
    `home`, // see execGrowth's comment on why this must be explicit
  )
  if (!copied) {
    await logError(
      ns,
      `scp of hack/grow/weaken scripts to ${server.hostname} failed.`,
    )
    return
  }

  for (const h of hgw) {
    if (h.threads === 0)
      continue
    const runOptions = {
      threads: h.threads,
      preventDuplicates: true,
    }
    const pid = ns.exec(
      h.script,
      server.hostname,
      runOptions,
      target.hostname,
      h.delay,
    )
    if (pid === 0) {
      await logError(
        ns,
        `exec of ${h.script} on ${server.hostname} (${h.threads} threads -> ${target.hostname}) failed - `
        + `likely not enough free RAM (${ns.getServerMaxRam(
          server.hostname,
        )}GB max, ${ns.getServerUsedRam(
          server.hostname,
        )}GB used) or a duplicate is already running.`,
      )
    }
    await ns.sleep(execDelay)
  }
}

export async function main(ns: NS) {
  ns.disableLog(`ALL`)
  const tenMinutes = 1000 * 60 * 10
  const serverFile = `known-servers.json.txt`
  const flooded: Server[] = []
  const bots: Server[] = []
  const weakeningHosts: string[] = []
  const bankFilter = (s: Server) => s.moneyMax || -1 > 0
  let nextBankIndex = 0

  const ignoredHostnames = readIgnoredHostnames(ns)

  // Every hostname this daemon has ever launched hack/grow/weaken scripts
  // on (banks and bots alike — see the three `touchedHosts.add(...)`
  // call sites below), so it can be cleaned up on exit. A plain Set
  // rather than reconstructing from `flooded`/`bots`/`weakeningHosts` at
  // exit time: a host moves between those over its lifetime (weakening ->
  // flooded, cloud/slave-node reclassification splicing it back out,
  // ...), so tracking "ever touched" directly is simpler and can't miss
  // one that's mid-transition.
  const touchedHosts = new Set<string>()
  registerFloodCleanup(ns, touchedHosts, `flooder-cleanup`)

  while (true) {
    // Ground truth for which hosts are cloud servers, straight from the
    // Cloud API rather than relying on known-servers.json.txt's cached
    // `purchasedByPlayer` flag (which could be stale, or wrong for a
    // server bought/deleted since netmapper.app.ts last wrote the
    // file) — re-fetched every cycle since the player can buy/delete
    // cloud servers at any time. Purged from `bots`/`flooded`/
    // `weakeningHosts` too, so a cloud server that slipped in before
    // this check existed (or got reclassified) stops being touched
    // instead of only blocking *new* additions.
    const cloudHostnames = new Set(ns.cloud.getServerNames())
    purgeStaleHosts([flooded, bots], cloudHostnames, ignoredHostnames)
    purgeStaleHostnames(weakeningHosts, cloudHostnames, ignoredHostnames)

    const servers = await loadKnownServers(
      ns,
      serverFile,
      cloudHostnames,
      ignoredHostnames,
      hostname => flooded.some(s => s.hostname === hostname) || bots.some(s => s.hostname === hostname),
    )
    ns.print(`\nReloaded ${serverFile}`)

    let foundServer = false
    for (const server of servers) {
      foundServer = true
      if (!bankFilter(server)) {
        bots.push(server)
        continue
      }

      try {
        if (
          (server.hackDifficulty || -1) > (server.minDifficulty || -1)
        ) {
          if (!weakeningHosts.includes(server.hostname)) {
            ns.killall(server.hostname)
            await execGrowth(ns, server)
            weakeningHosts.push(server.hostname)
            touchedHosts.add(server.hostname)
          }
          ns.print(`${server.hostname} (Bank) - Weakening`)
          continue
        }

        ns.print(`${server.hostname} (Bank) - Flooding`)
        ns.killall(server.hostname)

        const growingIndex = weakeningHosts.indexOf(server.hostname)
        if (growingIndex > -1) {
          weakeningHosts.splice(growingIndex, 1)
        }

        await execHGW(ns, server)
        flooded.push(server)
        touchedHosts.add(server.hostname)
      }
      catch (e) {
        await logError(
          ns,
          `Failed to process bank ${server.hostname}: ${e}`,
        )
      }
    }

    const banks = flooded.filter(bankFilter)
    if (banks.length > 0) {
      for (const server of bots) {
        const target = banks[nextBankIndex]
        nextBankIndex = (nextBankIndex + 1) % banks.length

        try {
          ns.print(
            `${server.hostname} (Bot) - Flooding (${target.hostname})`,
          )
          ns.killall(server.hostname)
          await execHGW(ns, server, target)
          touchedHosts.add(server.hostname)
        }
        catch (e) {
          await logError(
            ns,
            `Failed to flood bot ${server.hostname} -> ${target.hostname}: ${e}`,
          )
        }
      }
    }

    if (!foundServer) {
      ns.print(`No known floodable servers.`)
    }

    printNextRun(ns, tenMinutes)
    await ns.sleep(tenMinutes)
  }
}
