/* eslint-disable anti-slop/no-chained-type-assertions, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- Factory arguments are untrusted JavaScript values, so this module validates their exact runtime shape before any execution. */
import { DeepResearchRequest, compileResearchRequest } from "@usesonar/effect"
import type { DeepResearchConfig, ResearchConfig } from "@usesonar/effect"
import { Schema } from "effect"

import {
  deepResearchCompanyFields,
  deepResearchPersonFields,
  researchCompanyFields,
  researchPersonFields,
} from "./types.js"
import type {
  DeepResearchDynamicConfig,
  DeepResearchFactoryConfig,
  DeepResearchOptions,
  ResearchDynamicConfig,
  ResearchFactoryConfig,
  ResearchOptions,
} from "./types.js"

export const isDynamicConfig = (
  config: ResearchFactoryConfig | DeepResearchFactoryConfig
): config is ResearchDynamicConfig | DeepResearchDynamicConfig =>
  Object.getOwnPropertyDescriptor(config, "dynamic")?.value === true

const ttlPattern = /^(?<amount>\d+)(?<unit>ms|s|m|h|d|w)$/u
const minimumTTL = 12 * 3_600_000
const maximumTTL = 365 * 86_400_000
const customKeyPattern = /^[a-z][A-Za-z\d]*$/u
const reservedKeys = new Set(["ttl", "person", "company", "research", "deepResearch"])

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const snapshotOwnData = (value: Readonly<Record<string, unknown>>, label: string) => {
  const snapshot = new Map<string, unknown>()
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      typeof key !== "string" ||
      descriptor?.enumerable !== true ||
      !("value" in (descriptor ?? {}))
    ) {
      throw new TypeError(`${label} does not accept ${String(key)}`)
    }
    snapshot.set(key, descriptor.value)
  }
  return snapshot
}

const assertExactKeys = (
  values: ReadonlyMap<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string
) => {
  for (const key of values.keys()) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} does not accept ${key}`)
    }
  }
}

const requiredValue = (values: ReadonlyMap<string, unknown>, key: string, label: string) => {
  if (!values.has(key)) {
    throw new TypeError(`${label} requires ${key}`)
  }
  return values.get(key)
}

const ttlMilliseconds = (ttl: string) => {
  const match = ttlPattern.exec(ttl)
  const amount = Number(match?.groups?.amount)
  const unit = match?.groups?.unit
  let multiplier = Number.NaN
  switch (unit) {
    case "ms": {
      multiplier = 1
      break
    }
    case "s": {
      multiplier = 1000
      break
    }
    case "m": {
      multiplier = 60_000
      break
    }
    case "h": {
      multiplier = 3_600_000
      break
    }
    case "d": {
      multiplier = 86_400_000
      break
    }
    case "w": {
      multiplier = 604_800_000
      break
    }
    default: {
      break
    }
  }
  return amount * multiplier
}

const assertTTL = (ttl: unknown) => {
  if (typeof ttl !== "string") {
    throw new TypeError("Sonar ttl must be a compact duration")
  }
  const milliseconds = ttlMilliseconds(ttl)
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < minimumTTL ||
    milliseconds > maximumTTL
  ) {
    throw new TypeError("Sonar ttl must be between 12h and 365d")
  }
  return ttl
}

const snapshotQuestions = (questions: unknown, namespace: "research" | "deepResearch") => {
  if (!isPlainObject(questions)) {
    throw new TypeError(`Sonar ${namespace} questions must be an object`)
  }
  const snapshot: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(questions)) {
    if (typeof key !== "string") {
      throw new TypeError(`Invalid custom answer key: ${String(key)}`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(questions, key)
    if (descriptor?.enumerable !== true || !("value" in (descriptor ?? {}))) {
      throw new TypeError(`Invalid custom answer property: ${key}`)
    }
    const question = descriptor.value
    if (!customKeyPattern.test(key) || reservedKeys.has(key)) {
      throw new TypeError(`Invalid custom answer key: ${key}`)
    }
    snapshot[key] = question
  }
  return Object.freeze(snapshot)
}

const snapshotEntity = (
  value: unknown,
  slot: "person" | "company",
  fields: readonly string[],
  namespace: "research" | "deepResearch"
) => {
  if (!isPlainObject(value)) {
    throw new TypeError(`Sonar ${slot} selection must be an object`)
  }
  const values = snapshotOwnData(value, `Sonar ${slot} selection`)
  assertExactKeys(values, new Set([...fields, namespace]), `Sonar ${slot} selection`)
  const snapshot: Record<string, unknown> = {}
  for (const field of fields) {
    if (!values.has(field)) {
      continue
    }
    if (values.get(field) !== true) {
      throw new TypeError(`Sonar ${slot}.${field} must be true when selected`)
    }
    snapshot[field] = true
  }
  if (values.has(namespace)) {
    snapshot[namespace] = snapshotQuestions(values.get(namespace), namespace)
  }
  return Object.freeze(snapshot)
}

const entityFieldCount = (entity: Readonly<Record<string, unknown>>, namespace: string) =>
  Object.entries(entity).reduce(
    (count, [key, value]) =>
      count + (key === namespace && isPlainObject(value) ? Object.keys(value).length : 1),
    0
  )

const assertSelection = (
  person: Readonly<Record<string, unknown>>,
  company: Readonly<Record<string, unknown>>,
  namespace: "research" | "deepResearch"
) => {
  if (entityFieldCount(person, namespace) + entityFieldCount(company, namespace) === 0) {
    throw new TypeError("Select at least one built-in or custom Sonar field")
  }
}

const validationSeed = { linkedinURL: "https://www.linkedin.com/in/sonar-validation" } as const

export const validateResearchConfig = (config: ResearchFactoryConfig): ResearchFactoryConfig => {
  if (!isPlainObject(config)) {
    throw new TypeError("researchSonar config must be an object")
  }
  const label = "researchSonar config"
  const values = snapshotOwnData(config, label)
  const ttl = assertTTL(requiredValue(values, "ttl", label))
  if (values.has("dynamic")) {
    if (values.get("dynamic") !== true) {
      throw new TypeError("researchSonar dynamic must be true when provided")
    }
    assertExactKeys(values, new Set(["dynamic", "ttl"]), "Dynamic researchSonar config")
    return Object.freeze({ dynamic: true, ttl })
  }
  assertExactKeys(values, new Set(["ttl", "person", "company"]), label)
  const person = snapshotEntity(
    requiredValue(values, "person", label),
    "person",
    researchPersonFields,
    "research"
  )
  const company = snapshotEntity(
    requiredValue(values, "company", label),
    "company",
    researchCompanyFields,
    "research"
  )
  assertSelection(person, company, "research")
  // SAFETY: The snapshots above validate all fields and authored validators before compilation.
  const compiled = compileResearchRequest({
    company,
    person,
    seed: validationSeed,
    ttl,
  } as never)
  // SAFETY: compileResearchRequest returned the canonical wire entity maps for the exact snapshot.
  return Object.freeze({
    company: Object.freeze(compiled.company),
    person: Object.freeze(compiled.person),
    ttl,
  }) as ResearchConfig
}

export const validateDeepResearchConfig = (
  config: DeepResearchFactoryConfig
): DeepResearchFactoryConfig => {
  if (!isPlainObject(config)) {
    throw new TypeError("deepResearchSonar config must be an object")
  }
  const label = "deepResearchSonar config"
  const values = snapshotOwnData(config, label)
  const ttl = assertTTL(requiredValue(values, "ttl", label))
  if (values.has("dynamic")) {
    if (values.get("dynamic") !== true) {
      throw new TypeError("deepResearchSonar dynamic must be true when provided")
    }
    assertExactKeys(values, new Set(["dynamic", "ttl"]), "Dynamic deepResearchSonar config")
    return Object.freeze({ dynamic: true, ttl })
  }
  assertExactKeys(values, new Set(["ttl", "person", "company"]), label)
  const person = snapshotEntity(
    requiredValue(values, "person", label),
    "person",
    deepResearchPersonFields,
    "deepResearch"
  )
  const company = snapshotEntity(
    requiredValue(values, "company", label),
    "company",
    deepResearchCompanyFields,
    "deepResearch"
  )
  assertSelection(person, company, "deepResearch")
  const parsed = Schema.decodeUnknownSync(DeepResearchRequest)({
    company,
    person,
    seed: validationSeed,
    ttl,
  })
  // SAFETY: DeepResearchRequest returned the canonical wire entity maps for the exact snapshot.
  return Object.freeze({
    company: Object.freeze(parsed.company),
    person: Object.freeze(parsed.person),
    ttl,
  }) as DeepResearchConfig
}

const validateOptions = (
  options: ResearchOptions | DeepResearchOptions | undefined,
  deep: boolean
) => {
  if (options === undefined) {
    return Object.freeze({ description: undefined, execution: undefined, layer: undefined })
  }
  if (!isPlainObject(options)) {
    throw new TypeError("Sonar tool options must be an object")
  }
  const values = snapshotOwnData(options, "Sonar tool options")
  assertExactKeys(
    values,
    deep ? new Set(["layer", "description", "execution"]) : new Set(["layer", "description"]),
    "Sonar tool options"
  )
  const descriptionValue = values.get("description")
  let description: string | undefined
  if (values.has("description")) {
    if (typeof descriptionValue !== "string") {
      throw new TypeError("Sonar tool description must be a string")
    }
    description = descriptionValue
  }
  const executionValue = values.get("execution")
  let execution: "background" | undefined
  if (values.has("execution")) {
    if (executionValue !== "background") {
      throw new TypeError("Deep Sonar execution must be background when provided")
    }
    execution = executionValue
  }
  // SAFETY: The public options type supplies the Layer contract; this snapshot prevents inherited
  // or later-mutated values from changing the injected execution boundary.
  const layer = values.get("layer") as ResearchOptions["layer"]
  return Object.freeze({ description, execution, layer })
}

export const validateResearchOptions = (options: ResearchOptions | undefined): ResearchOptions =>
  validateOptions(options, false)

export const validateDeepResearchOptions = (
  options: DeepResearchOptions | undefined
): DeepResearchOptions => validateOptions(options, true)

const selectedDescription = (
  latency: "seconds" | "minutes",
  person: Readonly<Record<string, unknown>>,
  company: Readonly<Record<string, unknown>>,
  namespace: "research" | "deepResearch"
) => {
  const fields = (entity: Readonly<Record<string, unknown>>) =>
    Object.entries(entity).flatMap(([key, value]) =>
      key === namespace && isPlainObject(value)
        ? Object.keys(value).map((answer) => `${namespace}.${answer}`)
        : [key]
    )
  return `Enrich an identity with Sonar in ${latency}. Returns person fields in order: ${
    fields(person).join(", ") || "none"
  }; company fields in order: ${fields(company).join(", ") || "none"}; ${namespace} answers remain nested under their person or company entity.`
}

const dynamicDescription = (
  latency: "seconds" | "minutes",
  person: readonly string[],
  company: readonly string[],
  namespace: "research" | "deepResearch"
) =>
  `Enrich an identity with Sonar in ${latency}. The model selects person fields from ${person.join(
    ", "
  )}, then company fields from ${company.join(
    ", "
  )}, and may provide non-empty camelCase ${namespace} questions whose answers remain nested under the matching person or company entity.`

const appendDescription = (generated: string, caller: string | undefined) =>
  caller === undefined || caller.length === 0 ? generated : `${generated}\n\n${caller}`

export const researchDescription = (config: ResearchFactoryConfig, caller: string | undefined) =>
  appendDescription(
    isDynamicConfig(config)
      ? dynamicDescription("seconds", researchPersonFields, researchCompanyFields, "research")
      : selectedDescription("seconds", config.person, config.company, "research"),
    caller
  )

export const deepResearchDescription = (
  config: DeepResearchFactoryConfig,
  caller: string | undefined
) =>
  appendDescription(
    isDynamicConfig(config)
      ? dynamicDescription(
          "minutes",
          deepResearchPersonFields,
          deepResearchCompanyFields,
          "deepResearch"
        )
      : selectedDescription("minutes", config.person, config.company, "deepResearch"),
    caller
  )
