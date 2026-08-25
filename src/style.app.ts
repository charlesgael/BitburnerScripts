import { NS } from "@ns";
import { ensureStyleElement } from "./style/utils/inject-style";
import { ALL_STYLES } from "./style/index";

/**
 * Injects this project's custom CSS into the live game page: creates a
 * `<style id="custom-styles">` element in `<head>` if one doesn't already
 * exist, then (re)writes its content from every chunk in `style/index.ts`.
 *
 * Run-once, not a daemon: a `<style>` element lives in the DOM independent
 * of any script's process, so nothing needs to keep running to keep the
 * styling applied. Safe to re-run any time — e.g. after editing a style
 * chunk — since `ensureStyleElement` reuses the existing element instead
 * of creating a duplicate.
 *
 * Usage: `run style.app.js`
 */
export async function main(ns: NS) {
    const doc = eval("document");

    const style = ensureStyleElement(doc, "custom-styles");
    style.textContent = ALL_STYLES.map((s) => `/* ---- ${s.name} ---- */\n${s.css}`).join("\n\n");

    ns.tprint(`INFO: custom-styles updated (${ALL_STYLES.length} chunk${ALL_STYLES.length === 1 ? "" : "s"}).`);
}
