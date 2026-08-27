// oxlint-disable sort-keys -- Schema declaration order preserves the public person-before-company wire order.

import { z } from "zod"

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

const uniqueFields = <Value extends string>(values: readonly Value[]) =>
  z.array(z.enum(values)).refine((fields) => new Set(fields).size === fields.length)

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

type QuestionValuesAreStrings<Questions extends object> =
  true extends IsAny<Questions[keyof Questions]>
    ? false
    : [Questions[keyof Questions]] extends [string]
      ? true
      : false

export type ValidQuestions<Questions extends object> =
  true extends IsUnion<Questions>
    ? never
    : true extends IsCallableOrConstructable<Questions>
      ? never
      : [Exclude<keyof Questions, string>] extends [never]
        ? [OptionalKeys<Questions>] extends [never]
          ? true extends QuestionValuesAreStrings<Questions>
            ? string extends keyof Questions
              ? Questions
              : [InvalidQuestionKeys<Questions>] extends [never]
                ? Questions
                : never
            : never
          : never
        : never

declare const QuestionAnswer: unique symbol
export type Question<Answer extends JSONValue = JSONValue> = string & {
  readonly [QuestionAnswer]: (answer: Answer) => Answer
}

export const question = <Answer extends JSONValue = JSONValue>(prompt: string): Question<Answer> =>
  // SAFETY: The required private brand carries compile-time answer metadata only; requests send
  // the original prompt string, which the runtime Questions schema still validates and normalizes.
  prompt as Question<Answer>

export type AnswerOf<QuestionValue> =
  QuestionValue extends Question<infer Answer> ? Answer : JSONValue

export type AnswersOf<Questions extends object> = string extends keyof Questions
  ? Readonly<Partial<Record<string, JSONValue>>>
  : { readonly [Key in keyof Questions & string]: AnswerOf<Questions[Key]> }

const Questions = rejectPrototypeKey(
  z.record(z.string(), z.string().trim().min(1)).superRefine((questions, context) => {
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

const ResearchRequestSchema = rejectPrototypeKey(
  z
    .object({
      seed: SonarSeed,
      ttl: TTL,
      person: uniqueFields(researchPersonFields),
      company: uniqueFields(researchCompanyFields),
      research: Questions,
    })
    .strict()
)
export const ResearchRequest = jsonBoundary(ResearchRequestSchema)
export type ResearchRequest = {
  seed: SonarSeed
  ttl: TTL
  person: readonly (typeof researchPersonFields)[number][]
  company: readonly (typeof researchCompanyFields)[number][]
  research: Readonly<Record<string, string>>
  deepResearch?: never
}

const DeepResearchRequestSchema = rejectPrototypeKey(
  z
    .object({
      seed: SonarSeed,
      ttl: TTL,
      person: uniqueFields(deepResearchPersonFields),
      company: uniqueFields(deepResearchCompanyFields),
      deepResearch: Questions,
    })
    .strict()
)
export const DeepResearchRequest = jsonBoundary(DeepResearchRequestSchema)
export type DeepResearchRequest = {
  seed: SonarSeed
  ttl: TTL
  person: readonly (typeof deepResearchPersonFields)[number][]
  company: readonly (typeof deepResearchCompanyFields)[number][]
  deepResearch: Readonly<Record<string, string>>
  research?: never
}

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

const PersonData = rejectPrototypeKey(
  z
    .object({
      linkedin: StringField.optional(),
      title: StringField.optional(),
      x: StringField.optional(),
      github: StringField.optional(),
      phone: StringField.optional(),
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
    })
    .strict()
)

const SonarData = rejectPrototypeKey(
  z
    .object({
      person: PersonData,
      company: CompanyData,
    })
    .catchall(Field)
    .superRefine((data, context) => {
      for (const key of Object.keys(data)) {
        if (key !== "person" && key !== "company" && !isValidCustomKey(key)) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `Invalid custom answer key: ${key}`,
          })
        }
      }
    })
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

export const fieldMatchesPath = (path: string, field: ParsedField) => {
  const isAbsoluteURL = absoluteURLPaths.has(path)
  const isString = stringPaths.has(path)
  const isRichJSON = richJSONPaths.has(path)
  if (!(isAbsoluteURL || isString || isRichJSON || isValidCustomKey(path))) {
    return false
  }
  if (field.status !== "resolved") {
    return true
  }
  if (isAbsoluteURL) {
    return AbsoluteURL.safeParse(field.value).success
  }
  if (isString) {
    return StringValue.safeParse(field.value).success
  }
  return true
}

const containsPending = (data: ParsedSonarData): boolean => {
  const builtInFields = [...Object.values(data.person), ...Object.values(data.company)]
  const customFields = Object.entries(data)
    .filter(([key]) => key !== "person" && key !== "company")
    .map(([, field]) => Field.parse(field))
  return [...builtInFields, ...customFields].some((field) => field.status === "pending")
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
      if (!fieldMatchesPath(`${slot}.${key}`, field)) {
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
type SnapshotFieldCollection =
  | SonarSnapshot["data"]
  | SonarSnapshot["data"]["person"]
  | SonarSnapshot["data"]["company"]

const hasExactlyKeys = (actual: SnapshotFieldCollection, expected: readonly string[]) => {
  const actualKeys = Object.keys(actual)
  const actualKeySet = new Set(actualKeys)
  return actualKeys.length === expected.length && expected.every((key) => actualKeySet.has(key))
}

export const snapshotMatchesRequest = (snapshot: SonarSnapshot, request: SnapshotRequest) => {
  const questionKeys = Object.keys(request.research ?? request.deepResearch)
  return (
    hasExactlyKeys(snapshot.data, ["person", "company", ...questionKeys]) &&
    hasExactlyKeys(snapshot.data.person, request.person) &&
    hasExactlyKeys(snapshot.data.company, request.company)
  )
}

export const requestPaths = (request: SnapshotRequest) => [
  ...request.person.map((key) => `person.${key}`),
  ...request.company.map((key) => `company.${key}`),
  ...Object.keys(request.research ?? request.deepResearch),
]

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
