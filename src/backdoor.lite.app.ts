import type { NS, Server } from '@ns'

// Cheap, non-Singularity companion to backdoor.app.ts: just reports which
// rooted servers still need a backdoor, without installing anything. Useful
// when you don't have the RAM (or Source-File 4) to run the real installer
// yet.
export async function main(ns: NS) {
  ns.disableLog(`ALL`)
  const serverFile = `known-servers.json`
  ns.ui.openTail(ns.pid)
  ns.ui.resizeTail(600, 800)

  const servers: Server[] = JSON.parse(ns.read(serverFile))

  const needsBackdoor = servers.filter(
    s =>
      s.hasAdminRights
      && s.hostname !== `home`
      && !s.purchasedByPlayer
      && !s.backdoorInstalled,
  )

  ns.print(`\n--- Rooted servers without a backdoor (${needsBackdoor.length}) ---`)
  if (needsBackdoor.length === 0) {
    ns.print(`None — everything rooted is already backdoored.`)
  }
  for (const server of needsBackdoor) {
    ns.print(server.hostname)
  }
}
