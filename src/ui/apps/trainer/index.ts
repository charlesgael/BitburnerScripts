import type { AppDefinition } from '../../types'
import { TrainerContent } from './components/trainer-content'

/**
 * This app is a thin launcher — it never calls ns.singularity.* itself.
 * Training actually happens in `daemons/train.daemon.ts`, spawned/killed via
 * ns.exec/ns.kill. See that file for why: universityCourse/gymWorkout/
 * stopAction/isBusy are collectively ~88GB, and Bitburner charges a script
 * for every ns.* function it merely references, reachable or not — calling
 * them directly from here would permanently add that to ui.app.ts's RAM
 * footprint, since it's always running. exec/kill/isRunning/getPlayer/ps
 * cost a few cents on the GB by comparison. `home`'s used/max RAM comes
 * from `useHomeRam()` (see `ui/context/home-ram-context.ts`) rather than
 * this app polling ns.getServerUsedRam/getServerMaxRam on its own timer.
 *
 * All state/behavior lives in `logic/use-trainer.ts`; `components/` is
 * plain presentational JSX driven off that hook's return value.
 */
export const TrainerApp: AppDefinition = {
  id: 'trainer',
  icon: '💪',
  label: 'Trainer',
  Content: TrainerContent,
  minRam: 90.1,
  // Same Source-File-4-or-BitNode-4 gate `singularityAvailable` wraps for
  // `ManagedAppDefinition` consumers (see `ui/apps/programs/index.ts`) that
  // have no `minSourceFile` field of their own — `AppDefinition` does, and
  // now honors the same BitNode fallback (see `hasSourceFile` in
  // `ui/utils/app-availability.ts`), so this expresses it directly instead
  // of going through that wrapper.
  minSourceFile: { n: 4, lvl: 1 },
}
