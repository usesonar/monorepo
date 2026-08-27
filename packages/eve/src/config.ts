/* eslint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- Factory arguments are untrusted JavaScript values, so this module validates their exact runtime shape before any execution. */
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
  Object.hasOwn(config, "dynamic") && config.dynamic === true

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

const snapshotFields = <Field extends string>(
  fields: unknown,
  catalog: readonly Field[],
  slot: "person" | "company"
): readonly Field[] => {
  if (!Array.isArray(fields)) {
    throw new TypeError(`Sonar ${slot} selection must be an array`)
  }
  const snapshot: unknown[] = []
  for (let index = 0; index < fields.length; index += 1) {
    if (!Object.hasOwn(fields, index)) {
      throw new TypeError(`Sonar ${slot} selection must not contain sparse slots`)
    }
    snapshot.push(fields[index])
  }
  if (new Set(snapshot).size !== snapshot.length) {
    throw new TypeError(`Sonar ${slot} selection must not contain duplicates`)
  }
  const validated: Field[] = []
  for (const field of snapshot) {
    if (typeof field !== "string" || !catalog.some((candidate) => candidate === field)) {
      throw new TypeError(`${String(field)} is not available on this Sonar tier`)
    }
    // SAFETY: The catalog comparison above proves the stable snapshot value is this tier's Field.
    validated.push(field as Field)
  }
  return Object.freeze(validated)
}

const normalizedQuestions = (questions: unknown, namespace: "research" | "deepResearch") => {
  if (!isPlainObject(questions)) {
    throw new TypeError(`Sonar ${namespace} questions must be an object`)
  }
  const normalized: Record<string, string> = {}
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
    if (typeof question !== "string" || question.trim().length === 0) {
      throw new TypeError(`Question ${key} must be non-empty`)
    }
    normalized[key] = question.trim()
  }
  return Object.freeze(normalized)
}

const assertSelection = (
  person: readonly unknown[],
  company: readonly unknown[],
  questions: Readonly<Record<string, string>>
) => {
  if (person.length + company.length + Object.keys(questions).length === 0) {
    throw new TypeError("Select at least one built-in or custom Sonar field")
  }
}

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
  assertExactKeys(values, new Set(["ttl", "person", "company", "research"]), label)
  const person = snapshotFields(
    requiredValue(values, "person", label),
    researchPersonFields,
    "person"
  )
  const company = snapshotFields(
    requiredValue(values, "company", label),
    researchCompanyFields,
    "company"
  )
  const research = normalizedQuestions(requiredValue(values, "research", label), "research")
  assertSelection(person, company, research)
  return Object.freeze({ company, person, research, ttl })
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
  assertExactKeys(values, new Set(["ttl", "person", "company", "deepResearch"]), label)
  const person = snapshotFields(
    requiredValue(values, "person", label),
    deepResearchPersonFields,
    "person"
  )
  const company = snapshotFields(
    requiredValue(values, "company", label),
    deepResearchCompanyFields,
    "company"
  )
  const deepResearch = normalizedQuestions(
    requiredValue(values, "deepResearch", label),
    "deepResearch"
  )
  assertSelection(person, company, deepResearch)
  return Object.freeze({ company, deepResearch, person, ttl })
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
  person: readonly string[],
  company: readonly string[],
  custom: readonly string[]
) =>
  `Enrich an identity with Sonar in ${latency}. Returns person fields in order: ${
    person.join(", ") || "none"
  }; company fields in order: ${company.join(", ") || "none"}; top-level custom answers in order: ${custom.join(", ") || "none"}.`

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
  )}, and may provide non-empty camelCase ${namespace} questions whose answers are returned as top-level keys.`

const appendDescription = (generated: string, caller: string | undefined) =>
  caller === undefined || caller.length === 0 ? generated : `${generated}\n\n${caller}`

export const researchDescription = (config: ResearchFactoryConfig, caller: string | undefined) =>
  appendDescription(
    isDynamicConfig(config)
      ? dynamicDescription("seconds", researchPersonFields, researchCompanyFields, "research")
      : selectedDescription("seconds", config.person, config.company, Object.keys(config.research)),
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
      : selectedDescription(
          "minutes",
          config.person,
          config.company,
          Object.keys(config.deepResearch)
        ),
    caller
  )
