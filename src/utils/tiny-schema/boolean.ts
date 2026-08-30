import type { Schema } from './types'
import { schema } from './core'

export function boolean(): Schema<boolean> {
  return schema({
    validate(input: unknown): boolean {
      if (typeof input !== 'boolean')
        throw new TypeError('Expected boolean')

      return input
    },
  })
}
