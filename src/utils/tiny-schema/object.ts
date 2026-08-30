import type { InferObject, ObjectSchema, Shape } from './types'
import { schema } from './core'

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
