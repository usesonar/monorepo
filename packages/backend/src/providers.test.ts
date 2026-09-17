import { describe, expect, test } from "bun:test"

import { Effect, Layer } from "effect"

import {
  FirecrawlSDKClient,
  ProviderClock,
  ProviderFailure,
  ProviderGateway,
  ProviderTransport,
  ParallelTaskClient,
  makeProviderGatewayLayer,
  makeProviderRunStoreLayer,
  matchesJSONSchema,
} from "./providers.ts"
import type {
  ParallelBatch,
  ProviderGatewayService,
  ProviderHTTPRequest,
  ProviderHTTPResponse,
  SixtyFourBatch,
} from "./providers.ts"

const researchBatch: ParallelBatch = {
  entity: "company",
  identity: { domain: "example.com" },
  questions: {
    employeeCount: {
      description: "Current employee count",
      minimum: 1,
      type: "integer",
    },
    segment: {
      description: "Primary customer segment",
      enum: ["enterprise", "SMB"],
      type: "string",
    },
  },
  requestId: "tenant-a:company:research:questions",
}

const deepResearchBatch = (entity: "person" | "company"): SixtyFourBatch => ({
  entity,
  identity:
    entity === "person" ? { linkedin: "https://linkedin.com/in/ada" } : { domain: "example.com" },
  questions: { ownership: "Summarize the entity's ownership." },
  requestId: `tenant-a:${entity}:deepResearch:questions`,
})

const unavailableFirecrawl = Layer.succeed(FirecrawlSDKClient, {
  scrape: () => Effect.fail(new ProviderFailure({ kind: "invalidResponse" })),
})

const runWith = async <Value>(
  responses: readonly (ProviderHTTPResponse | ProviderFailure)[],
  use: (gateway: ProviderGatewayService) => Effect.Effect<Value, ProviderFailure>,
  options: { readonly maxPolls?: number } = {}
) => {
  const requests: ProviderHTTPRequest[] = []
  let responseIndex = 0
  let sleeps = 0
  const transport = Layer.succeed(ProviderTransport, {
    request: (request: ProviderHTTPRequest) =>
      Effect.suspend(() => {
        requests.push(request)
        const response = responses[responseIndex]
        responseIndex += 1
        if (response instanceof ProviderFailure) {
          return Effect.fail(response)
        }
        return response === undefined
          ? Effect.fail(new ProviderFailure({ kind: "invalidResponse" }))
          : Effect.succeed(response)
      }),
  })
  const parallel = Layer.succeed(ParallelTaskClient, {
    create: ({ identity, outputSchema, requestId }) => {
      requests.push({
        json: { identity, outputSchema, requestId },
        method: "POST",
        path: "sdk:taskRun.create",
      })
      const response = responses[responseIndex]
      responseIndex += 1
      return response instanceof ProviderFailure
        ? Effect.fail(response)
        : Effect.succeed(response?.body)
    },
    result: (runId: string) => {
      requests.push({ method: "GET", path: `sdk:taskRun.result:${runId}` })
      const response = responses[responseIndex]
      responseIndex += 1
      return response instanceof ProviderFailure
        ? Effect.fail(response)
        : Effect.succeed(response?.body)
    },
  })
  const firecrawl = Layer.succeed(FirecrawlSDKClient, {
    scrape: (input) => {
      requests.push({ json: input, method: "POST", path: "sdk:firecrawl.scrape" })
      const response = responses[responseIndex]
      responseIndex += 1
      return response instanceof ProviderFailure
        ? Effect.fail(response)
        : Effect.succeed(response?.body)
    },
  })
  const clock = Layer.succeed(ProviderClock, {
    now: Effect.succeed(1000),
    sleep: () =>
      Effect.sync(() => {
        sleeps += 1
      }),
  })
  const dependencies = Layer.mergeAll(
    transport,
    parallel,
    firecrawl,
    clock,
    makeProviderRunStoreLayer()
  )
  const gateway = makeProviderGatewayLayer({
    maxPolls: options.maxPolls ?? 4,
    pollIntervalMilliseconds: 1,
  }).pipe(Layer.provide(dependencies))
  const result = await Effect.runPromise(
    Effect.flatMap(Effect.service(ProviderGateway), use).pipe(Effect.provide(gateway))
  )
  return { requests, result, sleeps }
}

describe("Parallel provider routing", () => {
  test("submits one core-fast entity batch, polls safely, and keeps per-field basis", async () => {
    const { requests, result, sleeps } = await runWith(
      [
        { body: { run_id: "trun_1", status: "queued" }, status: 200 },
        {
          body: {
            output: {
              basis: [
                {
                  citations: [{ url: "https://example.com/team" }],
                  confidence: "high",
                  field: "employeeCount",
                },
                {
                  citations: [{ url: "https://example.com/customers" }],
                  confidence: "medium",
                  field: "segment",
                },
              ],
              content: { employeeCount: 42, segment: "consumer" },
            },
            run: { status: "completed" },
          },
          status: 200,
        },
      ],
      (gateway) => gateway.research(researchBatch)
    )

    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual({
      json: {
        identity: { domain: "example.com" },
        outputSchema: {
          additionalProperties: false,
          properties: researchBatch.questions,
          required: ["employeeCount", "segment"],
          type: "object",
        },
        requestId: researchBatch.requestId,
      },
      method: "POST",
      path: "sdk:taskRun.create",
    })
    expect(requests[1]).toEqual({ method: "GET", path: "sdk:taskRun.result:trun_1" })
    expect(sleeps).toBe(0)
    expect(result.employeeCount).toEqual({
      confidence: 1,
      sources: ["https://example.com/team"],
      status: "resolved",
      value: 42,
    })
    expect(result.segment).toEqual({ status: "notFound" })
  })

  test("reuses a persisted run ID instead of submitting a duplicate", async () => {
    const requests: ProviderHTTPRequest[] = []
    const parallel = Layer.succeed(ParallelTaskClient, {
      create: (input) => {
        requests.push({ json: input, method: "POST", path: "sdk:taskRun.create" })
        return Effect.succeed({ run_id: "trun_reused" })
      },
      result: (runId) => {
        requests.push({ method: "GET", path: `sdk:taskRun.result:${runId}` })
        return Effect.succeed({
          output: {
            basis: [],
            content: { employeeCount: 42, segment: "SMB" },
          },
        })
      },
    })
    const dependencies = Layer.mergeAll(
      Layer.succeed(ProviderTransport, {
        request: () => Effect.fail(new ProviderFailure({ kind: "invalidResponse" })),
      }),
      parallel,
      Layer.succeed(ProviderClock, { now: Effect.succeed(0), sleep: () => Effect.void }),
      unavailableFirecrawl,
      makeProviderRunStoreLayer()
    )
    const gatewayLayer = makeProviderGatewayLayer().pipe(Layer.provide(dependencies))
    await Effect.runPromise(
      Effect.gen(function* reuseRunId() {
        const gateway = yield* Effect.service(ProviderGateway)
        yield* gateway.research(researchBatch)
        yield* gateway.research(researchBatch)
      }).pipe(Effect.provide(gatewayLayer))
    )
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1)
    expect(requests.filter((request) => request.method === "GET")).toHaveLength(2)
  })

  test("never retries an ambiguous create failure", async () => {
    const failure = new ProviderFailure({ kind: "transport" })
    let calls = 0
    const parallel = Layer.succeed(ParallelTaskClient, {
      create: () => {
        calls += 1
        return Effect.fail(failure)
      },
      result: () => Effect.fail(failure),
    })
    const dependencies = Layer.mergeAll(
      Layer.succeed(ProviderTransport, {
        request: () => Effect.fail(new ProviderFailure({ kind: "invalidResponse" })),
      }),
      parallel,
      Layer.succeed(ProviderClock, { now: Effect.succeed(0), sleep: () => Effect.void }),
      unavailableFirecrawl,
      makeProviderRunStoreLayer()
    )
    const gatewayLayer = makeProviderGatewayLayer().pipe(Layer.provide(dependencies))
    const exit = await Effect.runPromiseExit(
      Effect.flatMap(Effect.service(ProviderGateway), (gateway) =>
        gateway.research(researchBatch)
      ).pipe(Effect.provide(gatewayLayer))
    )
    expect(exit._tag).toBe("Failure")
    expect(calls).toBe(1)
  })
})

describe("SixtyFour provider routing", () => {
  test("uses medium People and Company Intelligence batches and accepts only string leaves", async () => {
    for (const entity of ["person", "company"] as const) {
      // oxlint-disable-next-line no-await-in-loop -- Each entity owns an isolated fake response queue.
      const { requests, result } = await runWith(
        [
          { body: { status: "RUNNING", task_id: `task_${entity}` }, status: 200 },
          {
            body: {
              result: {
                confidence_score: 8,
                field_confidence: { ownership: 9 },
                references: { "https://example.com/about": "Official source" },
                structured_data: { ownership: entity === "person" ? "Founder-owned" : 42 },
              },
              status: "completed",
            },
            status: 200,
          },
        ],
        (gateway) => gateway.deepResearch(deepResearchBatch(entity))
      )
      expect(requests[0]).toEqual({
        json: {
          [entity === "person" ? "lead_info" : "target_company"]:
            deepResearchBatch(entity).identity,
          field_confidence: true,
          struct: { ownership: "Summarize the entity's ownership." },
          tier: "medium",
        },
        method: "POST",
        path: entity === "person" ? "people-intelligence-async" : "company-intelligence-async",
      })
      expect(result.ownership).toEqual(
        entity === "person"
          ? {
              confidence: 0.9,
              sources: ["https://example.com/about"],
              status: "resolved",
              value: "Founder-owned",
            }
          : { status: "notFound" }
      )
    }
  })
})

describe("Firecrawl company-site routing", () => {
  test("scrapes one known domain and normalizes only compatible requested fields", async () => {
    const fields = ["name", "logo", "colors", "description"] as const
    const { requests, result } = await runWith(
      [
        {
          body: {
            branding: {
              brandName: "Example",
              colors: { accent: "#abcdef", primary: "#123456" },
              logo: "/logo.svg",
            },
            metadata: {
              description: "An example company.",
              scrapeId: "private_scrape_id",
              sourceURL: "https://example.com/about",
            },
          },
          status: 200,
        },
      ],
      (gateway) => gateway.companySite({ domain: "example.com", fields })
    )

    expect(requests).toEqual([
      {
        json: { fields, url: "https://example.com" },
        method: "POST",
        path: "sdk:firecrawl.scrape",
      },
    ])
    expect(result).toEqual({
      colors: {
        confidence: 1,
        sources: ["https://example.com/about"],
        status: "resolved",
        value: { accent: "#abcdef", primary: "#123456" },
      },
      description: {
        confidence: 1,
        sources: ["https://example.com/about"],
        status: "resolved",
        value: "An example company.",
      },
      logo: {
        confidence: 1,
        sources: ["https://example.com/about"],
        status: "resolved",
        value: "https://example.com/logo.svg",
      },
      name: {
        confidence: 1,
        sources: ["https://example.com/about"],
        status: "resolved",
        value: "Example",
      },
    })
    expect(JSON.stringify(result)).not.toContain("private_scrape_id")
  })

  test("makes empty fields notFound and rejects malformed documents", async () => {
    const empty = await runWith([{ body: {}, status: 200 }], (gateway) =>
      gateway.companySite({ domain: "example.com", fields: ["name", "colors"] })
    )
    expect(empty.result).toEqual({ colors: { status: "notFound" }, name: { status: "notFound" } })

    await expect(
      runWith([{ body: "malformed", status: 200 }], (gateway) =>
        gateway.companySite({ domain: "example.com", fields: ["name"] })
      )
    ).rejects.toBeInstanceOf(ProviderFailure)
  })

  test("keeps auth, rate-limit, and timeout failures private", async () => {
    for (const kind of ["auth", "rateLimited", "timeout"] as const) {
      // oxlint-disable-next-line no-await-in-loop -- Each terminal provider failure owns a fresh Layer.
      await expect(
        runWith([new ProviderFailure({ kind })], (gateway) =>
          gateway.companySite({ domain: "example.com", fields: ["name"] })
        )
      ).rejects.toBeInstanceOf(ProviderFailure)
    }
  })
})

describe("provider normalization failures", () => {
  test("rejects the obsolete string encoding for Parallel JSON content", async () => {
    await expect(
      runWith(
        [
          { body: { run_id: "trun_string_content" }, status: 200 },
          {
            body: {
              output: {
                basis: [],
                content: JSON.stringify({ employeeCount: 42, segment: "SMB" }),
              },
            },
            status: 200,
          },
        ],
        (gateway) => gateway.research(researchBatch)
      )
    ).rejects.toBeInstanceOf(ProviderFailure)
  })

  test("terminates malformed, rejected, and timed-out results without polling forever", async () => {
    for (const response of [
      { body: { malformed: true }, status: 200 },
      { body: { error: "private detail", status: "failed" }, status: 200 },
      { body: { status: "running" }, status: 202 },
    ]) {
      const responses = [{ body: { run_id: "trun_failure" }, status: 200 }, response] as const
      // oxlint-disable-next-line no-await-in-loop -- Each failure case must be asserted independently.
      await expect(
        runWith(responses, (gateway) => gateway.research(researchBatch), { maxPolls: 1 })
      ).rejects.toBeInstanceOf(ProviderFailure)
    }
  })

  test("validates the bounded JSON Schema features used on the wire", () => {
    expect(
      matchesJSONSchema(
        {
          additionalProperties: false,
          description: "A bounded object",
          properties: {
            active: { type: "boolean" },
            tags: { items: { type: "string" }, type: "array" },
          },
          required: ["active"],
          type: "object",
        },
        { active: true, tags: ["a", "b"] }
      )
    ).toBe(true)
    expect(
      matchesJSONSchema(
        {
          additionalProperties: false,
          description: "A bounded object",
          properties: { active: { type: "boolean" } },
          type: "object",
        },
        { active: true, leaked: "provider metadata" }
      )
    ).toBe(false)
  })
})
