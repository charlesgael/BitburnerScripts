/**
 * Bitburner exposes its active color theme (Options > Appearance > Themes —
 * including any theme the player imports) as CSS custom properties on the
 * page, e.g. `--bb-theme-primary`. Reading colors through those instead of
 * hardcoding hex values is what makes this UI match whatever theme is
 * active, rather than only looking right under the default one.
 *
 * Each token falls back to roughly the hardcoded value this UI used before,
 * so nothing breaks if a name is ever renamed or a variable is missing.
 * Add more tokens here as apps need them — see the full list of
 * `--bb-theme-*` names by inspecting `:root` in devtools with the game
 * open.
 */
export const theme = {
    primary: "var(--bb-theme-primary, #0f0)",
    primaryLight: "var(--bb-theme-primarylight, #5f5)",
    primaryDark: "var(--bb-theme-primarydark, #0a0)",
    secondary: "var(--bb-theme-secondary, #888)",
    error: "var(--bb-theme-error, #f55)",
    errorDark: "var(--bb-theme-errordark, #1a0000)",
    well: "var(--bb-theme-well, #0b0f0b)",
    backgroundPrimary: "var(--bb-theme-backgroundprimary, #0b0f0b)",
    backgroundSecondary: "var(--bb-theme-backgroundsecondary, #0b0f0b)",
    button: "var(--bb-theme-button, #001a00)",
} as const;

/**
 * Bitburner's own stylesheet sets `white-space: nowrap` broadly across the
 * sidebar these apps are hosted in. Any text block that can run longer than
 * a couple words — error messages especially — needs this spread into its
 * style to opt back into wrapping, otherwise the line quietly overflows
 * past the window's edge instead of wrapping inside it.
 */
export const wrapText = {
    whiteSpace: "normal",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
} as const;
