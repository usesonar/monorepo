import type {
  DeepResearchConfig,
  ResearchConfig,
  SonarClientError,
  SonarSeed,
} from "@usesonar/effect"

type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
type LowercaseLetter =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z"
type UppercaseLetter = Uppercase<LowercaseLetter>
type IdentifierCharacter = LowercaseLetter | UppercaseLetter | Digit
type ReservedAnswerKey = "ttl" | "person" | "company" | "research" | "deepResearch"

type IsIdentifierTail<Value extends string> = Value extends ""
  ? true
  : Value extends `${IdentifierCharacter}${infer Rest}`
    ? IsIdentifierTail<Rest>
    : false

type IsCustomAnswerKey<Value extends string> = string extends Value
  ? false
  : Value extends ReservedAnswerKey
    ? false
    : Value extends `${LowercaseLetter}${infer Rest}`
      ? IsIdentifierTail<Rest>
      : false

type InvalidAnswerKeys<Questions extends Readonly<Record<string, string>>> = {
  [Key in keyof Questions & string]: IsCustomAnswerKey<Key> extends true ? never : Key
}[keyof Questions & string]

type IsUnion<Value, Whole = Value> = Value extends unknown
  ? [Whole] extends [Value]
    ? false
    : true
  : never

type OptionalKeys<Value> = {
  [Key in keyof Value]-?: object extends Pick<Value, Key> ? Key : never
}[keyof Value]

type QuestionRecord<Questions extends object> = {
  readonly [Key in keyof Questions]: Questions[Key]
}

type HasQuestionMapBehavior<Value> = Value extends (...arguments_: never[]) => infer _Return
  ? true
  : Value extends abstract new (...arguments_: never[]) => infer _Instance
    ? true
    : false

type ValidQuestions<Questions extends Readonly<Record<string, string>>> =
  true extends IsUnion<Questions>
    ? never
    : string extends keyof Questions
      ? Questions
      : [Exclude<keyof Questions, string>] extends [never]
        ? [OptionalKeys<Questions>] extends [never]
          ? [InvalidAnswerKeys<Questions>] extends [never]
            ? Questions
            : never
          : never
        : never

type ValidQuestionMap<Questions extends object> =
  true extends HasQuestionMapBehavior<Questions>
    ? never
    : [Exclude<keyof Questions, string>] extends [never]
      ? QuestionRecord<Questions> extends infer Normalized extends Readonly<Record<string, string>>
        ? ValidQuestions<Normalized> extends never
          ? never
          : Questions
        : never
      : never

type IsDigits<Value extends string> = Value extends ""
  ? false
  : Value extends `${Digit}${infer Rest}`
    ? Rest extends ""
      ? true
      : IsDigits<Rest>
    : false

type TrimLeadingZeros<Value extends string> = Value extends `0${infer Rest}`
  ? Rest extends ""
    ? "0"
    : TrimLeadingZeros<Rest>
  : Value

type StringLength<
  Value extends string,
  Accumulator extends unknown[] = [],
> = Value extends `${infer _First}${infer Rest}`
  ? StringLength<Rest, [unknown, ...Accumulator]>
  : Accumulator["length"]

type BuildTuple<
  Length extends number,
  Accumulator extends unknown[] = [],
> = Accumulator["length"] extends Length
  ? Accumulator
  : BuildTuple<Length, [unknown, ...Accumulator]>

type CompareLength<Left extends number, Right extends number> = Left extends Right
  ? "equal"
  : BuildTuple<Left> extends [...BuildTuple<Right>, ...unknown[]]
    ? "greater"
    : "less"

type DigitValue<Value extends Digit> = {
  readonly "0": 0
  readonly "1": 1
  readonly "2": 2
  readonly "3": 3
  readonly "4": 4
  readonly "5": 5
  readonly "6": 6
  readonly "7": 7
  readonly "8": 8
  readonly "9": 9
}[Value]
type CompareDigit<Left extends Digit, Right extends Digit> = Left extends Right
  ? "equal"
  : CompareLength<DigitValue<Left>, DigitValue<Right>>

type CompareEqualLength<
  Left extends string,
  Right extends string,
> = Left extends `${infer LeftDigit extends Digit}${infer LeftRest}`
  ? Right extends `${infer RightDigit extends Digit}${infer RightRest}`
    ? CompareDigit<LeftDigit, RightDigit> extends "equal"
      ? CompareEqualLength<LeftRest, RightRest>
      : CompareDigit<LeftDigit, RightDigit>
    : never
  : "equal"

type CompareDecimal<Left extends string, Right extends string> =
  CompareLength<
    StringLength<TrimLeadingZeros<Left>>,
    StringLength<TrimLeadingZeros<Right>>
  > extends infer LengthComparison
    ? LengthComparison extends "equal"
      ? CompareEqualLength<TrimLeadingZeros<Left>, TrimLeadingZeros<Right>>
      : LengthComparison
    : never

type IsInRange<Value extends string, Minimum extends string, Maximum extends string> =
  IsDigits<Value> extends true
    ? CompareDecimal<Value, Minimum> extends "less"
      ? false
      : CompareDecimal<Value, Maximum> extends "greater"
        ? false
        : true
    : false

type ValidTTL<Value extends string> = string extends Value
  ? Value
  : Value extends `${infer Amount}ms`
    ? IsInRange<Amount, "43200000", "31536000000"> extends true
      ? Value
      : never
    : Value extends `${infer Amount}s`
      ? IsInRange<Amount, "43200", "31536000"> extends true
        ? Value
        : never
      : Value extends `${infer Amount}m`
        ? IsInRange<Amount, "720", "525600"> extends true
          ? Value
          : never
        : Value extends `${infer Amount}h`
          ? IsInRange<Amount, "12", "8760"> extends true
            ? Value
            : never
          : Value extends `${infer Amount}d`
            ? IsInRange<Amount, "1", "365"> extends true
              ? Value
              : never
            : Value extends `${infer Amount}w`
              ? IsInRange<Amount, "1", "52"> extends true
                ? Value
                : never
              : never

export type ValidResearchConfig<C extends ResearchConfig<object>> = C & {
  readonly ttl: ValidTTL<C["ttl"]>
  readonly research: ValidQuestionMap<C["research"]>
}

export type ValidDeepResearchConfig<C extends DeepResearchConfig<object>> = C & {
  readonly ttl: ValidTTL<C["ttl"]>
  readonly deepResearch: ValidQuestionMap<C["deepResearch"]>
}

export type SonarResult<Data> = {
  readonly resolve: <const Seed>(seed: [Seed] extends [SonarSeed] ? Seed : never) => void
  readonly data: Data | null
  readonly status: "pending" | "complete" | undefined
  readonly loading: boolean
  readonly error: SonarClientError | null
}
