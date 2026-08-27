export { SonarClient, layer, layerFromAPI } from "./client.js"
export type {
  LayerOptions,
  SonarClientService,
  ValidDeepResearchRequest,
  ValidResearchRequest,
} from "./client.js"
export { HTTPError, ProtocolError, RequestError, TransportError } from "./errors.js"
export type { SonarClientError } from "./errors.js"
export { canonicalRequestIdentity } from "./identity.js"
export { CompleteEvent, initialSnapshot } from "./model.js"
export type {
  DeepResearchConfig,
  FieldEvent,
  ResearchConfig,
  SonarData,
  SonarProtocolEvent,
} from "./model.js"
export { reduceSnapshot } from "./protocol.js"
export {
  DeepResearchRequest,
  Field,
  JSONValue,
  question,
  ResearchRequest,
  SonarSeed,
  SonarSnapshot,
  TTL,
} from "./schemas.js"
export type { AnswerOf, AnswersOf, Question } from "./schemas.js"
