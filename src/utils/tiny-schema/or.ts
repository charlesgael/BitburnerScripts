import type { Schema } from './types'
import { schema } from './core'

export function or<S, U>(
  shape1: Schema<S>,
  shape2: Schema<U>,
): Schema<S | U> {
  return schema({
    validate(input) {
      try {
        return shape1.validate(input)
      }
      catch { }
      try {
        return shape2.validate(input)
      }
      catch { }

      throw new TypeError('Didn\'t match either branch')
    },
  })
}
