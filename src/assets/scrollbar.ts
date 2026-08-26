/**
 * Thin, theme-colored scrollbars for the sidebar app windows (`.un-scale` —
 * see `ui/components/app-grid.tsx`), instead of the browser/Electron
 * default full-width one. Only WebKit's `::-webkit-scrollbar` properties
 * are used (no standard equivalent exists) since Bitburner runs on
 * Chromium/Electron; `scrollbar-width` is included too as a harmless
 * no-op fallback for any other engine.
 *
 * Scoped under `.un-scale` (unique to the app grid + its floating windows)
 * rather than applied globally, so this doesn't reskin scrollbars
 * elsewhere in the game (script editor, terminal, ...).
 */
export const scrollbarStyle = `
.un-scale, .un-scale * {
    scrollbar-width: thin;
    scrollbar-color: var(--bb-theme-primary, #0f0) transparent;
}

.un-scale ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}

.un-scale ::-webkit-scrollbar-track {
    background: transparent;
}

.un-scale ::-webkit-scrollbar-thumb {
    background-color: var(--bb-theme-primary, #0f0);
    border-radius: 3px;
}

.un-scale ::-webkit-scrollbar-thumb:hover {
    background-color: var(--bb-theme-primarylight, #5f5);
}

.un-scale ::-webkit-scrollbar-corner {
    background: transparent;
}
`.trim();
