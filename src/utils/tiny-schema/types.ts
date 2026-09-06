/**
 * A minimal, zod-like runtime validator/parser for one value of type `T`.
 * `parse` takes a raw JSON string (`JSON.parse` + `validate`), `validate`
 * takes an already-decoded `unknown` value — both throw a `TypeError` on a
 * mismatch rather than returning a result type. Every `tiny-schema/*`
 * factory (`string`, `number`, `object`, ...) returns one of these, built via
 * `schema()` in `core.ts`.
 */
export interface Schema<T> {
  parse: (input: string) => T
  validate: (input: unknown) => T
  optional: () => OptionalSchema<T>
}

/** A `Schema<T>` that also accepts `undefined` — see `optional()` in `core.ts`. */
export interface OptionalSchema<T> extends Schema<T | undefined> {
  readonly _optional: true
}

/** A `Schema<string>` with chainable length/format constraints — see `string()`. */
export interface StringSchema<T extends string = string> extends Schema<T> {
  min: (length: number) => StringSchema<T>
  max: (length: number) => StringSchema<T>
  len: (length: number) => StringSchema<T>
  email: () => StringSchema<T>
  regex: (pattern: RegExp) => StringSchema<T>
}

/** A `Schema<number>` with chainable range/integer constraints — see `number()`. */
export interface NumberSchema extends Schema<number> {
  min: (value: number) => NumberSchema
  max: (value: number) => NumberSchema
  int: () => NumberSchema
}

/** A `Schema` for an object matching `S`'s per-field schemas — see `object()`. */
export interface ObjectSchema<S extends Shape>
  extends Schema<InferObject<S>> {
  readonly shape: S
}

/** A plain object of field name -> `Schema`, as passed to `object()`. */
export type Shape = Record<string, Schema<unknown>>

/** Extracts the validated output type `T` from a `Schema<T>`. */
export type InferSchema<S>
  = S extends Schema<infer T>
    ? T
    : never

/** The object type an `ObjectSchema<S>` validates to — optional fields (built via `.optional()`) become optional properties, not just `| undefined`. */
export type InferObject<S extends Shape> = {
  [K in keyof S as S[K] extends OptionalSchema<any> ? K : never]?:
  InferSchema<S[K]>
} & {
  [K in keyof S as S[K] extends OptionalSchema<any> ? never : K]:
  InferSchema<S[K]>
}
