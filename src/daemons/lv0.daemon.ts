import type { NS } from '@ns'
import { runTieredDaemon } from '../cgd/daemon-core'
import { makeStatPusher } from '../cgd/stat-push'
import { BASELINE_STAT_PROVIDERS } from '../cgd/stats'

/**
 * Tier 0: the cheapest daemon that still holds `window.cgd.daemon` — no
 * caller-facing methods at all (`isPathAllowed` already refuses everything
 * at tier 0 before ever consulting an allow-list, so this passes an empty
 * one), just the handoff/registration protocol every tier shares via
 * `cgd/daemon-core.ts` plus the baseline stat push (home RAM/karma/hacknet
 * — see `cgd/stats.ts`'s header comment on why tier 0 still computes these
 * despite having zero caller-facing dispatch). Exists so `start.ts` (a
 * later phase) always has *something* minimal to fall back to, and so "a
 * daemon is running" and "a daemon can actually do anything" are
 * independently observable states.
 *
 * Usage: `run daemons/lv0.daemon.js`
 */
export const TIER_0_METHODS: readonly string[] = [
  // --- UserInterface
  'ui.closeTail',
  'ui.getGameInfo',
  'ui.getStyles',
  'ui.getTheme',
  'ui.moveTail',
  'ui.openTail',
  'ui.renderTail',
  'ui.resetStyles',
  'ui.resetTheme',
  'ui.resizeTail',
  'ui.setStyles',
  'ui.setTailFontSize',
  'ui.setTailMinimized',
  'ui.setTailTitle',
  'ui.setTheme',
  'ui.windowSize',

  // --- Gang
  'gang.getBonusTime',
  'gang.getEquipmentNames',
  'gang.getTaskNames',
  'gang.inGang',
  'gang.nextUpdate',
  'gang.renameMember',

  // --- Stock
  'stock.getBonusTime',
  'stock.getConstants',
  'stock.nextUpdate',

  // --- Bladeburner
  'bladeburner.getBlackOpNames',
  'bladeburner.getBonusTime',
  'bladeburner.getContractNames',
  'bladeburner.getGeneralActionNames',
  'bladeburner.getOperationNames',
  'bladeburner.getSkillNames',
  'bladeburner.inBladeburner',
  'bladeburner.nextUpdate',

  // --- CodingContrats
  'codingcontract.getContractTypes',

  // --- Cloud
  'cloud.renameServer',

  // --- GoAnalysis
  'go.analysis.getStats',
  'go.analysis.resetStats',

  // --- Stranek
  'stanek.clearGift',
  'stanek.fragmentDefinitions',

  // --- Infiltration
  'infiltration.getPossibleLocations',

  // --- Corporation
  'corporation.canCreateCorporation',
  'corporation.getBonusTime',
  'corporation.getConstants',
  'corporation.hasCorporation',
  'corporation.nextUpdate',

  // --- heart
  'heart.break',

  // --- bare
  'alert',
  'asleep',
  'atExit',
  'clear',
  'clearLog',
  'clearPort',
  'disableLog',
  'dynamicImport',
  'enableLog',
  'exit',
  'flags',
  'getFileMetadata',
  'getFunctionRamCost',
  'getPortHandle',
  'getScriptLogs',
  'getScriptName',
  'isLogEnabled',
  'mv',
  'nextPortWrite',
  'peek',
  'print',
  'printf',
  'printRaw',
  'prompt',
  'ramOverride',
  'read',
  'readPort',
  'self',
  'sleep',
  'sprintf',
  'toast',
  'tprint',
  'tprintf',
  'tprintRaw',
  'tryWritePort',
  'vsprintf',
  'wget',
  'write',
  'writePort',

  // --- Used for stats
  'getServerMaxRam',
  'getServerUsedRam',
  'hacknet.getNodeStats',
  'hacknet.numNodes',
  'ps',
]

export async function main(ns: NS): Promise<void> {
  await runTieredDaemon(ns, 0, 'daemons/lv0.daemon.js', new Set(TIER_0_METHODS), {
    onIdle: makeStatPusher(BASELINE_STAT_PROVIDERS),
  })
}
