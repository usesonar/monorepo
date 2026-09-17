/* eslint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- StandardJSONSchemaV1 exposes unknown keyword records, and the authored-input compiler must discriminate executable validator objects before parsing their compiled JSON Schema at the HTTP boundary. */
// oxlint-disable sort-keys -- Schema declaration order preserves the public person-before-company wire order.

import { z } from "zod"

export type StandardJSONSchemaV1<Input = unknown, Output = Input> = {
  readonly "~standard": {
    readonly version: 1
    readonly vendor: string
    readonly types?: { readonly input: Input; readonly output: Output }
    readonly jsonSchema: {
      readonly input: (options: StandardJSONSchemaOptions) => Record<string, unknown>
      readonly output: (options: StandardJSONSchemaOptions) => Record<string, unknown>
    }
  }
}

export type StandardJSONSchemaOptions = {
  readonly target: string
  readonly libraryOptions?: Record<string, unknown>
}

export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue }

type JSONInputSnapshot = { success: true; value: JSONValue } | { success: false; message: string }
type JSONInputContainer = JSONInput[] | { [key: string]: JSONInput }
type JSONInput = null | boolean | number | string | JSONInputContainer | bigint | symbol | undefined

const invalidJSONInput = (message: string): JSONInputSnapshot => ({ success: false, message })

const isObjectInput = (input: JSONInput): input is JSONInputContainer =>
  input !== null && Object(input) === input

const JSONPrimitive = z.union([z.null(), z.boolean(), z.number(), z.string()])
const JSONInput = z.custom<JSONInput>(() => true)

const snapshotJSONInput = (input: JSONInput): JSONInputSnapshot => {
  const snapshotDescriptor = (descriptor: PropertyDescriptor): JSONInputSnapshot => {
    if ("value" in descriptor) {
      const { value } = descriptor
      return snapshotJSONInput(value)
    }
    const { get } = descriptor
    if (!get) {
      return invalidJSONInput("JSON accessors must provide a getter")
    }
    return snapshotJSONInput(get.call(input))
  }

  const primitive = JSONPrimitive.safeParse(input)
  if (primitive.success) {
    return { success: true, value: primitive.data }
  }
  if (!isObjectInput(input)) {
    return invalidJSONInput("JSON data contains an unsupported value")
  }

  if (Array.isArray(input)) {
    if (Object.getPrototypeOf(input) !== Array.prototype) {
      return invalidJSONInput("JSON arrays cannot inherit from a custom prototype")
    }
    const keys = Reflect.ownKeys(input)
    if (keys.length !== input.length + 1 || !keys.includes("length")) {
      return invalidJSONInput("JSON arrays must be dense and contain only indexed values")
    }
    const output: JSONValue[] = []
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, index.toString())
      if (!descriptor?.enumerable) {
        return invalidJSONInput("JSON array entries must be own enumerable data properties")
      }
      const entry = snapshotDescriptor(descriptor)
      if (!entry.success) {
        return entry
      }
      output.push(entry.value)
    }
    return { success: true, value: output }
  }

  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidJSONInput("JSON objects cannot inherit from a custom prototype")
  }

  const output: Record<string, JSONValue> = {}
  Object.setPrototypeOf(output, null)
  for (const rawKey of Reflect.ownKeys(input)) {
    const parsedKey = z.string().safeParse(rawKey)
    if (!parsedKey.success) {
      return invalidJSONInput("JSON objects cannot contain symbol keys")
    }
    const key = parsedKey.data
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (!descriptor?.enumerable) {
      return invalidJSONInput("JSON object entries must be own enumerable data properties")
    }
    const entry = snapshotDescriptor(descriptor)
    if (!entry.success) {
      return entry
    }
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      value: entry.value,
      writable: true,
    })
  }
  return { success: true, value: output }
}

const OwnedJSONInput: z.ZodType<JSONValue> = z.unknown().transform((input, context) => {
  const snapshot = snapshotJSONInput(JSONInput.parse(input))
  if (!snapshot.success) {
    context.addIssue({ code: "custom", message: snapshot.message })
    return z.NEVER
  }
  return snapshot.value
})

const jsonBoundary = <Output>(schema: z.ZodType<Output>): z.ZodType<Output> =>
  z.unknown().transform((input, context) => {
    const snapshot = snapshotJSONInput(JSONInput.parse(input))
    if (!snapshot.success) {
      context.addIssue({ code: "custom", message: snapshot.message })
      return z.NEVER
    }
    const parsed = schema.safeParse(snapshot.value)
    if (parsed.success) {
      return parsed.data
    }
    for (const issue of parsed.error.issues) {
      context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    }
    return z.NEVER
  })

const rejectPrototypeKey = <Output>(schema: z.ZodType<Output>): z.ZodType<Output> =>
  z.unknown().transform((input, context) => {
    const parsedInput = JSONInput.parse(input)
    if (isObjectInput(parsedInput) && Object.hasOwn(parsedInput, "__proto__")) {
      context.addIssue({ code: "custom", message: "__proto__ is not valid at this boundary" })
      return z.NEVER
    }
    const parsed = schema.safeParse(parsedInput)
    if (parsed.success) {
      return parsed.data
    }
    for (const issue of parsed.error.issues) {
      context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    }
    return z.NEVER
  })

export const JSONValue = OwnedJSONInput

const JSONObject: z.ZodType<Record<string, JSONValue>> = OwnedJSONInput.transform(
  (value, context) => {
    if (!isObjectInput(value)) {
      context.addIssue({ code: "custom", message: "Expected a JSON object" })
      return z.NEVER
    }
    if (Array.isArray(value)) {
      context.addIssue({ code: "custom", message: "Expected a JSON object" })
      return z.NEVER
    }
    return value
  }
)

const optionalSeedFields = {
  domain: z.string().trim().min(1).optional(),
  context: JSONObject.optional(),
}
const URLValue = z.string().trim().pipe(z.url())
const emailHasValidComponents = (email: string) => {
  const separator = email.lastIndexOf("@")
  const localPart = email.slice(0, separator)
  const domain = email.slice(separator + 1)
  if (
    new TextEncoder().encode(localPart).byteLength > 64 ||
    new TextEncoder().encode(domain).byteLength > 253
  ) {
    return false
  }
  return domain
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        new TextEncoder().encode(label).byteLength <= 63 &&
        !label.startsWith("-") &&
        !label.endsWith("-")
    )
}
const EmailValue = z.string().trim().pipe(z.email().refine(emailHasValidComponents))

const linkedinSeed = rejectPrototypeKey(
  z
    .object({
      linkedinURL: URLValue,
      fullName: z.string().trim().min(1).optional(),
      xURL: URLValue.optional(),
      email: EmailValue.optional(),
      ...optionalSeedFields,
    })
    .strict()
)

const xSeed = rejectPrototypeKey(
  z
    .object({
      linkedinURL: URLValue.optional(),
      fullName: z.string().trim().min(1),
      xURL: URLValue,
      email: EmailValue.optional(),
      ...optionalSeedFields,
    })
    .strict()
)

const emailSeed = rejectPrototypeKey(
  z
    .object({
      linkedinURL: URLValue.optional(),
      fullName: z.string().trim().min(1),
      xURL: URLValue.optional(),
      email: EmailValue,
      ...optionalSeedFields,
    })
    .strict()
)

const SonarSeedSchema = z.union([linkedinSeed, xSeed, emailSeed])
export const SonarSeed = jsonBoundary(SonarSeedSchema)
export type SonarSeed = z.infer<typeof SonarSeed>

const ttlPattern = /^(?<amount>\d+)(?<unit>ms|s|m|h|d|w)$/u
const minimumTTL = 12 * 3_600_000
const maximumTTL = 365 * 86_400_000

const ttlMultiplier = (unit: string) => {
  switch (unit) {
    case "ms": {
      return 1
    }
    case "s": {
      return 1000
    }
    case "m": {
      return 60_000
    }
    case "h": {
      return 3_600_000
    }
    case "d": {
      return 86_400_000
    }
    case "w": {
      return 604_800_000
    }
    default: {
      return Number.NaN
    }
  }
}

export const TTL = z
  .string()
  .regex(ttlPattern)
  .refine((value) => {
    const match = ttlPattern.exec(value)
    if (!match) {
      return false
    }
    const amount = Number(match.groups?.amount)
    const unit = match.groups?.unit
    if (unit === undefined) {
      return false
    }
    const multiplier = ttlMultiplier(unit)
    if (multiplier === undefined) {
      return false
    }
    const milliseconds = amount * multiplier
    return milliseconds >= minimumTTL && milliseconds <= maximumTTL
  })
export type TTL = z.infer<typeof TTL>

const customKeyPattern = /^[a-z][A-Za-z0-9]*$/u
const reservedCustomKeys = new Set(["ttl", "person", "company", "research", "deepResearch"])
const isValidCustomKey = (key: string) => customKeyPattern.test(key) && !reservedCustomKeys.has(key)

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
type ReservedQuestionKey = "ttl" | "person" | "company" | "research" | "deepResearch"

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

type InvalidQuestionKeys<Questions extends object> = {
  [Key in keyof Questions & string]: IsValidQuestionKey<Key> extends true ? never : Key
}[keyof Questions & string]

type IsUnion<Value, Whole = Value> = Value extends unknown
  ? [Whole] extends [Value]
    ? false
    : true
  : never

type OptionalKeys<Value> = {
  [Key in keyof Value]-?: object extends Pick<Value, Key> ? Key : never
}[keyof Value]

type IsAny<Value> = 0 extends 1 & Value ? true : false

type IsCallableOrConstructable<Value> = Value extends CallableFunction | NewableFunction
  ? true
  : false

type ValidQuestionKeys<Questions extends object> =
  true extends IsUnion<Questions>
    ? never
    : true extends IsCallableOrConstructable<Questions>
      ? never
      : [Exclude<keyof Questions, string>] extends [never]
        ? [OptionalKeys<Questions>] extends [never]
          ? string extends keyof Questions
            ? Questions
            : [InvalidQuestionKeys<Questions>] extends [never]
              ? Questions
              : never
          : never
        : never

type DeepResearchQuestionValuesAreStrings<Questions extends object> =
  true extends IsAny<Questions[keyof Questions]>
    ? false
    : [Questions[keyof Questions]] extends [string]
      ? true
      : false

export type ValidDeepResearchQuestions<Questions extends object> =
  ValidQuestionKeys<Questions> extends never
    ? never
    : true extends DeepResearchQuestionValuesAreStrings<Questions>
      ? Questions
      : never

const DeepResearchQuestions = rejectPrototypeKey(
  z.record(z.string(), z.string().trim().min(1)).superRefine((questions, context) => {
    for (const key of Object.keys(questions)) {
      if (!isValidCustomKey(key)) {
        context.addIssue({ code: "custom", message: `Invalid custom answer key: ${key}` })
      }
    }
  })
)

export type ResearchJSONSchema = {
  readonly description: string
  readonly [keyword: string]: JSONValue
}

export type ResearchValidator<Output extends JSONValue = JSONValue> =
  | z.ZodType<Output>
  | StandardJSONSchemaV1<unknown, Output>

export type ResearchQuestion = ResearchJSONSchema | ResearchValidator

export type ResearchOutput<Question> =
  Question extends z.ZodType<infer Output>
    ? Extract<Output, JSONValue>
    : Question extends StandardJSONSchemaV1<unknown, infer Output>
      ? Extract<Output, JSONValue>
      : JSONValue

type ResearchQuestionIsValid<QuestionValue> =
  true extends IsAny<QuestionValue>
    ? false
    : QuestionValue extends z.ZodType<infer Output>
      ? [Output] extends [JSONValue]
        ? true
        : false
      : QuestionValue extends StandardJSONSchemaV1<unknown, infer Output>
        ? [Output] extends [JSONValue]
          ? true
          : false
        : QuestionValue extends ResearchJSONSchema
          ? true
          : false

type ResearchQuestionValuesAreValid<Questions extends object> = false extends {
  [Key in keyof Questions]: ResearchQuestionIsValid<Questions[Key]>
}[keyof Questions]
  ? false
  : true

export type ValidResearchQuestions<Questions extends object> =
  ValidQuestionKeys<Questions> extends never
    ? never
    : true extends ResearchQuestionValuesAreValid<Questions>
      ? Questions
      : never

type AnswerValuesAreJSON<Answers extends object> =
  true extends IsAny<Answers[keyof Answers]>
    ? false
    : [Answers[keyof Answers]] extends [JSONValue]
      ? true
      : false

export type ValidAnswerMap<Answers extends object> =
  ValidQuestionKeys<Answers> extends never
    ? never
    : true extends AnswerValuesAreJSON<Answers>
      ? Answers
      : never

const ResearchJSONSchema: z.ZodType<ResearchJSONSchema> = jsonBoundary(
  rejectPrototypeKey(z.object({ description: z.string().trim().min(1) }).catchall(JSONValue))
)

const ResearchQuestions = rejectPrototypeKey(
  z.record(z.string(), ResearchJSONSchema).superRefine((questions, context) => {
    for (const key of Object.keys(questions)) {
      if (!isValidCustomKey(key)) {
        context.addIssue({ code: "custom", message: `Invalid custom answer key: ${key}` })
      }
    }
  })
)

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

const ResearchPersonRequest = rejectPrototypeKey(
  z
    .object({
      linkedin: z.literal(true).optional(),
      title: z.literal(true).optional(),
      x: z.literal(true).optional(),
      github: z.literal(true).optional(),
      research: ResearchQuestions.optional(),
    })
    .strict()
)

const ResearchCompanyRequest = rejectPrototypeKey(
  z
    .object({
      domain: z.literal(true).optional(),
      name: z.literal(true).optional(),
      logo: z.literal(true).optional(),
      colors: z.literal(true).optional(),
      location: z.literal(true).optional(),
      description: z.literal(true).optional(),
      funding: z.literal(true).optional(),
      research: ResearchQuestions.optional(),
    })
    .strict()
)

const ResearchRequestSchema = rejectPrototypeKey(
  z
    .object({
      seed: SonarSeed,
      ttl: TTL,
      person: ResearchPersonRequest,
      company: ResearchCompanyRequest,
    })
    .strict()
)
export const ResearchRequest = jsonBoundary(ResearchRequestSchema)
export type ResearchRequest = {
  seed: SonarSeed
  ttl: TTL
  person: Partial<Record<(typeof researchPersonFields)[number], true>> & {
    research?: Readonly<Record<string, ResearchJSONSchema>>
  }
  company: Partial<Record<(typeof researchCompanyFields)[number], true>> & {
    research?: Readonly<Record<string, ResearchJSONSchema>>
  }
}

export type ResearchPersonInput<
  Questions extends object = Readonly<Record<string, ResearchQuestion>>,
> = Partial<Record<(typeof researchPersonFields)[number], true>> & { research?: Questions }

export type ResearchCompanyInput<
  Questions extends object = Readonly<Record<string, ResearchQuestion>>,
> = Partial<Record<(typeof researchCompanyFields)[number], true>> & { research?: Questions }

export type ResearchInput<
  Person extends ResearchPersonInput = ResearchPersonInput,
  Company extends ResearchCompanyInput = ResearchCompanyInput,
> = {
  seed: SonarSeed
  ttl: TTL
  person: Person
  company: Company
}

export type ValidResearchEntityInput<Entity extends ResearchPersonInput | ResearchCompanyInput> =
  NonNullable<Entity["research"]> extends ValidResearchQuestions<NonNullable<Entity["research"]>>
    ? Entity
    : never

export type ValidResearchInput<Input extends ResearchInput> =
  Input extends ResearchInput<infer Person, infer Company>
    ? ResearchInput<ValidResearchEntityInput<Person>, ValidResearchEntityInput<Company>>
    : never

type OwnEntry = readonly [key: string, value: unknown]

const ownEnumerableEntries = (input: unknown, label: string): OwnEntry[] => {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`)
  }
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`)
  }

  const entries: OwnEntry[] = []
  for (const rawKey of Reflect.ownKeys(input)) {
    if (typeof rawKey !== "string") {
      throw new TypeError(`${label} cannot contain symbol keys`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, rawKey)
    if (!descriptor?.enumerable) {
      throw new TypeError(`${label} properties must be enumerable`)
    }
    if ("value" in descriptor) {
      entries.push([rawKey, descriptor.value])
      continue
    }
    if (!descriptor.get) {
      throw new TypeError(`${label} accessors must provide a getter`)
    }
    entries.push([rawKey, descriptor.get.call(input)])
  }
  return entries
}

const questionSchema = (questionValue: unknown, label: string): ResearchJSONSchema => {
  let schema: unknown
  if (questionValue instanceof z.ZodType) {
    schema = questionValue["~standard"].jsonSchema.output({ target: "draft-2020-12" })
  } else if (
    questionValue !== null &&
    typeof questionValue === "object" &&
    "~standard" in questionValue
  ) {
    // SAFETY: This branch established the Standard Schema marker; the checks below validate both
    // converter methods before either can be called.
    const standard = questionValue as StandardJSONSchemaV1
    const properties = standard["~standard"]
    if (
      properties.version !== 1 ||
      typeof properties.jsonSchema?.output !== "function" ||
      typeof properties.jsonSchema?.input !== "function"
    ) {
      throw new TypeError(`${label} must implement StandardJSONSchemaV1`)
    }
    schema = properties.jsonSchema.output({ target: "draft-2020-12" })
  } else {
    schema = questionValue
  }

  try {
    const serializable =
      schema !== null && typeof schema === "object" && !Array.isArray(schema)
        ? { ...schema }
        : schema
    return ResearchJSONSchema.parse(serializable)
  } catch (error) {
    throw new TypeError(`${label} must compile to JSON Schema with a non-empty root description`, {
      cause: error,
    })
  }
}

const compileResearchQuestions = (input: unknown, label: string) => {
  const output: Record<string, ResearchJSONSchema> = {}
  for (const [key, questionValue] of ownEnumerableEntries(input, label)) {
    if (!isValidCustomKey(key)) {
      throw new TypeError(`Invalid custom answer key: ${key}`)
    }
    output[key] = questionSchema(questionValue, `${label}.${key}`)
  }
  return output
}

const compileResearchEntity = (
  input: unknown,
  label: "person" | "company",
  builtIns: readonly string[]
) => {
  const entries = new Map(ownEnumerableEntries(input, label))
  const output: Record<string, true | Record<string, ResearchJSONSchema>> = {}
  for (const key of builtIns) {
    if (!entries.has(key)) {
      continue
    }
    if (entries.get(key) !== true) {
      throw new TypeError(`${label}.${key} must be true when selected`)
    }
    output[key] = true
    entries.delete(key)
  }
  if (entries.has("research")) {
    output.research = compileResearchQuestions(entries.get("research"), `${label}.research`)
    entries.delete("research")
  }
  const unknownKey = entries.keys().next().value
  if (typeof unknownKey === "string") {
    throw new TypeError(`Unknown ${label} research field: ${unknownKey}`)
  }
  return output
}

export function compileResearchRequest<
  const Person extends ResearchPersonInput,
  const Company extends ResearchCompanyInput,
>(
  input: ResearchInput<Person, Company> &
    (NonNullable<Person["research"]> extends ValidResearchQuestions<NonNullable<Person["research"]>>
      ? unknown
      : never) &
    (NonNullable<Company["research"]> extends ValidResearchQuestions<
      NonNullable<Company["research"]>
    >
      ? unknown
      : never)
): ResearchRequest
export function compileResearchRequest(input: ResearchInput): ResearchRequest {
  const entries = new Map(ownEnumerableEntries(input, "Research input"))
  const seed = entries.get("seed")
  const ttl = entries.get("ttl")
  const person = entries.get("person")
  const company = entries.get("company")
  entries.delete("seed")
  entries.delete("ttl")
  entries.delete("person")
  entries.delete("company")
  const unknownKey = entries.keys().next().value
  if (typeof unknownKey === "string") {
    throw new TypeError(`Unknown research input field: ${unknownKey}`)
  }

  return ResearchRequest.parse({
    seed,
    ttl,
    person: compileResearchEntity(person, "person", researchPersonFields),
    company: compileResearchEntity(company, "company", researchCompanyFields),
  })
}

const DeepResearchPersonRequest = rejectPrototypeKey(
  z
    .object({
      phone: z.literal(true).optional(),
      deepResearch: DeepResearchQuestions.optional(),
    })
    .strict()
)

const DeepResearchCompanyRequest = rejectPrototypeKey(
  z
    .object({
      legalName: z.literal(true).optional(),
      deepResearch: DeepResearchQuestions.optional(),
    })
    .strict()
)

const DeepResearchRequestSchema = rejectPrototypeKey(
  z
    .object({
      seed: SonarSeed,
      ttl: TTL,
      person: DeepResearchPersonRequest,
      company: DeepResearchCompanyRequest,
    })
    .strict()
)
export const DeepResearchRequest = jsonBoundary(DeepResearchRequestSchema)
export type DeepResearchRequest = {
  seed: SonarSeed
  ttl: TTL
  person: Partial<Record<(typeof deepResearchPersonFields)[number], true>> & {
    deepResearch?: Readonly<Record<string, string>>
  }
  company: Partial<Record<(typeof deepResearchCompanyFields)[number], true>> & {
    deepResearch?: Readonly<Record<string, string>>
  }
}

export type DeepResearchPersonInput<Questions extends object = Readonly<Record<string, string>>> =
  Partial<Record<(typeof deepResearchPersonFields)[number], true>> & { deepResearch?: Questions }

export type DeepResearchCompanyInput<Questions extends object = Readonly<Record<string, string>>> =
  Partial<Record<(typeof deepResearchCompanyFields)[number], true>> & { deepResearch?: Questions }

export type DeepResearchInput<
  Person extends DeepResearchPersonInput = DeepResearchPersonInput,
  Company extends DeepResearchCompanyInput = DeepResearchCompanyInput,
> = {
  seed: SonarSeed
  ttl: TTL
  person: Person
  company: Company
}

export type ValidDeepResearchEntityInput<
  Entity extends DeepResearchPersonInput | DeepResearchCompanyInput,
> =
  NonNullable<Entity["deepResearch"]> extends ValidDeepResearchQuestions<
    NonNullable<Entity["deepResearch"]>
  >
    ? Entity
    : never

export type ValidDeepResearchInput<Input extends DeepResearchInput> =
  Input extends DeepResearchInput<infer Person, infer Company>
    ? DeepResearchInput<ValidDeepResearchEntityInput<Person>, ValidDeepResearchEntityInput<Company>>
    : never

const PendingField = z.object({ status: z.literal("pending") }).strict()
const ResolvedField = z
  .object({
    status: z.literal("resolved"),
    value: JSONValue,
    confidence: z.number().min(0).max(1),
    sources: z.array(z.string()),
    resolvedAt: z.iso.datetime(),
  })
  .strict()
const NotFoundField = z
  .object({
    status: z.literal("notFound"),
    reason: z.enum(["timeout", "identityFailed", "providerEmpty"]).optional(),
  })
  .strict()
const SkippedField = z
  .object({
    status: z.literal("skipped"),
    reason: z.enum(["consumerEmail", "noPersonSeed", "noCompanySeed"]),
  })
  .strict()

const FieldSchema = z.discriminatedUnion("status", [
  PendingField,
  ResolvedField,
  NotFoundField,
  SkippedField,
])
export const Field = Object.assign(jsonBoundary(rejectPrototypeKey(FieldSchema)), {
  options: FieldSchema.options,
})
export type Field<Value = JSONValue> =
  | { status: "pending" }
  | {
      status: "resolved"
      value: Value
      confidence: number
      sources: string[]
      resolvedAt: string
    }
  | { status: "notFound"; reason?: "timeout" | "identityFailed" | "providerEmpty" }
  | { status: "skipped"; reason: "consumerEmail" | "noPersonSeed" | "noCompanySeed" }

const StringFieldSchema = z.discriminatedUnion("status", [
  PendingField,
  ResolvedField.extend({ value: z.string() }),
  NotFoundField,
  SkippedField,
])
const StringField = rejectPrototypeKey(StringFieldSchema)

type PersonFieldKey =
  | (typeof researchPersonFields)[number]
  | (typeof deepResearchPersonFields)[number]

type PersonFieldValues = Record<PersonFieldKey, string>
type CompanyFieldValues = {
  domain: string
  name: string
  logo: string
  colors: JSONValue
  location: JSONValue
  description: string
  funding: JSONValue
  legalName: string
}
type CatalogFields<Values extends Record<string, JSONValue>> = {
  [Key in keyof Values]?: Field<Values[Key]>
}

export type SonarData = {
  person: CatalogFields<PersonFieldValues>
  company: CatalogFields<CompanyFieldValues>
}

const ResearchAnswerData = rejectPrototypeKey(
  z.record(z.string(), Field).superRefine((answers, context) => {
    for (const key of Object.keys(answers)) {
      if (!isValidCustomKey(key)) {
        context.addIssue({ code: "custom", message: `Invalid custom answer key: ${key}` })
      }
    }
  })
)

const DeepResearchAnswerData = rejectPrototypeKey(
  z.record(z.string(), StringField).superRefine((answers, context) => {
    for (const key of Object.keys(answers)) {
      if (!isValidCustomKey(key)) {
        context.addIssue({ code: "custom", message: `Invalid custom answer key: ${key}` })
      }
    }
  })
)

const PersonData = rejectPrototypeKey(
  z
    .object({
      linkedin: StringField.optional(),
      title: StringField.optional(),
      x: StringField.optional(),
      github: StringField.optional(),
      phone: StringField.optional(),
      research: ResearchAnswerData.optional(),
      deepResearch: DeepResearchAnswerData.optional(),
    })
    .strict()
)

const CompanyData = rejectPrototypeKey(
  z
    .object({
      domain: StringField.optional(),
      name: StringField.optional(),
      logo: StringField.optional(),
      colors: Field.optional(),
      location: Field.optional(),
      description: StringField.optional(),
      funding: Field.optional(),
      legalName: StringField.optional(),
      research: ResearchAnswerData.optional(),
      deepResearch: DeepResearchAnswerData.optional(),
    })
    .strict()
)

const SonarData = rejectPrototypeKey(
  z
    .object({
      person: PersonData,
      company: CompanyData,
    })
    .strict()
)

type ParsedSonarData = z.infer<typeof SonarData>
type ParsedField = z.infer<typeof Field>

const AbsoluteURL = z.url()
const StringValue = z.string()
const absoluteURLPaths = new Set(["person.linkedin", "person.x", "person.github", "company.logo"])
const stringPaths = new Set([
  "person.title",
  "person.phone",
  "company.domain",
  "company.name",
  "company.description",
  "company.legalName",
])
const richJSONPaths = new Set(["company.colors", "company.location", "company.funding"])
const customPathPattern =
  /^(?<entity>person|company)\.(?<tier>research|deepResearch)\.(?<key>[a-z][A-Za-z0-9]*)$/u

export const fieldMatchesPath = (path: string, field: ParsedField) => {
  const isAbsoluteURL = absoluteURLPaths.has(path)
  const isString = stringPaths.has(path)
  const isRichJSON = richJSONPaths.has(path)
  const customPath = customPathPattern.exec(path)
  const isResearch =
    customPath?.groups?.tier === "research" && isValidCustomKey(customPath.groups.key ?? "")
  const isDeepResearch =
    customPath?.groups?.tier === "deepResearch" && isValidCustomKey(customPath.groups.key ?? "")
  if (!(isAbsoluteURL || isString || isRichJSON || isResearch || isDeepResearch)) {
    return false
  }
  if (field.status !== "resolved") {
    return true
  }
  if (isAbsoluteURL) {
    return AbsoluteURL.safeParse(field.value).success
  }
  if (isString || isDeepResearch) {
    return StringValue.safeParse(field.value).success
  }
  return true
}

const containsPending = (data: ParsedSonarData): boolean => {
  const fields = [data.person, data.company].flatMap((entity) =>
    Object.entries(entity).flatMap(([key, value]) => {
      if (key === "research") {
        return Object.values(ResearchAnswerData.parse(value))
      }
      if (key === "deepResearch") {
        return Object.values(DeepResearchAnswerData.parse(value))
      }
      return [Field.parse(value)]
    })
  )
  return fields.some((field) => field.status === "pending")
}

const validateSnapshot = (
  snapshot: { status: "pending" | "complete"; data: ParsedSonarData },
  context: z.RefinementCtx
) => {
  if (snapshot.status === "complete" && containsPending(snapshot.data)) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "A complete snapshot cannot contain pending fields",
    })
  }

  for (const [slot, fields] of [
    ["person", snapshot.data.person],
    ["company", snapshot.data.company],
  ] as const) {
    for (const [key, field] of Object.entries(fields)) {
      if (key === "research" || key === "deepResearch") {
        continue
      }
      if (!fieldMatchesPath(`${slot}.${key}`, Field.parse(field))) {
        context.addIssue({
          code: "custom",
          path: ["data", slot, key, "value"],
          message: `Resolved value does not match ${slot}.${key}`,
        })
      }
    }
  }
}

export const SonarSnapshot: z.ZodType<SonarSnapshot> = jsonBoundary(
  rejectPrototypeKey(
    z
      .object({
        status: z.enum(["pending", "complete"]),
        data: SonarData,
      })
      .strict()
      .superRefine(validateSnapshot)
  )
)
export type SonarSnapshot<Data extends SonarData = SonarData> = {
  status: "pending" | "complete"
  data: Data
}

type SnapshotRequest = ResearchRequest | DeepResearchRequest
type ResearchTier = "research" | "deepResearch"
type SnapshotEntityCollection = SonarSnapshot["data"]["person"] | SonarSnapshot["data"]["company"]
type SnapshotKeyCollection =
  | SonarSnapshot["data"]
  | SnapshotEntityCollection
  | Readonly<Record<string, JSONValue>>

const hasExactlyKeys = (actual: SnapshotKeyCollection, expected: readonly string[]) => {
  const actualKeys = Object.keys(actual)
  const actualKeySet = new Set(actualKeys)
  return actualKeys.length === expected.length && expected.every((key) => actualKeySet.has(key))
}

const nestedFieldCollection = (
  entity: SnapshotEntityCollection,
  tier: ResearchTier
): Readonly<Record<string, JSONValue>> | undefined => {
  const tierEntry = Object.entries(entity).find(([key]) => key === tier)
  return tierEntry ? JSONObject.parse(tierEntry[1]) : undefined
}

const hasExactlyNestedKeys = (
  entity: SnapshotEntityCollection,
  tier: ResearchTier,
  expected: readonly string[]
) => {
  if (expected.length === 0) {
    return true
  }
  const nested = nestedFieldCollection(entity, tier)
  return nested !== undefined && hasExactlyKeys(nested, expected)
}

const isResearchRequest = (request: SnapshotRequest): request is ResearchRequest =>
  Object.hasOwn(request.person, "research") || Object.hasOwn(request.company, "research")

export const snapshotMatchesRequest = (snapshot: SonarSnapshot, request: SnapshotRequest) => {
  const tier: ResearchTier = isResearchRequest(request) ? "research" : "deepResearch"
  const personQuestions = isResearchRequest(request)
    ? Object.keys(request.person.research ?? {})
    : Object.keys(request.person.deepResearch ?? {})
  const companyQuestions = isResearchRequest(request)
    ? Object.keys(request.company.research ?? {})
    : Object.keys(request.company.deepResearch ?? {})
  const personBuiltIns = Object.keys(request.person).filter((key) => key !== tier)
  const companyBuiltIns = Object.keys(request.company).filter((key) => key !== tier)
  return (
    hasExactlyKeys(snapshot.data, ["person", "company"]) &&
    hasExactlyKeys(snapshot.data.person, [
      ...personBuiltIns,
      ...(personQuestions.length > 0 ? [tier] : []),
    ]) &&
    hasExactlyKeys(snapshot.data.company, [
      ...companyBuiltIns,
      ...(companyQuestions.length > 0 ? [tier] : []),
    ]) &&
    hasExactlyNestedKeys(snapshot.data.person, tier, personQuestions) &&
    hasExactlyNestedKeys(snapshot.data.company, tier, companyQuestions)
  )
}

export const requestPaths = (request: SnapshotRequest) => {
  const tier: ResearchTier = isResearchRequest(request) ? "research" : "deepResearch"
  const personQuestions = isResearchRequest(request)
    ? Object.keys(request.person.research ?? {})
    : Object.keys(request.person.deepResearch ?? {})
  const companyQuestions = isResearchRequest(request)
    ? Object.keys(request.company.research ?? {})
    : Object.keys(request.company.deepResearch ?? {})
  return [
    ...Object.keys(request.person)
      .filter((key) => key !== tier)
      .map((key) => `person.${key}`),
    ...Object.keys(request.company)
      .filter((key) => key !== tier)
      .map((key) => `company.${key}`),
    ...personQuestions.map((key) => `person.${tier}.${key}`),
    ...companyQuestions.map((key) => `company.${tier}.${key}`),
  ]
}

export const SonarResponse: z.ZodType<SonarResponse> = jsonBoundary(
  rejectPrototypeKey(
    z
      .object({
        hash: z.string().min(1),
        status: z.enum(["pending", "complete"]),
        data: SonarData,
      })
      .strict()
      .superRefine(validateSnapshot)
  )
)
export type SonarResponse<Data extends SonarData = SonarData> = SonarSnapshot<Data> & {
  hash: string
}

export const SnapshotEvent: z.ZodType<SnapshotEvent> = jsonBoundary(
  rejectPrototypeKey(
    z
      .object({
        id: z.string().min(1),
        type: z.literal("snapshot"),
        snapshot: SonarSnapshot,
      })
      .strict()
  )
)
export type SnapshotEvent = {
  id: string
  type: "snapshot"
  snapshot: SonarSnapshot
}

export const FieldEvent: z.ZodType<FieldEvent> = jsonBoundary(
  rejectPrototypeKey(
    z
      .object({
        id: z.string().min(1),
        type: z.literal("field"),
        path: z.string().min(1),
        field: Field,
      })
      .strict()
      .superRefine((event, context) => {
        if (!fieldMatchesPath(event.path, event.field)) {
          context.addIssue({
            code: "custom",
            path: ["field", "value"],
            message: `Resolved value does not match ${event.path}`,
          })
        }
      })
  )
)
export type FieldEvent = {
  id: string
  type: "field"
  path: string
  field: Field
}

export const CompleteEvent: z.ZodType<CompleteEvent> = jsonBoundary(
  rejectPrototypeKey(
    z
      .object({
        id: z.string().min(1),
        type: z.literal("complete"),
        hash: z.string().min(1),
      })
      .strict()
  )
)
export type CompleteEvent = {
  id: string
  type: "complete"
  hash: string
}

export const SonarEvent: z.ZodType<SonarEvent> = jsonBoundary(
  z.union([SnapshotEvent, FieldEvent, CompleteEvent])
)
export type SonarEvent = SnapshotEvent | FieldEvent | CompleteEvent

export type ResearchPersonField = (typeof researchPersonFields)[number]
export type ResearchCompanyField = (typeof researchCompanyFields)[number]
export type DeepResearchPersonField = (typeof deepResearchPersonFields)[number]
export type DeepResearchCompanyField = (typeof deepResearchCompanyFields)[number]
