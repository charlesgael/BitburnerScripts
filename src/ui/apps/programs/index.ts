import type { AppDefinition } from '../../types'
import { singularityAvailable } from '../../utils/singularity-availability'
import { readSlaveNodes } from '../../utils/slave-nodes'
import { createTaskManagerApp } from '../task-manager'

/**
 * The actual sidebar-launchable "Programs" app — which .js files it can
 * spawn, and what to call them, is fixed here in code (see
 * `../task-manager/index.ts` for the generic, reusable task-manager part:
 * spawning any of these on `home` or a non-reserved cloud server, and the
 * flat running-tasks list with per-task Tail/Kill).
 *
 * `flooder.app.js` gets `buildArgs` instead of a fixed `args`: it needs the
 * current slave-node hostnames (see `ui/utils/slave-nodes.ts`) so it never
 * hijacks a server the player has designated for Programs/XP Farm/Share,
 * and that list can change at any time from the Cloud Servers app — a
 * fixed `args` array baked in here could only ever reflect whatever it was
 * at build time. It's also `singleInstance`: it floods every reachable
 * server it can see from wherever it runs, so a second instance elsewhere
 * would just fight the first one over the same targets.
 *
 * `cracker.app.js`, `flooder.app.js`, `backdoor.lite.app.js`,
 * `backdoor.app.js`, and `next-targets.app.js` all `requires:
 * ["netmapper.app.js"]` — they each read `known-servers.json`, which
 * only exists on a host where `netmapper.app.js` is (or has been) running,
 * so the task manager won't offer a host as a spawn target for any of them
 * until Netmapper is already running there too (see
 * `../task-manager/logic/use-task-manager.ts`'s `hostOptions`).
 *
 * `backdoor.app.js` also sets `isAvailable: singularityAvailable` (see
 * `ui/utils/singularity-availability.ts`) — it's entirely
 * `ns.singularity.connect`/`installBackdoor` calls under the hood, same
 * Source-File-4-or-BitNode-4 gate as the Trainer app, so it's left out of
 * the Spawn list entirely without that access rather than offered and
 * failing at spawn time.
 */
export const ProgramsApp: AppDefinition = createTaskManagerApp('programs', 'Programs', '🚀', [
  { script: 'netmapper.app.js', label: 'Netmapper' },
  {
    script: 'cracker.app.js',
    label: 'Cracker',
    requires: ['netmapper.app.js'],
    singleInstance: true,
  },
  {
    script: 'flooder.app.js',
    label: 'Flooder',
    buildArgs: async ns => [
      ...(await readSlaveNodes(ns)),
      // We do not want to kill the daemon
      await ns._getHostname(),
    ],
    singleInstance: true,
    excludes: ['floodshare.app.js'],
    requires: ['netmapper.app.js'],
  },
  {
    script: 'floodshare.app.js',
    label: 'ShareRAM',
    buildArgs: async ns => [
      ...(await readSlaveNodes(ns)),
      // We do not want to kill the daemon
      await ns._getHostname(),
    ],
    singleInstance: true,
    excludes: ['flooder.app.js'],
    requires: ['netmapper.app.js'],
  },
  {
    script: 'backdoor.lite.app.js',
    label: 'Backdoor Lister',
    oneShot: true,
    requires: ['netmapper.app.js'],
    // Inverted from `singularityAvailable`: this row is the point when
    // you *don't* have Singularity yet (backdoor.app.js below covers
    // the case where you do). `!singularityAvailable(ctx)` doesn't work
    // for this — its return type is `true | string`, and a non-empty
    // reason string is truthy, so negating it is `false` in both the
    // available and unavailable case. Comparing against `=== true`
    // instead reads the tri-state value correctly.
    isAvailable: ctx =>
      singularityAvailable(ctx) === true ? 'Use Backdoor Installer instead — Singularity is available.' : true,
  },
  {
    script: 'backdoor.app.js',
    label: 'Backdoor Installer',
    requires: ['netmapper.app.js'],
    isAvailable: singularityAvailable,
    singleInstance: true,
  },
  {
    script: 'next-targets.app.js',
    label: 'Next Targets',
    oneShot: true,
    requires: ['netmapper.app.js'],
  },
  {
    script: 'darknet.app.js',
    label: 'DNet Autoprober',
    singleInstance: true,
  },
  {
    script: 'hacknet.app.js',
    label: 'Hacknet',
    singleInstance: true,
  },
  // {
  //   script: 'contracts.app.js',
  //   label: 'Contracts',
  //   singleInstance: true,
  // },
])

export const TradeProgramsApp: AppDefinition = createTaskManagerApp('trading-apps', 'Trading', '🗠', [
  {
    script: 'stock-reader.app.js',
    label: 'Reader',
    singleInstance: true,
    excludes: ['stock-trader.app.js', 'stock-liquidator.app.js'],
  },
  {
    script: 'stock-trader.app.js',
    label: 'Trader',
    singleInstance: true,
    excludes: ['stock-reader.app.js', 'stock-liquidator.app.js'],
  },
  {
    script: 'stock-liquidator.app.js',
    label: 'Liquidator',
    singleInstance: true,
    excludes: ['stock-reader.app.js', 'stock-trader.app.js'],
  },
])
