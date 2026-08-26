import { NS } from "@ns";
import { ALL_STYLES } from "./assets/index";
import { ensureStyleElement } from "./assets/utils/inject-element";

/**
 * Injects this project's own page-level CSS into the live game window:
 * creates/reuses a `<style id="custom-styles">` element in `<head>` and
 * fills it from every chunk in `assets/index.ts`.
 *
 * Notifications/toasts do *not* live here — see `ui/utils/notify.ts`'s
 * header comment: Bitburner already exposes a native `ns.toast()` call for
 * that, so there's nothing to vendor or inject for it.
 *
 * Run-once, not a daemon: a `<style>` element lives in the DOM independent
 * of any script's process, so nothing needs to keep running afterward. Safe
 * to re-run any time — e.g. after editing a style chunk.
 *
 * Usage: `run assets.app.js`
 */
export async function main(ns: NS) {
    const doc = eval("document");

    const style = ensureStyleElement(doc, "custom-styles");
    style.textContent = ALL_STYLES.map((s) => `/* ---- ${s.name} ---- */\n${s.css}`).join("\n\n");

    ns.print(`INFO: custom-styles updated (${ALL_STYLES.length} chunk${ALL_STYLES.length === 1 ? "" : "s"}).`);
}
