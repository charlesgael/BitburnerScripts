import type { InferSchema, Schema } from './types'
import { schema } from './core'

/**
 * A `Schema` for the union of `shapes`: tries each in order and returns the
 * first that validates without throwing, or throws if none match. Use this
 * (rather than `combine`) when the input can genuinely take one of several
 * distinct shapes, not just several field sets merged into one — see
 * `log-helper.ts`'s `logSchema` doc comment for the concrete distinction.
 */
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
