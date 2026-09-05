import type { NS, Server } from '@ns'

// One-shot report, in the same spirit as backdoor.lite.app.ts: reads
// known-servers.json (written by netmapper.app.ts) and prints two
// independent top-3 rankings of not-yet-rooted servers — closest to hack by
// required hacking skill, and closest to hack by how many more port-opener
// programs ("exploits") are still needed on top of what's currently owned.
// No Singularity calls, cheap enough to run anywhere.
const PROGRAMS = [
  `BruteSSH.exe`,
  `SQLInject.exe`,
  `relaySMTP.exe`,
  `FTPCrack.exe`,
  `HTTPWorm.exe`,
]

function isCandidate(s: Server): boolean {
  // Already rooted, home, and purchased servers aren't hack targets; a
  // server with no money to steal (moneyMax 0) is bot-only infrastructure,
  // not something worth ranking as an upcoming hack target either.
  return (
    !s.hasAdminRights
    && s.hostname !== `home`
    && !s.purchasedByPlayer
    && (s.moneyMax ?? 0) > 0
  )
}

function printTop3(ns: NS, title: string, rows: string[]) {
  ns.print(`\n--- ${title} ---`)
  if (rows.length === 0) {
    ns.print(`None found.`)
    return
  }
  for (const row of rows) {
    ns.print(row)
  }
}

export async function main(ns: NS) {
  ns.disableLog(`ALL`)
  const serverFile = `known-servers.json`

  const servers: Server[] = JSON.parse(ns.read(serverFile))
  const playerSkill = ns.getHackingLevel()
  // "home" explicitly — port-cracking .exe programs only ever exist there
  // regardless of where this script itself is deployed, see cracker.app.ts's
  // comment on the same lookup.
  const ownedExploits = PROGRAMS.filter(p =>
    ns.fileExists(p, `home`),
  ).length
  ns.ui.openTail(ns.pid)
  ns.ui.resizeTail(900, 800)

  const candidates = servers.filter(isCandidate)

  const byLevel = [...candidates]
    .sort(
      (a, b) =>
        (a.requiredHackingSkill ?? 0) - (b.requiredHackingSkill ?? 0),
    )
    .slice(0, 3)

  const byExploits = candidates
  // Only servers already at or below the player's hacking level — the
  // level-gated ones are what the "by level" list is for, so exclude
  // them here to keep the two lists disjoint.
    .filter(s => (s.requiredHackingSkill ?? 0) <= playerSkill)
    .sort((a, b) => {
      const aNeeded = Math.max(
        0,
        (a.numOpenPortsRequired ?? 0) - ownedExploits,
      )
      const bNeeded = Math.max(
        0,
        (b.numOpenPortsRequired ?? 0) - ownedExploits,
      )
      if (aNeeded !== bNeeded)
        return aNeeded - bNeeded
      // Tie-break (e.g. several already crackable by exploit count) by
      // hacking level, so the more-immediately-useful one sorts first.
      return (
        (a.requiredHackingSkill ?? 0) - (b.requiredHackingSkill ?? 0)
      )
    })
    .slice(0, 3)

  ns.print(
    `\nPlayer hacking skill: ${playerSkill}  |  Exploits owned: ${ownedExploits}/${PROGRAMS.length}`,
  )

  printTop3(
    ns,
    `Closest to hack by level`,
    byLevel.map(
      s =>
        `${s.hostname.padEnd(20)} requires level ${
          s.requiredHackingSkill ?? 0
        } (you: ${playerSkill})`,
    ),
  )

  printTop3(
    ns,
    `Closest to hack by exploits needed`,
    byExploits.map((s) => {
      const needed = Math.max(
        0,
        (s.numOpenPortsRequired ?? 0) - ownedExploits,
      )
      return `${s.hostname.padEnd(20)} needs ${
        s.numOpenPortsRequired ?? 0
      } port(s) opened — ${needed} more exploit(s) needed`
    }),
  )
}
