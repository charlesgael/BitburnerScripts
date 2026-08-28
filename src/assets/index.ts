import { controlsStyle } from './controls'
import { overviewStyle } from './overview'
import { scrollbarStyle } from './scrollbar'
import { uiScaleStyle } from './ui-scale'

/**
 * Every style chunk injected into the shared `#custom-styles` element (see
 * `assets.app.ts`). Add a new file next to `overview.ts` exporting a CSS
 * string, then list it here.
 */
export const ALL_STYLES: { name: string, css: string }[] = [
  { name: 'ui-scale', css: uiScaleStyle },
  { name: 'overview', css: overviewStyle },
  { name: 'scrollbar', css: scrollbarStyle },
  { name: 'controls', css: controlsStyle },
]
