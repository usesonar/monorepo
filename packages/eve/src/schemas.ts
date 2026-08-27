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

const validQuestions = Schema.makeFilter<Readonly<Record<string, string>>>((questions) => {
  const invalid = Object.keys(questions).find(
    (key) => !customKeyPattern.test(key) || reservedKeys.has(key)
  )
  return invalid === undefined ? undefined : `Invalid custom answer key: ${invalid}`
})

const Questions = Schema.Record(Schema.String, nonEmpty).check(validQuestions)

const fields = <Values extends readonly string[]>(values: Values) =>
  Schema.Array(Schema.Literals(values)).check(
    Schema.makeFilter((selected) =>
      new Set(selected).size === selected.length ? undefined : "Selected fields must be unique"
    )
  )

const selectedSomething = (questionKey: "research" | "deepResearch") =>
  Schema.makeFilter<{
    readonly person: readonly string[]
    readonly company: readonly string[]
    readonly [key: string]: unknown
  }>((input) => {
    const questions = input[questionKey]
    return input.person.length +
      input.company.length +
      (isPlainObject(questions) ? Object.keys(questions).length : 0) >
      0
      ? undefined
      : "Select at least one built-in or custom field"
  })

const Seed = Schema.Struct(SeedFields).check(validSeed)

export const researchInputSchema = (dynamic: boolean) =>
  dynamic
    ? standard(
        // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
        Schema.Struct({
          ...SeedFields,
          person: fields(researchPersonFields),
          company: fields(researchCompanyFields),
          research: Questions,
        }).check(validSeed, selectedSomething("research"))
      )
    : standard(Seed)

export const deepResearchInputSchema = (dynamic: boolean) =>
  dynamic
    ? standard(
        // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
        Schema.Struct({
          ...SeedFields,
          person: fields(deepResearchPersonFields),
          company: fields(deepResearchCompanyFields),
          deepResearch: Questions,
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
  selected: readonly string[],
  catalog: Readonly<Record<string, Schema.Constraint>>
) =>
  // SAFETY: Every selected key was validated against the tier catalog before schema creation.
  Object.fromEntries(selected.map((key) => [key, field(catalog[key])])) as Record<
    string,
    ReturnType<typeof field>
  >

const optionalCatalogFields = (catalog: Readonly<Record<string, Schema.Constraint>>) =>
  // SAFETY: Object.fromEntries preserves one schema property for every catalog entry.
  Object.fromEntries(
    Object.entries(catalog).map(([key, value]) => [key, Schema.optionalKey(field(value))])
  ) as Record<string, ReturnType<typeof Schema.optionalKey>>

const outputSchema = (
  person: readonly string[],
  company: readonly string[],
  questions: readonly string[],
  personCatalog: Readonly<Record<string, Schema.Constraint>>,
  companyCatalog: Readonly<Record<string, Schema.Constraint>>
) => {
  // oxlint-disable-next-line sort-keys -- Sonar snapshots always nest person before company.
  const data = Schema.Struct({
    person: Schema.Struct(selectedFields(person, personCatalog)),
    company: Schema.Struct(selectedFields(company, companyCatalog)),
    ...Object.fromEntries(questions.map((key) => [key, field()])),
  })
  // oxlint-disable-next-line sort-keys -- Snapshot JSON Schema follows the public status-then-data contract.
  return standard(Schema.Struct({ status: Schema.Literals(["pending", "complete"]), data }))
}

const dynamicOutputSchema = (
  personCatalog: Readonly<Record<string, Schema.Constraint>>,
  companyCatalog: Readonly<Record<string, Schema.Constraint>>
) => {
  const person = Schema.Struct(optionalCatalogFields(personCatalog))
  const company = Schema.Struct(optionalCatalogFields(companyCatalog))
  const answer = field()
  const data = Schema.StructWithRest(
    // oxlint-disable-next-line sort-keys -- Sonar snapshots always nest person before company.
    Schema.Struct({ person, company }),
    [Schema.Record(Schema.String, Schema.Union([answer, person, company]))]
  ).check(
    Schema.makeFilter<unknown>((input) => {
      if (!isPlainObject(input)) {
        return
      }
      const invalid = Object.keys(input).find((key) => {
        if (key === "person" || key === "company") {
          return false
        }
        return (
          !customKeyPattern.test(key) || reservedKeys.has(key) || !Schema.is(answer)(input[key])
        )
      })
      return invalid === undefined ? undefined : `Invalid custom answer key: ${invalid}`
    })
  )
  // oxlint-disable-next-line sort-keys -- Snapshot JSON Schema follows the public status-then-data contract.
  return standard(Schema.Struct({ status: Schema.Literals(["pending", "complete"]), data }))
}

export const researchOutputSchema = (config: ResearchFactoryConfig) =>
  isDynamicConfig(config)
    ? dynamicOutputSchema(researchPersonValues, researchCompanyValues)
    : outputSchema(
        config.person,
        config.company,
        Object.keys(config.research),
        researchPersonValues,
        researchCompanyValues
      )

export const deepResearchOutputSchema = (config: DeepResearchFactoryConfig) =>
  isDynamicConfig(config)
    ? dynamicOutputSchema(deepResearchPersonValues, deepResearchCompanyValues)
    : outputSchema(
        config.person,
        config.company,
        Object.keys(config.deepResearch),
        deepResearchPersonValues,
        deepResearchCompanyValues
      )
