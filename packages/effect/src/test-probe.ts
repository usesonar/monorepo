import { Context } from "effect"
import type { Effect } from "effect"

import type {
  AnyDeepResearchConfig,
  AnyResearchConfig,
  DeepResearchRequest,
  ResearchRequest,
} from "./model.js"

type ScenarioRequest =
  | ResearchRequest<AnyResearchConfig>
  | DeepResearchRequest<AnyDeepResearchConfig>

export type SonarTestProbeService = {
  readonly requests: Effect.Effect<readonly ScenarioRequest[]>
  readonly interruptions: Effect.Effect<number>
}

export class SonarTestProbe extends Context.Service<SonarTestProbe, SonarTestProbeService>()(
  "@usesonar/effect/testing/SonarTestProbe"
) {}
