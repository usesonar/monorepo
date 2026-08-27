/* eslint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- This optional verifier parses the untrusted Responses API and Standard Schema boundary without adding a runtime validator dependency. */
import type { ToolContext } from "eve/tools"

import { deepResearchSonar, researchSonar } from "../src/index.js"
import {
  deepConfig,
  researchConfig,
  sonarFixtureLayer,
} from "../test/eve-native/agent/lib/sonar-fixture.js"

type StandardProperties = {
  readonly jsonSchema: {
    readonly input: (options: { readonly target: string }) => Record<string, unknown>
  }
  readonly validate: (
    value: unknown
  ) =>
    | { readonly issues: readonly unknown[] }
    | { readonly value: unknown }
    | Promise<{ readonly issues: readonly unknown[] } | { readonly value: unknown }>
}

const standardProperties = (schema: unknown): StandardProperties => {
  if (typeof schema !== "object" || schema === null || !("~standard" in schema)) {
    throw new Error("Sonar input is not a Standard Schema")
  }
  const properties = schema["~standard"]
  if (
    typeof properties !== "object" ||
    properties === null ||
    !("validate" in properties) ||
    typeof properties.validate !== "function" ||
    !("jsonSchema" in properties) ||
    typeof properties.jsonSchema !== "object" ||
    properties.jsonSchema === null ||
    !("input" in properties.jsonSchema) ||
    typeof properties.jsonSchema.input !== "function"
  ) {
    throw new Error("Sonar input cannot convert to JSON Schema")
  }
  return properties
}

const toolContext = (): ToolContext => {
  const context = { abortSignal: new AbortController().signal }
  // SAFETY: The optional verifier executes only the injected Sonar Layer and needs only cancellation.
  return context as ToolContext
}

const getFunctionCall = (response: unknown) => {
  if (typeof response !== "object" || response === null || !("output" in response)) {
    throw new Error("Responses API returned no output")
  }
  const { output } = response
  if (!Array.isArray(output)) {
    throw new TypeError("Responses API output was not an array")
  }
  const calls = output.filter(
    (item) =>
      typeof item === "object" && item !== null && "type" in item && item.type === "function_call"
  )
  if (calls.length !== 1) {
    throw new Error(`Expected one function call, received ${calls.length}`)
  }
  const [call] = calls
  if (
    typeof call !== "object" ||
    call === null ||
    !("name" in call) ||
    typeof call.name !== "string" ||
    !("arguments" in call) ||
    typeof call.arguments !== "string"
  ) {
    throw new Error("Responses API returned an invalid function call")
  }
  return call
}

const run = async () => {
  const openAIAPIKey = process.env.OPENAI_API_KEY
  if (openAIAPIKey === undefined || openAIAPIKey.length === 0) {
    console.log("UNAVAILABLE EVE-12 — OPENAI_API_KEY is not set")
    return
  }

  const research = researchSonar(researchConfig, { layer: sonarFixtureLayer })
  const deep = deepResearchSonar(deepConfig, { layer: sonarFixtureLayer })
  const openAIURL = new URL("https://api.openai.com/v1/responses")
  if (openAIURL.hostname !== "api.openai.com") {
    throw new Error("Live verifier credentials may be sent only to OpenAI")
  }
  const response = await fetch(openAIURL, {
    body: JSON.stringify({
      input:
        "Use the appropriate Sonar tool to investigate Ada Lovelace's company's legal name and multi-state tax exposure. You know her email is ada@example.com.",
      instructions:
        "Choose exactly one tool. Use deep research for investigation fields. Supply a valid identity seed and do not invent extra input keys.",
      max_output_tokens: 300,
      model: "gpt-5.6-luna",
      parallel_tool_calls: false,
      reasoning: { effort: "low" },
      store: false,
      tool_choice: "required",
      tools: [
        {
          description: research.description,
          name: "researchSonar",
          parameters: standardProperties(research.inputSchema).jsonSchema.input({
            target: "draft-2020-12",
          }),
          strict: true,
          type: "function",
        },
        {
          description: deep.description,
          name: "deepResearchSonar",
          parameters: standardProperties(deep.inputSchema).jsonSchema.input({
            target: "draft-2020-12",
          }),
          strict: true,
          type: "function",
        },
      ],
    }),
    headers: {
      Authorization: `Bearer ${openAIAPIKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  })

  if (!response.ok) {
    throw new Error(`Responses API returned HTTP ${response.status}`)
  }

  const call = getFunctionCall(await response.json())
  if (call.name !== "deepResearchSonar") {
    throw new Error(`Expected deepResearchSonar, received ${call.name}`)
  }

  const parsedArguments: unknown = JSON.parse(call.arguments)
  const validated = await standardProperties(deep.inputSchema).validate(parsedArguments)
  if ("issues" in validated) {
    throw new Error("The model supplied an invalid Sonar seed")
  }

  // SAFETY: deep.inputSchema validated this exact value immediately above.
  const deepInput = validated.value as Parameters<typeof deep.execute>[0]
  const output = deep.execute(deepInput, toolContext())
  let finalSnapshot: unknown
  if (typeof output === "object" && output !== null && Symbol.asyncIterator in output) {
    for await (const snapshot of output) {
      finalSnapshot = snapshot
    }
  } else {
    finalSnapshot = await output
  }

  if (
    typeof finalSnapshot !== "object" ||
    finalSnapshot === null ||
    !("status" in finalSnapshot) ||
    finalSnapshot.status !== "complete"
  ) {
    throw new Error("Injected Sonar Layer did not produce a complete final snapshot")
  }

  console.log("PASS EVE-12")
}

try {
  await run()
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown live verifier failure"
  console.error(`FAIL EVE-12 — ${message}`)
  process.exitCode = 1
}
