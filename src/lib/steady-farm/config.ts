/**
 * Shared constants for the Steady Farm feature: a self-sustaining,
 * offline-safe HWGW alternative to Money Farm (see
 * `daemons/steady-farm.daemon.ts`'s own header comment for the full
 * design).
 *
 * No config file — unlike `xp-farm-config.ts`/`money-farm-config.ts`, a
 * dedicated host list here isn't a shared, live-editable file at all: each
 * daemon instance takes its own hostnames as positional launch arguments,
 * fixed for that instance's lifetime (see the daemon's own header comment
 * for why). This is what lets several instances, each pinned to a
 * different `--target`, run against disjoint slices of the same fleet at
 * once without any runtime partition/claim negotiation between them — the
 * player decides the split at launch time, the same deliberate,
 * explicit-assignment principle every other mutual-exclusion boundary in
 * this project already relies on (never automatic sharing).
 */
export const STEADY_FARM_DAEMON_SCRIPT = 'daemons/steady-farm.daemon.js'
export const STEADY_FARM_DAEMON_HOST = 'home'

/**
 * The three worker scripts every managed host runs — the exact same files
 * Money Farm and XP Farm already use, referenced from here so every
 * consumer shares one copy of the filenames.
 */
export const STEADY_FARM_HACK_SCRIPT = 'daemons/hack.daemon.js'
export const STEADY_FARM_GROW_SCRIPT = 'daemons/grow.daemon.js'
export const STEADY_FARM_WEAKEN_SCRIPT = 'daemons/weaken.daemon.js'
