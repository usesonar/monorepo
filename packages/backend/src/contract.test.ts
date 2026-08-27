import { afterEach, describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"

import { SonarResponse } from "@usesonar/api"
import { SonarBackend, createSonarHandler, layer } from "@usesonar/backend"
import { createBackendTestHarness } from "@usesonar/backend/testing"
import type { FakeScenario, TestTenant } from "@usesonar/backend/testing"

const serverSecret = "verifier-only-server-secret"
const tenantAKey = "pk_test_tenant_a"
const tenantBKey = "sk_tenant_b"

type JSONValue =
  | boolean
  | null
  | number
  | string
  | readonly JSONValue[]
  | { readonly [key: string]: JSONValue }
type Field = { status: string; reason?: string } & { readonly [key: string]: JSONValue }
type Snapshot = {
  hash?: string
  status?: string
  data: { person: Record<string, Field>; company: Record<string, Field> } & Record<string, Field>
}
type RequestBody = { readonly [key: string]: JSONValue }

const research = (overrides: RequestBody = {}) => ({
  company: ["domain", "name"],
  person: ["linkedin", "title"],
  research: { sellsToSMB: "Who does this company sell to?" },
  seed: {
    domain: "Example.COM",
    fullName: "Ada Lovelace",
    xURL: "https://x.com/@Ada",
  },
  ttl: "24h",
  ...overrides,
})

const headersFor = (options: {
  accept?: string
  contentType?: string
  key?: string
  origin?: string | null
  headers?: HeadersInit
}) => {
  const headers = new Headers(options.headers)
  headers.set("accept", options.accept ?? "application/json")
  if (options.contentType !== undefined) {
    headers.set("content-type", options.contentType)
  }
  if (options.key !== undefined) {
    headers.set("authorization", `Bearer ${options.key}`)
  }
  if (options.key === tenantAKey && options.origin !== null && !headers.has("origin")) {
    headers.set("origin", options.origin ?? "https://app.tenant-a.test")
  }
  return headers
}

const request = (
  path: string,
  body?: JSONValue,
  options: { accept?: string; key?: string; origin?: string | null; headers?: HeadersInit } = {}
) =>
  new Request(`https://backend.test${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: headersFor({
      ...options,
      contentType: body === undefined ? undefined : "application/json",
    }),
    method: body === undefined ? "GET" : "POST",
  })

const rawRequest = (
  path: string,
  body: string,
  options: { contentType?: string; key?: string; method?: string; origin?: string | null } = {}
) =>
  new Request(`https://backend.test${path}`, {
    body,
    headers: headersFor({
      accept: "application/json",
      contentType: options.contentType ?? "application/json",
      key: options.key ?? tenantAKey,
      origin: options.origin,
    }),
    method: options.method ?? "POST",
  })

// SAFETY: Every call targets a JSON endpoint or has already asserted a JSON response status.
const json = (response: Response) => response.json() as Promise<Snapshot>

const hashOf = (snapshot: Snapshot) => {
  expect(snapshot.hash).toBeDefined()
  return snapshot.hash ?? ""
}

const canonicalHmac = (tenantId: string, route: string, seed: JSONValue, config: JSONValue) =>
  createHmac("sha256", serverSecret)
    .update(`${tenantId}${route}${JSON.stringify(seed)}${JSON.stringify(config)}`)
    .digest("hex")

let harness: Awaited<ReturnType<typeof createBackendTestHarness>>

afterEach(async () => {
  await harness?.close()
})

const boot = async ({
  scenario: scenarioOptions,
  ...options
}: Parameters<typeof createBackendTestHarness>[0] = {}) => {
  const tenants: TestTenant[] = [
    {
      allowedOrigins: ["https://app.tenant-a.test"],
      capability: "publishable",
      key: tenantAKey,
      tenantId: "tenant-a",
    },
    { capability: "secret", key: tenantBKey, tenantId: "tenant-b" },
  ]
  const scenario: FakeScenario = { autoSettle: true, ...scenarioOptions }
  harness = await createBackendTestHarness({
    scenario,
    serverSecret,
    tenants,
    ...options,
  })
  return harness
}

const expectSafe4xx = async (response: Response, status: number) => {
  expect(response.status).toBe(status)
  const body = await response.text()
  const normalized = body.toLowerCase()
  expect(normalized).not.toContain("provider")
  expect(normalized).not.toContain("cache")
  expect(normalized).not.toContain("stack")
  expect(normalized).not.toContain("internal")
  expect(normalized).not.toContain(serverSecret.toLowerCase())
}

describe("VLD-001 validation and representation negotiation", () => {
  test("rejects malformed requests before they create a run", async () => {
    const backend = await boot()
    await expectSafe4xx(await backend.fetch(request("/v1/research", {})), 400)
    await expectSafe4xx(
      await backend.fetch(request("/v1/research", research({ ttl: "11h" }), { key: tenantAKey })),
      400
    )
    await expectSafe4xx(
      await backend.fetch(
        request("/v1/research", research({ tenantId: "tenant-b" }), { key: tenantAKey })
      ),
      400
    )
    await expectSafe4xx(
      await backend.fetch(
        request("/v1/research", research({ person: ["phone"] }), { key: tenantAKey })
      ),
      400
    )
    await expectSafe4xx(
      await backend.fetch(
        request("/v1/research", research({ research: { ttl: "question" } }), { key: tenantAKey })
      ),
      400
    )
    await expectSafe4xx(
      await backend.fetch(
        request("/v1/research", research(), { accept: "text/plain", key: tenantAKey })
      ),
      406
    )
    expect(backend.inspect().runsStarted).toBe(0)
  })

  test("requires one of the three supported seeds", async () => {
    const backend = await boot()
    const responses = await Promise.all(
      [
        { fullName: "Ada" },
        { xURL: "ada" },
        { email: "ada@example.com" },
        { fullName: 42, linkedinURL: "https://linkedin.com/in/ada" },
      ].map((seed) =>
        backend.fetch(request("/v1/research", research({ seed }), { key: tenantAKey }))
      )
    )
    await Promise.all(responses.map((response) => expectSafe4xx(response, 400)))
    expect(backend.inspect().runsStarted).toBe(0)
  })

  test("accepts every locked seed branch, and rejects route, method, JSON, and content-type violations", async () => {
    const backend = await boot()
    const seedResponses = await Promise.all(
      [
        { context: { source: "signup" }, linkedinURL: "https://linkedin.com/in/ada" },
        { domain: "example.com", fullName: "Ada Lovelace", xURL: "https://x.com/ada" },
        { email: "ada@example.com", fullName: "Ada Lovelace" },
      ].map((seed) =>
        backend.fetch(request("/v1/research", research({ seed }), { key: tenantAKey }))
      )
    )
    for (const response of seedResponses) {
      expect(response.status).toBe(200)
    }
    await expectSafe4xx(
      await backend.fetch(request("/v1/unknown", research(), { key: tenantAKey })),
      404
    )
    await expectSafe4xx(
      await backend.fetch(
        rawRequest("/v1/research", JSON.stringify(research()), { method: "PUT" })
      ),
      404
    )
    await expectSafe4xx(await backend.fetch(rawRequest("/v1/research", "{bad-json")), 400)
    await expectSafe4xx(
      await backend.fetch(
        rawRequest("/v1/research", JSON.stringify(research()), { contentType: "text/plain" })
      ),
      415
    )
  })

  test("rejects catalog crossover fields, invalid custom questions, and both TTL bounds", async () => {
    const backend = await boot()
    const researchResponses = await Promise.all(
      [
        research({ person: ["phone"] }),
        research({ company: ["legalName"] }),
        research({ research: { "not-camel": "question" } }),
        research({ research: { sellsToSMB: " " } }),
        research({ ttl: "11h" }),
        research({ ttl: "366d" }),
      ].map((body) => backend.fetch(request("/v1/research", body, { key: tenantAKey })))
    )
    await Promise.all(researchResponses.map((response) => expectSafe4xx(response, 400)))
    const deepResponses = await Promise.all(
      [
        {
          company: [],
          deepResearch: {},
          person: ["title"],
          seed: { linkedinURL: "https://linkedin.com/in/ada" },
          ttl: "12h",
        },
        {
          company: ["name"],
          deepResearch: {},
          person: [],
          seed: { linkedinURL: "https://linkedin.com/in/ada" },
          ttl: "12h",
        },
      ].map((body) => backend.fetch(request("/v1/deepResearch", body, { key: tenantAKey })))
    )
    await Promise.all(deepResponses.map((response) => expectSafe4xx(response, 400)))
  })
})

describe("AUTH-001 capability keys and tenant isolation", () => {
  test("authenticates only configured capability keys and applies publishable origin policy", async () => {
    const backend = await boot()
    await expectSafe4xx(await backend.fetch(request("/v1/research", research())), 401)
    await expectSafe4xx(
      await backend.fetch(request("/v1/research", research(), { key: "pk_test_unknown" })),
      401
    )
    await expectSafe4xx(
      await backend.fetch(
        request("/v1/research", research(), {
          headers: { origin: "https://attacker.test" },
          key: tenantAKey,
        })
      ),
      403
    )
    await expectSafe4xx(
      await backend.fetch(request("/v1/research", research(), { key: tenantAKey, origin: null })),
      403
    )
    const secretResponse = await backend.fetch(
      request("/v1/research", research(), { key: tenantBKey })
    )
    expect(secretResponse.status).toBe(200)
    const allowedResponse = await backend.fetch(
      request("/v1/research", research(), {
        headers: { origin: "https://app.tenant-a.test" },
        key: tenantAKey,
      })
    )
    expect(allowedResponse.status).toBe(200)
  })
})

describe("HASH-001 canonical HMAC identity", () => {
  test("normalizes equivalent values and includes tenant, route, and TTL in the HMAC identity", async () => {
    const backend = await boot()
    const first = await json(
      await backend.fetch(request("/v1/research", research(), { key: tenantAKey }))
    )
    const equivalent = await json(
      await backend.fetch(
        request(
          "/v1/research",
          research({
            seed: {
              domain: " example.com ",
              fullName: "Ada Lovelace",
              xURL: "https://x.com/ada",
            },
          }),
          { key: tenantAKey }
        )
      )
    )
    const reorderedConfig = await json(
      await backend.fetch(
        request(
          "/v1/research",
          {
            company: ["domain", "name"],
            person: ["linkedin", "title"],
            research: { sellsToSMB: "Who does this company sell to?" },
            seed: {
              domain: "example.com",
              fullName: "Ada Lovelace",
              xURL: "https://x.com/ada",
            },
            ttl: "24h",
          },
          { key: tenantAKey }
        )
      )
    )
    const differentTTL = await json(
      await backend.fetch(request("/v1/research", research({ ttl: "25h" }), { key: tenantAKey }))
    )
    const otherTenant = await json(
      await backend.fetch(request("/v1/research", research(), { key: tenantBKey }))
    )
    const differentRouteResponse = await backend.fetch(
      request(
        "/v1/deepResearch",
        {
          company: ["legalName"],
          deepResearch: { doesUseXero: "Does it use Xero?" },
          person: ["phone"],
          seed: { domain: "example.com", fullName: "Ada Lovelace", xURL: "https://x.com/ada" },
          ttl: "24h",
        },
        { key: tenantAKey }
      )
    )
    expect(differentRouteResponse.status).toBe(200)
    const differentRoute = await json(differentRouteResponse)
    expect(differentRoute.hash).toBeDefined()

    expect(equivalent.hash).toBe(first.hash)
    expect(reorderedConfig.hash).toBe(first.hash)
    expect(differentTTL.hash).not.toBe(first.hash)
    expect(otherTenant.hash).not.toBe(first.hash)
    expect(differentRoute.hash).not.toBe(first.hash)
    expect(first.hash).toBe(
      canonicalHmac(
        "tenant-a",
        "/v1/research",
        {
          domain: "example.com",
          fullName: "Ada Lovelace",
          xURL: "https://x.com/ada",
        },
        {
          company: ["domain", "name"],
          person: ["linkedin", "title"],
          research: { sellsToSMB: "Who does this company sell to?" },
          ttl: "24h",
        }
      )
    )
  })

  test("orders distinct NFC and NFD context keys by code unit", async () => {
    const backend = await boot()
    const decomposed = "e\u0301"
    const composed = decomposed.normalize("NFC")
    const firstContext = Object.fromEntries([
      [composed, "composed"],
      [decomposed, "decomposed"],
    ])
    const reversedContext = Object.fromEntries([
      [decomposed, "decomposed"],
      [composed, "composed"],
    ])

    const [first, reversed] = await Promise.all(
      [firstContext, reversedContext].map(async (context) =>
        json(
          await backend.fetch(
            request(
              "/v1/research",
              research({
                seed: {
                  context,
                  domain: "example.com",
                  fullName: "Ada Lovelace",
                  xURL: "https://x.com/ada",
                },
              }),
              { key: tenantAKey }
            )
          )
        )
      )
    )

    expect(composed).not.toBe(decomposed)
    expect(decomposed < composed).toBe(true)
    expect(reversed.hash).toBe(first.hash)
    expect(backend.inspect().runsStarted).toBe(1)
  })
})

describe("RUN-001 idempotent and concurrent orchestration", () => {
  test("uses one run for equivalent simultaneous posts", async () => {
    const backend = await boot()
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        backend.fetch(request("/v1/research", research(), { key: tenantAKey }))
      )
    )
    const bodies = await Promise.all(responses.map(json))
    expect(new Set(bodies.map((body) => body.hash)).size).toBe(1)
    expect(backend.inspect().runsStarted).toBe(1)
  })

  test("attaches equivalent JSON and SSE requests to one underlying run", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })
    const jsonResponse = await backend.fetch(
      request("/v1/research", research(), { key: tenantAKey })
    )
    const streamResponse = await backend.fetch(
      request("/v1/research", research(), { accept: "text/event-stream", key: tenantAKey })
    )
    expect(jsonResponse.status).toBe(200)
    expect(streamResponse.status).toBe(200)
    expect(backend.inspect().runsStarted).toBe(1)
  })
})

describe("SSE-001 snapshots, events, replay, and disconnect", () => {
  test("starts pending, settles fields independently, replays only missed indexed events, and completes once", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })
    const stream = await backend.fetch(
      request("/v1/research", research(), { accept: "text/event-stream", key: tenantAKey })
    )
    expect(stream.status).toBe(200)
    const initial = await backend.nextSSE(stream)
    expect(initial.id).toBe("0")
    expect(initial.event).toBe("snapshot")
    expect(initial.data.status).toBe("pending")
    expect(initial.data.data.person.linkedin.status).toBe("pending")
    expect(initial.data.data.person.title.status).toBe("pending")
    expect(initial.data.data.company.domain.status).toBe("pending")
    expect(initial.data.data.company.name.status).toBe("pending")
    expect(initial.data.data.sellsToSMB.status).toBe("pending")

    await backend.settle("company.domain", { status: "resolved", value: "example.com" })
    const domain = await backend.nextSSE(stream)
    expect(domain).toMatchObject({
      data: { path: "company.domain", status: "resolved" },
      event: "field",
      id: "1",
    })
    await backend.disconnect(stream)
    expect(backend.inspect().runsCancelled).toBe(0)

    await backend.settle("person.linkedin", {
      status: "resolved",
      value: "https://linkedin.com/in/ada",
    })
    const resumed = await backend.fetch(
      request("/v1/research", research(), {
        accept: "text/event-stream",
        headers: { "last-event-id": "1" },
        key: tenantAKey,
      })
    )
    const resumedFirst = await backend.nextSSE(resumed)
    expect(resumedFirst).toMatchObject({
      data: { path: "person.linkedin", value: "https://linkedin.com/in/ada" },
      event: "field",
      id: "2",
    })
    await backend.settleAll()
    const events = [resumedFirst, ...(await backend.collectSSE(resumed))]
    expect(events.map((event) => event.id)).toEqual(events.map((_, index) => String(index + 2)))
    expect(
      events.filter((event) => event.event === "field").map((event) => event.data.path)
    ).toEqual(["person.linkedin", "person.title", "company.name", "sellsToSMB"])
    expect(events.filter((event) => event.event === "complete")).toHaveLength(1)
    expect(events.at(-1)?.event).toBe("complete")
  })
})

describe("TERM-001 terminal states, gates, and timeouts", () => {
  test("skips phone for consumer/no-email without provider work", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })
    const consumer = await json(
      await backend.fetch(
        request(
          "/v1/deepResearch",
          {
            company: [],
            deepResearch: {},
            person: ["phone"],
            seed: { email: "ada@gmail.com", fullName: "Ada" },
            ttl: "12h",
          },
          { key: tenantAKey }
        )
      )
    )
    expect(consumer.data.person.phone).toEqual({ reason: "consumerEmail", status: "skipped" })
    expect(backend.inspect().providerCalls["person.phone"]).toBe(0)
  })

  test("converts identify failure and per-field timeout to terminal notFound states", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })
    const response = await json(
      await backend.fetch(request("/v1/research", research(), { key: tenantAKey }))
    )
    await backend.settleIdentify({ reason: "identityFailed", status: "notFound" })
    const failedSnapshot = await backend.snapshot(hashOf(response))
    expect(failedSnapshot.data.company.name).toEqual({
      reason: "identityFailed",
      status: "notFound",
    })
    const timeoutRun = await json(
      await backend.fetch(request("/v1/research", research({ ttl: "26h" }), { key: tenantAKey }))
    )
    await backend.timeout("company.name")
    const timeoutSnapshot = await backend.snapshot(hashOf(timeoutRun))
    expect(timeoutSnapshot.data.company.name).toEqual({
      reason: "timeout",
      status: "notFound",
    })
  })

  test("starts dependent work when identify settles, and leaves no pending fields after identify failure", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })
    const resolvedRun = await json(
      await backend.fetch(request("/v1/research", research(), { key: tenantAKey }))
    )
    await backend.settle("person.linkedin", {
      status: "resolved",
      value: "https://linkedin.com/in/ada",
    })
    expect(backend.inspect().providerCalls["person.title"]).toBe(1)

    const failedRun = await json(
      await backend.fetch(request("/v1/research", research({ ttl: "25h" }), { key: tenantAKey }))
    )
    await backend.settleIdentify({ reason: "timeout", status: "notFound" })
    const [resolvedSnapshot, failedSnapshot] = await Promise.all([
      backend.snapshot(hashOf(resolvedRun)),
      backend.snapshot(hashOf(failedRun)),
    ])
    expect(resolvedSnapshot.status).toBe("complete")
    expect(failedSnapshot.status).toBe("complete")
  })

  test("keeps the resolved person branch alive when company identity times out", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })
    const run = await json(
      await backend.fetch(request("/v1/research", research(), { key: tenantAKey }))
    )
    await backend.settle("person.linkedin", {
      status: "resolved",
      value: "https://linkedin.com/in/ada",
    })
    await backend.timeout("company.domain")

    const duringTimeout = await backend.snapshot(hashOf(run))
    expect(duringTimeout.status).toBe("pending")
    expect(duringTimeout.data.person.title).toEqual({ status: "pending" })
    expect(backend.inspect().providerCalls["person.title"]).toBe(1)
    expect(duringTimeout.data.company.name).toEqual({
      reason: "identityFailed",
      status: "notFound",
    })
    expect(duringTimeout.data.sellsToSMB).toEqual({
      reason: "identityFailed",
      status: "notFound",
    })

    await backend.settle("person.title", { status: "resolved", value: "Analyst" })
    const complete = await backend.snapshot(hashOf(run))
    expect(complete.status).toBe("complete")
  })

  test("does not let settlement controls bypass identity gates", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })
    const created = await json(
      await backend.fetch(
        request(
          "/v1/research",
          research({
            company: ["name", "description"],
            person: [],
            research: {},
            seed: { fullName: "Ada Lovelace", xURL: "https://x.com/ada" },
          }),
          { key: tenantAKey }
        )
      )
    )

    await backend.settle("company.name", { status: "resolved", value: "Premature Company" })
    await backend.timeout("company.description")
    await backend.settleAll()
    const beforeIdentity = backend.snapshot(hashOf(created))
    expect(beforeIdentity.data.company.name).toEqual({ status: "pending" })
    expect(beforeIdentity.data.company.description).toEqual({ status: "pending" })
    expect(backend.inspect().providerCalls["company.name"] ?? 0).toBe(0)
    expect(backend.inspect().providerCalls["company.description"] ?? 0).toBe(0)

    await backend.settleIdentify({ reason: "identityFailed", status: "notFound" })
    const afterIdentity = backend.snapshot(hashOf(created))
    expect(afterIdentity.status).toBe("complete")
    expect(afterIdentity.data.company.name).toEqual({
      reason: "identityFailed",
      status: "notFound",
    })
    expect(afterIdentity.data.company.description).toEqual({
      reason: "identityFailed",
      status: "notFound",
    })
    expect(backend.inspect().providerCalls["company.name"] ?? 0).toBe(0)
    expect(backend.inspect().providerCalls["company.description"] ?? 0).toBe(0)
  })

  test("normalizes invalid built-in provider values without rejecting custom JSON", async () => {
    const backend = await boot({
      scenario: {
        fields: {
          "company.name": { status: "resolved", value: 42 },
          sellsToSMB: { status: "resolved", value: { answer: true } },
        },
      },
    })

    const body = await json(
      await backend.fetch(request("/v1/research", research(), { key: tenantAKey }))
    )

    expect(SonarResponse.safeParse(body).success).toBe(true)
    expect(body.status).toBe("complete")
    expect(body.data.company.name).toEqual({ reason: "providerEmpty", status: "notFound" })
    expect(body.data.sellsToSMB).toMatchObject({
      status: "resolved",
      value: { answer: true },
    })
    expect(backend.inspect().cachedFields["company.name"]).toEqual({
      reason: "providerEmpty",
      status: "notFound",
    })
    expect(
      Object.values(body.data.person).some((field) => field.status === "pending") ||
        Object.values(body.data.company).some((field) => field.status === "pending") ||
        body.data.sellsToSMB.status === "pending"
    ).toBe(false)
  })
})

describe("CACHE-001 cache boundaries and lifetimes", () => {
  test("uses field resolvedAt, rather than cache-write time, to judge request TTL freshness", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })
    await backend.cacheField(
      "company.name",
      {
        confidence: 1,
        resolvedAt: "2026-08-25T00:00:00.000Z",
        sources: ["https://example.test"],
        status: "resolved",
        value: "stale company",
      },
      { scope: "builtIn" }
    )
    const response = await json(
      await backend.fetch(request("/v1/research", research({ ttl: "12h" }), { key: tenantAKey }))
    )
    expect(response.data.company.name.status).toBe("pending")
    expect(backend.inspect().providerCalls["company.name"]).toBe(1)
  })

  test("shares positive built-ins across tenants, isolates custom answers, bounds negative entries, and never caches skipped fields", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })
    const a = await json(
      await backend.fetch(request("/v1/research", research(), { key: tenantAKey }))
    )
    await backend.settleAll()
    const sameTenant = await json(
      await backend.fetch(request("/v1/research", research({ ttl: "25h" }), { key: tenantAKey }))
    )
    expect(backend.inspect().providerCalls["company.name"]).toBe(1)
    expect(backend.inspect().providerCalls.sellsToSMB).toBe(1)
    expect(sameTenant.status).toBe("complete")
    expect(sameTenant.data.company.name).toMatchObject({
      status: "resolved",
      value: "resolved company.name",
    })
    expect(sameTenant.data.sellsToSMB).toMatchObject({ status: "resolved", value: true })
    await backend.fetch(request("/v1/research", research({ ttl: "26h" }), { key: tenantBKey }))
    expect(backend.inspect().providerCalls["company.name"]).toBe(1)
    expect(backend.inspect().providerCalls.sellsToSMB).toBe(2)

    const notFound = { reason: "providerEmpty", status: "notFound" }
    await backend.cacheField("company.name", notFound, { scope: "builtIn" })
    await backend.advanceBy(5 * 60 * 1000 - 1)
    await backend.fetch(request("/v1/research", research({ ttl: "27h" }), { key: tenantAKey }))
    expect(backend.inspect().providerCalls["company.name"]).toBe(1)
    await backend.advanceBy(1)
    await backend.fetch(request("/v1/research", research({ ttl: "28h" }), { key: tenantAKey }))
    expect(backend.inspect().providerCalls["company.name"]).toBe(2)

    const skipped = await json(
      await backend.fetch(
        request(
          "/v1/deepResearch",
          {
            company: [],
            deepResearch: {},
            person: ["phone"],
            seed: { email: "ada@gmail.com", fullName: "Ada" },
            ttl: "12h",
          },
          { key: tenantAKey }
        )
      )
    )
    expect(skipped.data.person.phone.status).toBe("skipped")
    expect(backend.inspect().cachedFields["person.phone"]).toBeUndefined()
    expect(a.hash).toBeDefined()
  })
})

describe("READ-001 public snapshots and safe errors", () => {
  test("returns JSON snapshots, makes known cross-tenant hashes look absent, and never exposes internals", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })
    const created = await json(
      await backend.fetch(request("/v1/research", research(), { key: tenantAKey }))
    )
    await backend.settleAll()
    const hash = hashOf(created)
    const own = await backend.fetch(request(`/v1/${hash}`, undefined, { key: tenantAKey }))
    const ownSnapshot = await json(own.clone())
    expect(ownSnapshot.status).toBe("complete")
    const foreign = await backend.fetch(request(`/v1/${hash}`, undefined, { key: tenantBKey }))
    const missing = await backend.fetch(
      request("/v1/does-not-exist", undefined, { key: tenantBKey })
    )
    expect(foreign.status).toBe(404)
    expect(await foreign.text()).toBe(await missing.text())
    const body = await own.text()
    for (const forbidden of ["provider", "runId", "cache", "layer", "secret", "workflow"]) {
      expect(body.toLowerCase()).not.toContain(forbidden)
    }
  })
})

describe("LAYER-001 deterministic Effect Layers and finalizers", () => {
  test("keeps runs alive after subscription finalization and closes every test Layer scope", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })
    const stream = await backend.fetch(
      request("/v1/research", research(), { accept: "text/event-stream", key: tenantAKey })
    )
    await backend.nextSSE(stream)
    await backend.disconnect(stream)
    expect(backend.inspect().subscriptionFinalizers).toBe(1)
    expect(backend.inspect().runsCancelled).toBe(0)
    await backend.settleAll()
    expect(backend.inspect().networkCalls).toBe(0)
    const finalizers = backend.inspect().subscriptionFinalizers
    await backend.close()
    await backend.close()
    expect(backend.inspect().subscriptionFinalizers).toBe(finalizers)
    expect(backend.inspect().openScopes).toBe(0)
  })

  test("closes an unlocked active response once and remains idempotent", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })
    const stream = await backend.fetch(
      request("/v1/research", research(), { accept: "text/event-stream", key: tenantAKey })
    )
    if (!stream.body) {
      throw new Error("SSE response has no body")
    }

    await expect(backend.close()).resolves.toBeUndefined()
    await expect(backend.close()).resolves.toBeUndefined()
    expect(backend.inspect().subscriptionFinalizers).toBe(1)
    expect(backend.inspect().runsCancelled).toBe(0)

    await expect(stream.body.cancel()).resolves.toBeUndefined()
    expect(backend.inspect().subscriptionFinalizers).toBe(1)
    expect(backend.inspect().openScopes).toBe(0)
  })

  test("closes through the server when a consumer has locked the response body", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })
    const created = await json(
      await backend.fetch(request("/v1/research", research(), { key: tenantAKey }))
    )
    const stream = await backend.fetch(
      request("/v1/research", research(), { accept: "text/event-stream", key: tenantAKey })
    )
    if (!stream.body) {
      throw new Error("SSE response has no body")
    }
    const reader = stream.body.getReader()
    const initial = await reader.read()
    expect(initial.done).toBe(false)
    const pendingRead = reader.read()

    await expect(backend.close()).resolves.toBeUndefined()
    expect(await pendingRead).toEqual({ done: true, value: undefined })
    expect(backend.inspect().subscriptionFinalizers).toBe(1)
    expect(backend.inspect().runsCancelled).toBe(0)

    await expect(reader.cancel()).resolves.toBeUndefined()
    await expect(backend.close()).resolves.toBeUndefined()
    expect(backend.inspect().subscriptionFinalizers).toBe(1)
    await backend.settleAll()
    const completed = backend.snapshot(hashOf(created))
    expect(completed.status).toBe("complete")
    expect(backend.inspect().openScopes).toBe(0)
  })

  test("keeps provider-call probes numeric for prototype-named custom answers", async () => {
    const backend = await boot({ scenario: { fields: {} } })
    const body = await json(
      await backend.fetch(
        request(
          "/v1/research",
          research({
            company: [],
            person: [],
            research: { constructor: "What was constructed?" },
          }),
          { key: tenantAKey }
        )
      )
    )

    expect(body.data.constructor).toMatchObject({ status: "resolved", value: true })
    const { providerCalls } = backend.inspect()
    const { constructor: constructorCalls } = providerCalls
    expect(Object.hasOwn(providerCalls, "constructor")).toBe(true)
    expect(constructorCalls).toBe(1)
    expect(Object.keys(providerCalls)).toEqual(["constructor"])
  })

  test("keeps built-in and custom provider-call probe keys unambiguous", async () => {
    const backend = await boot()
    const body = await json(
      await backend.fetch(
        request(
          "/v1/research",
          research({
            company: ["name"],
            person: [],
            research: { name: "What name should customers use?" },
          }),
          { key: tenantAKey }
        )
      )
    )

    expect(body.data.company.name).toMatchObject({ status: "resolved" })
    expect(body.data.name).toMatchObject({ status: "resolved" })
    const { providerCalls } = backend.inspect()
    expect(providerCalls).toEqual({ "company.name": 1, name: 1 })
  })
})

describe("ROOT-001 production root exports", () => {
  test("derives the Fetch handler from the root Effect Layer, not a test-only handler", async () => {
    const backend = await boot({ scenario: { autoSettle: false } })

    expect(SonarBackend).toMatchObject({ key: expect.any(String), pipe: expect.any(Function) })
    expect(layer).toEqual(expect.any(Function))
    expect(createSonarHandler).toEqual(expect.any(Function))

    const handler = await createSonarHandler(layer(backend.layerInput))
    const response = await handler(request("/v1/research", research(), { key: tenantAKey }))

    expect(response.status).toBe(200)
    const snapshot = await json(response)
    expect(snapshot.status).toBe("pending")
    expect(backend.inspect().runsStarted).toBe(1)
  })
})
