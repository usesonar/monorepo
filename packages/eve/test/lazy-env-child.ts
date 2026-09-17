/* eslint-disable anti-slop/no-reflect-get, sort-keys -- The fresh-process probe preserves field order and proxies process.env without parsing unrelated runtime keys. */
import { SonarClient } from "@usesonar/effect"
import type { SonarClientService } from "@usesonar/effect"
import { Effect, Layer, Stream } from "effect"

const reads: string[] = []
let networkCalls = 0
const originalEnvironment = process.env
const poisonedEnvironment = new Proxy(originalEnvironment, {
  get(target, property, receiver) {
    if (property === "SONAR_BASE_URL" || property === "SONAR_SECRET_KEY") {
      reads.push(property)
      return property === "SONAR_BASE_URL"
        ? "https://poison.invalid"
        : "poison-secret-must-never-escape"
    }
    return Reflect.get(target, property, receiver)
  },
})
Object.defineProperty(process, "env", { configurable: true, value: poisonedEnvironment })
globalThis.fetch = Object.assign(
  () => {
    networkCalls += 1
    return Promise.reject(new Error("Fresh-child network is disabled"))
  },
  // oxlint-disable-next-line no-empty-function -- Bun's fetch type requires this inert static hook.
  { preconnect() {} }
)

const { researchSonar } = await import("../src/index.js?lazy-env-verifier")
const config = {
  company: {
    name: true,
    research: {
      sellsToSMB: { description: "Does it sell to SMBs?", type: "string" },
    },
  },
  person: { title: true },
  ttl: "12h",
} as const
const complete = {
  status: "complete",
  data: {
    person: { title: { status: "pending" } },
    company: {
      name: { status: "pending" },
      research: { sellsToSMB: { status: "pending" } },
    },
  },
} as const
const service = {
  // SAFETY: The injected fixture matches the exact static config above.
  research: () => Stream.fromArray([complete]) as never,
  // SAFETY: Deep research and retrieve are unreachable in this research-only child.
  deepResearch: () => Stream.never as never,
  // SAFETY: Retrieve is unreachable in this research-only child.
  retrieve: () => Effect.never as never,
} satisfies SonarClientService
const layer = Layer.succeed(SonarClient, service)

if (reads.length !== 0 || networkCalls !== 0) {
  throw new Error("Module import read Sonar environment or touched network")
}
const injected = researchSonar(config, { layer })
const defaulted = researchSonar(config)
if (reads.length !== 0 || networkCalls !== 0 || defaulted.execute === undefined) {
  throw new Error("Factory creation read Sonar environment or touched network")
}
const execution = injected.execute(
  { linkedinURL: "https://linkedin.com/in/ada" },
  // SAFETY: The tool execution uses only Eve's AbortSignal.
  { abortSignal: new AbortController().signal } as never
)
for await (const snapshot of execution) {
  if (snapshot !== complete) {
    throw new Error("Injected child received an unexpected snapshot")
  }
}
if (reads.length !== 0 || networkCalls !== 0) {
  throw new Error("Injected Layer read Sonar environment or touched network")
}

process.stdout.write(JSON.stringify({ networkCalls, reads }))
