import type {
  DeepResearchCompanyInput as APIDeepResearchCompanyInput,
  DeepResearchPersonInput as APIDeepResearchPersonInput,
  JSONValue as APIJSONValue,
  ResearchCompanyInput as APIResearchCompanyInput,
  ResearchOutput,
  ResearchPersonInput as APIResearchPersonInput,
  SonarSeed as APISonarSeed,
  TTL as APITTL,
} from "@usesonar/api"

export type JSONValue = APIJSONValue
export type SonarSeed = APISonarSeed
export type TTL = APITTL
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

export type ResearchConfig<
  Person extends APIResearchPersonInput<object> = APIResearchPersonInput,
  Company extends APIResearchCompanyInput<object> = APIResearchCompanyInput,
> = {
  readonly ttl: TTL
  readonly seed?: never
  readonly person: Person & { readonly deepResearch?: never; readonly phone?: never }
  readonly company: Company & { readonly deepResearch?: never; readonly legalName?: never }
}

export type DeepResearchConfig<
  Person extends APIDeepResearchPersonInput<object> = APIDeepResearchPersonInput,
  Company extends APIDeepResearchCompanyInput<object> = APIDeepResearchCompanyInput,
> = {
  readonly ttl: TTL
  readonly seed?: never
  readonly person: Person & {
    readonly github?: never
    readonly linkedin?: never
    readonly research?: never
    readonly title?: never
    readonly x?: never
  }
  readonly company: Company & {
    readonly colors?: never
    readonly description?: never
    readonly domain?: never
    readonly funding?: never
    readonly location?: never
    readonly logo?: never
    readonly name?: never
    readonly research?: never
  }
}

export type AnyResearchConfig = ResearchConfig<
  APIResearchPersonInput<object>,
  APIResearchCompanyInput<object>
>
export type AnyDeepResearchConfig = DeepResearchConfig<
  APIDeepResearchPersonInput<object>,
  APIDeepResearchCompanyInput<object>
>

export type ResearchRequest<C extends AnyResearchConfig = ResearchConfig> = Omit<C, "seed"> & {
  readonly seed: SonarSeed
}

export type DeepResearchRequest<C extends AnyDeepResearchConfig = DeepResearchConfig> = Omit<
  C,
  "seed"
> & {
  readonly seed: SonarSeed
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

type SelectedFields<Catalog, Entity extends object> = {
  readonly [
    Key in keyof Catalog as Key extends keyof Entity
      ? true extends Entity[Key]
        ? object extends Pick<Entity, Key>
          ? never
          : Key
        : never
      : never
  ]: Field<Catalog[Key]>
} & {
  readonly [
    Key in keyof Catalog as Key extends keyof Entity
      ? true extends Entity[Key]
        ? object extends Pick<Entity, Key>
          ? Key
          : never
        : never
      : never
  ]?: Field<Catalog[Key]>
}

type QuestionsOf<
  Entity extends object,
  Tier extends "research" | "deepResearch",
> = Tier extends keyof Entity ? Extract<NonNullable<Entity[Tier]>, object> : Record<never, never>

type ResearchAnswerFields<Questions extends object> = string extends keyof Questions
  ? Readonly<Record<string, Field<JSONValue> | undefined>>
  : { readonly [Key in keyof Questions]: Field<ResearchOutput<Questions[Key]>> }

type DeepResearchAnswerFields<Questions extends object> = string extends keyof Questions
  ? Readonly<Record<string, Field<string> | undefined>>
  : { readonly [Key in keyof Questions]: Field<string> }

type ResearchNamespace<Entity extends object> = keyof QuestionsOf<Entity, "research"> extends never
  ? object
  : object extends Pick<Entity, Extract<"research", keyof Entity>>
    ? { readonly research?: ResearchAnswerFields<QuestionsOf<Entity, "research">> }
    : { readonly research: ResearchAnswerFields<QuestionsOf<Entity, "research">> }

type DeepResearchNamespace<Entity extends object> = keyof QuestionsOf<
  Entity,
  "deepResearch"
> extends never
  ? object
  : object extends Pick<Entity, Extract<"deepResearch", keyof Entity>>
    ? { readonly deepResearch?: DeepResearchAnswerFields<QuestionsOf<Entity, "deepResearch">> }
    : { readonly deepResearch: DeepResearchAnswerFields<QuestionsOf<Entity, "deepResearch">> }

type ResearchDataOf<C extends AnyResearchConfig> = {
  readonly person: SelectedFields<ResearchPersonCatalog, C["person"]> &
    ResearchNamespace<C["person"]>
  readonly company: SelectedFields<ResearchCompanyCatalog, C["company"]> &
    ResearchNamespace<C["company"]>
}

type DeepResearchDataOf<C extends AnyDeepResearchConfig> = {
  readonly person: SelectedFields<DeepResearchPersonCatalog, C["person"]> &
    DeepResearchNamespace<C["person"]>
  readonly company: SelectedFields<DeepResearchCompanyCatalog, C["company"]> &
    DeepResearchNamespace<C["company"]>
}

export type SonarData<C extends AnyResearchConfig | AnyDeepResearchConfig> =
  C extends AnyResearchConfig
    ? ResearchDataOf<C>
    : C extends AnyDeepResearchConfig
      ? DeepResearchDataOf<C>
      : never

export type SonarSnapshot<C extends AnyResearchConfig | AnyDeepResearchConfig> = {
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

const researchPersonFields = ["linkedin", "title", "x", "github"] as const
const researchCompanyFields = [
  "domain",
  "name",
  "logo",
  "colors",
  "location",
  "description",
  "funding",
] as const
const deepResearchPersonFields = ["phone"] as const
const deepResearchCompanyFields = ["legalName"] as const

const pendingFields = (keys: readonly string[]): Record<string, Field> =>
  Object.fromEntries(keys.map((key) => [key, { status: "pending" }]))

type ConfigEntity = ReadonlyMap<string, true | object>
type FieldNamespace = Readonly<Record<string, Field>>
type SnapshotEntity = { readonly [key: string]: Field | FieldNamespace | undefined }

const entitySnapshot = (
  entity: ConfigEntity,
  builtIns: readonly string[],
  tier: "research" | "deepResearch"
) => {
  const selected = builtIns.filter((key) => entity.get(key) === true)
  const questions = entity.get(tier)
  const questionKeys = questions === undefined || questions === true ? [] : Object.keys(questions)
  const snapshot: Record<string, Field | Record<string, Field>> = pendingFields(selected)
  if (questionKeys.length > 0) {
    snapshot[tier] = pendingFields(questionKeys)
  }
  return snapshot
}

export const initialSnapshot = <const C extends AnyResearchConfig | AnyDeepResearchConfig>(
  config: C
): SonarSnapshot<C> => {
  const research =
    "research" in config.person ||
    "research" in config.company ||
    researchPersonFields.some((key) => key in config.person) ||
    researchCompanyFields.some((key) => key in config.company)
  const tier = research ? "research" : "deepResearch"
  const personFields = research ? researchPersonFields : deepResearchPersonFields
  const companyFields = research ? researchCompanyFields : deepResearchCompanyFields
  // SAFETY: Both config entities contain only literal-true built-ins and object question maps.
  const personConfig = new Map(Object.entries(config.person)) as ConfigEntity
  // SAFETY: Both config entities contain only literal-true built-ins and object question maps.
  const companyConfig = new Map(Object.entries(config.company)) as ConfigEntity
  // oxlint-disable-next-line sort-keys -- The public result contract requires person before company.
  const data = {
    person: entitySnapshot(personConfig, personFields, tier),
    company: entitySnapshot(companyConfig, companyFields, tier),
  }
  // SAFETY: Each selected built-in and entity-owned question key from C is represented once as a
  // pending Field under the operation-derived namespace.
  return { data, status: "pending" } as SonarSnapshot<C>
}

const entityPaths = (slot: "person" | "company", entity: SnapshotEntity) =>
  Object.entries(entity).flatMap(([key, value]) =>
    key === "research" || key === "deepResearch"
      ? Object.keys(value ?? {}).map((answerKey) => `${slot}.${key}.${answerKey}`)
      : [`${slot}.${key}`]
  )

export const snapshotPaths = <C extends AnyResearchConfig | AnyDeepResearchConfig>(
  snapshot: SonarSnapshot<C>
) => {
  // SAFETY: SonarData entity properties contain only Field leaves and answer namespaces.
  const person = snapshot.data.person as SnapshotEntity
  // SAFETY: SonarData entity properties contain only Field leaves and answer namespaces.
  const company = snapshot.data.company as SnapshotEntity
  return [...entityPaths("person", person), ...entityPaths("company", company)]
}

export const fieldAtPath = <C extends AnyResearchConfig | AnyDeepResearchConfig>(
  snapshot: SonarSnapshot<C>,
  path: string
): Field | undefined => {
  const [entityKey, fieldKey, answerKey, extra] = path.split(".")
  if (
    extra !== undefined ||
    fieldKey === undefined ||
    (entityKey !== "person" && entityKey !== "company")
  ) {
    return undefined
  }
  // SAFETY: SonarData entity properties contain only Field leaves and answer namespaces.
  const entity = snapshot.data[entityKey] as SnapshotEntity
  if (answerKey === undefined) {
    const field = entity[fieldKey]
    if (fieldKey === "research" || fieldKey === "deepResearch") {
      return undefined
    }
    // SAFETY: Non-namespace properties on a snapshot entity contain only Field leaves.
    return field as Field | undefined
  }
  if (fieldKey !== "research" && fieldKey !== "deepResearch") {
    return undefined
  }
  // SAFETY: The guarded field key can contain only an entity-owned answer namespace.
  const answers = entity[fieldKey] as FieldNamespace | undefined
  return answers?.[answerKey]
}

export const withField = <C extends AnyResearchConfig | AnyDeepResearchConfig>(
  snapshot: SonarSnapshot<C>,
  path: string,
  field: Field
): SonarSnapshot<C> => {
  // SAFETY: reduceSnapshot calls withField only after fieldAtPath validates the path structure.
  const [entityKey, fieldKey, answerKey] = path.split(".") as [
    "person" | "company",
    string,
    string | undefined,
  ]
  // SAFETY: SonarData entity properties contain only Field leaves and answer namespaces.
  const entity = snapshot.data[entityKey] as SnapshotEntity
  const nextEntity =
    answerKey === undefined
      ? { ...entity, [fieldKey]: field }
      : {
          ...entity,
          [fieldKey]: {
            // SAFETY: A three-segment validated path always targets an answer namespace.
            ...(entity[fieldKey] as FieldNamespace),
            [answerKey]: field,
          },
        }
  // SAFETY: reduceSnapshot calls this only after fieldAtPath proves that path names an existing
  // Field leaf, so this preserves C's config-derived data shape.
  return {
    data: { ...snapshot.data, [entityKey]: nextEntity },
    status: "pending",
  } as SonarSnapshot<C>
}
