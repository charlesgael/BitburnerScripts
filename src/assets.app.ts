import { NS } from "@ns";
import { ALL_STYLES } from "./assets/index";
import { ensureStyleElement, runScriptOnce } from "./assets/utils/inject-element";
import { NOTYF_CSS, NOTYF_JS } from "./assets/vendor/notyf-lib";

/**
 * Injects this project's page-level assets into the live game window:
 * this project's own custom CSS, plus the vendored `notyf` toast library
 * (see `assets/vendor/notyf-lib.ts`) that `ui/utils/notify.ts` and app code
 * elsewhere in this repo use for every toast/notification — see CLAUDE.md's
 * note on `ui.app.ts` for why nothing should hand-roll its own toast UI
 * instead.
 *
 * - `<style id="custom-styles">` gets (re)written from every chunk in
 *   `assets/index.ts`.
 * - `<style id="notyf-styles">` gets the vendored notyf CSS.
 * - `<script id="notyf-lib">` gets the vendored notyf JS, which defines
 *   `window.Notyf` — run as a real inserted `<script>` tag (not `eval`)
 *   so it executes in true global scope regardless of this script's own
 *   module strictness; see `runScriptOnce`'s comment for why.
 *
 * Run-once, not a daemon: none of the above needs a script to keep running
 * to stay in effect — a `<style>`/`<script>` element lives in the DOM
 * independent of any script's process. Safe to re-run any time — e.g.
 * after editing a style chunk or updating the vendored notyf copy.
 *
 * Usage: `run assets.app.js`
 */
export async function main(ns: NS) {
    const doc = eval("document");

    const style = ensureStyleElement(doc, "custom-styles");
    style.textContent = ALL_STYLES.map((s) => `/* ---- ${s.name} ---- */\n${s.css}`).join("\n\n");

    const notyfStyle = ensureStyleElement(doc, "notyf-styles");
    notyfStyle.textContent = NOTYF_CSS;

    runScriptOnce(doc, "notyf-lib", NOTYF_JS);

    ns.print(
        `INFO: custom-styles updated (${ALL_STYLES.length} chunk${ALL_STYLES.length === 1 ? "" : "s"}); notyf loaded.`
    );
}
