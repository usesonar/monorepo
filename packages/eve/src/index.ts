/* eslint-disable anti-slop/no-chained-type-assertions, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type -- Eve's schema callbacks expose unknown boundary values, while the hidden overload implementation uses unknown to reconnect config-derived schemas and executors after defineTool erases that relationship. */
import { defineTool } from "eve/tools"

import {
  deepResearchDescription,
  isDynamicConfig,
  researchDescription,
  validateDeepResearchConfig,
  validateDeepResearchOptions,
  validateResearchConfig,
  validateResearchOptions,
} from "./config.js"
import { sanitizeSonarFailure } from "./errors.js"
import {
  deepResearchRequest,
  finalSnapshot,
  projectSnapshot,
  researchRequest,
  streamSnapshots,
  validateExecutionInput,
} from "./runtime.js"
import {
  deepResearchInputSchema,
  deepResearchOutputSchema,
  researchInputSchema,
  researchOutputSchema,
} from "./schemas.js"
import {
  deepResearchCompanyFields,
  deepResearchPersonFields,
  researchCompanyFields,
  researchPersonFields,
} from "./types.js"
import type {
  BackgroundDeepResearchTool,
  DeepResearchDynamicConfig,
  DeepResearchFactoryConfig,
  DeepResearchOptions,
  DeepResearchStaticFactoryArgument,
  DeepResearchStaticFactoryConfig,
  DeepResearchTool,
  DynamicFactoryArgument,
  ResearchDynamicConfig,
  ResearchFactoryConfig,
  ResearchOptions,
  ResearchStaticFactoryArgument,
  ResearchStaticFactoryConfig,
  ResearchTool,
} from "./types.js"

export function researchSonar<const Answers extends object = never>(
  config: DynamicFactoryArgument<ResearchDynamicConfig, Answers>,
  options?: ResearchOptions
): ResearchTool<ResearchDynamicConfig, NoInfer<Answers>>
export function researchSonar<const Config extends ResearchStaticFactoryConfig>(
  config: ResearchStaticFactoryArgument<Config>,
  options?: ResearchOptions
): ResearchTool<NoInfer<Config>>
export function researchSonar(config: ResearchFactoryConfig, options?: ResearchOptions): unknown {
  let validatedConfig: ResearchFactoryConfig
  let validatedOptions: ResearchOptions
  try {
    validatedConfig = validateResearchConfig(config)
    validatedOptions = validateResearchOptions(options)
  } catch (error) {
    throw sanitizeSonarFailure("research", "validation", error)
  }
  const configSnapshot = validatedConfig
  const optionsSnapshot = validatedOptions
  const dynamic = isDynamicConfig(configSnapshot)
  const inputSchema = researchInputSchema(dynamic)
  const personFields = dynamic ? researchPersonFields : configSnapshot.person
  const companyFields = dynamic ? researchCompanyFields : configSnapshot.company
  const customFields = dynamic ? undefined : Object.keys(configSnapshot.research)
  const tool = defineTool({
    description: researchDescription(configSnapshot, optionsSnapshot.description),
    async *execute(input, context) {
      const validated = validateExecutionInput("research", inputSchema, input)
      // SAFETY: The generated input schema accepts only plain Sonar input objects.
      const request = researchRequest(
        configSnapshot,
        validated as Readonly<Record<string, unknown>>
      )
      yield* streamSnapshots("research", request, optionsSnapshot.layer, context.abortSignal)
    },
    inputSchema,
    outputSchema: researchOutputSchema(configSnapshot),
    toModelOutput: (snapshot) =>
      projectSnapshot(snapshot, personFields, companyFields, customFields),
  })
  // SAFETY: The schemas, request builder, stream, and projection are all derived from the same
  // validated Config. The cast restores that config-derived relationship after runtime assembly.
  return tool as unknown as ResearchTool<ResearchFactoryConfig, never>
}

export function deepResearchSonar<const Answers extends object = never>(
  config: DynamicFactoryArgument<DeepResearchDynamicConfig, Answers>,
  options: DeepResearchOptions & { readonly execution: "background" }
): BackgroundDeepResearchTool<DeepResearchDynamicConfig, NoInfer<Answers>>
export function deepResearchSonar<const Answers extends object = never>(
  config: DynamicFactoryArgument<DeepResearchDynamicConfig, Answers>,
  options?: DeepResearchOptions & { readonly execution?: undefined }
): DeepResearchTool<DeepResearchDynamicConfig, NoInfer<Answers>>
export function deepResearchSonar<const Config extends DeepResearchStaticFactoryConfig>(
  config: DeepResearchStaticFactoryArgument<Config>,
  options: DeepResearchOptions & { readonly execution: "background" }
): BackgroundDeepResearchTool<NoInfer<Config>>
export function deepResearchSonar<const Config extends DeepResearchStaticFactoryConfig>(
  config: DeepResearchStaticFactoryArgument<Config>,
  options?: DeepResearchOptions & { readonly execution?: undefined }
): DeepResearchTool<NoInfer<Config>>
export function deepResearchSonar(rawConfig: unknown, options?: DeepResearchOptions): unknown {
  // SAFETY: validateDeepResearchConfig immediately validates the complete runtime config shape.
  const configInput = rawConfig as DeepResearchFactoryConfig
  let validatedConfig: DeepResearchFactoryConfig
  let validatedOptions: DeepResearchOptions
  try {
    validatedConfig = validateDeepResearchConfig(configInput)
    validatedOptions = validateDeepResearchOptions(options)
  } catch (error) {
    throw sanitizeSonarFailure("deepResearch", "validation", error)
  }
  const configSnapshot = validatedConfig
  const optionsSnapshot = validatedOptions
  const dynamic = isDynamicConfig(configSnapshot)
  const inputSchema = deepResearchInputSchema(dynamic)
  const outputSchema = deepResearchOutputSchema(configSnapshot)
  const description = deepResearchDescription(configSnapshot, optionsSnapshot.description)
  const personFields = dynamic ? deepResearchPersonFields : configSnapshot.person
  const companyFields = dynamic ? deepResearchCompanyFields : configSnapshot.company
  const customFields = dynamic ? undefined : Object.keys(configSnapshot.deepResearch)
  const toModelOutput = (snapshot: unknown) =>
    projectSnapshot(snapshot, personFields, companyFields, customFields)

  if (optionsSnapshot.execution === "background") {
    const tool = defineTool<typeof inputSchema, Promise<unknown>>({
      description,
      async execute(input, context) {
        const validated = validateExecutionInput("deepResearch", inputSchema, input)
        // SAFETY: The generated input schema accepts only plain Sonar input objects.
        const request = deepResearchRequest(
          configSnapshot,
          validated as Readonly<Record<string, unknown>>
        )
        return await finalSnapshot(
          "deepResearch",
          request,
          optionsSnapshot.layer,
          context.abortSignal
        )
      },
      execution: "background",
      inputSchema,
      outputSchema,
      toModelOutput,
    })
    // SAFETY: The background executor returns the final snapshot derived from this exact Config.
    return tool as unknown as BackgroundDeepResearchTool<DeepResearchFactoryConfig, never>
  }

  const tool = defineTool({
    description,
    async *execute(input, context) {
      const validated = validateExecutionInput("deepResearch", inputSchema, input)
      // SAFETY: The generated input schema accepts only plain Sonar input objects.
      const request = deepResearchRequest(
        configSnapshot,
        validated as Readonly<Record<string, unknown>>
      )
      yield* streamSnapshots("deepResearch", request, optionsSnapshot.layer, context.abortSignal)
    },
    inputSchema,
    outputSchema,
    toModelOutput,
  })
  // SAFETY: The foreground stream yields snapshots derived from this exact Config.
  return tool as unknown as DeepResearchTool<DeepResearchFactoryConfig, never>
}
