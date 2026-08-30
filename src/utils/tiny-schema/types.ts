export interface Schema<T> {
  parse: (input: string) => T
  validate: (input: unknown) => T
  optional: () => OptionalSchema<T>
}

export interface OptionalSchema<T> extends Schema<T | undefined> {
  readonly _optional: true
}

export interface StringSchema extends Schema<string> {
  min: (length: number) => StringSchema
  max: (length: number) => StringSchema
  len: (length: number) => StringSchema
  email: () => StringSchema
  regex: (pattern: RegExp) => StringSchema
}

export interface NumberSchema extends Schema<number> {
  min: (value: number) => NumberSchema
  max: (value: number) => NumberSchema
  int: () => NumberSchema
}

export interface ObjectSchema<S extends Shape>
  extends Schema<InferObject<S>> {
  readonly shape: S
}

export type Shape = Record<string, Schema<unknown>>

export type InferSchema<S>
  = S extends Schema<infer T>
    ? T
    : never

export type InferObject<S extends Shape> = {
  [K in keyof S as S[K] extends OptionalSchema<any> ? K : never]?:
  InferSchema<S[K]>
} & {
  [K in keyof S as S[K] extends OptionalSchema<any> ? never : K]:
  InferSchema<S[K]>
}
