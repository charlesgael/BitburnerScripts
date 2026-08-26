import { NS } from "@ns";

const ASSETS_SCRIPT = "assets.app.js";

/**
 * Makes sure `assets.app.js` has already run in this page session before
 * the rest of `ui.app.ts` starts — specifically, that it has defined
 * `window.Notyf` (see `assets.app.ts`), the one thing `ui/utils/notify.ts`
 * actually depends on at runtime. (The custom-CSS half of what
 * `assets.app.ts` injects is cosmetic-only and isn't checked here — the UI
 * just looks slightly different without it, nothing breaks.) Nothing in
 * this script's own startup path implicitly loads `assets.app.js`, so a
 * freshly opened game — or one where the player never ran it — needs this
 * check, rather than every app silently getting a `window.Notyf` that was
 * never actually there.
 *
 * If `window.Notyf` is missing and there's enough free RAM on `home`,
 * launches `assets.app.js` and waits 2s for its `main()` (synchronous DOM
 * work, no loop) to finish before letting the caller continue. If there
 * isn't enough RAM — or the script can't be found at all — prints an
 * actionable message and returns false, so `ui.app.ts` can stop before
 * mounting anything rather than run with a silently-broken notify.ts.
 */
export async function ensureAssetsLoaded(ns: NS, win: any): Promise<boolean> {
    if (win.Notyf) return true;

    const scriptRam = ns.getScriptRam(ASSETS_SCRIPT, "home");
    if (scriptRam === 0) {
        ns.tprint(`ERROR: ${ASSETS_SCRIPT} not found — can't auto-load notyf. Deploy it, then run ui.app.js again.`);
        return false;
    }

    const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
    if (freeRam < scriptRam) {
        ns.tprint(
            `WARNING: ${ASSETS_SCRIPT} hasn't been run yet and there's not enough free RAM to launch it ` +
                `automatically (needs ${scriptRam}GB, ${freeRam.toFixed(2)}GB free on home) — free up some RAM and ` +
                `run it manually: run ${ASSETS_SCRIPT}`
        );
        return false;
    }

    const pid = ns.exec(ASSETS_SCRIPT, "home", 1);
    if (pid === 0) {
        ns.tprint(`WARNING: couldn't launch ${ASSETS_SCRIPT} — run it manually first: run ${ASSETS_SCRIPT}`);
        return false;
    }

    ns.tprint(`INFO: ${ASSETS_SCRIPT} hasn't been run yet — launched it, waiting 2s for it to finish...`);
    await ns.sleep(2000);
    return true;
}
