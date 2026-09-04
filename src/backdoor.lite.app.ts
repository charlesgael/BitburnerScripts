import type { NS, Server } from '@ns'

// Cheap, non-Singularity companion to backdoor.app.ts: just reports which
// rooted servers still need a backdoor, without installing anything. Useful
// when you don't have the RAM (or Source-File 4) to run the real installer
// yet.
export async function main(ns: NS) {
  ns.disableLog(`ALL`)
  const serverFile = `known-servers.json`

  const servers: Server[] = JSON.parse(ns.read(serverFile))

  const needsBackdoor = servers.filter(
    s =>
      s.hasAdminRights
      && s.hostname !== `home`
      && !s.purchasedByPlayer
      && !s.backdoorInstalled,
  )

  ns.tprint(`\n--- Rooted servers without a backdoor (${needsBackdoor.length}) ---`)
  if (needsBackdoor.length === 0) {
    ns.tprint(`None — everything rooted is already backdoored.`)
  }
  for (const server of needsBackdoor) {
    ns.tprint(server.hostname)
  }
}
