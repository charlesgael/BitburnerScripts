export interface Schema<T> {
  parse: (input: string) => T
  validate: (input: unknown) => T
  optional: () => OptionalSchema<T>
}

export interface OptionalSchema<T> extends Schema<T | undefined> {
  readonly _optional: true
}

export interface StringSchema<T extends string = string> extends Schema<T> {
  min: (length: number) => StringSchema<T>
  max: (length: number) => StringSchema<T>
  len: (length: number) => StringSchema<T>
  email: () => StringSchema<T>
  regex: (pattern: RegExp) => StringSchema<T>
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
