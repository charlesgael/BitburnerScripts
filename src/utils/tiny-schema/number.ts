import type { NumberSchema } from './types'
import { schema } from './core'

export function number(): NumberSchema {
  const validations: Array<(value: number) => void> = []

  const result = schema({
    validate(input: unknown): number {
      if (input === undefined || input === null)
        throw new TypeError('Value required')

      if (typeof input !== 'number')
        throw new TypeError('Expected number')

      if (Number.isNaN(input))
        throw new TypeError('Expected valid number')

      for (const validate of validations)
        validate(input)

      return input
    },

    min(minimum: number) {
      validations.push((value) => {
        if (value < minimum) {
          throw new TypeError(
            `Expected number >= ${minimum}`,
          )
        }
      })

      return result
    },

    max(maximum: number) {
      validations.push((value) => {
        if (value > maximum) {
          throw new TypeError(
            `Expected number <= ${maximum}`,
          )
        }
      })

      return result
    },

    int() {
      validations.push((value) => {
        if (!Number.isInteger(value))
          throw new TypeError('Expected integer')
      })

      return result
    },
  })

  return result
}
