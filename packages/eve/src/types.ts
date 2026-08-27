/* eslint-disable anti-slop/no-unknown-returns -- The call-signature condition below only rejects callable map types; no unknown-returning function is exposed. */
import type {
  AnswerOf,
  DeepResearchConfig,
  Field,
  JSONValue,
  ResearchConfig,
  SonarClient,
  SonarSeed,
} from "@usesonar/effect"
import type { Layer } from "effect"
import type { BackgroundToolDefinition, TaskExec, ToolContext, ToolDefinition } from "eve/tools"

export const researchPersonFields = ["linkedin", "title", "x", "github"] as const
export const researchCompanyFields = [
  "domain",
  "name",
  "logo",
  "colors",
  "location",
  "description",
  "funding",
] as const
export const deepResearchPersonFields = ["phone"] as const
export const deepResearchCompanyFields = ["legalName"] as const

export type ResearchPersonField = (typeof researchPersonFields)[number]
export type ResearchCompanyField = (typeof researchCompanyFields)[number]
export type DeepResearchPersonField = (typeof deepResearchPersonFields)[number]
export type DeepResearchCompanyField = (typeof deepResearchCompanyFields)[number]

type ReservedQuestionKey = "ttl" | "person" | "company" | "research" | "deepResearch"
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
type DecimalDigit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
type QuestionKeyCharacter = LowercaseLetter | UppercaseLetter | DecimalDigit

type HasValidQuestionKeyTail<Key extends string> = Key extends ""
  ? true
  : Key extends `${QuestionKeyCharacter}${infer Rest}`
    ? HasValidQuestionKeyTail<Rest>
    : false

type IsValidQuestionKey<Key extends string> = Key extends ReservedQuestionKey
  ? false
  : Key extends `${LowercaseLetter}${infer Rest}`
    ? HasValidQuestionKeyTail<Rest>
    : false

type CustomEntries = object

type InvalidCustomKeys<Values extends CustomEntries> = {
  [Key in keyof Values & string]: IsValidQuestionKey<Key> extends true ? never : Key
}[keyof Values & string]

type InvalidCustomValues<Values extends CustomEntries, Allowed> = {
  [Key in keyof Values]-?: true extends IsAny<Values[Key]>
    ? Key
    : undefined extends Values[Key]
      ? Key
      : Values[Key] extends Allowed
        ? never
        : Key
}[keyof Values]

type OptionalCustomKeys<Values extends CustomEntries> = {
  [Key in keyof Values]-?: Readonly<Record<never, never>> extends Pick<Values, Key> ? Key : never
}[keyof Values]

type HasOnlyStringIndexKeys<Values extends CustomEntries> =
  Exclude<keyof Values, string> extends infer Extra
    ? [Extra] extends [never]
      ? true
      : [Exclude<Extra, number>] extends [never]
        ? number extends Extra
          ? true
          : false
        : false
    : false

type IsCallableObject<Values extends CustomEntries> = Values extends (
  ...arguments_: never[]
) => unknown
  ? true
  : Values extends abstract new (...arguments_: never[]) => unknown
    ? true
    : false

type IsBroadObject<Values extends CustomEntries> = keyof Values extends never
  ? string extends Values
    ? false
    : object extends Values
      ? true
      : false
  : false

type CustomKeyConstraint<Values extends CustomEntries, Allowed> = Values extends unknown
  ? true extends IsBroadObject<Values> | IsCallableObject<Values>
    ? "invalid"
    : string extends keyof Values
      ? true extends HasOnlyStringIndexKeys<Values>
        ? [InvalidCustomValues<Values, Allowed>] extends [never]
          ? "open"
          : "invalid"
        : "invalid"
      : Exclude<keyof Values, string> extends never
        ? [
            | InvalidCustomKeys<Values>
            | InvalidCustomValues<Values, Allowed>
            | OptionalCustomKeys<Values>,
          ] extends [never]
          ? "valid"
          : "invalid"
        : "invalid"
  : never

type IsUnion<Value, Whole = Value> = Value extends unknown
  ? [Whole] extends [Value]
    ? false
    : true
  : never

type IsAny<Value> = 0 extends 1 & Value ? true : false

type HasAnyTupleElement<Keys extends readonly PropertyKey[]> = number extends Keys["length"]
  ? false
  : Keys extends readonly [infer Head extends PropertyKey, ...infer Tail extends PropertyKey[]]
    ? true extends IsAny<Head>
      ? true
      : HasAnyTupleElement<Tail>
    : false

type ValidCustomKeys<Values extends CustomEntries, Allowed> =
  true extends IsUnion<Values>
    ? never
    : "invalid" extends CustomKeyConstraint<Values, Allowed>
      ? never
      : Values

type ValidDynamicCustomKeys<Values extends CustomEntries> =
  Extract<CustomKeyConstraint<Values, JSONValue>, "invalid" | "open"> extends never ? Values : never

type QuestionMap = CustomEntries

type ValidQuestions<Questions extends QuestionMap> = ValidCustomKeys<Questions, string>

export type ResearchStaticConfig<Questions extends QuestionMap> = {
  readonly ttl: string
  readonly person: readonly ResearchPersonField[]
  readonly company: readonly ResearchCompanyField[]
  readonly research: Questions
  readonly deepResearch?: never
  readonly dynamic?: never
  readonly description?: never
  readonly execution?: never
}

export type DeepResearchStaticConfig<Questions extends QuestionMap> = {
  readonly ttl: string
  readonly person: readonly DeepResearchPersonField[]
  readonly company: readonly DeepResearchCompanyField[]
  readonly deepResearch: Questions
  readonly research?: never
  readonly dynamic?: never
  readonly description?: never
  readonly execution?: never
}

export type ResearchDynamicConfig = {
  readonly dynamic: true
  readonly ttl: string
  readonly person?: never
  readonly company?: never
  readonly research?: never
  readonly deepResearch?: never
  readonly description?: never
  readonly execution?: never
}

export type DeepResearchDynamicConfig = {
  readonly dynamic: true
  readonly ttl: string
  readonly person?: never
  readonly company?: never
  readonly deepResearch?: never
  readonly research?: never
  readonly description?: never
  readonly execution?: never
}

export type DynamicFactoryArgument<
  Config extends ResearchDynamicConfig | DeepResearchDynamicConfig,
  Answers extends CustomEntries,
> =
  true extends IsAny<Answers>
    ? never
    : [Answers] extends [never]
      ? Config
      : true extends IsUnion<Answers>
        ? never
        : [ValidDynamicCustomKeys<Answers>] extends [never]
          ? never
          : Config

export type ResearchStaticFactoryConfig = ResearchStaticConfig<QuestionMap>
export type DeepResearchStaticFactoryConfig = DeepResearchStaticConfig<QuestionMap>

export type ResearchStaticFactoryArgument<Config extends ResearchStaticFactoryConfig> =
  true extends IsAny<Config>
    ? never
    : true extends HasAnyTupleElement<Config["person"]> | HasAnyTupleElement<Config["company"]>
      ? never
      : Config & {
          readonly research: ValidQuestions<Config["research"]>
        }

export type DeepResearchStaticFactoryArgument<Config extends DeepResearchStaticFactoryConfig> =
  true extends IsAny<Config>
    ? never
    : true extends HasAnyTupleElement<Config["person"]> | HasAnyTupleElement<Config["company"]>
      ? never
      : Config & {
          readonly deepResearch: ValidQuestions<Config["deepResearch"]>
        }

export type ResearchFactoryConfig = ResearchStaticFactoryConfig | ResearchDynamicConfig
export type DeepResearchFactoryConfig = DeepResearchStaticFactoryConfig | DeepResearchDynamicConfig

export type ResearchInput<Config extends ResearchFactoryConfig> =
  Config extends ResearchDynamicConfig
    ? SonarSeed & {
        readonly person: readonly ResearchPersonField[]
        readonly company: readonly ResearchCompanyField[]
        readonly research: Readonly<Record<string, string>>
      }
    : SonarSeed

export type DeepResearchInput<Config extends DeepResearchFactoryConfig> =
  Config extends DeepResearchDynamicConfig
    ? SonarSeed & {
        readonly person: readonly DeepResearchPersonField[]
        readonly company: readonly DeepResearchCompanyField[]
        readonly deepResearch: Readonly<Record<string, string>>
      }
    : SonarSeed

type ResearchPersonCatalog = {
  readonly linkedin: string
  readonly title: string
  readonly x: string
  readonly github: string
}

type ResearchCompanyCatalog = {
  readonly domain: string
  readonly name: string
  readonly logo: string
  readonly colors: JSONValue
  readonly location: JSONValue
  readonly description: string
  readonly funding: JSONValue
}

type DeepResearchPersonCatalog = { readonly phone: string }
type DeepResearchCompanyCatalog = { readonly legalName: string }

type HasUnionElement<Keys extends readonly PropertyKey[]> = Keys extends readonly []
  ? false
  : Keys extends readonly [infer Head extends PropertyKey, ...infer Tail extends PropertyKey[]]
    ? true extends IsAny<Head>
      ? true
      : true extends IsUnion<Head>
        ? true
        : HasUnionElement<Tail>
    : false

type Selected<Catalog, Keys extends readonly PropertyKey[]> = {
  readonly [Key in Keys[number] & keyof Catalog]: Field<Catalog[Key]>
} extends infer Fields
  ? number extends Keys["length"]
    ? Partial<Fields>
    : true extends IsUnion<Keys>
      ? Partial<Fields>
      : true extends HasUnionElement<Keys>
        ? Partial<Fields>
        : Fields
  : never

// Broad custom keys share a flat object with the reserved person/company containers. This
// read-precise intersection is library-produced; construct fixtures from finite configs.
type AnswerFields<Answers extends CustomEntries> = [Answers] extends [never]
  ? Readonly<Record<never, never>>
  : Answers extends unknown
    ? string extends keyof Answers
      ? Readonly<Record<string, Field<JSONValue> | undefined>>
      : {
          readonly [Key in keyof Answers & string]: Field<Extract<Answers[Key], JSONValue>>
        }
    : never

type DynamicAnswerFields<Answers extends CustomEntries> = [Answers] extends [never]
  ? Readonly<Record<never, never>>
  : { readonly [Key in keyof Answers & string]?: Field<Extract<Answers[Key], JSONValue>> }

type StaticAnswers<Questions extends QuestionMap> = {
  readonly [Key in keyof Questions & string]: AnswerOf<Questions[Key]>
}

export type ResearchSnapshot<
  Config extends ResearchFactoryConfig,
  Answers extends CustomEntries,
> = Config extends ResearchDynamicConfig
  ? {
      readonly status: "pending" | "complete"
      readonly data: {
        readonly person: Partial<Selected<ResearchPersonCatalog, readonly ResearchPersonField[]>>
        readonly company: Partial<Selected<ResearchCompanyCatalog, readonly ResearchCompanyField[]>>
      } & DynamicAnswerFields<Answers>
    }
  : Config extends ResearchStaticConfig<infer Questions>
    ? {
        readonly status: "pending" | "complete"
        readonly data: {
          readonly person: Selected<ResearchPersonCatalog, Config["person"]>
          readonly company: Selected<ResearchCompanyCatalog, Config["company"]>
        } & AnswerFields<StaticAnswers<Questions>>
      }
    : never

export type DeepResearchSnapshot<
  Config extends DeepResearchFactoryConfig,
  Answers extends CustomEntries,
> = Config extends DeepResearchDynamicConfig
  ? {
      readonly status: "pending" | "complete"
      readonly data: {
        readonly person: Partial<
          Selected<DeepResearchPersonCatalog, readonly DeepResearchPersonField[]>
        >
        readonly company: Partial<
          Selected<DeepResearchCompanyCatalog, readonly DeepResearchCompanyField[]>
        >
      } & DynamicAnswerFields<Answers>
    }
  : Config extends DeepResearchStaticConfig<infer Questions>
    ? {
        readonly status: "pending" | "complete"
        readonly data: {
          readonly person: Selected<DeepResearchPersonCatalog, Config["person"]>
          readonly company: Selected<DeepResearchCompanyCatalog, Config["company"]>
        } & AnswerFields<StaticAnswers<Questions>>
      }
    : never

export type ResearchOptions = {
  readonly layer?: Layer.Layer<SonarClient>
  readonly description?: string
}

export type DeepResearchOptions = ResearchOptions & {
  readonly execution?: "background"
}

export type ResearchTool<
  Config extends ResearchFactoryConfig,
  Answers extends CustomEntries = never,
> = SonarForegroundTool<ResearchInput<Config>, ResearchSnapshot<Config, Answers>>

export type DeepResearchTool<
  Config extends DeepResearchFactoryConfig,
  Answers extends CustomEntries = never,
> = SonarForegroundTool<DeepResearchInput<Config>, DeepResearchSnapshot<Config, Answers>>

export type BackgroundDeepResearchTool<
  Config extends DeepResearchFactoryConfig,
  Answers extends CustomEntries = never,
> = SonarBackgroundTool<DeepResearchInput<Config>, DeepResearchSnapshot<Config, Answers>>

type SonarModelOutput = {
  readonly type: "json"
  readonly value: Readonly<Record<string, JSONValue>>
}

type BivariantProjection<Output> = {
  // eslint-disable-next-line typescript/method-signature-style -- The method form intentionally makes projection parameters bivariant so config-specific tools remain assignable to Eve's generic tool collection.
  bivarianceHack(output: Output): SonarModelOutput | Promise<SonarModelOutput>
}["bivarianceHack"]

type SonarStream<Output> = AsyncGenerator<Output, undefined, unknown>

type SonarForegroundTool<Input, Output> = Omit<
  ToolDefinition<Input, Output>,
  "execute" | "outputSchema" | "toModelOutput"
> & {
  // eslint-disable-next-line typescript/method-signature-style -- Eve invokes tools through a heterogeneous collection, so input parameters must retain method bivariance while the return keeps Sonar's generator contract.
  execute(input: Input, context: ToolContext): SonarStream<Output>
  readonly outputSchema: ToolDefinition<unknown, unknown>["outputSchema"]
  readonly toModelOutput?: BivariantProjection<Output>
}

type SonarBackgroundTool<Input, Output> = Omit<
  BackgroundToolDefinition<Input, Output>,
  "execute" | "outputSchema" | "toModelOutput"
> & {
  // eslint-disable-next-line typescript/method-signature-style -- Eve invokes tools through a heterogeneous collection, so input parameters must retain method bivariance while the return excludes delegated task receipts.
  execute(input: Input, context: ToolContext, task: TaskExec): Promise<Output> | Output
  readonly outputSchema: BackgroundToolDefinition<unknown, unknown>["outputSchema"]
  readonly toModelOutput?: BivariantProjection<Output>
}

export type AnyResearchConfig = ResearchConfig
export type AnyDeepResearchConfig = DeepResearchConfig
