import type { StringSchema } from './types'
import { schema } from './core'

export function string<T extends readonly string[] = []>(
  ...values: T
): StringSchema<[T[number]] extends [never] ? string : T[number]> {
  type Output = [T[number]] extends [never] ? string : T[number]

  const allowed = values.length > 0 ? new Set<string>(values) : undefined
  const validations: Array<(value: string) => void> = []

  const result = schema({
    validate(input: unknown): Output {
      if (input === undefined || input === null)
        throw new TypeError('Value required')

      if (typeof input !== 'string')
        throw new TypeError('Expected string')

      if (allowed && !allowed.has(input)) {
        throw new TypeError(
          `Expected one of ${values.map(value => JSON.stringify(value)).join(', ')}`,
        )
      }

      for (const validate of validations)
        validate(input)

      return input as Output
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
