import type { Schema } from './types'
import { schema } from './core'

/** A `Schema<T[]>` with chainable length constraints — see `array()`. */
export interface ArraySchema<T>
  extends Schema<T[]> {
  min: (length: number) => ArraySchema<T>
  max: (length: number) => ArraySchema<T>
  len: (length: number) => ArraySchema<T>
}

/** A `Schema` for an array whose every element validates against `item`. */
export function array<T>(
  item: Schema<T>,
): ArraySchema<T> {
  const validations: Array<(value: T[]) => void> = []

  const result = schema({
    validate(input: unknown): Array<T> {
      if (!Array.isArray(input))
        throw new TypeError('Expected array')

      const output = input.map(value =>
        item.validate(value),
      )

      for (const validate of validations)
        validate(output)

      return output
    },

    min(length: number) {
      validations.push((value) => {
        if (value.length < length) {
          throw new TypeError(
            `Expected at least ${length} items`,
          )
        }
      })

      return result
    },

    max(length: number) {
      validations.push((value) => {
        if (value.length > length) {
          throw new TypeError(
            `Expected at most ${length} items`,
          )
        }
      })

      return result
    },

    len(length: number) {
      validations.push((value) => {
        if (value.length !== length) {
          throw new TypeError(
            `Expected exactly ${length} items`,
          )
        }
      })

      return result
    },
  })

  return result
}
