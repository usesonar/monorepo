/* eslint-disable anti-slop/no-conditional-empty-object-spread, anti-slop/no-known-value-widening, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- Eve inputs, Effect failures, and streamed snapshots are untrusted runtime boundaries that this module validates or projects before use; projection intentionally builds a runtime-selected field map. */
import {
  DeepResearchRequest,
  SonarClient,
  compileResearchRequest,
  layer as sonarLayer,
} from "@usesonar/effect"
import type {
  DeepResearchConfig,
  DeepResearchRequest as EffectDeepResearchRequest,
  ResearchConfig,
  ResearchRequest as EffectResearchRequest,
  SonarSeed,
  SonarSnapshot,
} from "@usesonar/effect"
import { Effect, Schema, Stream } from "effect"
import type { Layer } from "effect"

import { isDynamicConfig } from "./config.js"
import { sanitizeSonarFailure, SonarToolError, sonarToolError } from "./errors.js"
import type { SonarToolRoute } from "./errors.js"
import type { DeepResearchFactoryConfig, ResearchFactoryConfig } from "./types.js"

type StandardSchema = {
  readonly "~standard": {
    readonly validate: (
      value: unknown
    ) =>
      | { readonly issues: readonly unknown[] }
      | { readonly value: unknown }
      | Promise<{ readonly issues: readonly unknown[] } | { readonly value: unknown }>
  }
}

const validatedInput = (route: SonarToolRoute, schema: StandardSchema, input: unknown) => {
  try {
    const result = schema["~standard"].validate(input)
    if (result instanceof Promise || "issues" in result) {
      throw sonarToolError(route, "validation", "Invalid Sonar tool input")
    }
    return result.value
  } catch (error) {
    if (error instanceof SonarToolError) {
      throw error
    }
    throw sonarToolError(route, "validation", "Invalid Sonar tool input")
  }
}

const executionLayer = (route: SonarToolRoute, injected: Layer.Layer<SonarClient> | undefined) => {
  if (injected !== undefined) {
    return injected
  }
  const baseURL = process.env.SONAR_BASE_URL
  const secretKey = process.env.SONAR_SECRET_KEY
  if (baseURL === undefined || baseURL.trim().length === 0) {
    throw sonarToolError(route, "configuration", "Sonar configuration requires SONAR_BASE_URL")
  }
  if (secretKey === undefined || secretKey.trim().length === 0) {
    throw sonarToolError(route, "configuration", "Sonar configuration requires SONAR_SECRET_KEY")
  }
  try {
    return sonarLayer({ baseURL, secretKey })
  } catch {
    throw sonarToolError(route, "configuration", "Sonar configuration could not be created")
  }
}

const seedFromInput = (input: Readonly<Record<string, unknown>>): SonarSeed => {
  const seed = {
    ...(typeof input.linkedinURL === "string" ? { linkedinURL: input.linkedinURL } : {}),
    ...(typeof input.fullName === "string" ? { fullName: input.fullName } : {}),
    ...(typeof input.xURL === "string" ? { xURL: input.xURL } : {}),
    ...(typeof input.email === "string" ? { email: input.email } : {}),
    ...(typeof input.domain === "string" ? { domain: input.domain } : {}),
    ...(input.context === undefined ? {} : { context: input.context }),
  }
  // SAFETY: The tool's Effect Standard Schema validates one exact SonarSeed branch before this runs.
  return seed as SonarSeed
}

export const researchRequest = (
  config: ResearchFactoryConfig,
  input: Readonly<Record<string, unknown>>
): EffectResearchRequest => {
  const seed = seedFromInput(input)
  if (isDynamicConfig(config)) {
    // SAFETY: The dynamic research Effect Schema validated these two entity maps.
    const dynamicInput = input as Readonly<Record<string, unknown>> & {
      readonly person: ResearchConfig["person"]
      readonly company: ResearchConfig["company"]
    }
    // SAFETY: The dynamic research input schema accepts canonical raw JSON Schema maps only.
    return compileResearchRequest({
      company: dynamicInput.company,
      person: dynamicInput.person,
      seed,
      ttl: config.ttl,
    } as never)
  }
  // oxlint-disable-next-line sort-keys -- Public Effect requests place the seed before Sonar config fields and preserve person before company.
  return {
    seed,
    ttl: config.ttl,
    person: config.person,
    company: config.company,
  }
}

export const deepResearchRequest = (
  config: DeepResearchFactoryConfig,
  input: Readonly<Record<string, unknown>>
): EffectDeepResearchRequest => {
  const seed = seedFromInput(input)
  if (isDynamicConfig(config)) {
    // SAFETY: The dynamic deep research Effect Schema validated these two entity maps.
    const dynamicInput = input as Readonly<Record<string, unknown>> & {
      readonly person: DeepResearchConfig["person"]
      readonly company: DeepResearchConfig["company"]
    }
    return Schema.decodeUnknownSync(DeepResearchRequest)({
      company: dynamicInput.company,
      person: dynamicInput.person,
      seed,
      ttl: config.ttl,
    })
  }
  // oxlint-disable-next-line sort-keys -- Public Effect requests place the seed before Sonar config fields and preserve person before company.
  return {
    seed,
    ttl: config.ttl,
    person: config.person,
    company: config.company,
  }
}

const clientStream = <Config extends ResearchConfig | DeepResearchConfig>(
  route: SonarToolRoute,
  request: EffectResearchRequest | EffectDeepResearchRequest,
  injected: Layer.Layer<SonarClient> | undefined
) => {
  const operation = SonarClient.pipe(
    Effect.map((client) => {
      if (route === "research") {
        // SAFETY: Eve's static config validation and dynamic input schema validate a finite
        // question map before this bridge. The Effect generic cannot express runtime-selected keys.
        return client.research(request as never) as Stream.Stream<SonarSnapshot<Config>, unknown>
      }
      // SAFETY: Eve's static config validation and dynamic input schema validate a finite
      // question map before this bridge. The Effect generic cannot express runtime-selected keys.
      return client.deepResearch(request as never) as Stream.Stream<SonarSnapshot<Config>, unknown>
    })
  )
  const stream = Stream.unwrap(operation)
  // SAFETY: Both client operations return snapshots derived from the exact request config.
  return stream.pipe(Stream.provide(executionLayer(route, injected))) as Stream.Stream<
    SonarSnapshot<Config>,
    unknown
  >
}

const cancellationError = (route: SonarToolRoute) =>
  sonarToolError(
    route,
    "cancellation",
    route === "research" ? "Sonar research was cancelled" : "Sonar deep research was cancelled"
  )

const publicFailure = (route: SonarToolRoute, error: unknown) => {
  if (error instanceof SonarToolError) {
    return error
  }
  if (error instanceof Error && /cancel/iu.test(error.message)) {
    return cancellationError(route)
  }
  return sanitizeSonarFailure(route, "execution", error)
}

const nextWithAbort = async <Value>(
  iterator: AsyncIterator<Value>,
  signal: AbortSignal,
  route: SonarToolRoute
) => {
  if (signal.aborted) {
    await iterator.return?.()
    throw cancellationError(route)
  }
  let abort: (() => void) | undefined
  // eslint-disable-next-line promise/avoid-new -- AbortSignal exposes an event callback, so a promise is the cancellation branch raced against the stream iterator.
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      void iterator.return?.()
      reject(cancellationError(route))
    }
    signal.addEventListener("abort", abort, { once: true })
  })
  try {
    return await Promise.race([iterator.next(), aborted])
  } finally {
    if (abort !== undefined) {
      signal.removeEventListener("abort", abort)
    }
  }
}

export const streamSnapshots = async function* streamSnapshots<
  Config extends ResearchConfig | DeepResearchConfig,
>(
  route: SonarToolRoute,
  request: EffectResearchRequest | EffectDeepResearchRequest,
  layer: Layer.Layer<SonarClient> | undefined,
  signal: AbortSignal
) {
  const iterator = Stream.toAsyncIterable(clientStream<Config>(route, request, layer))[
    Symbol.asyncIterator
  ]()
  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop -- Async iterators must be advanced sequentially; parallel reads would reorder or lose snapshots.
      const next = await nextWithAbort(iterator, signal, route)
      if (next.done) {
        return
      }
      yield next.value
    }
  } catch (error) {
    throw publicFailure(route, error)
  } finally {
    await iterator.return?.()
  }
}

export const finalSnapshot = async <Config extends ResearchConfig | DeepResearchConfig>(
  route: "research" | "deepResearch",
  request: EffectResearchRequest | EffectDeepResearchRequest,
  layer: Layer.Layer<SonarClient> | undefined,
  signal: AbortSignal
) => {
  let final: SonarSnapshot<Config> | undefined
  for await (const snapshot of streamSnapshots<Config>(route, request, layer, signal)) {
    final = snapshot
  }
  if (final === undefined) {
    throw sonarToolError(route, "execution", "Sonar returned no result")
  }
  return final
}

export const validateExecutionInput = validatedInput

type ProjectedLeaf = {
  readonly value: unknown
  readonly confidence: number
}

const ownDataProperty = <Input extends object>(input: Input, key: PropertyKey) => {
  const descriptor = Object.getOwnPropertyDescriptor(input, key)
  if (descriptor?.enumerable !== true || !("value" in descriptor)) {
    return
  }
  const value: unknown = descriptor.value
  return { value }
}

const resolvedLeaf = (input: unknown): ProjectedLeaf | undefined => {
  if (typeof input !== "object" || input === null) {
    return undefined
  }
  const status = ownDataProperty(input, "status")
  const value = ownDataProperty(input, "value")
  const confidence = ownDataProperty(input, "confidence")
  if (
    status?.value !== "resolved" ||
    value === undefined ||
    typeof confidence?.value !== "number"
  ) {
    return undefined
  }
  // oxlint-disable-next-line sort-keys -- Eve model leaves expose value before confidence.
  return { value: value.value, confidence: confidence.value }
}

type ProjectedFields = Record<string, ProjectedLeaf>

const projectFields = (input: unknown, allowed: ReadonlySet<string>): ProjectedFields => {
  if (typeof input !== "object" || input === null) {
    return {}
  }
  const projected: ProjectedFields = {}
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key === "string" && allowed.has(key)) {
      const field = ownDataProperty(input, key)
      const leaf = resolvedLeaf(field?.value)
      if (leaf !== undefined) {
        projected[key] = leaf
      }
    }
  }
  return projected
}

const customKeyPattern = /^[a-z][A-Za-z\d]*$/u
const reservedCustomKeys = new Set(["ttl", "person", "company", "research", "deepResearch"])

const isProjectableCustomKey = (
  key: PropertyKey,
  allowed: ReadonlySet<string> | undefined
): key is string =>
  typeof key === "string" &&
  customKeyPattern.test(key) &&
  !reservedCustomKeys.has(key) &&
  (allowed === undefined || allowed.has(key))

const projectAnswers = (input: unknown, allowed: readonly string[] | undefined) => {
  if (typeof input !== "object" || input === null) {
    return {}
  }
  const projected: ProjectedFields = {}
  const allowedKeys = allowed === undefined ? undefined : new Set(allowed)
  for (const key of Reflect.ownKeys(input)) {
    if (!isProjectableCustomKey(key, allowedKeys)) {
      continue
    }
    const leaf = resolvedLeaf(ownDataProperty(input, key)?.value)
    if (leaf !== undefined) {
      projected[key] = leaf
    }
  }
  return projected
}

const projectEntity = (
  input: unknown,
  fields: readonly string[],
  namespace: "research" | "deepResearch",
  answers: readonly string[] | undefined
) => {
  const projected: Record<string, unknown> = projectFields(input, new Set(fields))
  if (typeof input !== "object" || input === null) {
    return projected
  }
  const nestedAnswers = projectAnswers(ownDataProperty(input, namespace)?.value, answers)
  if (Object.keys(nestedAnswers).length > 0) {
    projected[namespace] = nestedAnswers
  }
  return projected
}

export const projectSnapshot = (
  snapshot: unknown,
  personFields: readonly string[],
  companyFields: readonly string[],
  namespace: "research" | "deepResearch",
  personAnswers: readonly string[] | undefined,
  companyAnswers: readonly string[] | undefined
) => {
  if (typeof snapshot !== "object" || snapshot === null) {
    return { type: "json" as const, value: {} }
  }
  const dataProperty = ownDataProperty(snapshot, "data")
  if (typeof dataProperty?.value !== "object" || dataProperty.value === null) {
    return { type: "json" as const, value: {} }
  }
  const data = dataProperty.value
  const value: Record<string, unknown> = {}
  const person = projectEntity(
    ownDataProperty(data, "person")?.value,
    personFields,
    namespace,
    personAnswers
  )
  if (Object.keys(person).length > 0) {
    value.person = person
  }
  const company = projectEntity(
    ownDataProperty(data, "company")?.value,
    companyFields,
    namespace,
    companyAnswers
  )
  if (Object.keys(company).length > 0) {
    value.company = company
  }
  return { type: "json" as const, value }
}
