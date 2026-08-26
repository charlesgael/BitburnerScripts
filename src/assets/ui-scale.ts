/**
 * Shrinks the entire game UI via CSS `zoom` rather than `font-size`: most
 * of Bitburner's own layout — padding, icon sizes, sidebar width, button
 * chrome, ... — is set in fixed px, not relative units, so scaling only
 * the root font-size wouldn't shrink any of that; only text that happens
 * to use em/rem would move, and everything else would stay full size.
 *
 * `zoom` rescales the whole rendered page the way browser zoom-out does:
 * it actually changes layout, so more of the game fits in the same
 * window, instead of just shrinking visually and leaving the freed space
 * empty the way `transform: scale()` would. It's a Chromium/Electron-only
 * property — which is exactly what Bitburner runs on.
 *
 * 0.8 = 80% scale, i.e. compensates for "everything's ~25% too big"
 * (1 / 1.25 = 0.8). Tune this one number to taste.
 */
export const uiScaleStyle = `
html {
    zoom: 0.8;
}

#root {
    height: 100%;
}

#root > .MuiBox-root {
    align-items: stretch;
}

#root .MuiBox-root:has(#terminal) > div:not(.MuiBox-root) {
    height: 100%;
}

.MuiDrawer-root:has(#sidebar-extra-hook-0),
.MuiDrawer-paper:has(#sidebar-extra-hook-0){
    width: 280px;
}

div[role="tooltip"],
.un-scale {
    zoom: 1.2;
}
`.trim();
