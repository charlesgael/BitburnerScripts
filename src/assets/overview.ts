/**
 * Restyles the sidebar character-overview stats table (HP / Money / Hack /
 * Str / Def / Dex / Agi / Cha, their XP bars, and the current-work status +
 * Focus button underneath).
 *
 * The game doesn't put an id or class on the table itself, only on a few
 * cells inside it (`#overview-hp-hook`, `#overview-money-hook`, ...), so
 * this is scoped with `table:has(#overview-hp-hook)` instead of a class —
 * that also keeps it from leaking onto every other MUI table in the game
 * (contracts, factions, hacknet, ...), which all share the same generic
 * `.MuiTable-root` class.
 *
 * The two `[class*="-workHeader"]` / `[class*="-workSubtitles"]` selectors
 * lean on a quirk of Bitburner's own build: the hashed Emotion class the
 * game generates for those cells keeps a readable suffix from the source
 * (`css-yxlu3h-workHeader`, `css-1u6owlx-workSubtitles`) even though the
 * hash prefix changes across builds — matching on that suffix survives a
 * game update that a full class-name match wouldn't.
 *
 * Colors come from the same `--bb-theme-*` custom properties the sidebar
 * app grid uses (see `ui/utils/theme.ts`), so this matches whatever theme
 * is active instead of only looking right under the default one.
 *
 * The XP bars are colored per-stat by row position (see the comment above
 * those rules): CSS has no "previous sibling" selector, so there's no way
 * to look back from a bar's row to the labeled stat row directly above it
 * — only forward/descendant relationships exist, `:has()` included.
 */
export const overviewStyle = `
.MuiPaper-root:has(#overview-hp-hook) {
    width: 280px;
}

.MuiPaper-root:has(#overview-hp-hook) > div:nth-child(1) {
    border-bottom: 1px solid rgb(68, 68, 68) !important;
}

.MuiPaper-root:has(#overview-hp-hook) > div:nth-child(2) {
    border-top: none !important;
    margin: 0px;
}

table:has(#overview-hp-hook) {
    border-collapse: collapse;
    display: block;
}

tbody:has(#overview-hp-hook) {
    display: block !important;
}

table:has(#overview-hp-hook) tr {
    display: flex;
    justify-content: center;
}

table:has(#overview-hp-hook) th,
table:has(#overview-hp-hook) td {
    padding: 3px 8px !important;
    border: none !important;
}

table:has(#overview-hp-hook) th:nth-child(3),
table:has(#overview-hp-hook) td:nth-child(3),
table:has(#overview-hp-hook) th:has(#overview-extra-hook-0),
table:has(#overview-hp-hook) th:has(#overview-extra-hook-1) {
    padding: 0 !important;
}

table:has(#overview-hp-hook) th:nth-child(1),
table:has(#overview-hp-hook) td:nth-child(1) {
    flex: 1;
}

table:has(#overview-hp-hook) th:has(.MuiLinearProgress-root) {
    padding-left: 4px !important;
    padding-right: 4px !important;
}

table:has(#overview-hp-hook) .MuiTypography-root {
    font-family: ui-monospace, "SF Mono", Consolas, "Courier New", monospace;
    font-variant-numeric: tabular-nums;
    font-size: 16px;
}

table:has(#overview-hp-hook) .MuiLinearProgress-root {
    height: 1px !important;
    border-radius: 0 !important;
    background-color: var(--bb-theme-well, #0b0f0b) !important;
}

table:has(#overview-hp-hook) .MuiLinearProgress-bar {
    border-radius: 0 !important;
    background-color: var(--bb-theme-primary, #0f0) !important;
}

/* Per-stat bar color, by fixed row position: 1 HP, 2 Money, 3 Hack,
   4 [Hack bar], 5 Str, 6 [Str bar], 7 Def, 8 [Def bar], 9 Dex,
   10 [Dex bar], 11 Agi, 12 [Agi bar], 13 Cha, 14 [Cha bar]. If Bitburner
   ever reorders this table these are the rules to renumber. Str/Def/Dex/
   Agi share one color because the theme itself only defines one "combat"
   color for all four, not one each. */
table:has(#overview-hp-hook) tr:nth-child(4) .MuiLinearProgress-bar {
    background-color: var(--bb-theme-hack, #8ccf27) !important;
}

table:has(#overview-hp-hook) tr:nth-child(6) .MuiLinearProgress-bar,
table:has(#overview-hp-hook) tr:nth-child(8) .MuiLinearProgress-bar,
table:has(#overview-hp-hook) tr:nth-child(10) .MuiLinearProgress-bar,
table:has(#overview-hp-hook) tr:nth-child(12) .MuiLinearProgress-bar {
    background-color: var(--bb-theme-combat, #faffdf) !important;
}

table:has(#overview-hp-hook) tr:nth-child(14) .MuiLinearProgress-bar {
    background-color: var(--bb-theme-cha, #a671d1) !important;
}

table:has(#overview-hp-hook) [class*="-workHeader"] {
    font-weight: 600;
    color: var(--bb-theme-primary, #0f0);
}

table:has(#overview-hp-hook) [class*="-workSubtitles"] {
    color: var(--bb-theme-secondary, #888);
    font-size: 12px;
}

table:has(#overview-hp-hook) .MuiButton-root {
    font-family: ui-monospace, "SF Mono", Consolas, "Courier New", monospace;
    text-transform: none;
    color: var(--bb-theme-primary, #0f0) !important;
    border: 1px solid var(--bb-theme-primary, #0f0);
    border-radius: 4px;
    padding: 2px 10px !important;
    min-width: 0 !important;
}
`.trim();
