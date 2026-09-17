/* eslint-disable anti-slop/no-chained-type-assertions, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- Effect Schema filters inspect decoded boundary objects, while dynamic schema construction widens service-free schemas before reconnecting their concrete fields. */
import { SonarSeed as PublicSonarSeed } from "@usesonar/effect"
import { Schema } from "effect"

import { isDynamicConfig } from "./config.js"
import {
  deepResearchCompanyFields,
  deepResearchPersonFields,
  researchCompanyFields,
  researchPersonFields,
} from "./types.js"
import type { DeepResearchFactoryConfig, ResearchFactoryConfig } from "./types.js"

const standard = <S extends Schema.Constraint>(schema: S) => {
  // SAFETY: Every schema assembled in this module is service-free; dynamic object construction
  // widens that fact to Constraint even though no declaration requires decoding services.
  const serviceFree = schema as unknown as Schema.ConstraintDecoder<unknown, never>
  const converted = Schema.toStandardJSONSchemaV1(
    Schema.toStandardSchemaV1(serviceFree, {
      parseOptions: { onExcessProperty: "error" },
    })
  )
  // SAFETY: Eve 0.45.1 recognizes Standard Schema only on object values, while Effect v4
  // schemas are callable functions. This per-schema view inherits the converted schema's
  // TypeId, AST, decode API, validation, and JSON Schema conversion without shadowing or
  // mutating them; Schema.isSchema verifies that invariant in the package contract tests.
  return Object.create(converted) as typeof converted
}

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const customKeyPattern = /^[a-z][A-Za-z\d]*$/u
const reservedKeys = new Set(["ttl", "person", "company", "research", "deepResearch"])
const seedKeys = ["context", "domain", "email", "fullName", "linkedinURL", "xURL"] as const
const nonEmpty = Schema.Trim.check(Schema.isNonEmpty())
const JsonContext = Schema.Unknown.check(
  Schema.makeFilter((input) =>
    isPlainObject(input) ? undefined : "Sonar context must be a plain JSON object"
  )
).pipe(Schema.decodeTo(Schema.Record(Schema.String, Schema.Json)))
const SeedFields = {
  context: Schema.optionalKey(JsonContext),
  domain: Schema.optionalKey(nonEmpty),
  email: Schema.optionalKey(Schema.Trim),
  fullName: Schema.optionalKey(nonEmpty),
  linkedinURL: Schema.optionalKey(Schema.Trim),
  xURL: Schema.optionalKey(Schema.Trim),
} as const

const seedValue = (input: Readonly<Record<string, unknown>>) => {
  const seed: Record<string, unknown> = {}
  for (const key of seedKeys) {
    if (input[key] !== undefined) {
      seed[key] = input[key]
    }
  }
  return seed
}

const validSeed = Schema.makeFilter<Readonly<Record<string, unknown>>>((input) =>
  Schema.is(PublicSonarSeed)(seedValue(input))
    ? undefined
    : "Provide a valid linkedinURL, fullName with xURL, or fullName with email"
)

const validQuestionKeys = (questions: Readonly<Record<string, unknown>>) => {
  const invalid = Object.keys(questions).find(
    (key) => !customKeyPattern.test(key) || reservedKeys.has(key)
  )
  return invalid === undefined ? undefined : `Invalid custom answer key: ${invalid}`
}

const DeepResearchQuestions = Schema.Record(Schema.String, nonEmpty).check(
  Schema.makeFilter(validQuestionKeys)
)

const ResearchQuestions = Schema.Record(Schema.String, Schema.Json).check(
  Schema.makeFilter((questions) => {
    const invalidKey = validQuestionKeys(questions)
    if (invalidKey !== undefined) {
      return invalidKey
    }
    const invalidSchema = Object.entries(questions).find(
      ([, schema]) =>
        !isPlainObject(schema) ||
        typeof schema.description !== "string" ||
        schema.description.trim().length === 0
    )
    return invalidSchema === undefined
      ? undefined
      : `Research question ${invalidSchema[0]} requires JSON Schema with a description`
  })
)

const entityInput = (
  fields: readonly string[],
  namespace: "research" | "deepResearch",
  questions: Schema.Constraint
) =>
  Schema.Struct({
    ...Object.fromEntries(fields.map((field) => [field, Schema.optionalKey(Schema.Literal(true))])),
    [namespace]: Schema.optionalKey(questions),
  })

const selectedSomething = (namespace: "research" | "deepResearch") =>
  Schema.makeFilter<{ readonly person: object; readonly company: object }>((input) => {
    const count = [input.person, input.company].reduce(
      (total, entity) =>
        total +
        Object.entries(entity).reduce(
          (entityTotal, [key, value]) =>
            entityTotal +
            (key === namespace && isPlainObject(value) ? Object.keys(value).length : 1),
          0
        ),
      0
    )
    return count > 0 ? undefined : "Select at least one built-in or custom field"
  })

const Seed = Schema.Struct(SeedFields).check(validSeed)

export const researchInputSchema = (dynamic: boolean) =>
  dynamic
    ? standard(
        // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
        Schema.Struct({
          ...SeedFields,
          person: entityInput(researchPersonFields, "research", ResearchQuestions),
          company: entityInput(researchCompanyFields, "research", ResearchQuestions),
        }).check(validSeed, selectedSomething("research"))
      )
    : standard(Seed)

export const deepResearchInputSchema = (dynamic: boolean) =>
  dynamic
    ? standard(
        // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
        Schema.Struct({
          ...SeedFields,
          person: entityInput(deepResearchPersonFields, "deepResearch", DeepResearchQuestions),
          company: entityInput(deepResearchCompanyFields, "deepResearch", DeepResearchQuestions),
        }).check(validSeed, selectedSomething("deepResearch"))
      )
    : standard(Seed)

const resolved = (value: Schema.Constraint) =>
  Schema.Struct({
    confidence: Schema.Finite.check(Schema.isBetween({ maximum: 1, minimum: 0 })),
    resolvedAt: Schema.String,
    sources: Schema.Array(Schema.String),
    status: Schema.Literal("resolved"),
    value,
  })

const field = (value: Schema.Constraint = Schema.Json) =>
  Schema.Union([
    Schema.Struct({ status: Schema.Literal("pending") }),
    resolved(value),
    Schema.Struct({
      reason: Schema.optionalKey(Schema.Literals(["timeout", "identityFailed", "providerEmpty"])),
      status: Schema.Literal("notFound"),
    }),
    Schema.Struct({
      reason: Schema.Literals(["consumerEmail", "noPersonSeed", "noCompanySeed"]),
      status: Schema.Literal("skipped"),
    }),
  ])

// oxlint-disable-next-line sort-keys -- Schema order follows Sonar's documented catalog order.
const researchPersonValues = {
  linkedin: Schema.String,
  title: Schema.String,
  x: Schema.String,
  github: Schema.String,
} as const

// oxlint-disable-next-line sort-keys -- Schema order follows Sonar's documented catalog order.
const researchCompanyValues = {
  domain: Schema.String,
  name: Schema.String,
  logo: Schema.String,
  colors: Schema.Json,
  location: Schema.Json,
  description: Schema.String,
  funding: Schema.Json,
} as const

const deepResearchPersonValues = { phone: Schema.String } as const
const deepResearchCompanyValues = { legalName: Schema.String } as const

const selectedFields = (
  selected: Readonly<Record<string, unknown>>,
  catalog: Readonly<Record<string, Schema.Constraint>>
) =>
  // SAFETY: Factory validation accepts true only for built-ins in this exact tier catalog.
  Object.fromEntries(
    Object.entries(catalog)
      .filter(([key]) => selected[key] === true)
      .map(([key, value]) => [key, field(value)])
  ) as Record<string, ReturnType<typeof field>>

const optionalCatalogFields = (catalog: Readonly<Record<string, Schema.Constraint>>) =>
  // SAFETY: Object.fromEntries preserves one schema property for every catalog entry.
  Object.fromEntries(
    Object.entries(catalog).map(([key, value]) => [key, Schema.optionalKey(field(value))])
  ) as Record<string, ReturnType<typeof Schema.optionalKey>>

const outputSchema = (
  person: Readonly<Record<string, unknown>>,
  company: Readonly<Record<string, unknown>>,
  namespace: "research" | "deepResearch",
  answerValue: Schema.Constraint,
  personCatalog: Readonly<Record<string, Schema.Constraint>>,
  companyCatalog: Readonly<Record<string, Schema.Constraint>>
) => {
  const entity = (
    config: Readonly<Record<string, unknown>>,
    catalog: Readonly<Record<string, Schema.Constraint>>
  ) => {
    const questions = config[namespace]
    const questionKeys = isPlainObject(questions) ? Object.keys(questions) : []
    const fields: Record<string, Schema.Top> = selectedFields(config, catalog)
    if (questionKeys.length > 0) {
      fields[namespace] = Schema.Struct(
        Object.fromEntries(questionKeys.map((key) => [key, field(answerValue)]))
      )
    }
    return Schema.Struct(fields)
  }
  // oxlint-disable-next-line sort-keys -- Sonar snapshots always nest person before company.
  const data = Schema.Struct({
    person: entity(person, personCatalog),
    company: entity(company, companyCatalog),
  })
  // oxlint-disable-next-line sort-keys -- Snapshot JSON Schema follows the public status-then-data contract.
  return standard(Schema.Struct({ status: Schema.Literals(["pending", "complete"]), data }))
}

const dynamicOutputSchema = (
  namespace: "research" | "deepResearch",
  answerValue: Schema.Constraint,
  personCatalog: Readonly<Record<string, Schema.Constraint>>,
  companyCatalog: Readonly<Record<string, Schema.Constraint>>
) => {
  const answers = Schema.Record(Schema.String, field(answerValue)).check(
    Schema.makeFilter(validQuestionKeys)
  )
  const entity = (catalog: Readonly<Record<string, Schema.Constraint>>) =>
    Schema.Struct({
      ...optionalCatalogFields(catalog),
      [namespace]: Schema.optionalKey(answers),
    })
  // oxlint-disable-next-line sort-keys -- Sonar snapshots always nest person before company.
  const data = Schema.Struct({ person: entity(personCatalog), company: entity(companyCatalog) })
  // oxlint-disable-next-line sort-keys -- Snapshot JSON Schema follows the public status-then-data contract.
  return standard(Schema.Struct({ status: Schema.Literals(["pending", "complete"]), data }))
}

export const researchOutputSchema = (config: ResearchFactoryConfig) =>
  isDynamicConfig(config)
    ? dynamicOutputSchema("research", Schema.Json, researchPersonValues, researchCompanyValues)
    : outputSchema(
        config.person,
        config.company,
        "research",
        Schema.Json,
        researchPersonValues,
        researchCompanyValues
      )

export const deepResearchOutputSchema = (config: DeepResearchFactoryConfig) =>
  isDynamicConfig(config)
    ? dynamicOutputSchema(
        "deepResearch",
        Schema.String,
        deepResearchPersonValues,
        deepResearchCompanyValues
      )
    : outputSchema(
        config.person,
        config.company,
        "deepResearch",
        Schema.String,
        deepResearchPersonValues,
        deepResearchCompanyValues
      )
