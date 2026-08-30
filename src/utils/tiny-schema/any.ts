import type { Schema } from './types'
import { schema } from './core'

export function any(): Schema<any> {
  return schema({
    validate: (input: unknown): any => {
      if (input === null || input === undefined)
        throw new TypeError('Expected value')

      return input
    },
  })
}
