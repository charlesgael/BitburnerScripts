'use strict'

/**
 * `npm run usage-report` — for each deployed entry point (every `src/*.app.ts`,
 * `src/start.ts`, `src/bin/*.{ts,tsx}`, `src/daemons/*.daemon.ts`), walks the
 * set of top-level declarations *actually reachable* from it — not just every
 * file it happens to import from — and flags every identifier whose text
 * matches a real, RAM-*costed* `ns.*` method/property name, regardless of
 * what it's actually attached to. See CLAUDE.md's "RAM-cost model" section:
 * Bitburner's static RAM analyzer matches on identifier *text*, not on the
 * receiver's real type, so a decoy like a local variable or unrelated
 * object's property named `weaken` bills the same RAM as a real
 * `ns.weaken()` call. Free (0 GB) names — `ns.args`, `ns.format.*`, bare
 * namespace accessors like `ns.singularity` itself, ... — are excluded
 * entirely, since a decoy with that text never bills any real RAM.
 *
 * "Reachable" is per-*binding*, not per-file: importing `{ FOO } from './x'`
 * only pulls in `FOO`'s own declaration (and, transitively, whatever that
 * declaration itself references) — a sibling function declared in `./x` but
 * never imported by anyone does *not* count, even though it lives in the
 * same file. This mirrors real ES-module/RAM-analyzer behavior: a module's
 * top-level side-effecting statements (plain `const`s, object/array literals,
 * loose expression statements, ...) always run the moment the module loads
 * and so always count, but a `function`/`class` declaration (or a `const`
 * bound to a function/arrow expression) only "runs" — and only then costs —
 * once something actually calls it or imports it by name (matching the
 * project's own confirmed case: an unused-but-imported binding still bills
 * its RAM). Getting this file-vs-binding distinction wrong is exactly how an
 * earlier version of this script over-reported `cgd/actions/cloud.ts`'s
 * `ns.cloud.*` calls against `ui.app.ts`, even though only an unrelated
 * constant (`SLAVE_NODE_FILE`) is ever imported from that file on the UI
 * side — the action functions themselves are only ever imported by
 * `daemons/lv2.daemon.ts`, a separate entry point.
 *
 * Plain Node/CommonJS (not TypeScript) so it needs no ts-node/tsx dependency
 * to run — it uses the `typescript` package purely as a library to parse
 * other files, the same way `plugin/inline-cpy-imports.ts` does.
 *
 * Deliberately a standalone script, not a Vite/viteburner plugin: recomputing
 * a ~30-entry-point reachability graph on every hot-reload save would add
 * latency to the exact workflow viteburner exists to keep fast. Run this by
 * hand when hunting a RAM surprise, same as `tsc`/`eslint`.
 */

const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const NS_DEFS = path.join(ROOT, 'NetscriptDefinitions.d.ts')
const REACT_ALIAS = path.join(SRC, 'ui', 'utils', 'react-globals.ts')

function scriptKindFor(file) {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function parseFile(absPath) {
  const text = fs.readFileSync(absPath, 'utf8')
  return ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, scriptKindFor(absPath))
}

/**
 * A member's own documented RAM cost in GB, read from its leading JSDoc
 * comment (`RAM cost: X GB`, sometimes `RAM cost: X GB * 16/4/1` for the
 * SF4-discounted Singularity functions — the first number is always the
 * relevant one either way). 0 when the member has no such line at all,
 * which is how free properties/namespaces (`ns.args`, `ns.pid`, the bare
 * `ns.singularity` namespace accessor itself, all of `ns.format.*`, ...)
 * are documented.
 */
function ramCostGb(member, sourceFile) {
  const fullText = member.getFullText(sourceFile)
  const leadingTrivia = fullText.slice(0, fullText.length - member.getText(sourceFile).length)
  const match = /RAM cost:\s*([\d.]+)/i.exec(leadingTrivia)
  return match ? Number.parseFloat(match[1]) : 0
}

/**
 * The set of every real, RAM-*costed* `ns.*` name: `NS`'s own member names,
 * plus (recursively) the member names of every sub-namespace interface
 * reachable from a plain `readonly foo: Bar;` property on `NS` — this is
 * what keeps unrelated data shapes (`Player`, `Server`, `HP`, ...) out of
 * the set, since they're only ever used as method *return* types, never as
 * `NS`'s own property types.
 *
 * A member with no documented RAM cost (0 GB) is excluded from the tracked
 * set entirely — a decoy identifier with the same text never bills any real
 * RAM, so it isn't worth a report entry. Namespace accessors themselves
 * (`ns.singularity`, `ns.format`, ...) are always free this way; only their
 * individual members get their own cost. Still recursed into either way,
 * since a free namespace can hold costed members.
 */
function collectNsNames() {
  const sourceFile = parseFile(NS_DEFS)
  const interfaces = new Map()
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt))
      interfaces.set(stmt.name.text, stmt)
  }
  const root = interfaces.get('NS')
  if (!root)
    throw new Error('usage-report: could not find `interface NS` in NetscriptDefinitions.d.ts')

  const names = new Set()
  const visited = new Set()

  function visitInterface(iface) {
    if (visited.has(iface))
      return
    visited.add(iface)

    for (const member of iface.members) {
      if (!member.name || !ts.isIdentifier(member.name))
        continue
      if (ramCostGb(member, sourceFile) > 0)
        names.add(member.name.text)

      // Only a plain property whose type is a bare reference to another
      // interface in this same file is a sub-namespace worth recursing
      // into (e.g. `readonly singularity: Singularity;`) — a method's own
      // parameter/return types are not further `ns.*` namespaces.
      if (ts.isPropertySignature(member) && member.type && ts.isTypeReferenceNode(member.type) && ts.isIdentifier(member.type.typeName)) {
        const nested = interfaces.get(member.type.typeName.text)
        if (nested)
          visitInterface(nested)
      }
    }

    if (iface.heritageClauses) {
      for (const clause of iface.heritageClauses) {
        for (const t of clause.types) {
          if (ts.isIdentifier(t.expression)) {
            const nested = interfaces.get(t.expression.text)
            if (nested)
              visitInterface(nested)
          }
        }
      }
    }
  }

  visitInterface(root)
  return names
}

function findEntryPoints() {
  const entries = []

  for (const f of fs.readdirSync(SRC)) {
    const abs = path.join(SRC, f)
    if (fs.statSync(abs).isFile() && (/\.app\.ts$/.test(f) || f === 'start.ts'))
      entries.push(abs)
  }

  const binDir = path.join(SRC, 'bin')
  if (fs.existsSync(binDir)) {
    for (const f of fs.readdirSync(binDir)) {
      if (/\.tsx?$/.test(f))
        entries.push(path.join(binDir, f))
    }
  }

  const daemonsDir = path.join(SRC, 'daemons')
  if (fs.existsSync(daemonsDir)) {
    for (const f of fs.readdirSync(daemonsDir)) {
      if (/\.daemon\.ts$/.test(f))
        entries.push(path.join(daemonsDir, f))
    }
  }

  return entries.sort()
}

function resolveModule(fromFile, specifier) {
  if (specifier === '@react')
    return REACT_ALIAS
  if (!specifier.startsWith('.'))
    return null // `@ns` (ambient .d.ts) or any other bare specifier: not a reachable source file

  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile())
        return candidate
    }
    catch {}
  }
  return null
}

/**
 * Skip descending into any subtree that's erased before the game ever sees
 * the compiled JS: `interface`/`type` bodies, generic type parameters, and
 * every type-position node (annotations, `as`/`satisfies` targets, type
 * arguments, ...) — `ts.isTypeNode` covers that whole category in one check.
 */
function shouldSkipSubtree(node) {
  return ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isTypeParameterDeclaration(node)
    || ts.isTypeNode(node)
    || (ts.isImportClause(node) && node.isTypeOnly)
    || (ts.isImportSpecifier(node) && node.isTypeOnly)
    || (ts.isExportSpecifier(node) && node.isTypeOnly)
}

function hasDefaultModifier(stmt) {
  return !!(stmt.modifiers && stmt.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword))
}

/**
 * One file's top-level shape: which name each top-level declaration
 * introduces, and whether that declaration is "lazy" — a `function`/`class`
 * declaration, or a `const` bound to a function/arrow expression — meaning
 * its body only runs (and only then counts) once something actually calls
 * or imports it, as opposed to every other top-level statement (plain
 * `const`s, object/array literals, loose expression statements, ...), which
 * always runs the moment the module loads and so is always reachable once
 * the file is touched at all.
 */
function getFileInfo(absPath, cache) {
  const cached = cache.get(absPath)
  if (cached)
    return cached

  const sourceFile = parseFile(absPath)
  const bindingIndex = new Map() // name -> { idx, lazy }
  const lazyStatementIdx = new Set()
  let defaultBindingIdx = null

  sourceFile.statements.forEach((stmt, idx) => {
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt))
      return // erased before runtime, no binding
    if (ts.isImportDeclaration(stmt) || (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier))
      return // links to another module, handled separately — not a local binding

    if (ts.isFunctionDeclaration(stmt)) {
      if (stmt.name)
        bindingIndex.set(stmt.name.text, { idx, lazy: true })
      lazyStatementIdx.add(idx)
      if (hasDefaultModifier(stmt))
        defaultBindingIdx = idx
      return
    }
    if (ts.isClassDeclaration(stmt)) {
      if (stmt.name)
        bindingIndex.set(stmt.name.text, { idx, lazy: true })
      lazyStatementIdx.add(idx)
      if (hasDefaultModifier(stmt))
        defaultBindingIdx = idx
      return
    }
    if (ts.isVariableStatement(stmt)) {
      const decls = stmt.declarationList.declarations
      const allFunctionValued = decls.every(d => d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)))
      for (const decl of decls) {
        if (ts.isIdentifier(decl.name))
          bindingIndex.set(decl.name.text, { idx, lazy: allFunctionValued })
      }
      if (allFunctionValued)
        lazyStatementIdx.add(idx)
      return
    }
    if (ts.isExportAssignment(stmt)) {
      defaultBindingIdx = idx
    }
    // else: a plain statement with no named binding — always eager.
  })

  const info = { sourceFile, bindingIndex, lazyStatementIdx, defaultBindingIdx }
  cache.set(absPath, info)
  return info
}

/**
 * One top-level statement's own analysis, cached by (file, index) since it
 * never depends on which entry point reached it: every real `ns.*`-matching
 * identifier inside it, and every reference to a *sibling* top-level binding
 * declared in the same file (the same-file half of reachability — the
 * cross-file half doesn't need this, since a named import already seeds its
 * target binding as reachable unconditionally, see `processImport` below).
 */
function analyzeStatement(absPath, idx, run) {
  const key = `${absPath}#${idx}`
  const cached = run.analysisCache.get(key)
  if (cached)
    return cached

  const info = getFileInfo(absPath, run.fileInfoCache)
  const stmt = info.sourceFile.statements[idx]
  const nsMatches = []
  const siblingRefs = new Set()

  function visit(node) {
    if (shouldSkipSubtree(node))
      return
    if (ts.isIdentifier(node)) {
      if (run.nsNames.has(node.text)) {
        const { line } = info.sourceFile.getLineAndCharacterOfPosition(node.getStart(info.sourceFile))
        nsMatches.push({ name: node.text, line: line + 1 })
      }
      if (info.bindingIndex.has(node.text))
        siblingRefs.add(node.text)
    }
    ts.forEachChild(node, visit)
  }

  visit(stmt)
  const result = { nsMatches, siblingRefs }
  run.analysisCache.set(key, result)
  return result
}

function markStatementReachable(absPath, idx, entryState) {
  const key = `${absPath}#${idx}`
  if (entryState.reachableKeys.has(key))
    return
  entryState.reachableKeys.add(key)
  entryState.worklist.push({ absPath, idx })
}

function markBindingReachable(absPath, name, run, entryState) {
  const info = getFileInfo(absPath, run.fileInfoCache)
  const entry = info.bindingIndex.get(name)
  if (entry)
    markStatementReachable(absPath, entry.idx, entryState)
}

/**
 * A named/default/namespace import or re-export always causes its target
 * module to load — so that module's own eager (always-run) statements are
 * reachable too, not just the specific binding pulled through.
 */
function touchFile(absPath, run, entryState, { includeLazy = false } = {}) {
  if (entryState.touchedFiles.has(absPath))
    return
  entryState.touchedFiles.add(absPath)

  const info = getFileInfo(absPath, run.fileInfoCache)
  info.sourceFile.statements.forEach((stmt, idx) => {
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt))
      return
    if (ts.isImportDeclaration(stmt)) {
      processImport(absPath, stmt, run, entryState)
      return
    }
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
      processReExport(absPath, stmt, run, entryState)
      return
    }
    if (!includeLazy && info.lazyStatementIdx.has(idx))
      return // a function/class (or function-valued const) nobody has referenced yet
    markStatementReachable(absPath, idx, entryState)
  })
}

function processImport(fromPath, stmt, run, entryState) {
  if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier))
    return
  const resolved = resolveModule(fromPath, stmt.moduleSpecifier.text)
  if (!resolved || !fs.existsSync(resolved))
    return

  const clause = stmt.importClause
  if (!clause) {
    touchFile(resolved, run, entryState) // side-effect-only import: `import './x'`
    return
  }
  if (clause.isTypeOnly)
    return // fully erased, never reaches the deployed file

  if (clause.name) {
    touchFile(resolved, run, entryState)
    const info = getFileInfo(resolved, run.fileInfoCache)
    if (info.defaultBindingIdx != null)
      markStatementReachable(resolved, info.defaultBindingIdx, entryState)
  }

  const bindings = clause.namedBindings
  if (!bindings)
    return

  if (ts.isNamespaceImport(bindings)) {
    // `import * as x from './y'` — can't tell which of `x`'s properties end
    // up used, so conservatively pull in every top-level binding.
    touchFile(resolved, run, entryState)
    const info = getFileInfo(resolved, run.fileInfoCache)
    for (const name of info.bindingIndex.keys())
      markBindingReachable(resolved, name, run, entryState)
    return
  }

  const valueElements = bindings.elements.filter(el => !el.isTypeOnly)
  if (valueElements.length === 0)
    return
  touchFile(resolved, run, entryState)
  // A named import seeds its target binding as reachable unconditionally —
  // per CLAUDE.md, an imported-but-never-called function still bills its RAM.
  for (const el of valueElements)
    markBindingReachable(resolved, (el.propertyName ?? el.name).text, run, entryState)
}

function processReExport(fromPath, stmt, run, entryState) {
  if (stmt.isTypeOnly)
    return
  if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier))
    return
  const resolved = resolveModule(fromPath, stmt.moduleSpecifier.text)
  if (!resolved || !fs.existsSync(resolved))
    return

  const exportClause = stmt.exportClause
  if (!exportClause || !ts.isNamedExports(exportClause)) {
    // `export * from './y'` / `export * as ns from './y'` — same reasoning
    // as the namespace-import case above: pull in everything, conservatively.
    touchFile(resolved, run, entryState)
    const info = getFileInfo(resolved, run.fileInfoCache)
    for (const name of info.bindingIndex.keys())
      markBindingReachable(resolved, name, run, entryState)
    return
  }

  const valueElements = exportClause.elements.filter(el => !el.isTypeOnly)
  if (valueElements.length === 0)
    return
  touchFile(resolved, run, entryState)
  for (const el of valueElements)
    markBindingReachable(resolved, (el.propertyName ?? el.name).text, run, entryState)
}

/**
 * Every NS-name match actually reachable from one entry point, via the
 * per-binding worklist described at the top of this file.
 */
function computeEntryMatches(entryAbsPath, run) {
  const entryState = { touchedFiles: new Set(), reachableKeys: new Set(), worklist: [] }
  // The entry file itself isn't "imported" by anyone — the game invokes it
  // directly — so, unlike every file reached *through* it, all of its own
  // top-level declarations (including otherwise-lazy ones like `main`) are
  // reachable unconditionally.
  touchFile(entryAbsPath, run, entryState, { includeLazy: true })

  const matches = []
  while (entryState.worklist.length > 0) {
    const { absPath, idx } = entryState.worklist.pop()
    const { nsMatches, siblingRefs } = analyzeStatement(absPath, idx, run)
    for (const m of nsMatches)
      matches.push({ name: m.name, file: absPath, line: m.line })
    for (const name of siblingRefs)
      markBindingReachable(absPath, name, run, entryState)
  }
  return matches
}

function relDisplay(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/')
}

function main() {
  const nsNames = collectNsNames()
  const entries = findEntryPoints()
  const run = { nsNames, fileInfoCache: new Map(), analysisCache: new Map() }

  const lines = []
  lines.push('# NS-name usage report')
  lines.push('')
  lines.push('Generated by `npm run usage-report` (`scripts/usage-report.js`) — do not hand-edit.')
  lines.push('')
  lines.push('For each deployed entry point, every identifier actually reachable from it (see this')
  lines.push('script\'s own header comment for what "reachable" means at the per-binding level) whose')
  lines.push('text matches a real, RAM-costed `ns.*` method or property name, whether or not it\'s')
  lines.push('actually attached to `ns`. See CLAUDE.md\'s "RAM-cost model" section for why an unrelated')
  lines.push('local variable or object property can still bill real `ns.*` RAM.')
  lines.push('')

  for (const entry of entries) {
    const entryLabel = relDisplay(entry)
    const matches = computeEntryMatches(entry, run)

    const byName = new Map()
    for (const m of matches) {
      const list = byName.get(m.name) ?? []
      list.push({ file: m.file, line: m.line })
      byName.set(m.name, list)
    }

    lines.push(`## ${entryLabel}`)
    lines.push('')

    if (byName.size === 0) {
      lines.push('_No NS-name collisions found._')
      lines.push('')
      continue
    }

    const sortedNames = [...byName.keys()].sort((a, b) => byName.get(b).length - byName.get(a).length || a.localeCompare(b))
    for (const name of sortedNames) {
      const occurrences = byName.get(name).sort((a, b) => relDisplay(a.file).localeCompare(relDisplay(b.file)) || a.line - b.line)
      lines.push(`- \`${name}\` (${occurrences.length})`)
      for (const occ of occurrences)
        lines.push(`  - ${relDisplay(occ.file)}:${occ.line}`)
    }
    lines.push('')
  }

  const outPath = path.join(ROOT, 'usage.md')
  fs.writeFileSync(outPath, lines.join('\n'))
  console.log(`usage.md written — ${entries.length} entry points.`)
}

main()
