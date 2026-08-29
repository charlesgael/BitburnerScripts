/**
 * Shared button/field classes for every app under `ui/apps/` (plus
 * `ui/components/status-panel.tsx`). Centralizes what used to be a
 * near-identical `buttonStyle`/`fieldStyle` helper duplicated per app (each
 * app's own `components/styles.ts`, `file-explorer/logic/styles.ts`, plus a
 * few more defined inline) into one CSS chunk injected once — see
 * `assets.app.ts` — so apps just apply `className="bb-btn ..."` instead of
 * importing/computing a style object.
 *
 * Colors come from the same `--bb-theme-*` custom properties every other
 * chunk here reads, so these track whatever theme (including a
 * player-imported one) is active.
 */
export const controlsStyle = `
.bb-btn {
    background: var(--bb-theme-button, #001a00);
    color: var(--bb-theme-primary, #0f0);
    border: 1px solid var(--bb-theme-primary, #0f0);
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
}

/* Uniform brightness bump rather than a second set of hardcoded hover
   colors per variant (plain vs danger, or any future one) — one rule
   covers all of them and still tracks whatever theme is active. */
.bb-btn:not(:disabled):hover {
    filter: brightness(1.3);
}

.bb-btn:disabled {
    opacity: 0.6;
    cursor: default;
}

/* Danger buttons deliberately keep the same background as a plain .bb-btn
   instead of pairing it with --bb-theme-errordark: not every player theme
   defines a meaningfully darker "error dark" shade, so that pairing could
   put --bb-theme-error text on a near-identical red background and become
   unreadable. Swapping only the border/text color keeps the danger cue
   legible under every theme. */
.bb-btn-danger {
    color: var(--bb-theme-error, #f55);
    border-color: var(--bb-theme-error, #f55);
}
.bb-btn-warn {
    color: var(--bb-theme-warn, #cc0);
    border-color: var(--bb-theme-warn, #cc0);
}

.bb-btn--sm {
    padding: 4px 8px;
    font-size: 11px;
    white-space: nowrap;
}

.bb-btn--wide {
    min-width: 70px;
}

.bb-btn--block {
    width: 100%;
}

.bb-btn--lg {
    padding: 6px 10px;
}

/* The two halves of Task Manager's split spawn button: a wide "Spawn"/
   "Run" button with a compact "▾" button (opens the cloud-server picker)
   butted up against its right edge. */
.bb-btn--split-left {
    border-radius: 4px 0 0 4px;
    border-right: none;
}

.bb-btn--split-right {
    box-sizing: border-box;
    border-radius: 0 4px 4px 0;
    padding: 0 6px;
    font-size: 10px;
}

/* Tab strip (currently just the Cloud Servers app's Purchased/Slave Nodes
   split): plain-text buttons in a row, the active one underlined in the
   theme's primary color. */
.bb-tabs {
    display: flex;
    gap: 4px;
}

.bb-tab {
    background: transparent;
    color: var(--bb-theme-primary, #0f0);
    border: none;
    border-bottom: 2px solid transparent;
    padding: 6px 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    opacity: 0.65;
}

.bb-tab:hover {
    opacity: 0.9;
}

.bb-tab--active {
    border-bottom-color: var(--bb-theme-primary, #0f0);
    opacity: 1;
}

.bb-field {
    background: var(--bb-theme-well, #0b0f0b);
    color: var(--bb-theme-primary, #0f0);
    border: 1px solid var(--bb-theme-primary, #0f0);
    border-radius: 4px;
    padding: 4px;
    font-family: inherit;
}

.bb-field--sm {
    font-size: 11px;
}

.bb-field--block {
    width: 100%;
    box-sizing: border-box;
}

/* Progress/usage bar: a track (.bb-progress) with an absolutely-positioned
   fill (.bb-progress-fill) inside it. The fill's width is still set inline
   per-render (it's a live percentage, not something CSS can know), and
   callers decide when to add --danger the same way they picked the width —
   e.g. \`usedPct > 90\`. Two tracks share this: the taller one used for a
   resource bar with a border/background of its own (RAM usage, training
   progress), and --thin for a hairline bar sitting directly on a card's own
   background (per-server RAM usage in the cloud-servers/xp-farm/share
   cards below). */
.bb-progress {
    position: relative;
    height: 14px;
    border-radius: 4px;
    background: var(--bb-theme-well, #0b0f0b);
    border: 1px solid var(--bb-theme-primarydark, #0a0);
    overflow: hidden;
}

.bb-progress--thin {
    height: 3px;
    border-radius: 2px;
    background: var(--bb-theme-backgroundprimary, #0b0f0b);
    border-color: var(--bb-theme-primary, #0f0);
}

.bb-progress-fill {
    position: absolute;
    inset: 0;
    background: var(--bb-theme-primary, #0f0);
    transition: width 0.2s ease;
}

.bb-progress-fill--danger {
    background: var(--bb-theme-error, #f55);
}

/* Reserve-zone marker overlaid on a .bb-progress track (currently just
   home's card in the Share app): a translucent blue band pinned to the
   right edge of the bar, from wherever the reserve starts through 100%.
   Sits in DOM order after .bb-progress-fill so it stays visible (via alpha)
   even when usage is high enough that the fill already reaches into the
   reserved zone underneath it. Position/width are set inline per-render
   (a live percentage), same as .bb-progress-fill's width. */
.bb-progress-guard {
    position: absolute;
    inset: 0 0 0 auto;
    background: rgba(51, 170, 255, 0.85);
    mix-blend-mode: screen;
    border-left: 1px solid rgba(180, 225, 255, 0.9);
    pointer-events: none;
}

/* The small server/host card used by the Cloud Servers, Share, and XP Farm
   apps: hostname + stat line, an optional .bb-progress--thin usage bar,
   and (Cloud Servers/XP Farm) an action button. */
.bb-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    font-size: 12px;
    background: var(--bb-theme-backgroundsecondary, #0b0f0b);
    border: 1px solid var(--bb-theme-primarydark, #0a0);
    border-radius: 6px;
    min-width: 0;
}

/* --- Everything below centralizes what was left of theme.*-driven inline
   styles across ui/apps + ui/components, one recurring pattern at a time,
   the same way .bb-btn/.bb-field/.bb-card did above. */

/* A plain theme.well-colored separator line, oriented per call site (a
   section header's bottom edge, a list row's bottom edge, an action bar's
   top edge, ...). */
.bb-divider-bottom {
    border-bottom: 1px solid var(--bb-theme-backgroundsecondary, #0b0f0b);
}

.bb-divider-top {
    border-top: 1px solid var(--bb-theme-backgroundsecondary, #0b0f0b);
}

/* Error/validation text next to a form or list. Font-size/margin still
   vary per call site, so those stay inline. */
.bb-text-error {
    color: var(--bb-theme-error, #f55);
}

.bb-text-warning {
    color: var(--bb-theme-warning, #cc0);
}

/* Popup menu (the copy-to-host list, the spawn-on-cloud-server list): a
   small floating box anchored off a button, one action per row. Position/
   anchor (top vs bottom, margin, width) stay inline per call site since
   those differ; only the shared chrome lives here. */
.bb-menu {
    background: var(--bb-theme-backgroundsecondary, #0b0f0b);
    border: 1px solid var(--bb-theme-primary, #0f0);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    overflow: hidden;
}

.bb-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    color: var(--bb-theme-primary, #0f0);
    border: none;
    border-bottom: 1px solid var(--bb-theme-backgroundsecondary, #0b0f0b);
    padding: 6px 8px;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
}

/* Selectable list row — File Explorer's host sidebar and file grid both
   highlight their current selection the same way. */
.bb-list-item {
    background: transparent;
    color: var(--bb-theme-primary, #0f0);
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
}

.bb-list-item--selected {
    background: var(--bb-theme-button, #001a00);
    border-color: var(--bb-theme-primary, #0f0);
}

/* A well-background, primarydark-bordered scroll panel (File Explorer's
   file grid). */
.bb-panel {
    background: var(--bb-theme-backgroundsecondary, #0b0f0b);
    border: 1px solid var(--bb-theme-primarydark, #0a0);
    border-radius: 4px;
}

/* The sidebar app-launcher icon grid: same backgroundprimary/primary/
   primary trio as the floating windows its icons open (.bb-window below),
   just a smaller radius and icon-stack layout. */
.bb-icon-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    background: var(--bb-theme-backgroundprimary, #0b0f0b);
    border: 1px solid var(--bb-theme-primary, #0f0);
    border-radius: 6px;
    color: var(--bb-theme-primary, #0f0);
    font-family: inherit;
    cursor: pointer;
    padding: 6px 2px;
}

.bb-icon-btn:not(:disabled):hover {
    filter: brightness(1.3);
}

.bb-icon-btn:disabled {
    cursor: default;
    opacity: 0.4;
}

/* The floating app window shell + its title bar. */
.bb-window {
    background: var(--bb-theme-backgroundprimary, #0b0f0b);
    border: 1px solid var(--bb-theme-primary, #0f0);
    border-radius: 8px;
    color: var(--bb-theme-primary, #0f0);
    font-family: Consolas, monospace;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.bb-window-titlebar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--bb-theme-primarydark, #0a0);
    cursor: move;
    font-weight: bold;
    user-select: none;
    flex-shrink: 0;
}

/* Transparent icon-only buttons in the window title bar (Refresh/Close). */
.bb-icon-link {
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    color: var(--bb-theme-primary, #0f0);
}

.bb-icon-link--danger {
    color: var(--bb-theme-error, #f55);
}

/* Bitburner's own stylesheet sets white-space: nowrap broadly across the
   sidebar these apps are hosted in. Any text block that can run longer
   than a couple words — error messages especially — needs this to opt
   back into wrapping, otherwise the line quietly overflows past the
   window's edge instead of wrapping inside it. */
.bb-wrap {
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
}
`.trim()
