/* eslint-env node */
import { resolve } from "path";
import { defineConfig } from "viteburner";

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
            "/src": resolve(__dirname, "src"),
        },
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
    },
    viteburner: {
        watch: [
            {
                pattern: "src/**/*.{js,ts,tsx}",
                transform: true,
                // Viteburner's own default location function only strips a
                // trailing `.ts` (`file.replace(/\.ts$/, ".js")`) — that
                // regex requires the string to end in exactly "ts", so it
                // silently no-ops on `.tsx` (ends in "tsx"), leaving the
                // extension untouched. Deployed in-game files must be
                // `.js` (see CLAUDE.md), so a `.tsx` file — and any sibling
                // file's compiled import of it — was left pointing at a
                // "*.tsx" path the game can't find. Same override as the
                // default otherwise, just with a regex that also matches
                // `.tsx`.
                //
                // Must return an object with `filename`, not a bare string:
                // internally, a string return from this function is treated
                // as a `server` (hostname) override, not a filename one —
                // `{ filename: defaultFilename, server: "home", ...(typeof r
                // === "string" ? { server: r } : r) }`. Returning the
                // computed name as a plain string got it spread into
                // `server` instead, breaking uploads for *every* file (not
                // just `.tsx` ones) with "Invalid hostname" — `filename`
                // silently kept using the buggy default the whole time.
                location: (file) => ({ filename: file.replace(/^src\//, "").replace(/\.tsx?$/, ".js") }),
            },
            { pattern: "src/**/*.{script,txt}" },
        ],
        sourcemap: "inline",
    },
});
