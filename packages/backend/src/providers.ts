import { JSONValue as APIJSONValue } from "@usesonar/api"
import type { JSONValue } from "@usesonar/api"
import { Context, Data, Effect, Layer, ManagedRuntime } from "effect"
import { Firecrawl, SdkError as FirecrawlSDKError } from "firecrawl"
import ky from "ky"
import Parallel from "parallel-web"

/* eslint-disable anti-slop/no-runtime-typeof, max-classes-per-file -- The provider boundary parses JSON once, then interprets JSON Schema primitive kinds; its co-located Effect service tags form one private adapter. */

export type ProviderEntity = "person" | "company"

export type ProviderHTTPRequest = {
  readonly method: "GET" | "POST"
  readonly path: string
  readonly json?: JSONValue
}

export type ProviderHTTPResponse = {
  readonly status: number
  readonly body: JSONValue
}

export type ProviderTransportService = {
  readonly request: (
    request: ProviderHTTPRequest
  ) => Effect.Effect<ProviderHTTPResponse, ProviderFailure>
}

export class ProviderTransport extends Context.Service<
  ProviderTransport,
  ProviderTransportService
>()("@usesonar/backend/internal/ProviderTransport") {}

type ParallelTaskClientService = {
  readonly create: (input: {
    readonly identity: Readonly<Record<string, JSONValue>>
    readonly outputSchema: Readonly<Record<string, JSONValue>>
    readonly requestId: string
  }) => Effect.Effect<JSONValue, ProviderFailure>
  readonly result: (runId: string) => Effect.Effect<JSONValue, ProviderFailure>
}

export class ParallelTaskClient extends Context.Service<
  ParallelTaskClient,
  ParallelTaskClientService
>()("@usesonar/backend/internal/ParallelTaskClient") {}

export type CompanySiteField = "name" | "logo" | "colors" | "description"

export type FirecrawlScrape = {
  readonly fields: readonly CompanySiteField[]
  readonly url: string
}

type FirecrawlSDKClientService = {
  readonly scrape: (input: FirecrawlScrape) => Effect.Effect<JSONValue, ProviderFailure>
}

export class FirecrawlSDKClient extends Context.Service<
  FirecrawlSDKClient,
  FirecrawlSDKClientService
>()("@usesonar/backend/internal/FirecrawlSDKClient") {}

export type ProviderClockService = {
  readonly now: Effect.Effect<number>
  readonly sleep: (milliseconds: number) => Effect.Effect<void>
}

export class ProviderClock extends Context.Service<ProviderClock, ProviderClockService>()(
  "@usesonar/backend/internal/ProviderClock"
) {}

type StoredRun = {
  readonly provider: "parallel" | "sixtyFour"
  readonly runId: string
}

export type ProviderRunStoreService = {
  readonly get: (requestId: string) => Effect.Effect<StoredRun | undefined>
  readonly set: (requestId: string, run: StoredRun) => Effect.Effect<void>
}

export class ProviderRunStore extends Context.Service<ProviderRunStore, ProviderRunStoreService>()(
  "@usesonar/backend/internal/ProviderRunStore"
) {}

export type ProviderAnswer =
  | {
      readonly status: "resolved"
      readonly value: JSONValue
      readonly confidence: number
      readonly sources: readonly string[]
    }
  | { readonly status: "notFound" }

export type ParallelBatch = {
  readonly entity: ProviderEntity
  readonly identity: Readonly<Record<string, JSONValue>>
  readonly questions: Readonly<Record<string, JSONValue>>
  readonly requestId: string
}

export type SixtyFourBatch = {
  readonly entity: ProviderEntity
  readonly identity: Readonly<Record<string, JSONValue>>
  readonly questions: Readonly<Record<string, string>>
  readonly requestId: string
}

export type CompanySiteBatch = {
  readonly domain: string
  readonly fields: readonly CompanySiteField[]
}

export type ProviderGatewayService = {
  readonly research: (
    batch: ParallelBatch
  ) => Effect.Effect<Readonly<Record<string, ProviderAnswer>>, ProviderFailure>
  readonly deepResearch: (
    batch: SixtyFourBatch
  ) => Effect.Effect<Readonly<Record<string, ProviderAnswer>>, ProviderFailure>
  readonly companySite: (
    batch: CompanySiteBatch
  ) => Effect.Effect<Readonly<Record<string, ProviderAnswer>>, ProviderFailure>
}

export type ProviderRunner = {
  readonly close?: () => Promise<void>
  readonly companySite?: (
    batch: CompanySiteBatch,
    signal: AbortSignal
  ) => Promise<Readonly<Record<string, ProviderAnswer>>>
  readonly research: (
    batch: ParallelBatch,
    signal: AbortSignal
  ) => Promise<Readonly<Record<string, ProviderAnswer>>>
  readonly deepResearch: (
    batch: SixtyFourBatch,
    signal: AbortSignal
  ) => Promise<Readonly<Record<string, ProviderAnswer>>>
}

export class ProviderGateway extends Context.Service<ProviderGateway, ProviderGatewayService>()(
  "@usesonar/backend/internal/ProviderGateway"
) {}

type ProviderFailureFields = {
  readonly kind:
    | "auth"
    | "http"
    | "invalidResponse"
    | "rateLimited"
    | "rejected"
    | "timeout"
    | "transport"
}

export class ProviderFailure extends Data.TaggedError("ProviderFailure")<ProviderFailureFields> {}

export type HTTPTransportOptions = {
  readonly sixtyFour: { readonly apiKey: string; readonly baseURL?: string }
}

const responseBody = async (response: Response): Promise<JSONValue> => {
  const text = await response.text()
  if (text.length === 0) {
    return null
  }
  try {
    return APIJSONValue.parse(JSON.parse(text))
  } catch {
    return text
  }
}

export const makeKyProviderTransportLayer = (
  options: HTTPTransportOptions
): Layer.Layer<ProviderTransport> => {
  const client = ky.create({
    headers: { "x-api-key": options.sixtyFour.apiKey },
    prefix: options.sixtyFour.baseURL ?? "https://api.sixtyfour.ai/",
    retry: 0,
    throwHttpErrors: false,
  })
  return Layer.succeed(ProviderTransport, {
    request: (request) =>
      Effect.tryPromise({
        catch: () => new ProviderFailure({ kind: "transport" }),
        try: async (signal) => {
          const response = await client(request.path, {
            json: request.json,
            method: request.method,
            signal,
          })
          return { body: await responseBody(response), status: response.status }
        },
      }),
  })
}

export type ParallelSDKOptions = {
  readonly apiKey: string
  readonly baseURL?: string
  readonly resultTimeoutSeconds?: number
}

export type FirecrawlSDKOptions = {
  readonly apiKey: string
  readonly apiURL?: string
  readonly timeoutMilliseconds?: number
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The SDK rejection boundary is discriminated by its exported error class.
const firecrawlFailure = (error: unknown) => {
  if (!(error instanceof FirecrawlSDKError)) {
    return new ProviderFailure({ kind: "transport" })
  }
  if (error.status === 401 || error.status === 403) {
    return new ProviderFailure({ kind: "auth" })
  }
  if (error.status === 429) {
    return new ProviderFailure({ kind: "rateLimited" })
  }
  if (
    error.status === 408 ||
    error.code === "ECONNABORTED" ||
    error.code === "ETIMEDOUT" ||
    error.code === "SCRAPE_TIMEOUT"
  ) {
    return new ProviderFailure({ kind: "timeout" })
  }
  return new ProviderFailure({ kind: "http" })
}

export const makeFirecrawlSDKLayer = (
  options: FirecrawlSDKOptions
): Layer.Layer<FirecrawlSDKClient> => {
  const timeout = options.timeoutMilliseconds ?? 20_000
  const client = new Firecrawl({
    apiKey: options.apiKey,
    apiUrl: options.apiURL ?? "https://api.firecrawl.dev",
    // Firecrawl names total attempts `maxRetries`; one means one request and no retry.
    maxRetries: 1,
    timeoutMs: timeout,
  })
  return Layer.succeed(FirecrawlSDKClient, {
    scrape: (input) =>
      Effect.tryPromise({
        catch: firecrawlFailure,
        try: async () =>
          APIJSONValue.parse(
            await client.scrape(input.url, {
              autoResume: false,
              formats: [
                ...(input.fields.some((field) => field !== "description")
                  ? (["branding"] as const)
                  : []),
                ...(input.fields.includes("description") ? (["summary"] as const) : []),
              ],
              onlyMainContent: true,
              timeout,
            })
          ),
      }),
  })
}

export const makeParallelSDKLayer = (
  options: ParallelSDKOptions
): Layer.Layer<ParallelTaskClient> => {
  const client = new Parallel({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
  })
  return Layer.succeed(ParallelTaskClient, {
    create: ({ identity, outputSchema, requestId }) =>
      Effect.tryPromise({
        catch: () => new ProviderFailure({ kind: "transport" }),
        try: async (signal) =>
          APIJSONValue.parse(
            await client.taskRun.create(
              {
                input: identity,
                processor: "core-fast",
                task_spec: {
                  output_schema: {
                    json_schema: outputSchema,
                    type: "json",
                  },
                },
              },
              { idempotencyKey: requestId, maxRetries: 0, signal }
            )
          ),
      }),
    result: (runId) =>
      Effect.tryPromise({
        catch: () => new ProviderFailure({ kind: "transport" }),
        try: async (signal) =>
          APIJSONValue.parse(
            await client.taskRun.result(
              runId,
              { timeout: options.resultTimeoutSeconds ?? 3600 },
              { signal }
            )
          ),
      }),
  })
}

export const providerClockLayer: Layer.Layer<ProviderClock> = Layer.succeed(ProviderClock, {
  now: Effect.sync(() => Date.now()),
  sleep: (milliseconds) => Effect.sleep(`${milliseconds} millis`),
})

export const makeProviderRunStoreLayer = (): Layer.Layer<ProviderRunStore> => {
  const runs = new Map<string, StoredRun>()
  return Layer.succeed(ProviderRunStore, {
    get: (requestId) => Effect.sync(() => runs.get(requestId)),
    set: (requestId, run) =>
      Effect.sync(() => {
        runs.set(requestId, run)
      }),
  })
}

const isRecord = (value: JSONValue): value is { readonly [key: string]: JSONValue } =>
  value !== null && !Array.isArray(value) && typeof value === "object"

const own = (record: Readonly<Record<string, JSONValue>>, key: string) =>
  Object.hasOwn(record, key) ? record[key] : undefined

const stringAt = (record: Readonly<Record<string, JSONValue>>, key: string) => {
  const value = own(record, key)
  return typeof value === "string" && value.length > 0 ? value : undefined
}

const finiteNumberAt = (record: Readonly<Record<string, JSONValue>>, key: string) => {
  const value = own(record, key)
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

const sameJSON = (left: JSONValue, right: JSONValue) =>
  JSON.stringify(left) === JSON.stringify(right)

const matchesType = (type: string, value: JSONValue) => {
  switch (type) {
    case "array": {
      return Array.isArray(value)
    }
    case "boolean": {
      return typeof value === "boolean"
    }
    case "integer": {
      return typeof value === "number" && Number.isInteger(value)
    }
    case "null": {
      return value === null
    }
    case "number": {
      return typeof value === "number"
    }
    case "object": {
      return isRecord(value) && !Array.isArray(value)
    }
    case "string": {
      return typeof value === "string"
    }
    default: {
      return false
    }
  }
}

// oxlint-disable-next-line complexity -- The bounded JSON Schema interpreter must combine independent keyword checks.
export const matchesJSONSchema = (schema: JSONValue, value: JSONValue): boolean => {
  if (!isRecord(schema)) {
    return false
  }
  const constant = own(schema, "const")
  if (constant !== undefined && !sameJSON(constant, value)) {
    return false
  }
  const enumerated = own(schema, "enum")
  if (Array.isArray(enumerated) && !enumerated.some((entry) => sameJSON(entry, value))) {
    return false
  }
  const schemaType = own(schema, "type")
  if (
    typeof schemaType === "string" &&
    !matchesType(schemaType, value) &&
    !(Array.isArray(schemaType) && schemaType.some((entry) => matchesType(String(entry), value)))
  ) {
    return false
  }
  if (Array.isArray(schemaType) && !schemaType.some((entry) => matchesType(String(entry), value))) {
    return false
  }
  if (Array.isArray(value)) {
    const items = own(schema, "items")
    if (items !== undefined && !value.every((item) => matchesJSONSchema(items, item))) {
      return false
    }
  }
  if (isRecord(value) && !Array.isArray(value)) {
    const properties = own(schema, "properties")
    const propertySchemas = properties !== undefined && isRecord(properties) ? properties : {}
    const required = own(schema, "required")
    if (
      Array.isArray(required) &&
      required.some((key) => typeof key !== "string" || !Object.hasOwn(value, key))
    ) {
      return false
    }
    for (const [key, nested] of Object.entries(propertySchemas)) {
      const candidate = value[key]
      if (candidate !== undefined && !matchesJSONSchema(nested, candidate)) {
        return false
      }
    }
    if (
      own(schema, "additionalProperties") === false &&
      Object.keys(value).some((key) => !Object.hasOwn(propertySchemas, key))
    ) {
      return false
    }
  }
  return true
}

const normalizeConfidence = (value: number | undefined) => {
  if (value === undefined) {
    return 0
  }
  const normalized = value <= 1 ? value : value / 10
  return Math.max(0, Math.min(1, normalized))
}

const parallelConfidence = (value: JSONValue | undefined) => {
  switch (value) {
    case "high": {
      return 1
    }
    case "medium": {
      return 0.5
    }
    case "low": {
      return 0
    }
    default: {
      return 0
    }
  }
}

const parallelAnswers = (
  body: JSONValue,
  questions: Readonly<Record<string, JSONValue>>
): Readonly<Record<string, ProviderAnswer>> | undefined => {
  if (!isRecord(body)) {
    return undefined
  }
  const { output } = body
  if (output === undefined || !isRecord(output)) {
    return undefined
  }
  const content = own(output, "content")
  if (content === undefined || !isRecord(content)) {
    return undefined
  }
  const parsed = content
  const basis = own(output, "basis")
  const basisByField = new Map<string, Readonly<Record<string, JSONValue>>>()
  if (Array.isArray(basis)) {
    for (const item of basis) {
      if (isRecord(item)) {
        const field = stringAt(item, "field")
        if (field !== undefined && !basisByField.has(field)) {
          basisByField.set(field, item)
        }
      }
    }
  }
  return Object.fromEntries(
    Object.entries(questions).map(([key, schema]) => {
      const value = own(parsed, key)
      if (value === undefined || !matchesJSONSchema(schema, value)) {
        return [key, { status: "notFound" }]
      }
      const fieldBasis = basisByField.get(key)
      const citations = fieldBasis === undefined ? undefined : own(fieldBasis, "citations")
      const sources = Array.isArray(citations)
        ? citations.flatMap((citation) => {
            if (!isRecord(citation)) {
              return []
            }
            const url = stringAt(citation, "url")
            return url === undefined ? [] : [url]
          })
        : []
      return [
        key,
        {
          confidence: parallelConfidence(fieldBasis && own(fieldBasis, "confidence")),
          sources: [...new Set(sources)],
          status: "resolved",
          value,
        },
      ]
    })
  )
}

const sixtyFourAnswers = (
  body: JSONValue,
  questions: Readonly<Record<string, string>>
): Readonly<Record<string, ProviderAnswer>> | undefined => {
  if (!isRecord(body)) {
    return undefined
  }
  const structuredData = body.structured_data
  if (structuredData === undefined || !isRecord(structuredData)) {
    return undefined
  }
  const references = own(body, "references")
  const sources = references !== undefined && isRecord(references) ? Object.keys(references) : []
  const fieldConfidence = own(body, "field_confidence")
  const confidenceByField =
    fieldConfidence !== undefined && isRecord(fieldConfidence) ? fieldConfidence : {}
  const globalConfidence = finiteNumberAt(body, "confidence_score")
  return Object.fromEntries(
    Object.keys(questions).map((key) => {
      const value = own(structuredData, key)
      if (typeof value !== "string" || value.trim().length === 0) {
        return [key, { status: "notFound" }]
      }
      const fieldScore = confidenceByField[key]
      return [
        key,
        {
          confidence: normalizeConfidence(
            typeof fieldScore === "number" && Number.isFinite(fieldScore)
              ? fieldScore
              : globalConfidence
          ),
          sources,
          status: "resolved",
          value,
        },
      ]
    })
  )
}

const nonblankString = (value: JSONValue | undefined) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined

const siteURL = (domain: string) => `https://${domain}`

const absoluteSiteURL = (value: JSONValue | undefined, domain: string) => {
  const candidate = nonblankString(value)
  if (candidate === undefined) {
    return
  }
  try {
    const url = new URL(candidate, siteURL(domain))
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined
  } catch {
    // Relative or absolute provider values outside HTTP(S) are unusable as public URLs.
  }
}

const recordAt = (record: Readonly<Record<string, JSONValue>>, key: string) => {
  const value = own(record, key)
  return value !== undefined && isRecord(value) ? value : undefined
}

const validColors = (value: JSONValue | undefined): JSONValue | undefined => {
  if (value === undefined || !isRecord(value)) {
    return undefined
  }
  const entries = Object.entries(value)
  return entries.length > 0 && entries.every(([, color]) => nonblankString(color) !== undefined)
    ? value
    : undefined
}

const companySiteAnswers = (
  body: JSONValue,
  batch: CompanySiteBatch
): Readonly<Record<string, ProviderAnswer>> | undefined => {
  if (!isRecord(body)) {
    return undefined
  }
  const metadata = recordAt(body, "metadata") ?? {}
  const branding = recordAt(body, "branding") ?? {}
  const brandingImages = recordAt(branding, "images") ?? {}
  const source =
    absoluteSiteURL(own(metadata, "sourceURL") ?? own(metadata, "url"), batch.domain) ??
    siteURL(batch.domain)
  const values = {
    colors: validColors(own(branding, "colors")),
    description:
      nonblankString(own(metadata, "description")) ??
      nonblankString(own(metadata, "ogDescription")) ??
      nonblankString(own(body, "summary")),
    logo:
      absoluteSiteURL(own(branding, "logo"), batch.domain) ??
      absoluteSiteURL(own(brandingImages, "logo"), batch.domain) ??
      absoluteSiteURL(own(metadata, "ogImage"), batch.domain) ??
      absoluteSiteURL(own(metadata, "favicon"), batch.domain),
    name:
      nonblankString(own(branding, "brandName")) ??
      nonblankString(own(metadata, "ogSiteName")) ??
      nonblankString(own(metadata, "title")),
  } satisfies Readonly<Record<CompanySiteField, JSONValue | undefined>>
  return Object.fromEntries(
    batch.fields.map((field) => {
      const value = values[field]
      return value === undefined
        ? [field, { status: "notFound" }]
        : [
            field,
            {
              confidence: 1,
              sources: [source],
              status: "resolved",
              value,
            },
          ]
    })
  )
}

export type ProviderGatewayOptions = {
  readonly maxPolls?: number
  readonly pollIntervalMilliseconds?: number
}

const accepted = (status: number) => status >= 200 && status < 300

const jobIdFrom = (body: JSONValue, key: "run_id" | "task_id") =>
  isRecord(body) ? stringAt(body, key) : undefined

const sixtyFourEndpoint = {
  company: "company-intelligence-async",
  person: "people-intelligence-async",
} satisfies Readonly<Record<ProviderEntity, string>>

export const makeProviderGatewayLayer = (
  options: ProviderGatewayOptions = {}
): Layer.Layer<
  ProviderGateway,
  never,
  FirecrawlSDKClient | ParallelTaskClient | ProviderTransport | ProviderClock | ProviderRunStore
> =>
  Layer.effect(
    ProviderGateway,
    Effect.gen(function* makeGateway() {
      const transport = yield* Effect.service(ProviderTransport)
      const parallel = yield* Effect.service(ParallelTaskClient)
      const firecrawl = yield* Effect.service(FirecrawlSDKClient)
      const clock = yield* Effect.service(ProviderClock)
      const runStore = yield* Effect.service(ProviderRunStore)
      const maxPolls = options.maxPolls ?? 120
      const pollIntervalMilliseconds = options.pollIntervalMilliseconds ?? 5000

      const submitSixtyFourOnce = (
        requestId: string,
        request: ProviderHTTPRequest,
        idKey: "task_id"
      ): Effect.Effect<string, ProviderFailure> =>
        Effect.flatMap(runStore.get(requestId), (stored) => {
          if (stored !== undefined) {
            return stored.provider === "sixtyFour"
              ? Effect.succeed(stored.runId)
              : Effect.fail(new ProviderFailure({ kind: "invalidResponse" }))
          }
          return Effect.flatMap(transport.request(request), (response) => {
            if (!accepted(response.status)) {
              return Effect.fail(new ProviderFailure({ kind: "http" }))
            }
            const runId = jobIdFrom(response.body, idKey)
            if (runId === undefined) {
              return Effect.fail(new ProviderFailure({ kind: "invalidResponse" }))
            }
            return Effect.andThen(
              runStore.set(requestId, { provider: "sixtyFour", runId }),
              Effect.succeed(runId)
            )
          })
        })

      const submitParallelOnce = (batch: ParallelBatch): Effect.Effect<string, ProviderFailure> =>
        Effect.flatMap(runStore.get(batch.requestId), (stored) => {
          if (stored !== undefined) {
            return stored.provider === "parallel"
              ? Effect.succeed(stored.runId)
              : Effect.fail(new ProviderFailure({ kind: "invalidResponse" }))
          }
          const outputSchema = {
            additionalProperties: false,
            properties: batch.questions,
            required: Object.keys(batch.questions),
            type: "object",
          }
          return Effect.flatMap(
            parallel.create({
              identity: batch.identity,
              outputSchema,
              requestId: batch.requestId,
            }),
            (body) => {
              const runId = jobIdFrom(body, "run_id")
              if (runId === undefined) {
                return Effect.fail(new ProviderFailure({ kind: "invalidResponse" }))
              }
              return Effect.andThen(
                runStore.set(batch.requestId, { provider: "parallel", runId }),
                Effect.succeed(runId)
              )
            }
          )
        })

      const poll = <Value>(
        request: (runId: string) => ProviderHTTPRequest,
        runId: string,
        parse: (body: JSONValue) => Value | undefined,
        resultBody: (body: JSONValue) => JSONValue | undefined = (body) => body
      ): Effect.Effect<Value, ProviderFailure> => {
        const loop = (remaining: number): Effect.Effect<Value, ProviderFailure> =>
          Effect.suspend(() =>
            Effect.flatMap(transport.request(request(runId)), (response) => {
              if (response.status === 202) {
                return remaining <= 1
                  ? Effect.fail(new ProviderFailure({ kind: "timeout" }))
                  : Effect.andThen(clock.sleep(pollIntervalMilliseconds), loop(remaining - 1))
              }
              if (!accepted(response.status)) {
                return Effect.fail(new ProviderFailure({ kind: "http" }))
              }
              const body = resultBody(response.body)
              const parsed = body === undefined ? undefined : parse(body)
              if (parsed !== undefined) {
                return Effect.succeed(parsed)
              }
              if (isRecord(response.body)) {
                const status = own(response.body, "status")
                if (status === "failed" || status === "cancelled") {
                  return Effect.fail(new ProviderFailure({ kind: "rejected" }))
                }
                if (status === "queued" || status === "running" || status === "RUNNING") {
                  return remaining <= 1
                    ? Effect.fail(new ProviderFailure({ kind: "timeout" }))
                    : Effect.andThen(clock.sleep(pollIntervalMilliseconds), loop(remaining - 1))
                }
              }
              return Effect.fail(new ProviderFailure({ kind: "invalidResponse" }))
            })
          )
        return loop(maxPolls)
      }

      return {
        companySite: (batch: CompanySiteBatch) =>
          Effect.flatMap(
            firecrawl.scrape({ fields: batch.fields, url: siteURL(batch.domain) }),
            (body) => {
              const answers = companySiteAnswers(body, batch)
              return answers === undefined
                ? Effect.fail(new ProviderFailure({ kind: "invalidResponse" }))
                : Effect.succeed(answers)
            }
          ),
        deepResearch: (batch: SixtyFourBatch) =>
          Effect.flatMap(
            submitSixtyFourOnce(
              batch.requestId,
              {
                json: {
                  [batch.entity === "person" ? "lead_info" : "target_company"]: batch.identity,
                  field_confidence: true,
                  struct: batch.questions,
                  tier: "medium",
                },
                method: "POST",
                path: sixtyFourEndpoint[batch.entity],
              },
              "task_id"
            ),
            (runId) =>
              poll(
                (id) => ({
                  method: "GET",
                  path: `job-status/${encodeURIComponent(id)}`,
                }),
                runId,
                (body) => sixtyFourAnswers(body, batch.questions),
                (body) =>
                  isRecord(body) && own(body, "status") === "completed" ? own(body, "result") : body
              )
          ),
        research: (batch: ParallelBatch) =>
          Effect.flatMap(submitParallelOnce(batch), (runId) =>
            Effect.flatMap(parallel.result(runId), (body) => {
              const answers = parallelAnswers(body, batch.questions)
              return answers === undefined
                ? Effect.fail(new ProviderFailure({ kind: "invalidResponse" }))
                : Effect.succeed(answers)
            })
          ),
      }
    })
  )

export const makeProviderRunner = (gatewayLayer: Layer.Layer<ProviderGateway>): ProviderRunner => {
  const runtime = ManagedRuntime.make(gatewayLayer)
  return {
    close: () => runtime.dispose(),
    companySite: (batch, signal) =>
      runtime.runPromise(
        Effect.flatMap(Effect.service(ProviderGateway), (gateway) => gateway.companySite(batch)),
        { signal }
      ),
    deepResearch: (batch, signal) =>
      runtime.runPromise(
        Effect.flatMap(Effect.service(ProviderGateway), (gateway) => gateway.deepResearch(batch)),
        { signal }
      ),
    research: (batch, signal) =>
      runtime.runPromise(
        Effect.flatMap(Effect.service(ProviderGateway), (gateway) => gateway.research(batch)),
        { signal }
      ),
  }
}
/* oxlint-disable anti-slop/no-runtime-typeof, max-classes-per-file -- The provider boundary parses JSON once, then interprets JSON Schema primitive kinds; its co-located Effect service tags form one private adapter. */
