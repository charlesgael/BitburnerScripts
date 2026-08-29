// @ts-check
import { dirname, join, relative, sep } from 'node:path'

/**
 * Disallow `/`-rooted import specifiers (e.g. `/src/foo`), which resolve via
 * tsconfig.json's `/src/*` path mapping, and bare `src/foo` specifiers,
 * which resolve via tsconfig's `baseUrl: "."` fallback (TS resolves any
 * unmapped, non-relative specifier against baseUrl too) — neither is an
 * ordinary relative import. Every other import in this codebase is relative
 * (`./foo`, `../foo`) or a bare alias (`@react`, `@ns`) — a `/`-rooted or
 * `src/`-rooted specifier is an inconsistency, not a deliberate alias, so
 * this rule's fixer rewrites it back to a relative path instead of just
 * flagging it.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: 'problem',
    fixable: 'code',
    schema: [],
    messages: {
      absolute: 'Use a relative import instead of the absolute-style path \'{{source}}\'.',
    },
  },
  create(context) {
    /** @param {import('estree').Literal} sourceNode */
    function check(sourceNode) {
      const source = sourceNode.value
      if (
        typeof source !== 'string'
        || !(
          source.startsWith('/')
          || source === 'src'
          || source.startsWith('src/')
        )
      ) {
        return
      }

      context.report({
        node: sourceNode,
        messageId: 'absolute',
        data: { source },
        fix(fixer) {
          const targetAbs = join(context.cwd, source.replace(/^\//, sep))
          let rel = relative(dirname(context.filename), targetAbs).replace(/\\/g, '/')
          if (!rel.startsWith('.'))
            rel = `./${rel}`

          const raw = sourceNode.raw ?? `'${source}'`
          const quote = raw[0]
          return fixer.replaceText(sourceNode, `${quote}${rel}${quote}`)
        },
      })
    }

    return {
      ImportDeclaration(node) {
        check(node.source)
      },
      ExportNamedDeclaration(node) {
        if (node.source)
          check(node.source)
      },
      ExportAllDeclaration(node) {
        check(node.source)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal')
          check(node.source)
      },
    }
  },
}
