/* eslint-env node */
// import commonjs from "@rollup/plugin-commonjs";
import commonjs from '@rollup/plugin-commonjs';
import * as esbuild from 'esbuild';
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
        plugins: [
            commonjs(), // Seamlessly translates CommonJS (module.exports) to ESM

            // 2. The Universal Node Modules Resolver Plugin
            {
              name: 'force-compile-node-modules-inline',
              // We use 'transform' which intercepts the exact file text right before viteburner syncs it
              async transform(code, id) {
                // Only target your local source script files
                if (!id.match(/\.[jt]s$/) || id.includes('node_modules')) return null;

                // Target: import arg from 'arg' or import anything from 'bare-package'
                // Does NOT match local imports like './utils.js' or '../math.ts'
                const importRegex = /import\s+([\w\s*{},]+)\s+from\s+['"]([^./][\w\-_/]+)['"];?/g;
                let match;
                let finalCode = code;

                while ((match = importRegex.exec(code)) !== null) {
                  const [fullMatch, variableName, packageName] = match;

                  try {
                    // Locate the exact file on your machine
                    const resolvedPath = require.resolve(packageName);

                    // Compile the library into a single self-contained variable using esbuild
                    const result = await esbuild.build({
                      entryPoints: [resolvedPath],
                      bundle: true,
                      format: 'iife',               // Wraps the code cleanly to prevent scope bleeding
                      globalName: '__inlined_lib__', // Temporary internal attachment variable
                      write: false,                 // Compiles directly to memory
                      minify: false,
                    });

                    const bundleText = result.outputFiles[0].text;

                    // Generate the code to replace the import line completely
                    const inlineCode = `
/* --- Inlined ${packageName} --- */
const ${variableName.trim()} = (() => {
    ${bundleText}
    return typeof __inlined_lib__ !== 'undefined' && __inlined_lib__.default
    ? __inlined_lib__.default
    : __inlined_lib__;
})();
/* --- End Inlined ${packageName} --- */
`;

                    // Completely delete the 'import ...' line and replace it with our code block
                    finalCode = finalCode.replace(fullMatch, inlineCode);

                  } catch (e) {
                    // Ignore game specific globals (like 'ns') or special aliases
                    continue;
                  }
                }

                return {
                  code: finalCode,
                  map: null
                };
              }
            }
        ],
        build: {
            rollupOptions: {
                external(id) {
                    // Keep your internal files separated inside Bitburner
                    if (id.startsWith('.') || id.startsWith('/') || id.startsWith('@') || id.includes('src/')) {
                      return true;
                    }

                    // Return false for any bare import (like 'arg', 'lodash', etc.)
                    // This forces Vite to bundle them cleanly into your script!
                    return false;
                }
            }
        }
    };

    if (env?.command === "build") {
        // viteburner's own plugin only `apply`s in "serve" mode, so the
        // `viteburner` config below is inert here — this path is plain
        // Vite/Rollup, producing dist/setup.js instead of a live push. See
        // plugin/setup-bundle.ts for how that file actually gets built.
        return {
            ...base,
            plugins: [
                setupBundlePlugin(srcDir)
            ],
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
