import {
  DeepResearchRequest as APIDeepResearchRequest,
  Field as APIField,
  JSONValue as APIJSONValue,
  SonarSeed as APISonarSeed,
  SonarSnapshot as APISonarSnapshot,
  TTL as APITTL,
  compileResearchRequest,
} from "@usesonar/api"
import { Effect, Schema, SchemaIssue, SchemaTransformation } from "effect"

import type {
  AnyDeepResearchConfig,
  AnyResearchConfig,
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

export type JSONValue = JSONValueType
export type SonarSeed = SonarSeedType
export type TTL = TTLType
export type ResearchRequest<C extends AnyResearchConfig = ResearchConfig> = ResearchRequestType<C>
export type DeepResearchRequest<C extends AnyDeepResearchConfig = DeepResearchConfig> =
  DeepResearchRequestType<C>
export type Field<Value = JSONValueType> = FieldType<Value>
export type SonarSnapshot<C extends AnyResearchConfig | AnyDeepResearchConfig> =
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
  (input): input is ResearchRequestType<ResearchConfig> => {
    try {
      // SAFETY: This predicate accepts unknown input specifically so the API compiler can validate it.
      compileResearchRequest(input as never)
      return true
    } catch {
      return false
    }
  },
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
        try {
          // SAFETY: The API compiler is the runtime validator for authored research inputs.
          return Effect.succeed(compileResearchRequest(input as never))
        } catch {
          return Effect.fail(
            new SchemaIssue.InvalidValue({ message: "Invalid research request" }, input, options)
          )
        }
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

export const SonarSnapshot: Schema.Codec<
  SonarSnapshotType<AnyResearchConfig | AnyDeepResearchConfig>
> = Schema.declare<SonarSnapshotType<AnyResearchConfig | AnyDeepResearchConfig>>(
  (input): input is SonarSnapshotType<AnyResearchConfig | AnyDeepResearchConfig> =>
    APISonarSnapshot.safeParse(input).success,
  { identifier: "SonarSnapshot" }
)
