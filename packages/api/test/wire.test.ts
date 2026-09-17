// oxlint-disable sort-keys -- Wire fixtures preserve the public person, company, and variant order.

import { describe, expect, test } from "bun:test"

import { z } from "zod"

import {
  CompleteEvent,
  compileResearchRequest,
  DeepResearchRequest,
  Field,
  FieldEvent,
  JSONValue,
  ResearchRequest,
  SnapshotEvent,
  SonarEvent,
  SonarResponse,
  SonarSeed,
  SonarSnapshot,
  TTL,
} from "../src/index.ts"
import type { StandardJSONSchemaV1 } from "../src/index.ts"
import {
  completeResearchSnapshot,
  completeResearchResponse,
  deepResearchRequest,
  pendingResearchSnapshot,
  pendingResearchResponse,
  researchRequest,
  researchWireRequest,
} from "./fixtures.ts"

const resolvedFieldEvent = (path: string, value: JSONValue) => ({
  id: "1",
  type: "field",
  path,
  field: {
    status: "resolved",
    value,
    confidence: 0.9,
    sources: ["https://example.com/source"],
    resolvedAt: "2026-08-25T20:00:00Z",
  },
})

const utf8ByteLength = (value: string) => new TextEncoder().encode(value).byteLength

describe("V-API-01 public wire schemas", () => {
  test("accepts each seed identity branch and allows branch fields to coexist", () => {
    const seeds = [
      { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
      { fullName: "Ada Lovelace", xURL: "https://x.com/ada" },
      { fullName: "Ada Lovelace", email: "ada@example.com" },
      {
        linkedinURL: "https://www.linkedin.com/in/ada-lovelace",
        fullName: "Ada Lovelace",
        xURL: "https://x.com/ada",
        email: "ada@example.com",
        domain: "example.com",
        context: {
          source: "test",
          nested: { active: true, count: 2, empty: null },
          tags: ["api", 4, false],
        },
      },
    ]

    for (const seed of seeds) {
      expect(SonarSeed.safeParse(seed).success).toBe(true)
    }
  })

  test("normalizes trimmed seed strings while keeping domain caller-defined", () => {
    expect(
      SonarSeed.parse({
        linkedinURL: "  https://www.linkedin.com/in/ada-lovelace  ",
        fullName: "Ada Lovelace",
        xURL: "  https://x.com/ada  ",
        email: "  ada@example.com  ",
        domain: "  internal account label  ",
      })
    ).toEqual({
      linkedinURL: "https://www.linkedin.com/in/ada-lovelace",
      fullName: "Ada Lovelace",
      xURL: "https://x.com/ada",
      email: "ada@example.com",
      domain: "internal account label",
    })
    expect(
      SonarSeed.safeParse({
        linkedinURL: "https://www.linkedin.com/in/ada-lovelace",
        domain: "   ",
      }).success
    ).toBe(false)
  })

  test("normalizes valid email domains and rejects malformed domain labels and dot atoms", () => {
    const validEmails = [
      ["  ada@example.com  ", "ada@example.com"],
      ["  ada@xn--bcher-kva.example  ", "ada@xn--bcher-kva.example"],
    ] as const
    const invalidEmails = [
      ".a@example.com",
      "a.@example.com",
      "a..b@example.com",
      "a@",
      "a@.example.com",
      "a@example..com",
      "a@example.com.",
      "a@-example.com",
      "a@example-.com",
      "a@-foo.example.com",
      "a@foo-.example.com",
    ]

    for (const [email, normalizedEmail] of validEmails) {
      expect(SonarSeed.parse({ fullName: "Ada Lovelace", email }).email).toBe(normalizedEmail)
    }
    for (const email of invalidEmails) {
      expect(SonarSeed.safeParse({ fullName: "Ada Lovelace", email }).success).toBe(false)
    }
  })

  test("enforces email component limits in UTF-8 bytes", () => {
    const local64 = "a".repeat(64)
    const local65 = "a".repeat(65)
    const label63 = "b".repeat(63)
    const label64 = "b".repeat(64)
    const domain253 = ["a".repeat(63), "b".repeat(63), "c".repeat(63), "d".repeat(61)].join(".")
    const domain254 = ["a".repeat(63), "b".repeat(63), "c".repeat(63), "d".repeat(62)].join(".")
    expect([utf8ByteLength(local64), utf8ByteLength(label63), utf8ByteLength(domain253)]).toEqual([
      64, 63, 253,
    ])
    expect([utf8ByteLength(local65), utf8ByteLength(label64), utf8ByteLength(domain254)]).toEqual([
      65, 64, 254,
    ])

    const validEmails = [`${local64}@example.com`, `a@${label63}.com`, `a@${domain253}`]
    const invalidEmails = [`${local65}@example.com`, `a@${label64}.com`, `a@${domain254}`]
    for (const email of validEmails) {
      expect(SonarSeed.safeParse({ fullName: "Ada Lovelace", email }).success).toBe(true)
    }
    for (const email of invalidEmails) {
      expect(SonarSeed.safeParse({ fullName: "Ada Lovelace", email }).success).toBe(false)
    }
  })

  test("rejects seeds that do not satisfy an identity branch", () => {
    const invalidSeeds = [
      {},
      { domain: "example.com" },
      { email: "ada@example.com" },
      { fullName: "Ada Lovelace" },
      { xURL: "https://x.com/ada" },
      { fullName: "Ada Lovelace", xURL: "not a URL" },
      { fullName: "Ada Lovelace", email: "not an email" },
      { linkedinURL: "not a URL" },
      { name: "stale key", email: "ada@example.com" },
      { linkedinUrl: "https://www.linkedin.com/in/stale-casing" },
      { linkedinURL: "https://www.linkedin.com/in/ada", context: { bad: undefined } },
    ]

    for (const seed of invalidSeeds) {
      expect(SonarSeed.safeParse(seed).success).toBe(false)
    }
  })

  test("accepts compact integer TTLs from twelve hours through one year", () => {
    const valid = [
      "43200000ms",
      "43200s",
      "720m",
      "12h",
      "1d",
      "52w",
      "365d",
      "8760h",
      "525600m",
      "31536000s",
    ]
    const invalid = [
      "43199999ms",
      "43199s",
      "719m",
      "11h",
      "0d",
      "53w",
      "366d",
      "8761h",
      "1y",
      "12 h",
      "12.5h",
      "+12h",
      "-12h",
      "forever",
    ]

    for (const ttl of valid) {
      expect(TTL.safeParse(ttl).success).toBe(true)
    }
    for (const ttl of invalid) {
      expect(TTL.safeParse(ttl).success).toBe(false)
    }
  })

  test("accepts only JSON values, including in nested records", () => {
    const valid = [
      null,
      true,
      42,
      "text",
      [null, 1, "two", { deep: false }],
      { nested: { array: [1, 2, 3] } },
    ]
    const invalid = [undefined, 1n, Number.NaN, Number.POSITIVE_INFINITY, new Date()]

    for (const value of valid) {
      expect(JSONValue.safeParse(value).success).toBe(true)
    }
    for (const value of invalid) {
      expect(JSONValue.safeParse(value).success).toBe(false)
    }
  })

  test("enforces the research and deepResearch catalogs at runtime", () => {
    expect(ResearchRequest.safeParse(researchWireRequest).success).toBe(true)
    expect(DeepResearchRequest.safeParse(deepResearchRequest).success).toBe(true)

    const invalidRequests = [
      {
        schema: ResearchRequest,
        value: { ...researchWireRequest, person: { phone: true } },
      },
      {
        schema: ResearchRequest,
        value: { ...researchWireRequest, company: { legalName: true } },
      },
      {
        schema: ResearchRequest,
        value: {
          ...researchWireRequest,
          person: { ...researchWireRequest.person, deepResearch: { forbidden: "wrong tier" } },
        },
      },
      {
        schema: DeepResearchRequest,
        value: { ...deepResearchRequest, person: { title: true } },
      },
      {
        schema: DeepResearchRequest,
        value: { ...deepResearchRequest, company: { name: true } },
      },
      {
        schema: DeepResearchRequest,
        value: {
          ...deepResearchRequest,
          company: { ...deepResearchRequest.company, research: { forbidden: "wrong tier" } },
        },
      },
      {
        schema: ResearchRequest,
        value: { ...researchWireRequest, person: { title: false } },
      },
    ]

    for (const { schema, value } of invalidRequests) {
      expect(schema.safeParse(value).success).toBe(false)
    }
  })

  test("requires camelCase, non-reserved custom answer keys with questions", () => {
    const validKeys = ["sellsToSMB", "usesQuickbooks2", "a", "toString"]
    const invalidKeys = [
      "Person",
      "snake_case",
      "kebab-case",
      "two words",
      "2fast",
      "ttl",
      "person",
      "company",
      "research",
      "deepResearch",
    ]

    for (const key of validKeys) {
      expect(
        ResearchRequest.safeParse({
          ...researchWireRequest,
          person: {
            ...researchWireRequest.person,
            research: { [key]: { description: "Question?", type: "string" } },
          },
        }).success
      ).toBe(true)
    }
    for (const key of invalidKeys) {
      expect(
        ResearchRequest.safeParse({
          ...researchWireRequest,
          person: {
            ...researchWireRequest.person,
            research: { [key]: { description: "Question?", type: "string" } },
          },
        }).success
      ).toBe(false)
    }
    expect(
      ResearchRequest.safeParse({
        ...researchWireRequest,
        person: {
          ...researchWireRequest.person,
          research: { validKey: { description: "   ", type: "string" } },
        },
      }).success
    ).toBe(false)
  })

  test("compiles only described JSON Schema-capable research validators", () => {
    let inputConversions = 0
    let outputConversions = 0
    const standard: StandardJSONSchemaV1<unknown, string> = {
      "~standard": {
        version: 1,
        vendor: "fixture",
        jsonSchema: {
          input: () => {
            inputConversions += 1
            return { description: "Wrong direction", type: "string" }
          },
          output: () => {
            outputConversions += 1
            return { description: "What changed recently?", type: "string" }
          },
        },
      },
    }
    const compiled = compileResearchRequest({
      seed: researchRequest.seed,
      ttl: researchRequest.ttl,
      person: {
        title: true,
        research: {
          typed: z.object({ signal: z.string() }).describe("Which signal is strongest?"),
          raw: { description: "What is the public narrative?", type: "string" },
        },
      },
      company: { research: { standard } },
    })

    expect(compiled.person.research?.typed.description).toBe("Which signal is strongest?")
    expect(compiled.person.research?.raw).toEqual({
      description: "What is the public narrative?",
      type: "string",
    })
    expect(compiled.company.research?.standard.description).toBe("What changed recently?")
    expect(inputConversions).toBe(0)
    expect(outputConversions).toBe(1)

    const invalidValues = [
      z.string(),
      { type: "string" },
      { description: "   ", type: "string" },
      {
        "~standard": {
          version: 1,
          vendor: "schema-only",
          validate: <Value>(value: Value) => ({ value }),
        },
      },
    ]
    for (const invalid of invalidValues) {
      expect(() =>
        // SAFETY: Invalid validator fixtures intentionally bypass the authored compile-time contract.
        compileResearchRequest({
          seed: researchRequest.seed,
          ttl: researchRequest.ttl,
          person: { research: { invalid } },
          company: {},
        } as never)
      ).toThrow()
    }
  })

  test("Field has exactly the four specified states", () => {
    const canonicalVariants = [
      { status: "pending" },
      {
        status: "resolved",
        value: { rich: [1, true, null] },
        confidence: 0,
        sources: [],
        resolvedAt: "2026-08-25T20:00:00.000Z",
      },
      { status: "notFound" },
      { status: "skipped", reason: "consumerEmail" },
    ]

    expect(Field.options).toHaveLength(4)
    expect(
      canonicalVariants.map(
        (variant) => Field.options.filter((option) => option.safeParse(variant).success).length
      )
    ).toEqual([1, 1, 1, 1])
    expect(
      Field.options.map(
        (option) => canonicalVariants.filter((variant) => option.safeParse(variant).success).length
      )
    ).toEqual([1, 1, 1, 1])

    const valid = [
      ...canonicalVariants,
      {
        status: "resolved",
        value: "answer",
        confidence: 1,
        sources: ["https://example.com/source"],
        resolvedAt: "2026-08-25T20:00:00Z",
      },
      { status: "notFound", reason: "timeout" },
      { status: "notFound", reason: "identityFailed" },
      { status: "notFound", reason: "providerEmpty" },
      { status: "skipped", reason: "noPersonSeed" },
      { status: "skipped", reason: "noCompanySeed" },
    ]
    const invalid = [
      { status: "resolved", value: "answer" },
      {
        status: "resolved",
        value: undefined,
        confidence: 0.5,
        sources: [],
        resolvedAt: "2026-08-25T20:00:00Z",
      },
      {
        status: "resolved",
        value: "answer",
        confidence: -0.01,
        sources: [],
        resolvedAt: "2026-08-25T20:00:00Z",
      },
      {
        status: "resolved",
        value: "answer",
        confidence: 1.01,
        sources: [],
        resolvedAt: "2026-08-25T20:00:00Z",
      },
      {
        status: "resolved",
        value: "answer",
        confidence: 0.5,
        sources: [],
        resolvedAt: "yesterday",
      },
      { status: "notFound", reason: "unknown" },
      { status: "skipped" },
      { status: "skipped", reason: "timeout" },
      { status: "failed", error: "no fifth state" },
      { status: "pending", value: "extraneous" },
    ]

    for (const field of valid) {
      expect(Field.safeParse(field).success).toBe(true)
    }
    for (const field of invalid) {
      expect(Field.safeParse(field).success).toBe(false)
    }
  })

  test("decodes pending and complete snapshots with entity-owned answer namespaces", () => {
    expect(SonarSnapshot.safeParse(pendingResearchSnapshot).success).toBe(true)
    expect(SonarSnapshot.safeParse(completeResearchSnapshot).success).toBe(true)
    expect(SonarResponse.safeParse(pendingResearchResponse).success).toBe(true)
    expect(SonarResponse.safeParse(completeResearchResponse).success).toBe(true)
    expect(Object.keys(pendingResearchSnapshot.data)).toEqual(["person", "company"])
    expect(Object.keys(pendingResearchSnapshot.data.person.research)).toEqual(["accountSignals"])

    const contradictory = {
      ...pendingResearchSnapshot,
      status: "complete",
    }
    expect(SonarSnapshot.safeParse(contradictory).success).toBe(false)
  })

  test("decodes only the locked normalized event protocol", () => {
    const events = [
      { id: "0", type: "snapshot", snapshot: pendingResearchSnapshot },
      {
        id: "1",
        type: "field",
        path: "person.title",
        field: {
          status: "resolved",
          value: "Founder",
          confidence: 0.9,
          sources: ["https://example.com"],
          resolvedAt: "2026-08-25T20:00:00Z",
        },
      },
      { id: "2", type: "complete", hash: "sonar_hash_123" },
    ]

    expect(SnapshotEvent.safeParse(events[0]).success).toBe(true)
    expect(FieldEvent.safeParse(events[1]).success).toBe(true)
    expect(CompleteEvent.safeParse(events[2]).success).toBe(true)
    for (const event of events) {
      expect(SonarEvent.safeParse(event).success).toBe(true)
    }

    expect(
      SonarEvent.safeParse({ id: "3", type: "field", path: "title", status: "pending" }).success
    ).toBe(false)
    expect(
      SonarEvent.safeParse({ id: "3", type: "complete", hash: "x", extra: true }).success
    ).toBe(false)
  })

  test("validates direct field events against catalog paths and value families", () => {
    const mismatchedEvents = [
      resolvedFieldEvent("person.linkedin", "not a URL"),
      resolvedFieldEvent("person.x", "@ada"),
      resolvedFieldEvent("person.github", "/ada"),
      resolvedFieldEvent("company.logo", false),
      resolvedFieldEvent("person.title", 42),
      resolvedFieldEvent("person.phone", { number: "+1-202-555-0100" }),
      resolvedFieldEvent("company.domain", false),
      resolvedFieldEvent("company.name", ["Example Analytics"]),
      resolvedFieldEvent("company.description", null),
      resolvedFieldEvent("company.legalName", { name: "Example Analytics Ltd" }),
      resolvedFieldEvent("person.logo", "https://example.com/logo.png"),
      resolvedFieldEvent("company.title", "Founder"),
      resolvedFieldEvent("person.providerInternal", "private"),
      resolvedFieldEvent("company.providerInternal", "private"),
    ]
    const richEvents = [
      resolvedFieldEvent("company.colors", ["#112233", "#ffffff"]),
      resolvedFieldEvent("company.location", { city: "London", remote: true }),
      resolvedFieldEvent("company.funding", { round: "seed", amount: 1_000_000 }),
      resolvedFieldEvent("person.research.accountSignals", {
        intent: "high",
        evidence: ["public"],
      }),
    ]

    for (const event of mismatchedEvents) {
      expect(FieldEvent.safeParse(event).success).toBe(false)
      expect(SonarEvent.safeParse(event).success).toBe(false)
    }
    for (const event of richEvents) {
      expect(FieldEvent.safeParse(event).success).toBe(true)
      expect(SonarEvent.safeParse(event).success).toBe(true)
    }
  })
})
