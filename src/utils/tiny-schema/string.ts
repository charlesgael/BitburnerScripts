import type { StringSchema } from './types'
import { schema } from './core'

export function string(): StringSchema {
  const validations: Array<(value: string) => void> = []

  const result = schema({
    validate(input: unknown): string {
      if (input === undefined || input === null)
        throw new TypeError('Value required')

      if (typeof input !== 'string')
        throw new TypeError('Expected string')

      for (const validate of validations)
        validate(input)

      return input
    },

    min(length: number) {
      validations.push((value) => {
        if (value.length < length) {
          throw new TypeError(
            `Expected string with at least ${length} characters`,
          )
        }
      })

      return result
    },

    max(length: number) {
      validations.push((value) => {
        if (value.length > length) {
          throw new TypeError(
            `Expected string with at most ${length} characters`,
          )
        }
      })

      return result
    },

    len(length: number) {
      validations.push((value) => {
        if (value.length !== length) {
          throw new TypeError(
            `Expected string with exactly ${length} characters`,
          )
        }
      })

      return result
    },

    email() {
      validations.push((value) => {
        if (!/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(value))
          throw new TypeError('Expected valid email')
      })

      return result
    },

    regex(pattern: RegExp) {
      validations.push((value) => {
        if (!pattern.test(value)) {
          throw new TypeError(
            `Expected string matching ${pattern}`,
          )
        }
      })

      return result
    },
  })

  return result
}
