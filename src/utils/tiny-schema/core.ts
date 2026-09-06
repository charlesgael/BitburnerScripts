import type { OptionalSchema, Schema } from './types'

/**
 * Turns a bare `{ validate, ...extras }` object into a full `Schema` by
 * adding `parse` (JSON-decode then `validate`) and `optional` (wraps the
 * result via `optional()` below). Every `tiny-schema/*` factory (`string()`,
 * `number()`, `object()`, ...) is built on this — `extras` is where their
 * chainable methods (`.min()`, `.max()`, ...) come from.
 */
export function schema<T extends {
  validate: (input: unknown) => any
}>(
  schema: T,
): Omit<T, 'validate'> & Schema<ReturnType<T['validate']>> {
  const result = {
    ...schema,

    parse(input: string): ReturnType<T['validate']> {
      return schema.validate(JSON.parse(input.trim()))
    },

    optional(): OptionalSchema<ReturnType<T['validate']>> {
      return optional(result)
    },
  }

  return result
}

/**
 * Wraps `inner` so `undefined` validates/parses to `undefined` instead of
 * throwing, and anything else defers to `inner`. `.optional()` on itself is
 * a no-op (returns `this`) rather than double-wrapping.
 */
export function optional<T>(
  inner: Schema<T>,
): OptionalSchema<T> {
  return {
    _optional: true,

    validate(input) {
      if (input === undefined)
        return undefined

      return inner.validate(input)
    },

    parse(input: string) {
      return inner.validate(JSON.parse(input))
    },

    optional() {
      return this
    },
  }
}
