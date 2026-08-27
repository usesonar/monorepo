import { experimental_streamedQuery, useQuery } from "@tanstack/react-query"
import type { QueryKey } from "@tanstack/react-query"
import {
  Field,
  ProtocolError,
  SonarClient,
  SonarSnapshot,
  canonicalRequestIdentity,
  initialSnapshot,
} from "@usesonar/effect"
import type {
  DeepResearchConfig,
  ResearchConfig,
  SonarClientError,
  SonarClientService,
  SonarData,
  SonarSeed,
  SonarSnapshot as SonarSnapshotType,
} from "@usesonar/effect"
import { Effect, Schema, Stream } from "effect"
import { useCallback, useContext, useId, useRef, useState } from "react"
import type { ContextType } from "react"

import { SonarContext } from "./provider.js"
import type { SonarResult, ValidDeepResearchConfig, ValidResearchConfig } from "./types.js"

type Tier = "research" | "deepResearch"
type Config = ResearchConfig<object> | DeepResearchConfig<object>
type Snapshot<C extends Config> = SonarSnapshotType<C>
type Request<C extends Config> = {
  readonly config: C
  readonly operation: StreamOperation<C>
  readonly queryKey: QueryKey
  readonly seed: SonarSeed
}
type StreamOperation<C extends Config> = (
  client: SonarClientService,
  request: C & { readonly seed: SonarSeed }
) => Stream.Stream<Snapshot<C>, SonarClientError>

const isSnapshot = Schema.is(SonarSnapshot)

const sameKeys = (actualKeys: readonly string[], expectedKeys: readonly string[]) =>
  actualKeys.length === expectedKeys.length && expectedKeys.every((key) => actualKeys.includes(key))

const validSnapshot = <C extends Config>(value: Snapshot<C>, config: C) => {
  if (!isSnapshot(value)) {
    return false
  }
  const expected = initialSnapshot(config)
  return (
    sameKeys(Object.keys(value.data), Object.keys(expected.data)) &&
    sameKeys(Object.keys(value.data.person), Object.keys(expected.data.person)) &&
    sameKeys(Object.keys(value.data.company), Object.keys(expected.data.company))
  )
}

const isField = Schema.is(Field)
const fieldsEqual = Schema.toEquivalence(Field)

const snapshotFields = <C extends Config>(snapshot: Snapshot<C>) => {
  const fields = new Map<string, typeof Field.Type>()
  for (const [key, field] of Object.entries(snapshot.data.person)) {
    if (isField(field)) {
      fields.set(`person.${key}`, field)
    }
  }
  for (const [key, field] of Object.entries(snapshot.data.company)) {
    if (isField(field)) {
      fields.set(`company.${key}`, field)
    }
  }
  for (const [key, field] of Object.entries(snapshot.data)) {
    if (key !== "person" && key !== "company" && isField(field)) {
      fields.set(key, field)
    }
  }
  return fields
}

type SnapshotFields = ReturnType<typeof snapshotFields>

const allFieldsPending = (fields: SnapshotFields) =>
  [...fields.values()].every((field) => field.status === "pending")

const validProgression = (
  previous: SnapshotFields,
  current: SnapshotFields,
  status: Snapshot<Config>["status"]
) => {
  for (const [path, previousField] of previous) {
    const currentField = current.get(path)
    if (
      previousField.status !== "pending" &&
      (!currentField || !fieldsEqual(previousField, currentField))
    ) {
      return false
    }
  }
  return status !== "complete" || ![...current.values()].some((field) => field.status === "pending")
}

const validatedIterable = <C extends Config>(
  source: AsyncIterable<Snapshot<C>>,
  signal: AbortSignal,
  config: C
): AsyncIterable<Snapshot<C>> => ({
  [Symbol.asyncIterator]() {
    const iterator = source[Symbol.asyncIterator]()
    const abortListener = new AbortController()
    let phase: "initial" | "pending" | "complete" = "initial"
    let previousFields: SnapshotFields | undefined
    let closed = false

    const close = async () => {
      if (!closed) {
        closed = true
        abortListener.abort()
        await iterator.return?.()
      }
      return { done: true, value: undefined } as const
    }
    const onAbort = () => {
      void close()
    }
    const failProtocol = async (message: string) => {
      await close()
      throw new ProtocolError({ message })
    }
    signal.addEventListener("abort", onAbort, { once: true, signal: abortListener.signal })

    return {
      async next() {
        if (signal.aborted) {
          return close()
        }
        try {
          const next = await iterator.next()
          if (signal.aborted) {
            return close()
          }
          if (next.done) {
            if (phase !== "complete") {
              return failProtocol(
                phase === "initial"
                  ? "Sonar stream ended before its initial pending snapshot"
                  : "Sonar stream ended before its complete snapshot"
              )
            }
            return close()
          }
          if (!validSnapshot(next.value, config)) {
            return failProtocol("Sonar client returned an invalid snapshot")
          }
          if (phase === "initial" && next.value.status !== "pending") {
            return failProtocol("Sonar stream must start with a pending snapshot")
          }
          if (phase === "complete") {
            return failProtocol("Sonar client returned a snapshot after completion")
          }
          const currentFields = snapshotFields(next.value)
          if (phase === "initial" && !allFieldsPending(currentFields)) {
            return failProtocol("Sonar stream must start with every requested field pending")
          }
          if (
            previousFields &&
            !validProgression(previousFields, currentFields, next.value.status)
          ) {
            return failProtocol("Sonar client returned a non-monotonic snapshot")
          }
          previousFields = currentFields
          phase = next.value.status
          return next
        } catch (error) {
          abortListener.abort()
          throw error
        }
      },
      return: close,
    }
  },
})

type CanonicalIdentity = {
  readonly config: unknown
  readonly seed: unknown
}

const queryKey = <C extends Config>(
  tier: Tier,
  config: C,
  seed: SonarSeed,
  fallback: QueryKey
): QueryKey => {
  try {
    const identity = canonicalRequestIdentity(
      tier === "research"
        ? { config, seed, tier: "research" }
        : { config, seed, tier: "deepResearch" }
    )
    // SAFETY: canonicalRequestIdentity is the trusted public Effect helper and always
    // serializes an object containing its normalized config and seed properties.
    const canonical = JSON.parse(identity) as CanonicalIdentity
    return ["sonar", tier, canonical.config, canonical.seed] as const
  } catch {
    return fallback
  }
}

const streamFor = async <C extends Config>(
  request: Request<C>,
  runtime: NonNullable<ContextType<typeof SonarContext>>["runtime"],
  signal: AbortSignal
) => {
  const source = await runtime.runPromise(
    SonarClient.pipe(
      Effect.map((client) =>
        Stream.toAsyncIterable(request.operation(client, { ...request.config, seed: request.seed }))
      )
    ),
    { signal }
  )
  return validatedIterable(source, signal, request.config)
}

const useSonarTier = <C extends Config>(
  tier: Tier,
  config: C,
  operation: StreamOperation<C>
): SonarResult<SonarData<C>> => {
  const resources = useContext(SonarContext)
  if (!resources) {
    throw new Error("Sonar hooks must be rendered inside SonarProvider")
  }

  const queryScope = useId()
  const requestSequence = useRef(0)
  const [request, setRequest] = useState<Request<C> | null>(null)
  const resolve = useCallback(
    <const Seed>(seed: [Seed] extends [SonarSeed] ? Seed : never) => {
      // SAFETY: the conditional parameter accepts Seed only when it extends SonarSeed.
      const nextSeed = seed as SonarSeed
      const captured = structuredClone({ config, seed: nextSeed })
      requestSequence.current += 1
      const fallback = ["sonar", tier, "invalid", queryScope, requestSequence.current] as const
      setRequest({
        config: captured.config,
        operation,
        queryKey: queryKey(tier, captured.config, captured.seed, fallback),
        seed: captured.seed,
      })
    },
    [config, operation, queryScope, tier]
  )
  const activeQueryKey: QueryKey = request?.queryKey ?? ["sonar", "idle"]
  const query = useQuery<Snapshot<C> | null, SonarClientError>({
    enabled: request !== null,
    queryFn: experimental_streamedQuery<Snapshot<C>, Snapshot<C> | null, QueryKey>({
      initialValue: null,
      reducer: (_previous, snapshot: Snapshot<C>) => snapshot,
      streamFn: ({ signal }) => {
        if (!request) {
          throw new ProtocolError({ message: "Sonar query started without a request" })
        }
        return streamFor(request, resources.runtime, signal)
      },
    }),
    queryKey: activeQueryKey,
  })
  const snapshot = query.data

  return {
    data: snapshot?.data ?? null,
    error: query.error ?? null,
    loading: request !== null && query.fetchStatus === "fetching",
    resolve,
    status: snapshot?.status,
  }
}

export const useSonar = <const C extends ResearchConfig<object>>(
  config: ValidResearchConfig<C>
): SonarResult<SonarData<C>> =>
  useSonarTier<C>("research", config, (client, request) => {
    const research = client.research<C>
    // SAFETY: useSonar accepts only ValidResearchConfig<C>, and resolve deep-clones
    // that config without changing its question map before adding the captured seed.
    const validRequest = request as Parameters<typeof research>[0]
    return research(validRequest)
  })

export const useDeepSonar = <const C extends DeepResearchConfig<object>>(
  config: ValidDeepResearchConfig<C>
): SonarResult<SonarData<C>> =>
  useSonarTier<C>("deepResearch", config, (client, request) => {
    const deepResearch = client.deepResearch<C>
    // SAFETY: useDeepSonar accepts only ValidDeepResearchConfig<C>, and resolve
    // deep-clones that config without changing its question map before adding the seed.
    const validRequest = request as Parameters<typeof deepResearch>[0]
    return deepResearch(validRequest)
  })
