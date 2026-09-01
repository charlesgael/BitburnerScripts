import type { Schema } from './types'
import { schema } from './core'

export function record<T>(value: Schema<T>): Schema<Record<string, T>> {
  return schema({
    validate(input: unknown): Record<string, T> {
      if (
        typeof input !== 'object'
        || input === null
        || Array.isArray(input)
      ) {
        throw new TypeError('Expected object')
      }

      const source = input as Record<string, unknown>
      const output = {} as Record<string, T>

      for (const key in source) {
        output[key] = value.validate(source[key])
      }

      return output
    },
  })
}
