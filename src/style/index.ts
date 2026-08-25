import { uiScaleStyle } from "./ui-scale";
import { overviewStyle } from "./overview";

/**
 * Every style chunk injected into the shared `#custom-styles` element (see
 * `style.app.ts`). Add a new file next to `overview.ts` exporting a CSS
 * string, then list it here.
 */
export const ALL_STYLES: { name: string; css: string }[] = [
    { name: "ui-scale", css: uiScaleStyle },
    { name: "overview", css: overviewStyle },
];
