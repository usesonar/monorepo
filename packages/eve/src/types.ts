/* eslint-disable anti-slop/no-unknown-returns -- The call-signature conditions below reject callable map types; no unknown-returning function is exposed. */
import type {
  DeepResearchConfig,
  DeepResearchCompanyInput,
  DeepResearchPersonInput,
  Field,
  JSONValue,
  ResearchConfig,
  ResearchCompanyInput,
  ResearchPersonInput,
  SonarClient,
  SonarSeed,
  SonarSnapshot,
  ValidDeepResearchEntityInput,
  ValidResearchEntityInput,
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

type IsAny<Value> = 0 extends 1 & Value ? true : false
type IsUnion<Value, Whole = Value> = Value extends unknown
  ? [Whole] extends [Value]
    ? false
    : true
  : never
type IsCallableObject<Values extends object> = Values extends (...arguments_: never[]) => unknown
  ? true
  : Values extends abstract new (...arguments_: never[]) => unknown
    ? true
    : false
type OptionalKeys<Values extends object> = {
  [Key in keyof Values]-?: Readonly<Record<never, never>> extends Pick<Values, Key> ? Key : never
}[keyof Values]
type InvalidKeys<Values extends object> = {
  [Key in keyof Values & string]: IsValidQuestionKey<Key> extends true ? never : Key
}[keyof Values & string]

type ValidFiniteAnswers<Answers extends object, Value> =
  true extends IsAny<Answers>
    ? never
    : true extends IsUnion<Answers>
      ? never
      : true extends IsCallableObject<Answers>
        ? never
        : string extends keyof Answers
          ? never
          : Exclude<keyof Answers, string> extends never
            ? [OptionalKeys<Answers> | InvalidKeys<Answers>] extends [never]
              ? Answers[keyof Answers] extends Value
                ? Answers
                : never
              : never
            : never

export type DynamicAnswers = {
  readonly person?: object
  readonly company?: object
}

type ValidDynamicEntity<Answers, Value> = Answers extends object
  ? ValidFiniteAnswers<Answers, Value>
  : never

type EntityAnswers<
  Answers extends DynamicAnswers,
  Slot extends "person" | "company",
> = Slot extends keyof Answers ? NonNullable<Answers[Slot]> : Readonly<Record<never, never>>

export type DynamicFactoryArgument<
  Config extends ResearchDynamicConfig | DeepResearchDynamicConfig,
  Answers extends DynamicAnswers,
  Value,
> = [Answers] extends [never]
  ? Config
  : true extends IsAny<Answers>
    ? never
    : true extends IsUnion<Answers>
      ? never
      : Exclude<keyof Answers, "person" | "company"> extends never
        ? ValidDynamicEntity<EntityAnswers<Answers, "person">, Value> extends never
          ? never
          : ValidDynamicEntity<EntityAnswers<Answers, "company">, Value> extends never
            ? never
            : Config
        : never

export type ResearchStaticFactoryConfig = ResearchConfig
export type DeepResearchStaticFactoryConfig = DeepResearchConfig

type InvalidSelectionValues<Entity extends object, Fields extends PropertyKey> = {
  [Key in keyof Entity & Fields]-?: true extends IsAny<Entity[Key]>
    ? Key
    : Exclude<Entity[Key], undefined> extends true
      ? never
      : Key
}[keyof Entity & Fields]

type ExactEntityArgument<
  Entity extends object,
  Fields extends PropertyKey,
  Namespace extends PropertyKey,
  ForbiddenFields extends PropertyKey,
> =
  Exclude<keyof Entity, Fields | Namespace | ForbiddenFields> extends never
    ? InvalidSelectionValues<Entity, Fields> extends never
      ? Entity
      : never
    : never

type ValidResearchEntityArgument<
  Entity extends ResearchPersonInput | ResearchCompanyInput,
  Fields extends ResearchPersonField | ResearchCompanyField,
  ForbiddenFields extends PropertyKey,
> =
  ValidResearchEntityInput<Entity> extends never
    ? never
    : ExactEntityArgument<Entity, Fields, "research", ForbiddenFields>

type ValidDeepResearchEntityArgument<
  Entity extends DeepResearchPersonInput | DeepResearchCompanyInput,
  Fields extends DeepResearchPersonField | DeepResearchCompanyField,
  ForbiddenFields extends PropertyKey,
> =
  ValidDeepResearchEntityInput<Entity> extends never
    ? never
    : ExactEntityArgument<Entity, Fields, "deepResearch", ForbiddenFields>

type HasExactStaticConfigKeys<Config extends object> =
  Exclude<keyof Config, "ttl" | "person" | "company" | "seed"> extends never ? unknown : never

export type ResearchStaticFactoryArgument<Config extends ResearchStaticFactoryConfig> = Config &
  HasExactStaticConfigKeys<Config> &
  (Config["person"] extends ValidResearchEntityArgument<
    Config["person"],
    ResearchPersonField,
    DeepResearchPersonField | "deepResearch"
  >
    ? unknown
    : never) &
  (Config["company"] extends ValidResearchEntityArgument<
    Config["company"],
    ResearchCompanyField,
    DeepResearchCompanyField | "deepResearch"
  >
    ? unknown
    : never)
export type DeepResearchStaticFactoryArgument<Config extends DeepResearchStaticFactoryConfig> =
  Config &
    HasExactStaticConfigKeys<Config> &
    (Config["person"] extends ValidDeepResearchEntityArgument<
      Config["person"],
      DeepResearchPersonField,
      ResearchPersonField | "research"
    >
      ? unknown
      : never) &
    (Config["company"] extends ValidDeepResearchEntityArgument<
      Config["company"],
      DeepResearchCompanyField,
      ResearchCompanyField | "research"
    >
      ? unknown
      : never)

export type ResearchDynamicConfig = {
  readonly dynamic: true
  readonly ttl: string
  readonly person?: never
  readonly company?: never
  readonly description?: never
  readonly execution?: never
}

export type DeepResearchDynamicConfig = ResearchDynamicConfig

export type ResearchFactoryConfig = ResearchStaticFactoryConfig | ResearchDynamicConfig
export type DeepResearchFactoryConfig = DeepResearchStaticFactoryConfig | DeepResearchDynamicConfig

type DynamicResearchPerson = Partial<Record<ResearchPersonField, true>> & {
  readonly research?: Readonly<Record<string, Readonly<Record<string, JSONValue>>>>
}

type DynamicResearchCompany = Partial<Record<ResearchCompanyField, true>> & {
  readonly research?: Readonly<Record<string, Readonly<Record<string, JSONValue>>>>
}

type DynamicDeepResearchPerson = Partial<Record<DeepResearchPersonField, true>> & {
  readonly deepResearch?: Readonly<Record<string, string>>
}

type DynamicDeepResearchCompany = Partial<Record<DeepResearchCompanyField, true>> & {
  readonly deepResearch?: Readonly<Record<string, string>>
}

export type ResearchInput<Config extends ResearchFactoryConfig> =
  Config extends ResearchDynamicConfig
    ? SonarSeed & {
        readonly person: DynamicResearchPerson
        readonly company: DynamicResearchCompany
      }
    : SonarSeed

export type DeepResearchInput<Config extends DeepResearchFactoryConfig> =
  Config extends DeepResearchDynamicConfig
    ? SonarSeed & {
        readonly person: DynamicDeepResearchPerson
        readonly company: DynamicDeepResearchCompany
      }
    : SonarSeed

type DynamicAnswerFields<Answers extends object, Value> = [Answers] extends [never]
  ? Readonly<Record<never, never>>
  : { readonly [Key in keyof Answers & string]?: Field<Extract<Answers[Key], Value>> }

type WithDynamicAnswers<Entity, Answers extends object, Value, Tier extends string> = Entity &
  ([Answers] extends [never]
    ? object
    : { readonly [Key in Tier]?: DynamicAnswerFields<Answers, Value> })

type BroadResearchSnapshot = SonarSnapshot<ResearchConfig>
type BroadDeepResearchSnapshot = SonarSnapshot<DeepResearchConfig>

export type ResearchSnapshot<
  Config extends ResearchFactoryConfig,
  Answers extends DynamicAnswers,
> = Config extends ResearchDynamicConfig
  ? {
      readonly status: "pending" | "complete"
      readonly data: {
        readonly person: WithDynamicAnswers<
          BroadResearchSnapshot["data"]["person"],
          EntityAnswers<Answers, "person">,
          JSONValue,
          "research"
        >
        readonly company: WithDynamicAnswers<
          BroadResearchSnapshot["data"]["company"],
          EntityAnswers<Answers, "company">,
          JSONValue,
          "research"
        >
      }
    }
  : Config extends ResearchConfig
    ? SonarSnapshot<Config>
    : never

export type DeepResearchSnapshot<
  Config extends DeepResearchFactoryConfig,
  Answers extends DynamicAnswers,
> = Config extends DeepResearchDynamicConfig
  ? {
      readonly status: "pending" | "complete"
      readonly data: {
        readonly person: WithDynamicAnswers<
          BroadDeepResearchSnapshot["data"]["person"],
          EntityAnswers<Answers, "person">,
          string,
          "deepResearch"
        >
        readonly company: WithDynamicAnswers<
          BroadDeepResearchSnapshot["data"]["company"],
          EntityAnswers<Answers, "company">,
          string,
          "deepResearch"
        >
      }
    }
  : Config extends DeepResearchConfig
    ? SonarSnapshot<Config>
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
  Answers extends DynamicAnswers = never,
> = SonarForegroundTool<ResearchInput<Config>, ResearchSnapshot<Config, Answers>>

export type DeepResearchTool<
  Config extends DeepResearchFactoryConfig,
  Answers extends DynamicAnswers = never,
> = SonarForegroundTool<DeepResearchInput<Config>, DeepResearchSnapshot<Config, Answers>>

export type BackgroundDeepResearchTool<
  Config extends DeepResearchFactoryConfig,
  Answers extends DynamicAnswers = never,
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
