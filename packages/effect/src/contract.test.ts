import { describe, expect, test } from "bun:test"

import {
  DeepResearchRequest as APIDeepResearchRequest,
  ResearchRequest as APIResearchRequest,
} from "@usesonar/api"
import { Effect, Schema } from "effect"

import {
  CompleteEvent,
  DeepResearchRequest as DeepResearchRequestSchema,
  HTTPError,
  ProtocolError,
  RequestError,
  ResearchRequest as ResearchRequestSchema,
  SonarClient,
  SonarSeed,
  TransportError,
  canonicalRequestIdentity,
  initialSnapshot,
  reduceSnapshot,
} from "./index.js"
import type {
  DeepResearchConfig,
  DeepResearchRequest,
  Field,
  FieldEvent,
  ResearchConfig,
  ResearchRequest,
  SonarProtocolEvent,
  SonarSnapshot,
  StandardJSONSchemaV1,
} from "./index.js"

type AccountSignals = { intent: "low" | "medium" | "high"; evidence: string[] }

const accountSignals: StandardJSONSchemaV1<unknown, AccountSignals> = {
  "~standard": {
    jsonSchema: {
      input: () => ({ description: "Which buying signals are public?", type: "object" }),
      output: () => ({
        additionalProperties: false,
        description: "Which buying signals are public?",
        properties: {
          evidence: { items: { type: "string" }, type: "array" },
          intent: { enum: ["low", "medium", "high"] },
        },
        required: ["intent", "evidence"],
        type: "object",
      }),
    },
    types: undefined,
    vendor: "fixture",
    version: 1,
  },
}

const researchConfig = {
  company: {
    name: true,
    research: { accountSignals },
  },
  person: {
    research: {
      accountSignals: { description: "Summarize the person's public signals.", type: "string" },
    },
    title: true,
  },
  ttl: "12h",
} as const satisfies ResearchConfig

const researchRequest = {
  ...researchConfig,
  seed: {
    context: { source: "signup", tags: ["founder", "technical"] },
    fullName: "Ada Lovelace",
    xURL: "https://x.com/AdaLovelace",
  },
} as const satisfies ResearchRequest<typeof researchConfig>

const deepResearchConfig = {
  company: {
    deepResearch: { background: "Summarize the company's history." },
    legalName: true,
  },
  person: {
    deepResearch: { background: "Summarize the person's career." },
    phone: true,
  },
  ttl: "365d",
} as const satisfies DeepResearchConfig

const deepResearchRequest = {
  ...deepResearchConfig,
  seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
} as const satisfies DeepResearchRequest<typeof deepResearchConfig>

const resolvedTitle = {
  confidence: 0.98,
  resolvedAt: "2026-08-26T12:00:00.000Z",
  sources: ["https://example.com/ada"],
  status: "resolved",
  value: "Mathematician",
} as const satisfies Field<string>

const terminalEvent = (path: string, field: Field): FieldEvent => ({
  _tag: "FieldEvent",
  field,
  path,
})

type ResearchSnapshot = SonarSnapshot<typeof researchConfig>

const reduce = (snapshot: ResearchSnapshot, event: SonarProtocolEvent) =>
  Effect.runPromise(reduceSnapshot<typeof researchConfig>(snapshot, event))

describe("@usesonar/effect request schemas", () => {
  test("accepts authored research validators and returns their compiled wire request", () => {
    const effectRequest = Schema.decodeUnknownSync(ResearchRequestSchema)(researchRequest)
    const rawRequest = APIResearchRequest.parse(effectRequest)

    expect(rawRequest.person.research?.accountSignals).toMatchObject({ type: "string" })
    expect(rawRequest.company.research?.accountSignals).toMatchObject({ type: "object" })
    expect(effectRequest.seed).toEqual(researchRequest.seed)
  })

  test("accepts deep-research prompts and normalizes seeds exactly like the raw API", () => {
    const padded = {
      ...deepResearchRequest,
      seed: {
        domain: " example.com ",
        linkedinURL: " https://www.linkedin.com/in/ada-lovelace ",
      },
    }
    const raw = APIDeepResearchRequest.parse(padded)

    expect(Schema.decodeUnknownSync(DeepResearchRequestSchema)(padded)).toEqual(raw)
    expect(
      Schema.decodeUnknownSync(SonarSeed)({
        domain: " example.com ",
        email: " ada@example.com ",
        fullName: "Ada Lovelace",
      })
    ).toEqual({ domain: "example.com", email: "ada@example.com", fullName: "Ada Lovelace" })
  })

  test("rejects invalid seeds, TTLs, selectors, question schemas, and prompt maps", () => {
    expect(() => Schema.decodeUnknownSync(SonarSeed)({ fullName: "Ada Lovelace" })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ResearchRequestSchema)({ ...researchRequest, ttl: "11h" })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ResearchRequestSchema)({
        ...researchRequest,
        person: { phone: true },
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ResearchRequestSchema)({
        ...researchRequest,
        person: { research: { badSchema: { type: "string" } } },
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(DeepResearchRequestSchema)({
        ...deepResearchRequest,
        company: { deepResearch: { snake_case: "Question?" } },
      })
    ).toThrow()
  })
})

describe("@usesonar/effect snapshots and protocol reduction", () => {
  test("creates an all-pending entity-owned snapshot with duplicate namespace keys", () => {
    const snapshot = initialSnapshot(researchConfig)

    expect(Object.keys(snapshot.data)).toEqual(["person", "company"])
    expect(snapshot).toEqual({
      data: {
        company: {
          name: { status: "pending" },
          research: { accountSignals: { status: "pending" } },
        },
        person: {
          research: { accountSignals: { status: "pending" } },
          title: { status: "pending" },
        },
      },
      status: "pending",
    })
  })

  test("settles nested leaves once and requires explicit complete", async () => {
    const started = initialSnapshot(researchConfig)
    const afterTitle = await reduce(started, terminalEvent("person.title", resolvedTitle))
    const afterPersonResearch = await reduce(
      afterTitle,
      terminalEvent("person.research.accountSignals", {
        confidence: 0.8,
        resolvedAt: "2026-08-26T12:00:00.000Z",
        sources: [],
        status: "resolved",
        value: "Strong public profile",
      })
    )
    const afterCompany = await reduce(
      afterPersonResearch,
      terminalEvent("company.name", { reason: "providerEmpty", status: "notFound" })
    )
    const settled = await reduce(
      afterCompany,
      terminalEvent("company.research.accountSignals", {
        confidence: 0.9,
        resolvedAt: "2026-08-26T12:00:00.000Z",
        sources: [],
        status: "resolved",
        value: { evidence: [], intent: "high" },
      })
    )

    expect(settled.status).toBe("pending")
    const completed = await reduce(settled, CompleteEvent)
    expect(completed.status).toBe("complete")
    await expect(
      reduce(settled, terminalEvent("company.research.accountSignals", { status: "notFound" }))
    ).rejects.toMatchObject({ _tag: "ProtocolError" })
  })

  test("rejects malformed, unrequested, premature, and post-complete events", async () => {
    const started = initialSnapshot(researchConfig)
    await expect(
      reduce(started, terminalEvent("company.deepResearch.accountSignals", { status: "notFound" }))
    ).rejects.toMatchObject({ _tag: "ProtocolError" })
    await expect(reduce(started, CompleteEvent)).rejects.toMatchObject({ _tag: "ProtocolError" })
    await expect(
      Effect.runPromise(reduceSnapshot(started, { _tag: "FieldEvent", field: {}, path: "x" }))
    ).rejects.toMatchObject({ _tag: "ProtocolError" })
  })
})

describe("@usesonar/effect identity and errors", () => {
  test("canonicalizes validator output, selector order, TTL, seed, and route", () => {
    const canonical = canonicalRequestIdentity({
      config: researchConfig,
      seed: researchRequest.seed,
      tier: "research",
    })
    const reordered = canonicalRequestIdentity({
      config: {
        company: { name: true, research: { accountSignals } },
        person: {
          research: {
            accountSignals: {
              description: "Summarize the person's public signals.",
              type: "string",
            },
          },
          title: true,
        },
        ttl: "720m",
      },
      seed: {
        context: { source: "signup", tags: ["founder", "technical"] },
        fullName: " ada lovelace ",
        xURL: "https://X.com/@AdaLovelace/",
      },
      tier: "research",
    })

    expect(reordered).toBe(canonical)
    expect(
      canonicalRequestIdentity({
        config: deepResearchConfig,
        seed: deepResearchRequest.seed,
        tier: "deepResearch",
      })
    ).not.toBe(canonical)
  })

  test("keeps public failures tagged and the client a Context service", () => {
    const errors = [
      new RequestError({ message: "request" }),
      new TransportError({ message: "transport" }),
      new HTTPError({ message: "http", status: 503 }),
      new ProtocolError({ message: "protocol" }),
    ]
    expect(errors.map((error) => error._tag)).toEqual([
      "RequestError",
      "TransportError",
      "HTTPError",
      "ProtocolError",
    ])
    expect(SonarClient.key).toBe("@usesonar/effect/SonarClient")
  })
})
