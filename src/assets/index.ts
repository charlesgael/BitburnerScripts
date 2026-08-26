import { uiScaleStyle } from "./ui-scale";
import { overviewStyle } from "./overview";
import { scrollbarStyle } from "./scrollbar";
import { notyfFont } from "./notyf-font";
import { controlsStyle } from "./controls";

/**
 * Every style chunk injected into the shared `#custom-styles` element (see
 * `assets.app.ts`). Add a new file next to `overview.ts` exporting a CSS
 * string, then list it here.
 *
 * This is only for this project's own styling — the vendored third-party
 * assets under `vendor/` (e.g. `notyf-lib.ts`) are injected separately by
 * `assets.app.ts`, into their own elements, not folded in here.
 */
export const ALL_STYLES: { name: string; css: string }[] = [
    { name: "ui-scale", css: uiScaleStyle },
    { name: "overview", css: overviewStyle },
    { name: "scrollbar", css: scrollbarStyle },
    { name: "notyf", css: notyfFont },
    { name: "controls", css: controlsStyle },
];
