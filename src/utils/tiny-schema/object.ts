import type { InferObject, ObjectSchema, Shape } from './types'
import { schema } from './core'

/**
 * A `Schema` for a plain object matching `shape`: every key in `shape` is
 * validated against the source object's same-named field (missing/extra
 * keys are whatever each field's own schema allows — e.g. use `.optional()`
 * on a field schema to permit it being absent).
 */
export function object<S extends Shape>(
  shape: S,
): ObjectSchema<S> {
  return schema({
    shape,

    validate(input) {
      if (
        typeof input !== 'object'
        || input === null
        || Array.isArray(input)
      ) {
        throw new TypeError('Expected object')
      }

      const source = input as Record<string, unknown>
      const output = {} as InferObject<S>

      for (const key in shape) {
        (output as any)[key] = shape[key].validate(source[key])
      }

      return output
    },
  })
}
