import type { OptionalSchema, Schema } from './types'

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
