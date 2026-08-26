/* eslint-env node */
import { resolve } from "path";
import type { ConfigEnv } from "vite";
import type { ViteBurnerUserConfig } from "viteburner";
import { setupBundlePlugin, walk } from "./plugin/setup-bundle";

const srcDir = resolve(__dirname, "src");

export default function (env: ConfigEnv): ViteBurnerUserConfig {
    const base: ViteBurnerUserConfig = {
        resolve: {
            alias: {
                "@": srcDir,
                "/src": srcDir,
            },
        },
    };

    if (env.command === "build") {
        // viteburner's own plugin only `apply`s in "serve" mode, so the
        // `viteburner` config below is inert here — this path is plain
        // Vite/Rollup, producing dist/setup.js instead of a live push. See
        // plugin/setup-bundle.ts for how that file actually gets built.
        return {
            ...base,
            plugins: [setupBundlePlugin(srcDir)],
            build: {
                outDir: "dist",
                emptyOutDir: true,
                minify: false,
                target: "esnext",
                rollupOptions: {
                    input: walk(srcDir, (rel) => /\.(js|ts|tsx)$/.test(rel)),
                    // Vite's default build config sets this to `false`, which
                    // Rollup rejects outright when `output.preserveModules`
                    // is on.
                    preserveEntrySignatures: "strict",
                    output: {
                        preserveModules: true,
                        preserveModulesRoot: srcDir,
                        entryFileNames: "[name].js",
                        format: "es",
                    },
                },
            },
        };
    }

    // `npm start` (viteburner dev server) — unchanged, just the live push.
    return {
        ...base,
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
    };
}
