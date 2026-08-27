import {
  DeepResearchRequest as APIDeepResearchRequest,
  ResearchRequest as APIResearchRequest,
  SonarStreamError,
  createSonar,
  retrieveSonar,
  streamDeepResearch,
  streamResearch,
} from "@usesonar/api"
import type {
  SonarEvent as APISonarEvent,
  SonarResponse as APISonarResponse,
  ValidQuestions,
} from "@usesonar/api"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"

import { HTTPError, ProtocolError, RequestError, TransportError } from "./errors.js"
import { CompleteEvent, initialSnapshot } from "./model.js"
import type {
  DeepResearchConfig,
  DeepResearchRequest,
  ResearchConfig,
  ResearchRequest,
  SonarSnapshot,
} from "./model.js"
import { reduceSnapshot } from "./protocol.js"

type PublicError = RequestError | TransportError | HTTPError | ProtocolError
type ResponseData = APISonarResponse["data"]
type ResponseFields = ResponseData["person"] | ResponseData["company"]
type ResponseKeyCollection = ResponseData | ResponseFields

type IsAny<Value> = 0 extends 1 & Value ? true : false

type TupleHasAnyElement<Keys extends readonly PropertyKey[]> = Keys extends readonly [
  infer Head,
  ...infer Tail extends readonly PropertyKey[],
]
  ? true extends IsAny<Head>
    ? true
    : TupleHasAnyElement<Tail>
  : false

type ValidSelectedKeys<Keys extends readonly PropertyKey[]> =
  true extends TupleHasAnyElement<Keys> ? never : Keys

type ValidQuestionMap<Questions extends object> = ValidQuestions<Questions>

type ValidResearchConfig<C extends ResearchConfig<object>> = [
  ValidQuestionMap<C["research"]>,
] extends [never]
  ? never
  : C extends unknown
    ? C & {
        readonly person: ValidSelectedKeys<C["person"]>
        readonly company: ValidSelectedKeys<C["company"]>
        readonly research: ValidQuestionMap<C["research"]>
      }
    : never

type ValidDeepResearchConfig<C extends DeepResearchConfig<object>> = [
  ValidQuestionMap<C["deepResearch"]>,
] extends [never]
  ? never
  : C extends unknown
    ? C & {
        readonly person: ValidSelectedKeys<C["person"]>
        readonly company: ValidSelectedKeys<C["company"]>
        readonly deepResearch: ValidQuestionMap<C["deepResearch"]>
      }
    : never

export type ValidResearchRequest<C extends ResearchConfig<object>> = ResearchRequest<C> &
  ValidResearchConfig<C>

export type ValidDeepResearchRequest<C extends DeepResearchConfig<object>> =
  DeepResearchRequest<C> & ValidDeepResearchConfig<C>

export type ValidConfig<C extends ResearchConfig<object> | DeepResearchConfig<object>> = [
  C,
] extends [ResearchConfig<object>]
  ? ValidResearchConfig<C>
  : [C] extends [DeepResearchConfig<object>]
    ? ValidDeepResearchConfig<C>
    : never

export type SonarClientService = {
  readonly research: <const C extends ResearchConfig<object>>(
    request: ValidResearchRequest<C>
  ) => Stream.Stream<SonarSnapshot<C>, PublicError>
  readonly deepResearch: <const C extends DeepResearchConfig<object>>(
    request: ValidDeepResearchRequest<C>
  ) => Stream.Stream<SonarSnapshot<C>, PublicError>
  readonly retrieve: <const C extends ResearchConfig<object> | DeepResearchConfig<object>>(
    hash: string,
    config: ValidConfig<C>
  ) => Effect.Effect<SonarSnapshot<C>, PublicError>
}

export class SonarClient extends Context.Service<SonarClient, SonarClientService>()(
  "@usesonar/effect/SonarClient"
) {}

type SonarAPI = ReturnType<typeof createSonar>
export type LayerOptions = Parameters<typeof createSonar>[0]

const HTTPFailure = Schema.Struct({ response: Schema.instanceOf(Response) })
const decodeHTTPFailure = Schema.decodeUnknownOption(HTTPFailure)
const decodeError = Schema.decodeUnknownOption(Schema.ErrorInstance())
const decodeObject = Schema.decodeUnknownOption(Schema.ObjectKeyword)

const mapRawError = (cause: unknown, phase: "request" | "protocol" = "protocol"): PublicError => {
  const httpFailure = Option.getOrUndefined(decodeHTTPFailure(cause))
  if (httpFailure) {
    return new HTTPError({
      message: "Sonar HTTP request failed",
      status: httpFailure.response.status,
    })
  }
  if (phase === "request") {
    return new RequestError({ message: "Invalid Sonar request" })
  }
  const error = Option.getOrUndefined(decodeError(cause))
  return cause instanceof SonarStreamError || error?.name === "ZodError"
    ? new ProtocolError({ message: "Invalid Sonar response protocol" })
    : new TransportError({ message: "Sonar transport failed" })
}

const fromAPIEvent = <const C extends ResearchConfig<object> | DeepResearchConfig<object>>(
  snapshot: SonarSnapshot<C> | undefined,
  event: APISonarEvent
): Effect.Effect<readonly [SonarSnapshot<C>, readonly SonarSnapshot<C>[]], ProtocolError> => {
  if (event.type === "snapshot") {
    if (snapshot !== undefined) {
      return Effect.fail(new ProtocolError({ message: "Received more than one initial snapshot" }))
    }
    // SAFETY: The raw API validated this snapshot against the same literal request C.
    const next = event.snapshot as SonarSnapshot<C>
    return Effect.succeed([next, [next]])
  }
  if (snapshot === undefined) {
    return Effect.fail(
      new ProtocolError({ message: "Received an event before the initial snapshot" })
    )
  }
  const protocolEvent =
    event.type === "field"
      ? { _tag: "FieldEvent" as const, field: event.field, path: event.path }
      : CompleteEvent
  return Effect.map(reduceSnapshot(snapshot, protocolEvent), (next) => [next, [next]])
}

const streamFromReadable = <const C extends ResearchConfig<object> | DeepResearchConfig<object>>(
  readable: ReadableStream<APISonarEvent>
) =>
  Stream.fromReadableStream({
    evaluate: () => readable,
    onError: mapRawError,
  }).pipe(
    Stream.mapAccumEffect(
      (): SonarSnapshot<C> | undefined => undefined,
      (snapshot, event) => fromAPIEvent(snapshot, event)
    )
  )

const researchStream = <const C extends ResearchConfig<object>>(
  api: SonarAPI,
  request: ValidResearchRequest<C>
): Stream.Stream<SonarSnapshot<C>, PublicError> => {
  const parsed = APIResearchRequest.safeParse(request)
  if (!parsed.success) {
    return Stream.fail(mapRawError(parsed.error, "request"))
  }
  return Stream.unwrap(
    Effect.tryPromise({
      catch: mapRawError,
      try: (signal) => streamResearch(api, parsed.data, { signal }),
    }).pipe(Effect.map((readable) => streamFromReadable<C>(readable)))
  )
}

const deepResearchStream = <const C extends DeepResearchConfig<object>>(
  api: SonarAPI,
  request: ValidDeepResearchRequest<C>
): Stream.Stream<SonarSnapshot<C>, PublicError> => {
  const parsed = APIDeepResearchRequest.safeParse(request)
  if (!parsed.success) {
    return Stream.fail(mapRawError(parsed.error, "request"))
  }
  return Stream.unwrap(
    Effect.tryPromise({
      catch: mapRawError,
      try: (signal) => streamDeepResearch(api, parsed.data, { signal }),
    }).pipe(Effect.map((readable) => streamFromReadable<C>(readable)))
  )
}

const sameKeys = (actual: ResponseKeyCollection, expected: readonly string[]) => {
  const keys = new Set(Object.keys(actual))
  return keys.size === expected.length && expected.every((key) => keys.has(key))
}

const RetrieveValidationSeed = {
  linkedinURL: "https://www.linkedin.com/in/sonar-validation",
} as const

const parseRetrieveConfig = (
  config: ResearchConfig<object> | DeepResearchConfig<object>
): ResearchConfig | DeepResearchConfig | undefined => {
  const objectConfig = Option.getOrUndefined(decodeObject(config))
  if (!objectConfig) {
    return undefined
  }
  if (Object.hasOwn(objectConfig, "seed")) {
    return undefined
  }
  if (Object.hasOwn(objectConfig, "research")) {
    const parsed = APIResearchRequest.safeParse({ ...objectConfig, seed: RetrieveValidationSeed })
    if (!parsed.success) {
      return undefined
    }
    const { seed: _seed, ...parsedConfig } = parsed.data
    return parsedConfig
  }
  const parsed = APIDeepResearchRequest.safeParse({ ...objectConfig, seed: RetrieveValidationSeed })
  if (!parsed.success) {
    return undefined
  }
  const { seed: _seed, ...parsedConfig } = parsed.data
  return parsedConfig
}

const responseMatchesConfig = (
  snapshot: APISonarResponse,
  config: ResearchConfig | DeepResearchConfig
) => {
  const expected = initialSnapshot(config).data
  const { data } = snapshot
  return (
    sameKeys(data, Object.keys(expected)) &&
    sameKeys(data.person, Object.keys(expected.person)) &&
    sameKeys(data.company, Object.keys(expected.company))
  )
}

const retrieveSnapshot = <const C extends ResearchConfig<object> | DeepResearchConfig<object>>(
  api: SonarAPI,
  hash: string,
  config: ValidConfig<C>
): Effect.Effect<SonarSnapshot<C>, PublicError> => {
  if (hash.trim().length === 0 || hash === "." || hash === "..") {
    return Effect.fail(new RequestError({ message: "A path-safe Sonar hash is required" }))
  }
  const parsedConfig = parseRetrieveConfig(config)
  if (!parsedConfig) {
    return Effect.fail(new RequestError({ message: "Invalid Sonar retrieve config" }))
  }
  return Effect.tryPromise({
    catch: mapRawError,
    try: () => retrieveSonar(api, hash),
  }).pipe(
    Effect.flatMap((response) => {
      if (!responseMatchesConfig(response, parsedConfig)) {
        return Effect.fail(
          new ProtocolError({ message: "Retrieved snapshot does not match the requested config" })
        )
      }
      const { hash: _hash, ...snapshot } = response
      // SAFETY: The API validated every Field, and the exact config-derived keys were checked above.
      return Effect.succeed(snapshot as SonarSnapshot<C>)
    })
  )
}

const makeService = (api: SonarAPI): SonarClientService => {
  const research = <const C extends ResearchConfig<object>>(request: ValidResearchRequest<C>) =>
    researchStream(api, request)
  const deepResearch = <const C extends DeepResearchConfig<object>>(
    request: ValidDeepResearchRequest<C>
  ) => deepResearchStream(api, request)
  const retrieve = <const C extends ResearchConfig<object> | DeepResearchConfig<object>>(
    hash: string,
    config: ValidConfig<C>
  ) => retrieveSnapshot(api, hash, config)

  return { deepResearch, research, retrieve }
}

export const layerFromAPI = (api: SonarAPI): Layer.Layer<SonarClient> =>
  Layer.succeed(SonarClient, makeService(api))

export const layer = (options: LayerOptions): Layer.Layer<SonarClient> =>
  Layer.sync(SonarClient, () => makeService(createSonar(options)))
