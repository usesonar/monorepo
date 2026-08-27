import { defaultScheduler, notifyManager } from "@tanstack/react-query"
import {
  HTTPError,
  ProtocolError,
  RequestError,
  SonarClient,
  SonarSeed as SonarSeedSchema,
  TransportError,
  initialSnapshot,
} from "@usesonar/effect"
import type {
  DeepResearchConfig,
  DeepResearchRequest,
  Field,
  ResearchConfig,
  ResearchRequest,
  SonarClientError,
  SonarClientService,
  SonarSeed,
  SonarSnapshot,
} from "@usesonar/effect"
import { Effect, Layer, Schema, Stream } from "effect"
import { Window } from "happy-dom"
import { StrictMode, act, createElement } from "react"
import type { ReactElement } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"

type RecordedSnapshot = {
  readonly data: object
  readonly status: "pending" | "complete"
}

type SnapshotController = {
  complete: () => void
  fail: (error: SonarClientError) => void
  push: (value: RecordedSnapshot) => void
  pushMalformed: (value: MalformedSnapshot) => void
}

type StartedRequest =
  | {
      tier: "research"
      request: ResearchRequest<ResearchConfig<object>>
      source: SnapshotController
    }
  | {
      tier: "deepResearch"
      request: DeepResearchRequest<DeepResearchConfig<object>>
      source: SnapshotController
    }

type ClientRecorder = {
  starts: StartedRequest[]
  cancellations: number
  disposals: number
}

type ServiceOptions = {
  cooperativeCancellation?: boolean
  emitInitialSnapshot?: boolean
  onStart?: (started: StartedRequest) => void
}

type MalformedSnapshot = {
  readonly data: object
  readonly status: string
}

const ClientError = Schema.Union([
  Schema.instanceOf(RequestError),
  Schema.instanceOf(TransportError),
  Schema.instanceOf(HTTPError),
  Schema.instanceOf(ProtocolError),
])
const isSonarClientError = Schema.is(ClientError)
const isSonarSeed = Schema.is(SonarSeedSchema)

const toClientError = (cause: unknown) =>
  isSonarClientError(cause) ? cause : new TransportError({ message: String(cause) })

export class SnapshotSource<T> implements AsyncIterable<T> {
  readonly #queue: IteratorResult<T>[] = []
  readonly #waiters: {
    reject: (reason: SonarClientError) => void
    resolve: (result: IteratorResult<T>) => void
  }[] = []
  readonly #onCancel: () => void
  readonly #cooperativeCancellation: boolean
  #cancelled = false
  #closed = false
  #failure: SonarClientError | undefined

  constructor(onCancel: () => void, options: { cooperativeCancellation?: boolean } = {}) {
    this.#onCancel = onCancel
    this.#cooperativeCancellation = options.cooperativeCancellation ?? true
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.#next(),
      return: () => {
        this.#cancel()
        return Promise.resolve({ done: true, value: undefined })
      },
    }
  }

  push(value: T) {
    if (this.#closed) {
      return
    }

    const waiter = this.#waiters.shift()
    if (waiter) {
      waiter.resolve({ done: false, value })
      return
    }
    this.#queue.push({ done: false, value })
  }

  pushMalformed(value: MalformedSnapshot) {
    // SAFETY: This method exists only for an adversarial boundary test that must
    // violate the typed Effect client contract and verify a visible ProtocolError.
    this.push(value as T)
  }

  complete() {
    if (this.#closed) {
      return
    }
    this.#closed = true
    this.#drain({ done: true, value: undefined })
  }

  fail(error: SonarClientError) {
    if (this.#closed) {
      return
    }
    this.#closed = true
    this.#failure = error
    for (const waiter of this.#waiters.splice(0)) {
      waiter.reject(error)
    }
  }

  #cancel() {
    if (this.#closed || this.#cancelled) {
      return
    }
    this.#cancelled = true
    this.#onCancel()
    if (this.#cooperativeCancellation) {
      this.#closed = true
      this.#drain({ done: true, value: undefined })
    }
  }

  #drain(result: IteratorResult<T>) {
    for (const waiter of this.#waiters.splice(0)) {
      waiter.resolve(result)
    }
  }

  #next(): Promise<IteratorResult<T>> {
    const queued = this.#queue.shift()
    if (queued) {
      return Promise.resolve(queued)
    }
    if (this.#failure !== undefined) {
      return Promise.reject(this.#failure)
    }
    if (this.#closed) {
      return Promise.resolve({ done: true, value: undefined })
    }
    const deferred = Promise.withResolvers<IteratorResult<T>>()
    this.#waiters.push({ reject: deferred.reject, resolve: deferred.resolve })
    return deferred.promise
  }
}

const requestConfig = <C extends ResearchConfig<object> | DeepResearchConfig<object>>(
  request: C & { readonly seed: SonarSeed }
): C => request

const snapshotController = <C extends ResearchConfig<object> | DeepResearchConfig<object>>(
  source: SnapshotSource<SonarSnapshot<C>>
): SnapshotController => ({
  complete: () => source.complete(),
  fail: (error) => source.fail(error),
  push: (value) => {
    // SAFETY: A controller is stored beside the request that created this source.
    // Runtime tests select fixtures from that recorded tier and config before pushing.
    source.push(value as SonarSnapshot<C>)
  },
  pushMalformed: (value) => source.pushMalformed(value),
})

const makeResearchStartedRequest = <C extends ResearchConfig<object>>(
  request: ResearchRequest<C>,
  source: SnapshotSource<SonarSnapshot<C>>
): StartedRequest => ({ request, source: snapshotController(source), tier: "research" })

const makeDeepResearchStartedRequest = <C extends DeepResearchConfig<object>>(
  request: DeepResearchRequest<C>,
  source: SnapshotSource<SonarSnapshot<C>>
): StartedRequest => ({ request, source: snapshotController(source), tier: "deepResearch" })

const retrieveImpl = <const C extends ResearchConfig<object> | DeepResearchConfig<object>>(
  _hash: string,
  config: C
) => Effect.succeed(initialSnapshot(config))
// SAFETY: initialSnapshot contains only pending Field variants, whose shape is
// independent of the caller's custom answer value types across retrieve overloads.
const retrieve = retrieveImpl as SonarClientService["retrieve"]

export const installHappyDOM = () => {
  const window = new Window({ url: "https://react.usesonar.test/" })
  const globals = {
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    MutationObserver: window.MutationObserver,
    Node: window.Node,
    document: window.document,
    navigator: window.navigator,
    window,
  }
  const originals = new Map<PropertyKey, PropertyDescriptor | undefined>()

  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true,
    })
  }
  notifyManager.setScheduler(queueMicrotask)

  return () => {
    notifyManager.setScheduler(defaultScheduler)
    window.close()
    for (const [name, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, name)
      }
    }
  }
}

export const createTestLayer = (options: ServiceOptions = {}) => {
  const recorder: ClientRecorder = { cancellations: 0, disposals: 0, starts: [] }

  const researchImpl = <const C extends ResearchConfig<object>>(
    request: ResearchRequest<C>
  ): Stream.Stream<SonarSnapshot<C>, SonarClientError> => {
    if (!isSonarSeed(request.seed)) {
      return Stream.fail(new RequestError({ message: "Invalid Sonar request" }))
    }
    const source = new SnapshotSource<SonarSnapshot<C>>(() => {
      recorder.cancellations += 1
    }, options)
    const started = makeResearchStartedRequest(request, source)
    recorder.starts.push(started)
    options.onStart?.(started)
    const config = requestConfig<C>(request)
    if (options.emitInitialSnapshot ?? true) {
      source.push(initialSnapshot(config))
    }
    return Stream.fromAsyncIterable(source, toClientError)
  }
  // SAFETY: researchImpl is generic over every ResearchConfig and preserves C in
  // both its request and snapshot. The additional public overload only erases C
  // to ResearchConfig; TypeScript expands SonarSnapshot<any> across both tiers.
  const research = researchImpl as SonarClientService["research"]

  const deepResearch: SonarClientService["deepResearch"] = <
    const C extends DeepResearchConfig<object>,
  >(
    request: DeepResearchRequest<C>
  ): Stream.Stream<SonarSnapshot<C>, SonarClientError> => {
    if (!isSonarSeed(request.seed)) {
      return Stream.fail(new RequestError({ message: "Invalid Sonar request" }))
    }
    const source = new SnapshotSource<SonarSnapshot<C>>(() => {
      recorder.cancellations += 1
    }, options)
    const started = makeDeepResearchStartedRequest(request, source)
    recorder.starts.push(started)
    options.onStart?.(started)
    const config = requestConfig<C>(request)
    if (options.emitInitialSnapshot ?? true) {
      source.push(initialSnapshot(config))
    }
    return Stream.fromAsyncIterable(source, toClientError)
  }

  const service: SonarClientService = { deepResearch, research, retrieve }
  const scopedService = Effect.acquireRelease(Effect.succeed(service), () =>
    Effect.sync(() => {
      recorder.disposals += 1
    })
  )

  return {
    layer: Layer.effect(SonarClient, scopedService),
    recorder,
  }
}

const valueForKey = (key: string): boolean | string => {
  if (key === "sellsToSMB" || key === "usesQuickBooks") {
    return true
  }
  if (key === "linkedin") {
    return "https://www.linkedin.com/in/ada"
  }
  if (key === "phone") {
    return "+1-202-555-0100"
  }
  return `${key}-value`
}

type FixtureField = Field<ReturnType<typeof valueForKey>>

const resolvedField = (key: string): FixtureField => ({
  confidence: 0.99,
  resolvedAt: "2026-08-26T12:00:00.000Z",
  sources: ["https://example.test/source"],
  status: "resolved" as const,
  value: valueForKey(key),
})

const fixtureData = (
  config: ResearchConfig<object> | DeepResearchConfig<object>,
  resolution: "all" | "first"
) => {
  let resolvedOne = false
  const fields = (keys: readonly string[]) => {
    const result: Record<string, FixtureField> = {}
    for (const key of keys) {
      if (resolution === "all" || !resolvedOne) {
        result[key] = resolvedField(key)
        resolvedOne = true
      } else {
        result[key] = { status: "pending" }
      }
    }
    return result
  }
  const questions = "research" in config ? config.research : config.deepResearch
  const person = { person: fields(config.person) }
  const company = { company: fields(config.company) }
  return { ...person, ...company, ...fields(Object.keys(questions ?? {})) }
}

export const terminalSnapshot = <
  const C extends ResearchConfig<object> | DeepResearchConfig<object>,
>(
  config: C
): SonarSnapshot<C> =>
  // SAFETY: fixtureData derives every key directly from C and assigns a valid
  // resolved Field to each requested leaf.
  ({
    data: fixtureData(config, "all"),
    status: "complete",
  }) as SonarSnapshot<C>

export const partialSnapshot = <
  const C extends ResearchConfig<object> | DeepResearchConfig<object>,
>(
  config: C
): SonarSnapshot<C> =>
  // SAFETY: fixtureData derives every key directly from C, resolves exactly the
  // first requested leaf, and leaves every remaining Field pending.
  ({
    data: fixtureData(config, "first"),
    status: "pending",
  }) as SonarSnapshot<C>

export type MountedTree = {
  container: HTMLElement
  render: (element: ReactElement) => Promise<void>
  unmount: () => Promise<void>
}

export const flushReact = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const renderRoot = async (root: Root, element: ReactElement) => {
  await act(() => root.render(element))
  await flushReact()
}

export const mountTree = async (element: ReactElement): Promise<MountedTree> => {
  const container = document.createElement("div")
  const { body } = document
  body.append(container)
  const root = createRoot(container)
  await renderRoot(root, element)

  return {
    container,
    render: (next) => renderRoot(root, next),
    unmount: async () => {
      await act(() => root.unmount())
      container.remove()
    },
  }
}

export const strict = (element: ReactElement) => createElement(StrictMode, null, element)

export const waitFor = async (assertion: () => void, attempts = 50): Promise<void> => {
  try {
    assertion()
  } catch (error) {
    if (attempts === 1) {
      throw error
    }
    await flushReact()
    await waitFor(assertion, attempts - 1)
  }
}
