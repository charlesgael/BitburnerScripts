import { NS } from "@ns";

/**
 * Restarts the sidebar UI: waits briefly, then starts a fresh ui.app.js.
 *
 * Split into its own script rather than having ui.app.ts call ns.spawn/
 * ns.run itself — same reasoning as daemons/train.daemon.ts: Bitburner charges a
 * script for every ns.* function it merely references, whether that code
 * path runs or not, so putting a rarely-used restart call directly in
 * ui.app.ts would permanently add to its RAM footprint since it's always
 * running. Here, that cost only applies for the ~2s this daemon is alive.
 * (ns.exec is already part of ui.app.js's footprint via the Programs app,
 * so launching *this* daemon from ui.app.ts is free by comparison.)
 *
 * The delay gives the old ui.app.js instance time to fully unmount — DOM
 * containers, injected style, child scripts, all via its own ns.atExit —
 * before a new instance tries to mount into the same sidebar hooks.
 */
export async function main(ns: NS) {
    await ns.sleep(2000);
    ns.run("ui.app.js");
}
