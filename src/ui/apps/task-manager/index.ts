import type { AppComponentProps, AppDefinition } from '../../types'
import type { ManagedAppDefinition } from './logic/types'
import { TaskManagerBody } from './components/task-manager-body'

export type { ManagedAppDefinition }

/**
 * Builds a task-manager app: a fixed catalog of scripts (`apps`, fixed in
 * source — see `../programs/index.ts`) can each be spawned on `home` or any
 * non-reserved purchased ("cloud") server, and every instance currently
 * running shows up in a flat "Running Tasks" list underneath, each with its
 * own Tail/Kill buttons — independent of which row spawned it. Unlike a
 * single-instance-per-app toggle, the same catalog entry can run on several
 * hosts at once; each (script, host) pair is tracked as its own task.
 *
 * This is the one app folder that doesn't itself export a fixed
 * `AppDefinition` — it's a reusable builder, instantiated once per catalog
 * (currently just the Programs app — see `../programs/index.ts`).
 *
 * "Non-reserved" cloud server means: not one of the hosts `../xp-farm/` has
 * dedicated to XP farming (tracked in `xp-farm-config.txt` via
 * `readXpFarmHosts`) — `daemons/xp-farm.daemon.ts` has exclusive control of
 * those and `ns.killall`s them the moment it claims one, so offering them
 * here would just mean whatever got spawned is killed out from under it
 * moments later. This app never references `ns.cloud.*` itself to find
 * cloud servers — see `../cloud-servers/index.ts`'s header comment for why
 * — instead reading the same `cgd/actions/cloud.ts` `cloudList` snapshot
 * the Cloud Servers app uses (via `fetchCloudList`), which conveniently already
 * reports each server's `ram`/`usedRam`, so this app has no need to poll
 * `ns.getServerUsedRam`/`getServerMaxRam` per host itself the way the old
 * per-program-row version of this app did.
 *
 * The running-task list only ever tracks instances of the scripts in
 * `apps` — filtered out of a plain `ns.ps(host)` scan across `home` plus
 * every non-reserved cloud server, for every non-`oneShot` app, each time
 * this window opens or a spawn/kill happens. Matched by filename alone
 * (not `ns.isRunning(script, host, ...args)`, which needs an exact args
 * match) since an app's args aren't always fixed up front — see
 * `logic/types.ts`'s `buildArgs` — and each match's real PID is what
 * `killTask`/`tailTask` then address directly (`ns.kill(pid)`/
 * `ns.ui.openTail(pid)`) instead of reconstructing whatever args it was
 * actually launched with. A `oneShot` app (e.g. a report that prints and
 * exits) is excluded from that scan and the task list entirely — by the
 * time a re-render could show it as a task, the script has usually already
 * exited, so tracking it would either never show anything or show a stale
 * task that can no longer actually be killed.
 *
 * Spawning on `home` uses a direct `ns.exec` (the script's already there,
 * deployed by Viteburner); spawning on a cloud server goes through
 * `ui/utils/spawn-remote.ts`'s `spawnRemote`, which `ns.scp`'s the script
 * over first through the daemon queue since a cloud server never has it
 * already. Neither path registers the spawned pid via
 * `useAddChildPid()`: these are meant to keep running in the background
 * across `ui.app.ts` restarts, not be torn down when the sidebar UI itself
 * restarts (only the short-lived one-shot orchestrator daemons —
 * `spawn-remote`/`cloud-list`/etc. — get tracked as child pids, so a
 * restart mid-operation doesn't leak one of *those*).
 *
 * All state/behavior lives in `logic/use-task-manager.ts`; `components/`
 * is plain presentational JSX driven off that hook's return value.
 */
export function createTaskManagerApp(
  id: string,
  label: string,
  icon: string,
  apps: ManagedAppDefinition[],
): AppDefinition {
  const runnableApps = apps.filter(a => !a.oneShot)
  const appByScript = Object.fromEntries(apps.map(a => [a.script, a]))

  function TaskManagerContent({ React }: AppComponentProps) {
    return TaskManagerBody({ React, apps, runnableApps, appByScript })
  }

  return {
    id,
    icon,
    label,
    Content: TaskManagerContent,
  }
}
