import type { ObjectSchema, Shape } from './types'
import { object } from './object'

/**
 * Merges two `ObjectSchema`s' shapes into one `ObjectSchema<A & B>` — e.g.
 * for layering a shared field set (like `logSchema`'s `ts` stamp) onto a
 * feature-specific one. `b`'s fields win on a key collision, matching plain
 * object-spread semantics. See `log-helper.ts`'s `logSchema` doc comment for
 * when this fits and when `or()` (a union of shapes) is needed instead.
 */
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
