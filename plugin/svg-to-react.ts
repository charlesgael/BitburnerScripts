import type { Plugin } from 'vite'
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'

/**
 * `import Icon from './document.svg'` — instead of Vite's default asset
 * behavior (emitting the file as a URL string, see `vite/client`'s own
 * `declare module '*.svg'`), parses the SVG's markup at load time and
 * returns a React function component built from `React.createElement`
 * calls, so it can be dropped straight into JSX (`<Icon />`) like any other
 * component under `ui/apps/`/`ui/components/`.
 *
 * Deliberately hand-rolled rather than pulling in `@svgr/core`/`svgo`: this
 * project has no runtime dependency on anything but `arg` (see
 * package.json), and these are simple, well-formed icon SVGs (see
 * `src/ui/svg/`), not arbitrary untrusted markup — a tiny regex-based
 * tag/attribute scanner is enough and keeps that property intact.
 *
 * Output is plain `React.createElement(...)` JS, not JSX — so this needs no
 * `.tsx`/JSX transform of its own (side-stepping the Viteburner `.tsx`
 * upload-path gotcha noted in `vite.config.ts`) and needs only `React`
 * (from `@react`, see `ui/utils/react-globals.ts`) in scope, exactly the
 * same identifier JSX's classic-transform output already requires.
 */

interface SvgElementNode {
  tag: string
  attrs: Record<string, string>
  children: (SvgElementNode | string)[]
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const codePoint = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint)
    }
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

function stripNoise(source: string): string {
  return source
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrRe = /([a-z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = attrRe.exec(attrString))) {
    const [, name, doubleQuoted, singleQuoted] = match
    attrs[name] = decodeEntities(doubleQuoted ?? singleQuoted ?? '')
  }
  return attrs
}

const TAG_NAME_RE = /^([a-z][\w:-]*)/i

function parseSvg(source: string, filePath: string): SvgElementNode {
  const clean = stripNoise(source)
  // Each tag's whole inside (name + attributes + optional trailing `/`) is
  // captured as one plain `[^>]*` block and split apart in JS afterward
  // (via TAG_NAME_RE), rather than as adjacent regex groups — two adjacent
  // quantified groups sharing overlapping characters (word chars in a tag
  // name followed by an attribute blob that can also start with word
  // chars) is exactly the shape that causes polynomial backtracking on
  // malformed input, so there's only one quantifier per alternative here.
  const tagRe = /<(\/)?([^>]*)>|([^<]+)/g
  const stack: SvgElementNode[] = []
  let root: SvgElementNode | null = null
  let match: RegExpExecArray | null

  // eslint-disable-next-line no-cond-assign
  while ((match = tagRe.exec(clean))) {
    const [, closing, inner, text] = match
    if (text !== undefined) {
      const trimmed = text.trim()
      if (trimmed && stack.length > 0)
        stack[stack.length - 1].children.push(decodeEntities(trimmed))
      continue
    }
    if (closing) {
      stack.pop()
      continue
    }
    const trimmedInner = inner.trim()
    const selfClose = trimmedInner.endsWith('/')
    const body = selfClose ? trimmedInner.slice(0, -1).trimEnd() : trimmedInner
    const nameMatch = TAG_NAME_RE.exec(body)
    if (!nameMatch)
      continue
    const tagName = nameMatch[1]
    const attrString = body.slice(nameMatch[0].length)

    const node: SvgElementNode = { tag: tagName, attrs: parseAttrs(attrString), children: [] }
    if (stack.length > 0)
      stack[stack.length - 1].children.push(node)
    else if (!root)
      root = node

    if (!selfClose)
      stack.push(node)
  }

  if (!root)
    throw new Error(`no root element found in "${filePath}"`)
  return root
}

/** Inline `style="a: b; c: d"` needs a JS object, camelCased, not a string. */
function styleToObjectLiteral(style: string): string {
  const props = style
    .split(';')
    .map(decl => decl.trim())
    .filter(Boolean)
    .map((decl) => {
      const sep = decl.indexOf(':')
      if (sep === -1)
        return null
      const prop = decl.slice(0, sep).trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
      const value = decl.slice(sep + 1).trim()
      return `${JSON.stringify(prop)}: ${JSON.stringify(value)}`
    })
    .filter((entry): entry is string => entry !== null)
  return `{ ${props.join(', ')} }`
}

function attrPropsEntries(attrs: Record<string, string>): string[] {
  return Object.entries(attrs).map(([name, value]) => {
    // `class` is the one HTML/SVG attribute name React refuses to set as-is
    // (it warns and asks for `className`); everything else — including
    // hyphenated names like `stroke-width` — React sets on the element
    // exactly as given, since only JSX itself requires camelCase identifiers
    // (plain object keys have no such restriction).
    const key = name === 'class' ? 'className' : name
    const jsValue = key === 'style' ? styleToObjectLiteral(value) : JSON.stringify(value)
    return `${JSON.stringify(key)}: ${jsValue}`
  })
}

/**
 * `mergeWithProps` is only ever true for the root call in
 * `buildComponentSource` — it merges the component's own `props` argument
 * on top of the root element's literal attributes (so a caller can override
 * `width`/`height`/`className`/`style`/... same as any other component),
 * never for a nested child, which always renders its literal attributes
 * as-is.
 */
function serializeNode(node: SvgElementNode | string, depth: number, mergeWithProps = false): string {
  const pad = '  '.repeat(depth)
  if (typeof node === 'string')
    return `${pad}${JSON.stringify(node)}`

  const propsEntries = attrPropsEntries(node.attrs)
  const literalPropsExpr = propsEntries.length > 0 ? `{ ${propsEntries.join(', ')} }` : '{}'
  const propsExpr = mergeWithProps
    ? `Object.assign(${literalPropsExpr}, props)`
    : (propsEntries.length > 0 ? literalPropsExpr : 'null')

  if (node.children.length === 0)
    return `${pad}React.createElement(${JSON.stringify(node.tag)}, ${propsExpr})`

  const childLines = node.children.map(child => serializeNode(child, depth + 1)).join(',\n')
  return `${pad}React.createElement(${JSON.stringify(node.tag)}, ${propsExpr},\n${childLines},\n${pad})`
}

function componentNameFor(filePath: string): string {
  const base = basename(filePath, extname(filePath))
  const pascal = base
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map(segment => segment[0].toUpperCase() + segment.slice(1))
    .join('')
  return `Svg${pascal}`
}

function buildComponentSource(filePath: string, root: SvgElementNode): string {
  const name = componentNameFor(filePath)
  // Icons in this repo (see HeroStat in contracts-dashboard.tsx, or any
  // emoji `icon: '...'` under `ui/apps/*/index.ts`) are sized by the
  // font-size of whatever wraps them — an emoji gets that for free just by
  // being text. An `<svg>` doesn't: forcing width/height to `1em` here
  // (overriding whatever fixed pixel size the source file shipped with,
  // e.g. `width="800px"`) makes every generated icon track its container's
  // font-size the same way. `props` is still spread on top (see
  // `serializeNode`'s `mergeWithProps`), so a caller can override this back
  // to a fixed size, or add `className`/`style`/`onClick`/..., same as any
  // other component.
  const sizedRoot: SvgElementNode = { ...root, attrs: { ...root.attrs, width: '1em', height: '1em' } }
  return `import React from '@react'\n\nexport default function ${name}(props) {\n  return ${serializeNode(sizedRoot, 1, true).trimStart()}\n}\n`
}

export function svgToReactPlugin(): Plugin {
  return {
    name: 'svg-to-react',
    enforce: 'pre',
    load(id) {
      if (id.includes('?') || !id.endsWith('.svg'))
        return null

      this.addWatchFile(id)
      const source = readFileSync(id, 'utf8')
      let root: SvgElementNode
      try {
        root = parseSvg(source, id)
      }
      catch (err) {
        this.error(`svg-to-react: failed to parse "${id}": ${(err as Error).message}`)
      }
      return { code: buildComponentSource(id, root), map: null }
    },
  }
}
