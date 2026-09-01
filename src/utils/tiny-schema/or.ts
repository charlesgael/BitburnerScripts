import type { InferSchema, Schema } from './types'
import { schema } from './core'

export function or<S extends [Schema<any>, Schema<any>, ...Schema<any>[]]>(
  ...shapes: S
): Schema<InferSchema<S[number]>> {
  return schema({
    validate(input) {
      for (const shape of shapes) {
        try {
          return shape.validate(input)
        }
        catch { }
      }

      throw new TypeError('Didn\'t match any branch')
    },
  })
}
