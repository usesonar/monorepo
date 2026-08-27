import { defineAgent } from "eve"
import { mockModel } from "eve/evals"

export default defineAgent({
  compaction: { modelContextWindowTokens: 100_000 },
  experimental: { tasks: true },
  model: mockModel({
    modelId: "sonar-routing-fixture",
    provider: "sonar-verifier",
    respond: ({ lastUserMessage, toolResults }) => {
      if (toolResults.length > 0) {
        return `MODEL_RESULT:${JSON.stringify(toolResults[0]?.output)}`
      }

      const background = lastUserMessage?.includes("background") === true
      const deep = lastUserMessage?.includes("deep") === true
      let toolName = "research-sonar"
      if (background) {
        toolName = "deep-background-sonar"
      } else if (deep) {
        toolName = "deep-research-sonar"
      }
      return {
        toolCalls: [
          {
            input: {
              email: "ada@example.com",
              fullName: "Ada Lovelace",
            },
            name: toolName,
          },
        ],
      }
    },
  }),
  modelContextWindowTokens: 100_000,
})
