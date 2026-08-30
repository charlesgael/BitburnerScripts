import type { ObjectSchema, Shape } from './types'
import { object } from './object'

export function combine<
  A extends Shape,
  B extends Shape,
>(
  a: ObjectSchema<A>,
  b: ObjectSchema<B>,
): ObjectSchema<A & B> {
  return object({
    ...a.shape,
    ...b.shape,
  } as A & B)
}
