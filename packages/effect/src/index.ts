export { SonarClient, layer, layerFromAPI } from "./client.js"
export type {
  LayerOptions,
  SonarClientService,
  ValidConfig,
  ValidDeepResearchConfig,
  ValidDeepResearchRequest,
  ValidResearchConfig,
  ValidResearchRequest,
} from "./client.js"
export { compileResearchRequest } from "@usesonar/api"
export type {
  DeepResearchCompanyInput,
  DeepResearchPersonInput,
  ResearchCompanyInput,
  ResearchJSONSchema,
  ResearchOutput,
  ResearchPersonInput,
  ResearchQuestion,
  ResearchValidator,
  StandardJSONSchemaOptions,
  StandardJSONSchemaV1,
  ValidDeepResearchEntityInput,
  ValidDeepResearchQuestions,
  ValidResearchEntityInput,
  ValidResearchQuestions,
} from "@usesonar/api"
export { HTTPError, ProtocolError, RequestError, TransportError } from "./errors.js"
export type { SonarClientError } from "./errors.js"
export { canonicalRequestIdentity } from "./identity.js"
export { CompleteEvent, initialSnapshot } from "./model.js"
export type {
  AnyDeepResearchConfig,
  AnyResearchConfig,
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
  ResearchRequest,
  SonarSeed,
  SonarSnapshot,
  TTL,
} from "./schemas.js"
