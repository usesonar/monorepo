import type {
  AnswersOf,
  JSONValue as APIJSONValue,
  SonarSeed as APISonarSeed,
  TTL as APITTL,
} from "@usesonar/api"

export type JSONValue = APIJSONValue
export type SonarSeed = APISonarSeed
export type TTL = APITTL

export type ResearchPersonField = "linkedin" | "title" | "x" | "github"
export type ResearchCompanyField =
  | "domain"
  | "name"
  | "logo"
  | "colors"
  | "location"
  | "description"
  | "funding"
export type DeepResearchPersonField = "phone"
export type DeepResearchCompanyField = "legalName"

export type ResearchConfig<Questions extends object = Readonly<Record<string, string>>> = {
  readonly ttl: TTL
  readonly person: readonly ResearchPersonField[]
  readonly company: readonly ResearchCompanyField[]
  readonly research: Questions
  readonly deepResearch?: never
}

export type DeepResearchConfig<Questions extends object = Readonly<Record<string, string>>> = {
  readonly ttl: TTL
  readonly person: readonly DeepResearchPersonField[]
  readonly company: readonly DeepResearchCompanyField[]
  readonly deepResearch: Questions
  readonly research?: never
}

export type ResearchRequest<C extends ResearchConfig<object> = ResearchConfig> = C & {
  readonly seed: SonarSeed
}

export type DeepResearchRequest<C extends DeepResearchConfig<object> = DeepResearchConfig> = C & {
  readonly seed: SonarSeed
}

export type Field<Value = JSONValue> =
  | { readonly status: "pending" }
  | {
      readonly status: "resolved"
      readonly value: Value
      readonly confidence: number
      readonly sources: readonly string[]
      readonly resolvedAt: string
    }
  | {
      readonly status: "notFound"
      readonly reason?: "timeout" | "identityFailed" | "providerEmpty"
    }
  | {
      readonly status: "skipped"
      readonly reason: "consumerEmail" | "noPersonSeed" | "noCompanySeed"
    }

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

type IsUnion<Value, Whole = Value> = Value extends unknown
  ? [Whole] extends [Value]
    ? false
    : true
  : never

type IsAny<Value> = 0 extends 1 & Value ? true : false

type TupleHasUnionElement<Keys extends readonly PropertyKey[]> = Keys extends readonly [
  infer Head extends PropertyKey,
  ...infer Tail extends readonly PropertyKey[],
]
  ? true extends IsAny<Head>
    ? true
    : true extends IsUnion<Head>
      ? true
      : TupleHasUnionElement<Tail>
  : false

type Selected<Catalog, Keys extends readonly PropertyKey[]> = Keys extends unknown
  ? number extends Keys["length"]
    ? Partial<{
        readonly [Key in Keys[number] & keyof Catalog]: Field<Catalog[Key]>
      }>
    : true extends TupleHasUnionElement<Keys>
      ? Partial<{
          readonly [Key in Keys[number] & keyof Catalog]: Field<Catalog[Key]>
        }>
      : {
          readonly [Key in Keys[number] & keyof Catalog]: Field<Catalog[Key]>
        }
  : never

export type DefaultAnswers<C extends ResearchConfig<object> | DeepResearchConfig<object>> =
  C extends ResearchConfig<object>
    ? AnswersOf<C["research"]>
    : C extends DeepResearchConfig<object>
      ? AnswersOf<C["deepResearch"]>
      : never

type AnswerFields<Answers extends Readonly<Record<string, JSONValue | undefined>>> =
  Answers extends unknown
    ? string extends keyof Answers
      ? Readonly<Record<string, Field<JSONValue> | undefined>>
      : {
          readonly [Key in keyof Answers]: Field<Exclude<Answers[Key], undefined>>
        }
    : never

export type SonarData<C extends ResearchConfig<object> | DeepResearchConfig<object>> =
  C extends ResearchConfig<object>
    ? {
        readonly person: Selected<ResearchPersonCatalog, C["person"]>
        readonly company: Selected<ResearchCompanyCatalog, C["company"]>
      } & AnswerFields<DefaultAnswers<C>>
    : C extends DeepResearchConfig<object>
      ? {
          readonly person: Selected<DeepResearchPersonCatalog, C["person"]>
          readonly company: Selected<DeepResearchCompanyCatalog, C["company"]>
        } & AnswerFields<DefaultAnswers<C>>
      : never

export type SonarSnapshot<C extends ResearchConfig<object> | DeepResearchConfig<object>> = {
  readonly status: "pending" | "complete"
  readonly data: SonarData<C>
}

export type FieldEvent = {
  readonly _tag: "FieldEvent"
  readonly path: string
  readonly field: Field
}

export type CompleteEvent = { readonly _tag: "CompleteEvent" }
export type SonarProtocolEvent = FieldEvent | CompleteEvent

export const CompleteEvent: CompleteEvent = { _tag: "CompleteEvent" }

const pendingFields = (keys: readonly string[]): Record<string, Field> =>
  Object.fromEntries(keys.map((key) => [key, { status: "pending" }]))

export const initialSnapshot = <
  const C extends ResearchConfig<object> | DeepResearchConfig<object>,
>(
  config: C
): SonarSnapshot<C> => {
  const questions = ("research" in config ? config.research : config.deepResearch) ?? {}
  // oxlint-disable-next-line sort-keys -- The public result contract requires person before company.
  const data = {
    person: pendingFields(config.person),
    company: pendingFields(config.company),
    ...pendingFields(Object.keys(questions)),
  }
  // SAFETY: The data keys are constructed directly from C's selected catalog fields and
  // question keys, and every generated value is the valid pending Field variant.
  return { data, status: "pending" } as SonarSnapshot<C>
}

export const snapshotPaths = <C extends ResearchConfig<object> | DeepResearchConfig<object>>(
  snapshot: SonarSnapshot<C>
) => [
  ...Object.keys(snapshot.data.person).map((key) => `person.${key}`),
  ...Object.keys(snapshot.data.company).map((key) => `company.${key}`),
  ...Object.keys(snapshot.data).filter((key) => key !== "person" && key !== "company"),
]

export const fieldAtPath = <C extends ResearchConfig<object> | DeepResearchConfig<object>>(
  snapshot: SonarSnapshot<C>,
  path: string
): Field | undefined => {
  const [slot, key, extra] = path.split(".")
  if (extra !== undefined || key === undefined) {
    // SAFETY: A non-built-in path can only address a top-level custom Field leaf.
    const customFields = snapshot.data as SonarData<C> & Readonly<Record<string, Field | undefined>>
    return customFields[path]
  }
  if (slot === "person" || slot === "company") {
    // SAFETY: Both built-in slots contain only Field values; the path key is checked dynamically.
    const fields = snapshot.data[slot] as Readonly<Record<string, Field>>
    return fields[key]
  }
  return undefined
}

export const withField = <C extends ResearchConfig<object> | DeepResearchConfig<object>>(
  snapshot: SonarSnapshot<C>,
  path: string,
  field: Field
): SonarSnapshot<C> => {
  const [slot, key, extra] = path.split(".")
  const data =
    extra === undefined && key !== undefined && (slot === "person" || slot === "company")
      ? { ...snapshot.data, [slot]: { ...snapshot.data[slot], [key]: field } }
      : { ...snapshot.data, [path]: field }
  // SAFETY: Only one existing Field leaf is replaced, preserving the config-derived data shape.
  return {
    data,
    status: "pending",
  } as SonarSnapshot<C>
}
