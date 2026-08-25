import { NS } from "@ns";
import { ReactGlobals } from "../types";

/**
 * Grabs the game's exposed React/ReactDOM globals via the classic
 * `eval("window")` trick — the standard, RAM-free way to reach the DOM/React
 * from a Netscript script. Returns null (after printing an error) if
 * React/ReactDOM aren't available.
 */
export function getReactGlobals(ns: NS): ReactGlobals | null {
    const doc = eval("document");
    const win = eval("window");
    const React = win.React;
    const ReactDOM = win.ReactDOM;

    if (!React || !ReactDOM) {
        ns.tprint("ERROR: Could not access React/ReactDOM globals.");
        return null;
    }

    return { doc, win, React, ReactDOM };
}
