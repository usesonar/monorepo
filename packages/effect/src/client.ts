import {
  DeepResearchRequest as APIDeepResearchRequest,
  SonarStreamError,
  compileResearchRequest,
  createSonar,
  retrieveSonar,
  streamDeepResearch,
  streamResearch,
} from "@usesonar/api"
import type {
  DeepResearchCompanyInput as APIDeepResearchCompanyInput,
  DeepResearchPersonInput as APIDeepResearchPersonInput,
  Field as APIField,
  ResearchCompanyInput as APIResearchCompanyInput,
  ResearchPersonInput as APIResearchPersonInput,
  SonarEvent as APISonarEvent,
  SonarResponse as APISonarResponse,
  ValidDeepResearchQuestions as APIValidDeepResearchQuestions,
  ValidResearchQuestions as APIValidResearchQuestions,
  ResearchRequest as APIResearchRequest,
} from "@usesonar/api"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"

import { HTTPError, ProtocolError, RequestError, TransportError } from "./errors.js"
import { CompleteEvent, initialSnapshot } from "./model.js"
import type {
  AnyDeepResearchConfig,
  AnyResearchConfig,
  DeepResearchConfig,
  DeepResearchRequest,
  ResearchConfig,
  ResearchRequest,
  SonarSnapshot,
} from "./model.js"
import { reduceSnapshot } from "./protocol.js"

type PublicError = RequestError | TransportError | HTTPError | ProtocolError
type AnswerKeyCollection = Readonly<Record<string, APIField>>
type EntityKeyCollection = (
  | APISonarResponse["data"]["person"]
  | APISonarResponse["data"]["company"]
) & {
  readonly research?: AnswerKeyCollection
  readonly deepResearch?: AnswerKeyCollection
}
type KeyCollection = APISonarResponse["data"] | EntityKeyCollection | AnswerKeyCollection

type QuestionsOf<
  Entity extends object,
  Tier extends "research" | "deepResearch",
> = Tier extends keyof Entity ? Extract<NonNullable<Entity[Tier]>, object> : Record<never, never>

type ValidResearchEntity<Entity extends object> =
  QuestionsOf<Entity, "research"> extends APIValidResearchQuestions<QuestionsOf<Entity, "research">>
    ? Entity
    : never

type ValidDeepResearchEntity<Entity extends object> =
  QuestionsOf<Entity, "deepResearch"> extends APIValidDeepResearchQuestions<
    QuestionsOf<Entity, "deepResearch">
  >
    ? Entity
    : never

export type ValidResearchConfig<C extends AnyResearchConfig> =
  C & C["person"] extends ValidResearchEntity<C["person"]>
    ? C["company"] extends ValidResearchEntity<C["company"]>
      ? unknown
      : never
    : never

export type ValidDeepResearchConfig<C extends AnyDeepResearchConfig> =
  C & C["person"] extends ValidDeepResearchEntity<C["person"]>
    ? C["company"] extends ValidDeepResearchEntity<C["company"]>
      ? unknown
      : never
    : never

export type ValidResearchRequest<C extends AnyResearchConfig> = ResearchRequest<C> &
  (C extends ValidResearchConfig<C> ? unknown : never)

export type ValidDeepResearchRequest<C extends AnyDeepResearchConfig> = DeepResearchRequest<C> &
  (C extends ValidDeepResearchConfig<C> ? unknown : never)

export type ValidConfig<C extends AnyResearchConfig | AnyDeepResearchConfig> =
  C extends AnyResearchConfig
    ? ValidResearchConfig<C>
    : C extends AnyDeepResearchConfig
      ? ValidDeepResearchConfig<C>
      : never

export type SonarClientService = {
  readonly research: <
    const Person extends APIResearchPersonInput<object>,
    const Company extends APIResearchCompanyInput<object>,
  >(
    request: ResearchRequest<ResearchConfig<Person, Company>> &
      (Person extends ValidResearchEntity<Person> ? unknown : never) &
      (Company extends ValidResearchEntity<Company> ? unknown : never)
  ) => Stream.Stream<SonarSnapshot<ResearchConfig<Person, Company>>, PublicError>
  readonly deepResearch: <
    const Person extends APIDeepResearchPersonInput<object>,
    const Company extends APIDeepResearchCompanyInput<object>,
  >(
    request: DeepResearchRequest<DeepResearchConfig<Person, Company>> &
      (Person extends ValidDeepResearchEntity<Person> ? unknown : never) &
      (Company extends ValidDeepResearchEntity<Company> ? unknown : never)
  ) => Stream.Stream<SonarSnapshot<DeepResearchConfig<Person, Company>>, PublicError>
  readonly retrieve: {
    <
      const Person extends APIResearchPersonInput<object>,
      const Company extends APIResearchCompanyInput<object>,
    >(
      hash: string,
      config: ValidResearchConfig<ResearchConfig<Person, Company>>
    ): Effect.Effect<SonarSnapshot<ResearchConfig<Person, Company>>, PublicError>
    <
      const Person extends APIDeepResearchPersonInput<object>,
      const Company extends APIDeepResearchCompanyInput<object>,
    >(
      hash: string,
      config: ValidDeepResearchConfig<DeepResearchConfig<Person, Company>>
    ): Effect.Effect<SonarSnapshot<DeepResearchConfig<Person, Company>>, PublicError>
  }
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

const fromAPIEvent = <const C extends AnyResearchConfig | AnyDeepResearchConfig>(
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

const streamFromReadable = <const C extends AnyResearchConfig | AnyDeepResearchConfig>(
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

const researchStream = <const C extends AnyResearchConfig>(
  api: SonarAPI,
  request: ResearchRequest<C>
): Stream.Stream<SonarSnapshot<C>, PublicError> => {
  let body: APIResearchRequest
  try {
    // SAFETY: ValidResearchRequest applies the API's exported entity-map validity constraints.
    body = compileResearchRequest(request as never)
  } catch (error) {
    return Stream.fail(mapRawError(error, "request"))
  }
  return Stream.unwrap(
    Effect.tryPromise({
      catch: mapRawError,
      try: (signal) => streamResearch(api, body, { signal }),
    }).pipe(Effect.map((readable) => streamFromReadable<C>(readable)))
  )
}

const deepResearchStream = <const C extends AnyDeepResearchConfig>(
  api: SonarAPI,
  request: DeepResearchRequest<C>
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

const sameKeys = (actual: KeyCollection, expected: readonly string[]) => {
  const keys = new Set(Object.keys(actual))
  return keys.size === expected.length && expected.every((key) => keys.has(key))
}

const RetrieveValidationSeed = {
  linkedinURL: "https://www.linkedin.com/in/sonar-validation",
} as const

const parseRetrieveConfig = (
  config: AnyResearchConfig | AnyDeepResearchConfig
): AnyResearchConfig | AnyDeepResearchConfig | undefined => {
  const objectConfig = Option.getOrUndefined(decodeObject(config))
  if (!objectConfig) {
    return undefined
  }
  if (Object.hasOwn(objectConfig, "seed")) {
    return undefined
  }
  try {
    // SAFETY: The public config types and ValidConfig reject malformed entity question maps; the
    // API compiler performs the matching runtime validation.
    const { seed: _seed, ...parsedConfig } = compileResearchRequest({
      ...objectConfig,
      seed: RetrieveValidationSeed,
    } as never)
    return parsedConfig
  } catch {
    // A deep-research config is validated by its serializable API schema below.
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
  config: AnyResearchConfig | AnyDeepResearchConfig
) => {
  const expected = initialSnapshot(config).data
  const { data } = snapshot
  const entityMatches = (actual: EntityKeyCollection, expectedEntity: EntityKeyCollection) => {
    if (!sameKeys(actual, Object.keys(expectedEntity))) {
      return false
    }
    for (const tier of ["research", "deepResearch"] as const) {
      const expectedAnswers = expectedEntity[tier]
      if (
        expectedAnswers !== undefined &&
        !sameKeys(actual[tier] ?? {}, Object.keys(expectedAnswers))
      ) {
        return false
      }
    }
    return true
  }
  // SAFETY: Parsed API data and config-derived Effect data both contain object-valued Field leaves
  // plus optional entity-owned answer namespaces.
  const actualPerson = data.person as EntityKeyCollection
  // SAFETY: Parsed API data and config-derived Effect data both contain object-valued Field leaves
  // plus optional entity-owned answer namespaces.
  const actualCompany = data.company as EntityKeyCollection
  // SAFETY: initialSnapshot produces the same entity collection shape from the validated config.
  const expectedPerson = expected.person as EntityKeyCollection
  // SAFETY: initialSnapshot produces the same entity collection shape from the validated config.
  const expectedCompany = expected.company as EntityKeyCollection
  return (
    sameKeys(data, Object.keys(expected)) &&
    entityMatches(actualPerson, expectedPerson) &&
    entityMatches(actualCompany, expectedCompany)
  )
}

const retrieveSnapshot = <const C extends AnyResearchConfig | AnyDeepResearchConfig>(
  api: SonarAPI,
  hash: string,
  config: C
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
  const research: SonarClientService["research"] = (request) => researchStream(api, request)
  const deepResearch: SonarClientService["deepResearch"] = (request) =>
    deepResearchStream(api, request)
  const retrieve = (hash: string, config: AnyResearchConfig | AnyDeepResearchConfig) =>
    retrieveSnapshot(api, hash, config)

  return {
    deepResearch,
    research,
    // SAFETY: The overloads differ only in the config-derived return type; retrieveSnapshot
    // preserves that same config through parsing and hash removal.
    retrieve: retrieve as SonarClientService["retrieve"],
  }
}

export const layerFromAPI = (api: SonarAPI): Layer.Layer<SonarClient> =>
  Layer.succeed(SonarClient, makeService(api))

export const layer = (options: LayerOptions): Layer.Layer<SonarClient> =>
  Layer.sync(SonarClient, () => makeService(createSonar(options)))
