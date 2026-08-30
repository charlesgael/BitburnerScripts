import type { ConfigEnv } from 'vite'
import type { ViteBurnerUserConfig } from 'viteburner'
// import commonjs from "@rollup/plugin-commonjs";
import { resolve } from 'node:path'
import { inlineCpyImportsPlugin } from './plugin/inline-cpy-imports'
import { setupBundlePlugin, walk } from './plugin/setup-bundle'
import { svgToReactPlugin } from './plugin/svg-to-react'

const srcDir = resolve(__dirname, 'src')
const reactGlobals = resolve(__dirname, 'src', 'ui', 'utils', 'react-globals.ts')

export default function (env: ConfigEnv): ViteBurnerUserConfig {
  const base: ViteBurnerUserConfig = {
    resolve: {
      alias: {
        '@react': reactGlobals,
      },
    },
  }

  if (env?.command === 'build') {
    // viteburner's own plugin only `apply`s in "serve" mode, so the
    // `viteburner` config below is inert here — this path is plain
    // Vite/Rollup, producing dist/setup.js instead of a live push. See
    // plugin/setup-bundle.ts for how that file actually gets built.
    return {
      ...base,
      plugins: [
        svgToReactPlugin(),
        inlineCpyImportsPlugin(),
        setupBundlePlugin(srcDir),
      ],
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        minify: false,
        target: 'esnext',
        rollupOptions: {
          input: walk(srcDir, rel => /\.(?:js|ts|tsx)$/.test(rel)),
          // Vite's default build config sets this to `false`, which
          // Rollup rejects outright when `output.preserveModules`
          // is on.
          preserveEntrySignatures: 'strict',
          output: {
            preserveModules: true,
            preserveModulesRoot: srcDir,
            // A plain `'[name].js'` template only strips one of Rollup's
            // own known extensions (.ts/.tsx/.js/...) when computing
            // `[name]` — `.svg` isn't in that list, so a `document.svg`
            // module (see plugin/svg-to-react.ts) would come out named
            // `document.svg.js` instead of `document.js`. Rollup already
            // rewrites every chunk's own import specifiers to match
            // whatever name we return here, so this function-form is a
            // drop-in replacement for the template, not just an SVG patch.
            entryFileNames: chunkInfo => `${chunkInfo.name.replace(/\.svg$/, '')}.js`,
            format: 'es',
          },
        },
      },
    }
  }

  // `npm start` (viteburner dev server) — unchanged, just the live push.
  return {
    ...base,
    plugins: [
      svgToReactPlugin(),
      inlineCpyImportsPlugin(),
    ],
    viteburner: {
      watch: [
        {
          pattern: 'src/**/*.svg',
          transform: true,
          // Same reasoning as the `.tsx` override just below: the deployed
          // file is JS generated from the SVG's markup (see
          // plugin/svg-to-react.ts), so its upload path must end in `.js`,
          // not `.svg` — and `fixImportPath` (viteburner's own AST-based
          // import-rewriter, see its README) then rewrites any `./foo.svg`
          // import in a sibling file to match this actual upload path
          // automatically, so source files keep writing the real `.svg`
          // specifier.
          location: file => ({ filename: file.replace(/^src\//, '').replace(/\.svg$/, '.js') }),
        },
        {
          pattern: 'src/**/*.{js,ts,tsx}',
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
          location: file => ({ filename: file.replace(/^src\//, '').replace(/\.tsx?$/, '.js') }),
        },
        { pattern: 'src/**/*.{script,txt}' },
      ],

      sourcemap: 'inline',
    },
  }
}
