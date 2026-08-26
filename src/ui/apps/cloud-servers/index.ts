import { AppDefinition } from "../../types";
import { CloudServersContent } from "./components/cloud-servers-content";

/**
 * Lets the player buy, list, and delete purchased ("cloud") servers.
 *
 * This app never references `ns.cloud.*` (or `ns.getServerMoneyAvailable`)
 * itself — Bitburner charges a script for every ns.* function it merely
 * *references* anywhere in its reachable code, whether or not that code
 * path runs, and since this file is always part of ui.app.js's bundle,
 * writing those here would permanently inflate its footprint (even
 * getServerMoneyAvailable's mere 0.1GB isn't worth paying for, since the
 * game's own overview panel already shows current money live). Instead
 * all of that work happens in three tiny one-shot scripts —
 * `daemons/cloud-list.daemon.ts`, `daemons/cloud-buy.daemon.ts`, `daemons/cloud-delete.daemon.ts`
 * — spawned via ns.exec and polled via ns.isRunning, the same pattern
 * `daemons/train.daemon.ts`/`daemons/restart.daemon.ts` use. Each daemon writes its result
 * as JSON to a fixed file, which this app reads back with ns.read (0 GB).
 * exec/kill/isRunning/getScriptRam are all already part of ui.app.js's
 * footprint via the Trainer/Programs apps, so using them here is free.
 * `home`'s used/max RAM (used below to gate launching the buy/delete
 * daemons) comes from `useHomeRam()` (see `ui/context/home-ram-context.ts`)
 * instead of this app polling ns.getServerUsedRam/getServerMaxRam on its
 * own timer.
 *
 * All state/behavior lives in `logic/use-cloud-servers.ts`; `components/`
 * is plain presentational JSX driven off that hook's return value.
 */
export const CloudServersApp: AppDefinition = {
    id: "cloud-servers",
    icon: "🖥️",
    label: "Cloud S.",
    Content: CloudServersContent,
    // Wide enough to open already showing two ~260px server cards per row
    // (see the grid in CloudServersContent) instead of the default window
    // width falling back to a single column.
    preferredWidth: 850,
    preferredHeight: 620,
    minWidth: 290,
};
