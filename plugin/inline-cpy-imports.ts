import type { Plugin } from 'vite'
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import ts from 'typescript'

/**
 * `import { foo } from './bar' // cpy` — instead of leaving a real import in
 * the deployed output, splices `./bar`'s own top-level declarations directly
 * into the bottom of the importing file and drops the import line entirely.
 *
 * Exists for worker payloads (see CLAUDE.md's daemon classification) that get
 * `ns.scp`'d to arbitrary remote servers: a real import would require the
 * imported file to *also* be copied to every one of those servers. Marking
 * the import `// cpy` keeps the source ergonomic (a normal, type-checked
 * import) while producing a self-contained deployed script.
 *
 * v1 scope (deliberately restricted, not general import-merging):
 * - Only relative specifiers are resolved (no aliases like `@react`).
 * - The target file's own imports must all be type-only, named, unaliased
 *   (`import type { A, B } from '...'`, or `import { type A } from '...'`).
 *   A value-level import in the target is a build error — flatten it first.
 * - The *entire* target file's non-import top-level declarations are copied,
 *   not just the specific names the `// cpy` import listed.
 *
 * Runs as `enforce: 'pre'` so it sees raw TypeScript (types intact) before
 * Vite's core `vite:esbuild` transform strips them — the spliced-in
 * declarations get stripped by that same later pass, same as the rest of the
 * file, rather than needing to run esbuild ourselves.
 */

const CPY_MARKER = /^\/\/\s*cpy\b/
const CPY_QUICK_CHECK = /\/\/\s*cpy\b/

interface Edit { start: number, end: number, text: string }

function trailingLineComment(text: string, pos: number): string {
  const nl = text.indexOf('\n', pos)
  const slice = nl === -1 ? text.slice(pos) : text.slice(pos, nl)
  return slice.trim()
}

function lineBounds(text: string, nodeStart: number, nodeEnd: number): { lineStart: number, lineEnd: number } {
  const prevNl = text.lastIndexOf('\n', nodeStart - 1)
  const lineStart = prevNl === -1 ? 0 : prevNl + 1
  const nextNl = text.indexOf('\n', nodeEnd)
  const lineEnd = nextNl === -1 ? text.length : nextNl + 1
  return { lineStart, lineEnd }
}

function resolveRelativeFile(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.'))
    return null
  const base = resolvePath(dirname(fromFile), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
    try {
      if (statSync(candidate).isFile())
        return candidate
    }
    catch {}
  }
  return null
}

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function stripExportKeyword(text: string): string {
  return text.replace(/^export\s+default\s+/, '').replace(/^export\s+/, '')
}

interface TargetAnalysis {
  typeImports: Map<string, Set<string>> // module specifier -> named type bindings needed
  declarationsText: string
}

function analyzeTargetFile(filePath: string): TargetAnalysis {
  const sourceText = readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(filePath))
  const typeImports = new Map<string, Set<string>>()
  const declarations: string[] = []

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      if (!ts.isStringLiteral(stmt.moduleSpecifier))
        throw new Error(`cpy: "${filePath}" has an import with a non-literal module specifier, cannot inline.`)
      const specifier = stmt.moduleSpecifier.text
      const clause = stmt.importClause
      const wholeTypeOnly = clause?.isTypeOnly === true
      const namedBindings = clause?.namedBindings
      if (!namedBindings || !ts.isNamedImports(namedBindings)) {
        throw new Error(`cpy: "${filePath}" has an unsupported import form — only named type-only imports are supported for merging (e.g. \`import type { A, B } from '...'\`).`)
      }
      const names: string[] = []
      for (const el of namedBindings.elements) {
        if (!wholeTypeOnly && el.isTypeOnly !== true) {
          throw new Error(`cpy: "${filePath}" has a value-level import ("${el.name.text}" from "${specifier}") — cpy-inlined files may only have type-only imports. Flatten this dependency first.`)
        }
        if (el.propertyName) {
          throw new Error(`cpy: "${filePath}" has an aliased type import ("${el.propertyName.text} as ${el.name.text}") — aliased imports aren't supported for cpy merging.`)
        }
        names.push(el.name.text)
      }
      const set = typeImports.get(specifier) ?? new Set<string>()
      names.forEach(n => set.add(n))
      typeImports.set(specifier, set)
      continue
    }
    declarations.push(stripExportKeyword(stmt.getText(sourceFile)))
  }

  return { typeImports, declarationsText: declarations.join('\n\n') }
}

export function inlineCpyImportsPlugin(): Plugin {
  return {
    name: 'inline-cpy-imports',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.tsx?$/.test(id) || id.includes('node_modules'))
        return null
      if (!CPY_QUICK_CHECK.test(code))
        return null

      const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, scriptKindFor(id))
      const consumerImports = sourceFile.statements.filter(ts.isImportDeclaration)
      const edits: Edit[] = []
      const appended: string[] = []
      let sawCpy = false

      for (const stmt of sourceFile.statements) {
        if (!ts.isImportDeclaration(stmt))
          continue
        const comment = trailingLineComment(code, stmt.getEnd())
        if (!CPY_MARKER.test(comment))
          continue
        sawCpy = true

        if (!ts.isStringLiteral(stmt.moduleSpecifier)) {
          this.error(`cpy: import in "${id}" has a non-literal module specifier, cannot resolve.`)
          return null
        }
        const specifier = stmt.moduleSpecifier.text
        const resolved = resolveRelativeFile(id, specifier)
        if (!resolved) {
          this.error(`cpy: could not resolve "${specifier}" from "${id}" (only relative imports are supported for cpy).`)
          return null
        }
        this.addWatchFile(resolved)

        let analysis: TargetAnalysis
        try {
          analysis = analyzeTargetFile(resolved)
        }
        catch (err) {
          this.error((err as Error).message)
          return null
        }

        const { lineStart, lineEnd } = lineBounds(code, stmt.getStart(), stmt.getEnd())
        edits.push({ start: lineStart, end: lineEnd, text: '' })
        appended.push(`// ---- inlined from ${specifier} (cpy) ----\n${analysis.declarationsText}`)

        for (const [targetSpecifier, names] of analysis.typeImports) {
          const existing = consumerImports.find((imp) => {
            const spec = imp.moduleSpecifier
            return ts.isStringLiteral(spec) && spec.text === targetSpecifier
              && imp.importClause?.namedBindings && ts.isNamedImports(imp.importClause.namedBindings)
          })
          if (existing) {
            const namedBindings = existing.importClause!.namedBindings as ts.NamedImports
            const already = new Set(namedBindings.elements.map(e => e.name.text))
            const missing = [...names].filter(n => !already.has(n))
            if (missing.length > 0) {
              const isTypeOnlyClause = existing.importClause!.isTypeOnly
              const insertion = missing.map(n => (isTypeOnlyClause ? n : `type ${n}`)).join(', ')
              const insertPos = namedBindings.getEnd() - 1 // just before the closing '}'
              const prefix = namedBindings.elements.length > 0 ? ', ' : ''
              edits.push({ start: insertPos, end: insertPos, text: prefix + insertion })
            }
          }
          else {
            edits.push({ start: 0, end: 0, text: `import type { ${[...names].join(', ')} } from '${targetSpecifier}'\n` })
          }
        }
      }

      if (!sawCpy)
        return null

      edits.sort((a, b) => b.start - a.start || b.end - a.end)
      let result = code
      for (const edit of edits)
        result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)

      result += `\n\n${appended.join('\n\n')}\n`

      return { code: result, map: null }
    },
  }
}
