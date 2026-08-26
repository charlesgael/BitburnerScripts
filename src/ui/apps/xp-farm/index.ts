import { AppDefinition } from "../../types";
import { XpFarmContent } from "./components/xp-farm-content";

/**
 * Lets the player dedicate purchased ("cloud") servers to grinding hacking
 * XP: toggling a server here just writes it in/out of `xp-farm-config.txt`
 * (via `readXpFarmHosts`/`writeXpFarmHosts` — both 0 GB, see that file's
 * header comment) and makes sure `daemons/xp-farm.daemon.ts` is running to act
 * on it. Everything RAM-heavy — picking a target, splitting grow/weaken
 * threads, actually launching them — happens entirely in that daemon; this
 * app never calls `ns.grow`/`ns.weaken`/`ns.getServer`/`ns.scan`/`ns.killall`
 * itself, for the same reason the Cloud Servers/Share apps offload their own
 * heavy calls (see those apps' header comments, and the RAM-cost model
 * section in CLAUDE.md).
 *
 * Deliberately no RAM bar (unlike the Programs app this otherwise mirrors):
 * a dedicated server's RAM is entirely the daemon's business, not something
 * spawning one more thing from here would ever compete with.
 *
 * The daemon is a self-managing background process, not something this app
 * starts/stops directly the way Share's daemon is: enabling a server just
 * ensures it's running (launches it if it isn't — `ns.isRunning` first, so
 * this never launches a second copy even if every row gets toggled on in a
 * row), and disabling the last one doesn't kill it — it notices its config
 * list went empty on its own next cycle and exits by itself. Its pid is
 * deliberately never passed to `useAddChildPid()` (same choice as
 * `../share/`): it's meant to keep running across a UI restart, not die
 * with this window or with ui.app.js itself.
 *
 * Once a server is dedicated, `../task-manager/` (the Programs app)
 * excludes it from its own cloud-server dropdown — the daemon has
 * exclusive control (it `ns.killall`s the host the moment it claims it, and
 * again the moment it's released) and Programs launching something there
 * too would just get killed out from under it.
 *
 * All state/behavior lives in `logic/use-xp-farm.ts`; `components/` is
 * plain presentational JSX driven off that hook's return value.
 */
export const XpFarmApp: AppDefinition = {
    id: "xp-farm",
    icon: "🏋️",
    label: "XP Farm",
    Content: XpFarmContent,
    // Wide enough to open already showing two ~260px server cards per row —
    // same reasoning as the Cloud Servers app's own preferredWidth.
    preferredWidth: 850,
    preferredHeight: 640,
    minWidth: 550,
    minHeight: 400,
};
