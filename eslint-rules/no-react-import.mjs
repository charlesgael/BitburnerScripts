// @ts-check

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
      useProxy: 'Use \'@react\' in this repo instead of \'react\'.',
      test: 'Test: {{node}}',
    },
  },
  create(context) {
    /** @param {import('estree').Literal} sourceNode */
    function check(sourceNode) {
      const source = sourceNode.value
      if (source !== 'react') {
        return
      }

      context.report({
        node: sourceNode,
        messageId: 'useProxy',
        data: { source },
        fix(fixer) {
          const raw = sourceNode.raw ?? `'${source}'`
          const quote = raw[0]
          return fixer.replaceText(sourceNode, `${quote}@${source}${quote}`)
        },
      })
    }

    return {
      ImportDeclaration(node) {
        if ('importKind' in node && node.importKind === 'type') {
          return
        }
        check(node.source)
      },
      ExportNamedDeclaration(node) {
        if ('importKind' in node && node.importKind === 'type') {
          return
        }
        if (node.source)
          check(node.source)
      },
      ExportAllDeclaration(node) {
        if ('importKind' in node && node.importKind === 'type') {
          return
        }
        check(node.source)
      },
      ImportExpression(node) {
        if ('importKind' in node && node.importKind === 'type') {
          return
        }
        if (node.source.type === 'Literal')
          check(node.source)
      },
    }
  },
}
