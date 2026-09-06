import type { Schema } from './types'
import { schema } from './core'

/** A `Schema` that only accepts a real `boolean`. */
export function boolean(): Schema<boolean> {
  return schema({
    validate(input: unknown): boolean {
      if (typeof input !== 'boolean')
        throw new TypeError('Expected boolean')

      return input
    },
  })
}
