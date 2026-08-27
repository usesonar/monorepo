import { Effect, Layer, Stream } from "effect"

import { SonarClient } from "./client.js"
import type {
  SonarClientService,
  ValidConfig,
  ValidDeepResearchRequest,
  ValidResearchRequest,
} from "./client.js"
import { RequestError } from "./errors.js"
import type { ProtocolError } from "./errors.js"
import { canonicalRequestIdentity } from "./identity.js"
import { initialSnapshot } from "./model.js"
import type {
  DeepResearchConfig,
  DeepResearchRequest,
  ResearchConfig,
  ResearchRequest,
  SonarProtocolEvent,
  SonarSnapshot,
} from "./model.js"
import { reduceSnapshot } from "./protocol.js"
import { SonarTestProbe } from "./test-probe.js"
import type { SonarTestProbeService } from "./test-probe.js"

export { SonarTestProbe } from "./test-probe.js"

type ScenarioRequest =
  | ResearchRequest<ResearchConfig<object>>
  | DeepResearchRequest<DeepResearchConfig<object>>

export class Scenario<Request extends ScenarioRequest = ScenarioRequest> {
  readonly request: Request
  readonly events: readonly SonarProtocolEvent[]

  private constructor(options: {
    readonly request: Request
    readonly events: readonly SonarProtocolEvent[]
  }) {
    this.request = options.request
    this.events = options.events
  }

  static make<const Request extends ScenarioRequest>(options: {
    readonly request: Request
    readonly events: readonly SonarProtocolEvent[]
  }) {
    return new Scenario(options)
  }
}

const tierOf = (request: ScenarioRequest): "research" | "deepResearch" =>
  "research" in request ? "research" : "deepResearch"

const configOf = (
  request: ScenarioRequest
): ResearchConfig<object> | DeepResearchConfig<object> => {
  const { seed: _seed, ...config } = request
  return config
}

const identityOf = (request: ScenarioRequest) => {
  const { seed } = request
  return canonicalRequestIdentity({
    config: configOf(request),
    seed,
    tier: tierOf(request),
  })
}

const scenarioStream = <const C extends ResearchConfig<object> | DeepResearchConfig<object>>(
  scenario: Scenario,
  request: ScenarioRequest,
  requests: ScenarioRequest[],
  onInterrupt: () => void
): Stream.Stream<SonarSnapshot<C>, RequestError | ProtocolError> => {
  // SAFETY: Removing seed from either request branch leaves the same literal config C.
  const config = configOf(request) as C
  let ended = false
  const snapshots = Stream.fromIterable(scenario.events).pipe(
    Stream.scanEffect(initialSnapshot(config), reduceSnapshot)
  )
  return Stream.fromEffect(
    Effect.sync(() => {
      requests.push(request)
    })
  ).pipe(
    Stream.flatMap(() => snapshots),
    Stream.onEnd(
      Effect.sync(() => {
        ended = true
      })
    ),
    Stream.ensuring(
      Effect.sync(() => {
        if (!ended) {
          onInterrupt()
        }
      })
    )
  )
}

function retrieve<const C extends ResearchConfig<object> | DeepResearchConfig<object>>(
  _hash: string,
  config: ValidConfig<C>
): Effect.Effect<SonarSnapshot<C>>
function retrieve(_hash: string, config: ResearchConfig | DeepResearchConfig) {
  return Effect.succeed(initialSnapshot(config))
}

export const scenarioLayer = (...scenarios: readonly Scenario[]) => {
  const requests: ScenarioRequest[] = []
  let interruptions = 0

  const matching = (request: ScenarioRequest) => {
    const identity = identityOf(request)
    return scenarios.find((scenario) => identityOf(scenario.request) === identity)
  }

  const research = <const C extends ResearchConfig<object>>(request: ValidResearchRequest<C>) => {
    const scenario = matching(request)
    return scenario
      ? scenarioStream<C>(scenario, request, requests, () => {
          interruptions += 1
        })
      : Stream.fail(new RequestError({ message: "No matching research scenario" }))
  }

  const deepResearch = <const C extends DeepResearchConfig<object>>(
    request: ValidDeepResearchRequest<C>
  ) => {
    const scenario = matching(request)
    return scenario
      ? scenarioStream<C>(scenario, request, requests, () => {
          interruptions += 1
        })
      : Stream.fail(new RequestError({ message: "No matching deepResearch scenario" }))
  }

  const service: SonarClientService = {
    deepResearch,
    research,
    retrieve,
  }
  const probe: SonarTestProbeService = {
    interruptions: Effect.sync(() => interruptions),
    requests: Effect.sync(() => [...requests]),
  }

  return Layer.merge(Layer.succeed(SonarClient, service), Layer.succeed(SonarTestProbe, probe))
}
