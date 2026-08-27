import {
  DeepResearchRequest as APIDeepResearchRequest,
  Field as APIField,
  JSONValue as APIJSONValue,
  ResearchRequest as APIResearchRequest,
  SonarSeed as APISonarSeed,
  SonarSnapshot as APISonarSnapshot,
  TTL as APITTL,
} from "@usesonar/api"
import { Effect, Schema, SchemaIssue, SchemaTransformation } from "effect"

import type {
  DeepResearchConfig,
  DeepResearchRequest as DeepResearchRequestType,
  Field as FieldType,
  JSONValue as JSONValueType,
  ResearchConfig,
  ResearchRequest as ResearchRequestType,
  SonarSeed as SonarSeedType,
  SonarSnapshot as SonarSnapshotType,
  TTL as TTLType,
} from "./model.js"

export { question } from "@usesonar/api"
export type { AnswerOf, AnswersOf, Question } from "@usesonar/api"

export type JSONValue = JSONValueType
export type SonarSeed = SonarSeedType
export type TTL = TTLType
export type ResearchRequest<C extends ResearchConfig<object> = ResearchConfig> =
  ResearchRequestType<C>
export type DeepResearchRequest<C extends DeepResearchConfig<object> = DeepResearchConfig> =
  DeepResearchRequestType<C>
export type Field<Value = JSONValueType> = FieldType<Value>
export type SonarSnapshot<C extends ResearchConfig<object> | DeepResearchConfig<object>> =
  SonarSnapshotType<C>

export const JSONValue: Schema.Codec<JSONValueType> = Schema.declare<JSONValueType>(
  (input): input is JSONValueType => APIJSONValue.safeParse(input).success,
  { identifier: "JSONValue" }
)

const NormalizedSonarSeed = Schema.declare<SonarSeedType>(
  (input): input is SonarSeedType => APISonarSeed.safeParse(input).success,
  { identifier: "SonarSeed" }
)

export const SonarSeed: Schema.Codec<SonarSeedType, unknown> = Schema.Unknown.pipe(
  Schema.decodeTo(
    NormalizedSonarSeed,
    SchemaTransformation.transformOrFail<SonarSeedType, unknown>({
      decode: (input, options) => {
        const parsed = APISonarSeed.safeParse(input)
        return parsed.success
          ? Effect.succeed(parsed.data)
          : Effect.fail(
              new SchemaIssue.InvalidValue({ message: "Invalid Sonar seed" }, input, options)
            )
      },
      encode: Effect.succeed,
    })
  )
)

export const TTL: Schema.Codec<TTLType> = Schema.declare<TTLType>(
  (input): input is TTLType => APITTL.safeParse(input).success,
  { identifier: "TTL" }
)

const NormalizedResearchRequest = Schema.declare<ResearchRequestType<ResearchConfig>>(
  (input): input is ResearchRequestType<ResearchConfig> =>
    APIResearchRequest.safeParse(input).success,
  { identifier: "ResearchRequest" }
)

export const ResearchRequest: Schema.Codec<
  ResearchRequestType<ResearchConfig>,
  unknown
> = Schema.Unknown.pipe(
  Schema.decodeTo(
    NormalizedResearchRequest,
    SchemaTransformation.transformOrFail<ResearchRequestType<ResearchConfig>, unknown>({
      decode: (input, options) => {
        const parsed = APIResearchRequest.safeParse(input)
        return parsed.success
          ? Effect.succeed(parsed.data)
          : Effect.fail(
              new SchemaIssue.InvalidValue({ message: "Invalid research request" }, input, options)
            )
      },
      encode: Effect.succeed,
    })
  )
)

const NormalizedDeepResearchRequest = Schema.declare<DeepResearchRequestType<DeepResearchConfig>>(
  (input): input is DeepResearchRequestType<DeepResearchConfig> =>
    APIDeepResearchRequest.safeParse(input).success,
  { identifier: "DeepResearchRequest" }
)

export const DeepResearchRequest: Schema.Codec<
  DeepResearchRequestType<DeepResearchConfig>,
  unknown
> = Schema.Unknown.pipe(
  Schema.decodeTo(
    NormalizedDeepResearchRequest,
    SchemaTransformation.transformOrFail<DeepResearchRequestType<DeepResearchConfig>, unknown>({
      decode: (input, options) => {
        const parsed = APIDeepResearchRequest.safeParse(input)
        return parsed.success
          ? Effect.succeed(parsed.data)
          : Effect.fail(
              new SchemaIssue.InvalidValue(
                { message: "Invalid deep research request" },
                input,
                options
              )
            )
      },
      encode: Effect.succeed,
    })
  )
)

export const Field: Schema.Codec<FieldType> = Schema.declare<FieldType>(
  (input): input is FieldType => APIField.safeParse(input).success,
  { identifier: "Field" }
)

export const SonarSnapshot: Schema.Codec<SonarSnapshotType<ResearchConfig | DeepResearchConfig>> =
  Schema.declare<SonarSnapshotType<ResearchConfig | DeepResearchConfig>>(
    (input): input is SonarSnapshotType<ResearchConfig | DeepResearchConfig> =>
      APISonarSnapshot.safeParse(input).success,
    { identifier: "SonarSnapshot" }
  )
