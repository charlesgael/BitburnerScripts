import type { Schema } from './types'
import { schema } from './core'

/** A `Schema` that accepts any value except `null`/`undefined`. */
export function any(): Schema<any> {
  return schema({
    validate: (input: unknown): any => {
      if (input === null || input === undefined)
        throw new TypeError('Expected value')

      return input
    },
  })
}
