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
  JSONValue,
  ResearchConfig,
  ResearchRequest,
  SonarProtocolEvent,
  SonarSnapshot,
} from "./index.js"

const researchConfig = {
  company: ["name"],
  person: ["title"],
  research: { sellsToSMB: "Does this company sell to small businesses?" },
  ttl: "12h",
} as const satisfies ResearchConfig

const researchRequest = {
  ...researchConfig,
  seed: {
    context: { source: "signup", tags: ["founder", "technical"] },
    fullName: "Ada Lovelace",
    xURL: "https://x.com/AdaLovelace",
  },
} as const satisfies ResearchRequest

const deepResearchConfig = {
  company: ["legalName"],
  deepResearch: { usesQuickBooks: "Does this company use QuickBooks?" },
  person: ["phone"],
  ttl: "365d",
} as const satisfies DeepResearchConfig

const deepResearchRequest = {
  ...deepResearchConfig,
  seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
} as const satisfies DeepResearchRequest

const resolvedTitle = {
  confidence: 0.98,
  resolvedAt: "2026-08-26T12:00:00.000Z",
  sources: ["https://example.com/ada"],
  status: "resolved",
  value: "Mathematician",
} as const

const terminalEvent = (path: string, field: Field): FieldEvent => ({
  _tag: "FieldEvent",
  field,
  path,
})

type ResearchSnapshot = SonarSnapshot<typeof researchConfig>

const reduce = (snapshot: ResearchSnapshot, event: SonarProtocolEvent) =>
  Effect.runPromise(reduceSnapshot<typeof researchConfig>(snapshot, event))

describe("@usesonar/effect request schemas", () => {
  test("accepts each supported seed form, a compact bounded TTL, and JSON context", () => {
    expect(
      Schema.decodeUnknownSync(SonarSeed)({ linkedinURL: "https://linkedin.com/in/ada" })
    ).toEqual({
      linkedinURL: "https://linkedin.com/in/ada",
    })
    expect(
      Schema.decodeUnknownSync(SonarSeed)({
        fullName: "Ada Lovelace",
        xURL: "https://x.com/ada",
      })
    ).toEqual({ fullName: "Ada Lovelace", xURL: "https://x.com/ada" })
    expect(
      Schema.decodeUnknownSync(SonarSeed)({
        context: { nested: [true, null, 42] },
        domain: "example.com",
        email: "ada@example.com",
        fullName: "Ada Lovelace",
      })
    ).toMatchObject({ email: "ada@example.com", fullName: "Ada Lovelace" })
    expect(Schema.decodeUnknownSync(ResearchRequestSchema)(researchRequest)).toEqual(
      researchRequest
    )
    expect(Schema.decodeUnknownSync(DeepResearchRequestSchema)(deepResearchRequest)).toEqual(
      deepResearchRequest
    )
  })

  test("returns API-normalized URL, email, and domain seed values from the Effect Schema", () => {
    expect(
      Schema.decodeUnknownSync(SonarSeed)({
        linkedinURL: " https://linkedin.com/in/ada ",
      })
    ).toEqual({ linkedinURL: "https://linkedin.com/in/ada" })
    expect(
      Schema.decodeUnknownSync(SonarSeed)({
        fullName: "Ada Lovelace",
        xURL: " https://x.com/ada ",
      })
    ).toEqual({ fullName: "Ada Lovelace", xURL: "https://x.com/ada" })
    expect(
      Schema.decodeUnknownSync(SonarSeed)({
        domain: " example.com ",
        email: " ada@example.com ",
        fullName: "Ada Lovelace",
      })
    ).toEqual({
      domain: "example.com",
      email: "ada@example.com",
      fullName: "Ada Lovelace",
    })
  })

  test("normalizes nested request seeds exactly like the raw API schemas", () => {
    const paddedResearchRequest = {
      ...researchRequest,
      seed: {
        domain: " example.com ",
        email: " ada@example.com ",
        fullName: "Ada Lovelace",
      },
    }
    const paddedDeepResearchRequest = {
      ...deepResearchRequest,
      seed: {
        domain: " example.com ",
        linkedinURL: " https://www.linkedin.com/in/ada-lovelace ",
      },
    }
    const rawResearch = APIResearchRequest.safeParse(paddedResearchRequest)
    const rawDeepResearch = APIDeepResearchRequest.safeParse(paddedDeepResearchRequest)

    expect(rawResearch.success).toBeTrue()
    expect(rawDeepResearch.success).toBeTrue()
    if (!(rawResearch.success && rawDeepResearch.success)) {
      return
    }

    expect(Schema.decodeUnknownSync(ResearchRequestSchema)(paddedResearchRequest)).toEqual(
      rawResearch.data
    )
    expect(Schema.decodeUnknownSync(DeepResearchRequestSchema)(paddedDeepResearchRequest)).toEqual(
      rawDeepResearch.data
    )
  })

  test("rejects seeds without an accepted identity basis, non-JSON context, and TTL values outside 12h to 1y", () => {
    expect(() => Schema.decodeUnknownSync(SonarSeed)({ fullName: "Ada Lovelace" })).toThrow()
    expect(() => Schema.decodeUnknownSync(SonarSeed)({ xURL: "https://x.com/ada" })).toThrow()
    expect(() => Schema.decodeUnknownSync(SonarSeed)({ email: "ada@example.com" })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(SonarSeed)({
        context: new Date(),
        linkedinURL: "https://linkedin.com/in/ada",
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ResearchRequestSchema)({
        ...researchRequest,
        ttl: "11h",
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ResearchRequestSchema)({
        ...researchRequest,
        ttl: "366d",
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ResearchRequestSchema)({
        ...researchRequest,
        ttl: "720 minutes",
      })
    ).toThrow()
  })

  test("rejects fields from the other tier and malformed custom question keys", () => {
    expect(() =>
      Schema.decodeUnknownSync(ResearchRequestSchema)({
        ...researchRequest,
        person: ["phone"],
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ResearchRequestSchema)({
        ...researchRequest,
        company: ["legalName"],
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(DeepResearchRequestSchema)({
        ...deepResearchRequest,
        person: ["title"],
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(DeepResearchRequestSchema)({
        ...deepResearchRequest,
        company: ["name"],
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ResearchRequestSchema)({
        ...researchRequest,
        research: { "not-camel": "Question?" },
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ResearchRequestSchema)({
        ...researchRequest,
        research: { person: "Question?" },
      })
    ).toThrow()
  })
})

describe("@usesonar/effect snapshots and protocol reduction", () => {
  test("creates an all-pending snapshot whose custom answers follow person and company at the top level", () => {
    const snapshot = initialSnapshot(researchConfig)

    expect(snapshot.status).toBe("pending")
    expect(Object.keys(snapshot.data)).toEqual(["person", "company", "sellsToSMB"])
    expect(snapshot.data).toEqual({
      company: { name: { status: "pending" } },
      person: { title: { status: "pending" } },
      sellsToSMB: { status: "pending" },
    })
  })

  test("settles independent leaves before the required complete event marks the snapshot complete", async () => {
    const started = initialSnapshot(researchConfig)
    const afterTitle = await reduce(started, terminalEvent("person.title", resolvedTitle))
    const afterCompany = await reduce(
      afterTitle,
      terminalEvent("company.name", { reason: "providerEmpty", status: "notFound" })
    )
    const settled = await reduce(
      afterCompany,
      terminalEvent("sellsToSMB", { reason: "noCompanySeed", status: "skipped" })
    )
    const completed = await reduce(settled, CompleteEvent)

    expect(afterTitle.status).toBe("pending")
    expect(afterCompany.status).toBe("pending")
    expect(settled.status).toBe("pending")
    expect(completed.status).toBe("complete")
  })

  test("rejects a wrong-tier or otherwise unrequested field without changing the snapshot", async () => {
    const started = initialSnapshot(researchConfig)

    await expect(
      reduce(
        started,
        terminalEvent("person.phone", { reason: "providerEmpty", status: "notFound" })
      )
    ).rejects.toMatchObject({ _tag: "ProtocolError" })
  })

  test("rejects an exact duplicate field event after the leaf is terminal", async () => {
    const started = initialSnapshot(researchConfig)
    const afterTitle = await reduce(started, terminalEvent("person.title", resolvedTitle))

    await expect(
      reduce(afterTitle, terminalEvent("person.title", resolvedTitle))
    ).rejects.toMatchObject({
      _tag: "ProtocolError",
    })
  })

  test("rejects a terminal leaf returning to pending", async () => {
    const started = initialSnapshot(researchConfig)
    const afterTitle = await reduce(started, terminalEvent("person.title", resolvedTitle))

    await expect(
      reduce(afterTitle, terminalEvent("person.title", { status: "pending" }))
    ).rejects.toMatchObject({ _tag: "ProtocolError" })
  })

  test("rejects premature complete while a requested leaf remains pending", async () => {
    const started = initialSnapshot(researchConfig)

    await expect(reduce(started, CompleteEvent)).rejects.toMatchObject({ _tag: "ProtocolError" })
  })

  test("rejects duplicate complete and every field event after completion", async () => {
    const started = initialSnapshot(researchConfig)
    const afterTitle = await reduce(started, terminalEvent("person.title", resolvedTitle))
    const afterCompany = await reduce(
      afterTitle,
      terminalEvent("company.name", { status: "notFound" })
    )
    const settled = await reduce(
      afterCompany,
      terminalEvent("sellsToSMB", { reason: "noCompanySeed", status: "skipped" })
    )
    const completed = await reduce(settled, CompleteEvent)

    await expect(
      reduce(completed, terminalEvent("person.title", { status: "notFound" }))
    ).rejects.toMatchObject({ _tag: "ProtocolError" })
    await expect(reduce(completed, CompleteEvent)).rejects.toMatchObject({ _tag: "ProtocolError" })
  })
})

describe("@usesonar/effect canonical identity and tagged errors", () => {
  test("uses normalized seed and config semantics, including tier and TTL, for request identity", () => {
    const equivalentConfig = {
      ...researchConfig,
      company: ["name"],
      person: ["title"],
    }
    const equivalentSeed = {
      context: { source: "signup", tags: ["founder", "technical"] },
      fullName: "  ADA LOVELACE ",
      xURL: "https://x.com/@adalovelace",
    }

    expect(
      canonicalRequestIdentity({
        config: researchConfig,
        seed: researchRequest.seed,
        tier: "research",
      })
    ).toBe(
      canonicalRequestIdentity({ config: equivalentConfig, seed: equivalentSeed, tier: "research" })
    )
    expect(
      canonicalRequestIdentity({
        config: researchConfig,
        seed: researchRequest.seed,
        tier: "research",
      })
    ).not.toBe(
      canonicalRequestIdentity({
        config: { ...researchConfig, ttl: "24h" },
        seed: researchRequest.seed,
        tier: "research",
      })
    )
    expect(
      canonicalRequestIdentity({
        config: researchConfig,
        seed: researchRequest.seed,
        tier: "research",
      })
    ).not.toBe(
      canonicalRequestIdentity({
        config: deepResearchConfig,
        seed: deepResearchRequest.seed,
        tier: "deepResearch",
      })
    )
  })

  test("orders distinct Unicode object keys by code units without collapsing their values", () => {
    const NFCKey = "é"
    const NFDKey = "é"
    const canonical = (context: Record<string, JSONValue>, research: Record<string, string>) =>
      canonicalRequestIdentity({
        config: { ...researchConfig, research },
        seed: { ...researchRequest.seed, context },
        tier: "research",
      })
    const forward = canonical(
      Object.fromEntries([
        [
          "a",
          Object.fromEntries([
            [NFCKey, "nested composed"],
            [NFDKey, "nested decomposed"],
          ]),
        ],
        ["b", "second"],
        [NFCKey, "composed"],
        [NFDKey, "decomposed"],
      ]),
      Object.fromEntries([
        ["a", "first"],
        ["b", "second"],
        [NFCKey, "composed question"],
        [NFDKey, "decomposed question"],
      ])
    )
    const reversed = canonical(
      Object.fromEntries([
        [NFDKey, "decomposed"],
        [NFCKey, "composed"],
        ["b", "second"],
        [
          "a",
          Object.fromEntries([
            [NFDKey, "nested decomposed"],
            [NFCKey, "nested composed"],
          ]),
        ],
      ]),
      Object.fromEntries([
        [NFDKey, "decomposed question"],
        [NFCKey, "composed question"],
        ["b", "second"],
        ["a", "first"],
      ])
    )
    const swappedUnicodeValues = canonical(
      Object.fromEntries([
        [
          "a",
          Object.fromEntries([
            [NFCKey, "nested decomposed"],
            [NFDKey, "nested composed"],
          ]),
        ],
        ["b", "second"],
        [NFCKey, "decomposed"],
        [NFDKey, "composed"],
      ]),
      Object.fromEntries([
        ["a", "first"],
        ["b", "second"],
        [NFCKey, "composed question"],
        [NFDKey, "decomposed question"],
      ])
    )

    expect(forward).toBe(reversed)
    expect(forward).not.toBe(swappedUnicodeValues)
    expect(forward).toContain('"a":"first","b":"second"')
  })

  test("keeps every public failure catchable by its stable Effect tag", async () => {
    const request = await Effect.runPromise(
      Effect.fail(new RequestError({ message: "Invalid request" })).pipe(
        Effect.catchTag("RequestError", () => Effect.succeed("request"))
      )
    )
    const transport = await Effect.runPromise(
      Effect.fail(new TransportError({ message: "Sonar transport failed" })).pipe(
        Effect.catchTag("TransportError", () => Effect.succeed("transport"))
      )
    )
    const http = await Effect.runPromise(
      Effect.fail(new HTTPError({ message: "Sonar HTTP request failed", status: 429 })).pipe(
        Effect.catchTag("HTTPError", (error) => Effect.succeed(error.status))
      )
    )
    const protocol = await Effect.runPromise(
      Effect.fail(new ProtocolError({ message: "Unexpected field event" })).pipe(
        Effect.catchTag("ProtocolError", () => Effect.succeed("protocol"))
      )
    )

    expect([request, transport, http, protocol]).toEqual(["request", "transport", 429, "protocol"])
  })

  test("exports a real Context.Service instead of a singleton client", () => {
    expect(SonarClient.key).toBe("@usesonar/effect/SonarClient")
    expect(SonarClient.use).toBeFunction()
  })
})
