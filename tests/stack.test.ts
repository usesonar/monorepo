import { afterEach, beforeEach, describe, expect, test } from "bun:test"
// oxlint-disable sort-keys -- Cross-stack fixtures assert the public person-before-company and built-in-before-custom wire order.

import {
  compileResearchRequest,
  createDeepResearch,
  createResearch,
  createSonar,
  retrieveSonar,
} from "@usesonar/api"
import { createBackendTestHarness } from "@usesonar/backend/testing"
import { SonarClient, layerFromAPI } from "@usesonar/effect"
import type { SonarClientError } from "@usesonar/effect"
import { researchSonar } from "@usesonar/eve"
import { SonarProvider, useSonar } from "@usesonar/react"
import { Effect, Stream } from "effect"
import { act, createElement } from "react"

import { installHappyDOM, mountTree } from "../packages/react/test/harness"

const serverSecret = "stack-verifier-server-secret"
const publishableKey = "pk_test_stack_tenant"

const goldenSeed = {
  domain: "analyticalengines.example",
  fullName: "Ada Lovelace",
  xURL: "https://x.com/ada",
} as const

const goldenConfig = {
  company: {
    name: true,
    research: {
      sellsToSMB: {
        description: "Does this company sell to small and medium businesses?",
        type: "boolean",
      },
    },
  },
  person: {
    research: {
      isTechnical: {
        description: "Does this person have a technical background?",
        type: "boolean",
      },
    },
    title: true,
  },
  ttl: "12h",
} as const

const goldenRequest = {
  seed: goldenSeed,
  ...goldenConfig,
} as const

const goldenWireRequest = compileResearchRequest(goldenRequest)

const goldenDeepRequest = {
  company: {
    deepResearch: { ownership: "Describe the company's ownership structure." },
    legalName: true,
  },
  person: {
    deepResearch: { biography: "Write a sourced professional biography." },
    phone: true,
  },
  seed: { ...goldenSeed, email: "ada@analyticalengines.example" },
  ttl: "12h",
} as const

type GoldenField = {
  readonly status: "pending" | "resolved" | "notFound" | "skipped"
}

type GoldenData = {
  readonly company: {
    readonly name: GoldenField
    readonly research: { readonly sellsToSMB: GoldenField }
  }
  readonly person: {
    readonly research: { readonly isTechnical: GoldenField }
    readonly title: GoldenField
  }
}

type GoldenDeepData = {
  readonly company: {
    readonly deepResearch: { readonly ownership: GoldenField }
    readonly legalName: GoldenField
  }
  readonly person: {
    readonly deepResearch: { readonly biography: GoldenField }
    readonly phone: GoldenField
  }
}

type GoldenSnapshot = {
  readonly data: GoldenData
  readonly status: "pending" | "complete"
}

type GoldenResponse = GoldenSnapshot & { readonly hash: string }

type PackageManifest = {
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly name?: string
  readonly private?: boolean
}

type RootManifest = {
  readonly workspaces?: readonly string[]
  readonly scripts?: {
    readonly build?: string
    readonly "check:packages"?: string
  }
}

type TypeScriptConfig = {
  readonly extends?: string
  readonly include?: readonly string[]
}

type ResearchBody = Omit<typeof goldenWireRequest, "ttl"> & { readonly ttl: string }

type RequestBody = ResearchBody | typeof goldenDeepRequest | undefined

type HashEnvelope = { readonly hash?: string }

type CapturedResult = {
  data: GoldenData | null
  error: SonarClientError | null
  loading: boolean
  resolve: (seed: typeof goldenSeed) => void
  status: "pending" | "complete" | undefined
}

const parseManifest = <T>(source: string): T =>
  // SAFETY: the static verifier reads repository-owned JSON manifests and checks their required fields immediately after parsing.
  JSON.parse(source) as T

const resolvedTitle = {
  confidence: 0.98,
  resolvedAt: "2026-08-26T12:00:00.000Z",
  sources: ["https://example.test/ada"],
  status: "resolved",
  value: "Mathematician",
} as const

const resolvedCompanyName = {
  confidence: 0.9,
  resolvedAt: "2026-08-26T12:00:01.000Z",
  sources: ["https://example.test"],
  status: "resolved",
  value: "Analytical Engines",
} as const

const resolvedCustom = {
  confidence: 0.82,
  resolvedAt: "2026-08-26T12:00:02.000Z",
  sources: ["https://example.test/customers"],
  status: "resolved",
  value: true,
} as const

const resolvedPersonCustom = {
  confidence: 0.86,
  resolvedAt: "2026-08-26T12:00:03.000Z",
  sources: ["https://example.test/ada/technical-work"],
  status: "resolved",
  value: true,
} as const

const resolvedPhone = {
  confidence: 0.71,
  resolvedAt: "2026-08-26T12:00:04.000Z",
  sources: ["https://example.test/ada/contact"],
  status: "resolved",
  value: "+1-555-0100",
} as const

const resolvedLegalName = {
  confidence: 0.94,
  resolvedAt: "2026-08-26T12:00:05.000Z",
  sources: ["https://example.test/company-registry"],
  status: "resolved",
  value: "Analytical Engines, Inc.",
} as const

const resolvedBiography = {
  confidence: 0.79,
  resolvedAt: "2026-08-26T12:00:06.000Z",
  sources: ["https://example.test/ada/biography"],
  status: "resolved",
  value: "Ada Lovelace developed foundational work in computing.",
} as const

const resolvedOwnership = {
  confidence: 0.76,
  resolvedAt: "2026-08-26T12:00:07.000Z",
  sources: ["https://example.test/company-registry/ownership"],
  status: "resolved",
  value: "Privately held.",
} as const

const expectedKeys = ["person", "company"]

const forbiddenMetadata = ["hash", "provider", "cache", "runId", "workflow", "jobId", "secret"]

const privateProviderDetails = ["core-fast", "firecrawl", "medium", "parallel", "sixtyfour"]

const poisonedEnvironmentKeys = [
  "FIRECRAWL_API_KEY",
  "OPENAI_API_KEY",
  "PARALLEL_API_KEY",
  "SIXTYFOUR_API_KEY",
  "SONAR_BASE_URL",
  "SONAR_SECRET_KEY",
  "VERCEL_TOKEN",
] as const

const request = (
  path: string,
  body: RequestBody,
  options: { accept?: string; key?: string; origin?: string } = {}
) => {
  const headers = new Headers({ accept: options.accept ?? "application/json" })
  if (body !== undefined) {
    headers.set("content-type", "application/json")
  }
  if (options.key !== undefined) {
    headers.set("authorization", `Bearer ${options.key}`)
  }
  if (options.origin !== undefined) {
    headers.set("origin", options.origin)
  }
  return new Request(`https://stack.test${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method: body === undefined ? "GET" : "POST",
  })
}

const json = async (response: Response) =>
  // SAFETY: the test only inspects JSON response envelopes after the public helper has decoded them.
  (await response.json()) as GoldenResponse

const jsonHash = async (response: Response) => {
  // SAFETY: route hash checks only need the validated response envelope's public hash.
  const body = (await response.json()) as HashEnvelope
  if (body.hash === undefined) {
    throw new TypeError("Expected a response hash")
  }
  return body.hash
}

const drainMicrotasks = async () => {
  await Promise.all(Array.from({ length: 8 }))
}

const expectGoldenData = (data: GoldenData | undefined) => {
  expect(data).toBeObject()
  if (data === undefined) {
    throw new Error("Expected a public Sonar data tree")
  }
  expect(Object.keys(data)).toEqual(expectedKeys)
  expect(data).toMatchObject({
    company: {
      name: { status: "resolved" },
      research: { sellsToSMB: { status: "resolved" } },
    },
    person: {
      research: { isTechnical: { status: "resolved" } },
      title: { status: "resolved" },
    },
  })
}

const expectGoldenDeepData = (data: GoldenDeepData | undefined) => {
  expect(data).toEqual({
    person: {
      phone: resolvedPhone,
      deepResearch: { biography: resolvedBiography },
    },
    company: {
      legalName: resolvedLegalName,
      deepResearch: { ownership: resolvedOwnership },
    },
  })
}

const expectNoMetadata = (
  value: GoldenData | GoldenDeepData | GoldenSnapshot | undefined | null
) => {
  const serialized = JSON.stringify(value)
  for (const forbidden of forbiddenMetadata) {
    expect(serialized).not.toContain(`"${forbidden}"`)
  }
  const normalized = serialized.toLowerCase()
  for (const detail of privateProviderDetails) {
    expect(normalized).not.toContain(detail.toLowerCase())
  }
}

let backend: Awaited<ReturnType<typeof createBackendTestHarness>> | undefined

const ambientFetch = globalThis.fetch
const ambientEnvironment = new Map<string, string | undefined>()

beforeEach(() => {
  globalThis.fetch = () => {
    throw new Error("ambient fetch is forbidden by the cross-stack verifier")
  }
  for (const key of poisonedEnvironmentKeys) {
    ambientEnvironment.set(key, process.env[key])
    process.env[key] = "__STACK_VERIFIER_POISON__"
  }
})

const boot = async (options: Parameters<typeof createBackendTestHarness>[0] = {}) => {
  backend = await createBackendTestHarness({
    scenario: { autoSettle: false },
    serverSecret,
    tenants: [
      {
        allowedOrigins: ["https://stack.test"],
        capability: "publishable",
        key: publishableKey,
        tenantId: "tenant-stack",
      },
    ],
    ...options,
  })
  return backend
}

const stackClient = (handler: (request: Request) => Promise<Response>) =>
  createSonar({
    baseURL: "https://stack.test",
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const outgoing = input instanceof Request ? input : new Request(input, init)
      return await handler(outgoing)
    },
    headers: { origin: "https://stack.test" },
    publishableKey,
  })

const runFreshFingerprint = () => {
  const result = Bun.spawnSync(["bun", "tests/stack-fingerprint.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      PATH: process.env.PATH ?? "",
      SONAR_STACK_FINGERPRINT_MODE: "1",
    },
  })
  expect(result.exitCode).toBe(0)
  return new TextDecoder().decode(result.stdout).trim()
}

afterEach(async () => {
  globalThis.fetch = ambientFetch
  for (const key of poisonedEnvironmentKeys) {
    const value = ambientEnvironment.get(key)
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key)
    } else {
      process.env[key] = value
    }
  }
  ambientEnvironment.clear()
  await backend?.close()
  backend = undefined
})

describe("STK-001 through STK-003 golden backend, API, and Effect path", () => {
  test("preserves the request, pending snapshot, indexed events, and completed data", async () => {
    const harness = await boot()
    const calls: Request[] = []
    const client = stackClient(async (outgoing) => {
      calls.push(outgoing.clone())
      return await harness.fetch(outgoing)
    })

    const pending = await createResearch(client, goldenRequest)
    expect(pending.status).toBe("pending")
    expect(Object.keys(pending.data)).toEqual(expectedKeys)
    expect(pending.data.person.title).toEqual({ status: "pending" })
    expect(pending.data.person.research.isTechnical).toEqual({ status: "pending" })
    expect(pending.data.company.name).toEqual({ status: "pending" })
    expect(pending.data.company.research.sellsToSMB).toEqual({ status: "pending" })
    expectNoMetadata(pending.data)
    expect(await calls[0]?.json()).toEqual(goldenWireRequest)

    const effectSnapshotsPromise = Effect.runPromise(
      SonarClient.use((service) => Stream.runCollect(service.research(goldenRequest))).pipe(
        Effect.provide(layerFromAPI(client))
      )
    )

    await harness.settleIdentify({ status: "resolved" })
    await harness.settle("person.title", resolvedTitle)
    await harness.settle("person.research.isTechnical", resolvedPersonCustom)
    await harness.settle("company.name", resolvedCompanyName)
    await harness.settle("company.research.sellsToSMB", resolvedCustom)

    const effectSnapshots = [...(await effectSnapshotsPromise)]
    const [firstEffectSnapshot] = effectSnapshots
    const finalEffectSnapshot = effectSnapshots.at(-1)

    expect(firstEffectSnapshot?.status).toBe("pending")
    expect(firstEffectSnapshot?.data).toEqual({
      person: {
        title: { status: "pending" },
        research: { isTechnical: { status: "pending" } },
      },
      company: {
        name: { status: "pending" },
        research: { sellsToSMB: { status: "pending" } },
      },
    })
    expect(finalEffectSnapshot?.status).toBe("complete")
    expectGoldenData(finalEffectSnapshot?.data)
    expect(Object.keys(finalEffectSnapshot?.data ?? {})).toEqual(expectedKeys)
    expectNoMetadata(finalEffectSnapshot?.data)
    if (!finalEffectSnapshot) {
      throw new Error("Expected a final Effect snapshot")
    }
    expect("hash" in finalEffectSnapshot).toBe(false)

    const retrieved = await retrieveSonar(client, pending.hash)
    expect(retrieved.hash).toBe(pending.hash)
    expect(retrieved.status).toBe("complete")
    expect(retrieved.data).toEqual(finalEffectSnapshot?.data)
    expect(calls).toHaveLength(3)
    expect(await calls[1]?.json()).toEqual(goldenWireRequest)
    expect(calls[2]?.method).toBe("GET")
    expect(harness.inspect().runsStarted).toBe(1)
  })

  test("preserves entity-owned deep-research questions and results", async () => {
    const harness = await boot()
    const calls: Request[] = []
    const client = stackClient(async (outgoing) => {
      calls.push(outgoing.clone())
      return await harness.fetch(outgoing)
    })

    const pending = await createDeepResearch(client, goldenDeepRequest)
    expect(pending.status).toBe("pending")
    expect(pending.data).toEqual({
      person: {
        phone: { status: "pending" },
        deepResearch: { biography: { status: "pending" } },
      },
      company: {
        legalName: { status: "pending" },
        deepResearch: { ownership: { status: "pending" } },
      },
    })
    expectNoMetadata(pending.data)
    expect(await calls[0]?.json()).toEqual(goldenDeepRequest)

    const snapshotsPromise = Effect.runPromise(
      SonarClient.use((service) => Stream.runCollect(service.deepResearch(goldenDeepRequest))).pipe(
        Effect.provide(layerFromAPI(client))
      )
    )

    await harness.settleIdentify({ status: "resolved" })
    await harness.settle("person.phone", resolvedPhone)
    await harness.settle("person.deepResearch.biography", resolvedBiography)
    await harness.settle("company.legalName", resolvedLegalName)
    await harness.settle("company.deepResearch.ownership", resolvedOwnership)

    const snapshots = [...(await snapshotsPromise)]
    const completed = snapshots.at(-1)
    expect(completed?.status).toBe("complete")
    expectGoldenDeepData(completed?.data)
    expectNoMetadata(completed?.data)
    if (!completed) {
      throw new Error("Expected a completed deep-research snapshot")
    }
    expect("hash" in completed).toBe(false)
    expect(calls).toHaveLength(2)
    expect(await calls[1]?.json()).toEqual(goldenDeepRequest)
    expect(harness.inspect().runsStarted).toBe(1)
  })

  test("reconnects the same raw API stream without duplicate or skipped indexed events", async () => {
    const harness = await boot()
    const calls: Request[] = []
    const client = stackClient(async (outgoing) => {
      calls.push(outgoing.clone())
      return await harness.fetch(outgoing)
    })

    const jsonResponse = await client.post("/v1/research", {
      headers: { accept: "application/json" },
      json: goldenWireRequest,
    })
    expect(jsonResponse.status).toBe(200)
    const stream = await client.post("/v1/research", {
      headers: { accept: "text/event-stream" },
      json: goldenWireRequest,
    })
    expect(stream.status).toBe(200)

    const snapshot = await harness.nextSSE(stream)
    expect(snapshot).toMatchObject({
      data: { data: { person: { title: { status: "pending" } } }, status: "pending" },
      event: "snapshot",
      id: "0",
    })

    await harness.settleIdentify({ status: "resolved" })
    const firstFieldPromise = harness.nextSSE(stream)
    await harness.settle("person.title", resolvedTitle)
    const firstField = await firstFieldPromise
    expect(firstField).toMatchObject({
      data: { path: "person.title", status: "resolved" },
      event: "field",
      id: "1",
    })
    await harness.disconnect(stream)

    const resumed = await client.post("/v1/research", {
      headers: { accept: "text/event-stream", "last-event-id": firstField.id },
      json: goldenWireRequest,
    })
    expect(resumed.status).toBe(200)
    const personCustomPromise = harness.nextSSE(resumed)
    await harness.settle("person.research.isTechnical", resolvedPersonCustom)
    const personCustom = await personCustomPromise
    expect(personCustom).toMatchObject({
      data: { path: "person.research.isTechnical", status: "resolved" },
      event: "field",
      id: "2",
    })

    const resumedFieldPromise = harness.nextSSE(resumed)
    await harness.settle("company.name", resolvedCompanyName)
    const resumedField = await resumedFieldPromise
    expect(resumedField).toMatchObject({
      data: { path: "company.name", status: "resolved" },
      event: "field",
      id: "3",
    })

    const customFieldPromise = harness.nextSSE(resumed)
    await harness.settle("company.research.sellsToSMB", resolvedCustom)
    const customField = await customFieldPromise
    expect(customField).toMatchObject({
      data: { path: "company.research.sellsToSMB", status: "resolved" },
      event: "field",
      id: "4",
    })
    const complete = await harness.nextSSE(resumed)
    expect(complete).toMatchObject({ event: "complete", id: "5" })

    const fieldEvents = [firstField, personCustom, resumedField, customField]
    expect(fieldEvents.map((event) => event.id)).toEqual(["1", "2", "3", "4"])
    expect(fieldEvents.map((event) => event.data.path)).toEqual([
      "person.title",
      "person.research.isTechnical",
      "company.name",
      "company.research.sellsToSMB",
    ])
    expect(new Set(fieldEvents.map((event) => event.id)).size).toBe(fieldEvents.length)
    expect(calls[2]?.headers.get("last-event-id")).toBe("1")
    expect(harness.inspect().runsStarted).toBe(1)
    expect(harness.inspect().runsCancelled).toBe(0)
  })
})

describe("STK-004 React adapter", () => {
  test("renders the same completed snapshot through SonarProvider and useSonar", async () => {
    const harness = await boot()
    const client = stackClient((outgoing) => harness.fetch(outgoing))
    const restoreDOM = installHappyDOM()
    const result: CapturedResult = {
      data: null,
      error: null,
      loading: false,
      resolve: () => {
        throw new Error("React hook has not rendered")
      },
      status: undefined,
    }

    const Probe = () => {
      Object.assign(result, useSonar(goldenConfig))
      return null
    }

    try {
      const tree = await mountTree(
        createElement(SonarProvider, { layer: layerFromAPI(client) }, createElement(Probe))
      )
      await act(async () => {
        result.resolve(goldenSeed)
        await drainMicrotasks()
      })
      expect(result.status).toBe("pending")
      expect(result.data).toMatchObject({
        company: {
          name: { status: "pending" },
          research: { sellsToSMB: { status: "pending" } },
        },
        person: {
          research: { isTechnical: { status: "pending" } },
          title: { status: "pending" },
        },
      })

      await harness.settleIdentify({ status: "resolved" })
      await harness.settle("person.title", resolvedTitle)
      await harness.settle("person.research.isTechnical", resolvedPersonCustom)
      await harness.settle("company.name", resolvedCompanyName)
      await harness.settle("company.research.sellsToSMB", resolvedCustom)

      await act(async () => {
        await drainMicrotasks()
      })
      expect(result.status).toBe("complete")
      expectGoldenData(result.data)
      expect(Object.keys(result.data ?? {})).toEqual(expectedKeys)
      expectNoMetadata(result.data)
      expect(result.error).toBeNull()
      await tree.unmount()
    } finally {
      restoreDOM()
    }
  })
})

describe("STK-005 Eve adapter", () => {
  test("streams the full snapshot and projects only resolved model fields", async () => {
    const harness = await boot()
    const client = stackClient((outgoing) => harness.fetch(outgoing))
    const tool = researchSonar(goldenConfig, {
      layer: layerFromAPI(client),
    })
    const execution = tool.execute(goldenSeed, {
      abortSignal: new AbortController().signal,
    })

    const snapshotsPromise = (async () => {
      const snapshots: GoldenSnapshot[] = []
      for await (const snapshot of execution) {
        snapshots.push(snapshot)
      }
      return snapshots
    })()

    await drainMicrotasks()
    await harness.settleIdentify({ status: "resolved" })
    await harness.settle("person.title", resolvedTitle)
    await harness.settle("person.research.isTechnical", resolvedPersonCustom)
    await harness.settle("company.name", resolvedCompanyName)
    await harness.settle("company.research.sellsToSMB", resolvedCustom)
    const snapshots = await snapshotsPromise

    expect(snapshots[0]).toMatchObject({
      data: {
        company: {
          name: { status: "pending" },
          research: { sellsToSMB: { status: "pending" } },
        },
        person: {
          research: { isTechnical: { status: "pending" } },
          title: { status: "pending" },
        },
      },
      status: "pending",
    })
    expect(snapshots.at(-1)).toMatchObject({ status: "complete" })
    const finalSnapshot = snapshots.at(-1)
    expectGoldenData(finalSnapshot?.data)
    expect(Object.keys(finalSnapshot?.data ?? {})).toEqual(expectedKeys)
    expectNoMetadata(finalSnapshot?.data)

    const projected = await tool.toModelOutput?.(finalSnapshot)
    expect(projected).toEqual({
      type: "json",
      value: {
        company: {
          name: { confidence: resolvedCompanyName.confidence, value: resolvedCompanyName.value },
          research: {
            sellsToSMB: {
              confidence: resolvedCustom.confidence,
              value: resolvedCustom.value,
            },
          },
        },
        person: {
          research: {
            isTechnical: {
              confidence: resolvedPersonCustom.confidence,
              value: resolvedPersonCustom.value,
            },
          },
          title: { confidence: resolvedTitle.confidence, value: resolvedTitle.value },
        },
      },
    })
    const serialized = JSON.stringify(projected)
    expect(Object.keys(projected?.value ?? {})).toEqual(expectedKeys)
    for (const forbidden of ["status", "sources", "resolvedAt", ...forbiddenMetadata]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})

describe("STK-006 tenant and identity boundaries", () => {
  test("keeps raw hashes tenant-scoped and adapters hash-free", async () => {
    const harness = await boot({
      tenants: [
        {
          allowedOrigins: ["https://stack.test"],
          capability: "publishable",
          key: publishableKey,
          tenantId: "tenant-stack",
        },
        {
          allowedOrigins: ["https://foreign.test"],
          capability: "publishable",
          key: "pk_test_foreign_tenant",
          tenantId: "tenant-foreign",
        },
      ],
    })
    const first = await harness.fetch(
      request("/v1/research", goldenWireRequest, {
        key: publishableKey,
        origin: "https://stack.test",
      })
    )
    const firstBody = await json(first)
    expect(firstBody.hash).toBeString()

    const foreignPost = await harness.fetch(
      request("/v1/research", goldenWireRequest, {
        key: "pk_test_foreign_tenant",
        origin: "https://foreign.test",
      })
    )
    const foreignHash = await jsonHash(foreignPost)
    expect(foreignHash).not.toBe(firstBody.hash)

    const differentTTL = await harness.fetch(
      request(
        "/v1/research",
        { ...goldenWireRequest, ttl: "24h" },
        { key: publishableKey, origin: "https://stack.test" }
      )
    )
    expect(await jsonHash(differentTTL)).not.toBe(firstBody.hash)

    const differentRoute = await harness.fetch(
      request("/v1/deepResearch", goldenDeepRequest, {
        key: publishableKey,
        origin: "https://stack.test",
      })
    )
    expect(await jsonHash(differentRoute)).not.toBe(firstBody.hash)

    const foreign = await harness.fetch(
      request(`/v1/${String(firstBody.hash)}`, undefined, {
        key: "pk_test_foreign_tenant",
        origin: "https://foreign.test",
      })
    )
    const missing = await harness.fetch(
      request("/v1/not-a-known-hash", undefined, {
        key: "pk_test_foreign_tenant",
        origin: "https://foreign.test",
      })
    )
    expect(foreign.status).toBe(404)
    expect(await foreign.text()).toBe(await missing.text())

    const normalized = await harness.fetch(
      request(
        "/v1/research",
        {
          ...goldenWireRequest,
          seed: {
            domain: goldenSeed.domain,
            fullName: " ADA LOVELACE ",
            xURL: goldenSeed.xURL,
          },
        },
        { key: publishableKey, origin: "https://stack.test" }
      )
    )
    const normalizedBody = await json(normalized)
    expect(normalizedBody.hash).toBe(firstBody.hash)

    const canonicalEquivalent = await harness.fetch(
      request(
        "/v1/research",
        {
          company: {
            name: true,
            research: { ...goldenWireRequest.company.research },
          },
          person: {
            research: { ...goldenWireRequest.person.research },
            title: true,
          },
          seed: {
            domain: goldenSeed.domain,
            fullName: goldenSeed.fullName,
            xURL: goldenSeed.xURL,
          },
          ttl: goldenConfig.ttl,
        },
        { key: publishableKey, origin: "https://stack.test" }
      )
    )
    expect(await jsonHash(canonicalEquivalent)).toBe(firstBody.hash)

    expect(harness.inspect().runsStarted).toBe(4)
  })
})

describe("STK-007 through STK-009 static workspace boundaries", () => {
  test("contains the selected public/private package graph", async () => {
    const rootPackage = parseManifest<RootManifest>(
      await Bun.file(new URL("../package.json", import.meta.url)).text()
    )
    expect(rootPackage.workspaces).toEqual(["apps/*", "packages/*"])
    const buildTypeScript = parseManifest<TypeScriptConfig>(
      await Bun.file(new URL("../tsconfig.build.json", import.meta.url)).text()
    )
    expect(buildTypeScript.extends).toBe("./tsconfig.json")
    expect(buildTypeScript.include).toEqual([
      "packages/api/src/**/*.ts",
      "packages/effect/src/**/*.ts",
      "packages/react/src/**/*.ts",
      "packages/react/src/**/*.tsx",
      "packages/eve/src/**/*.ts",
    ])
    for (const scriptName of ["build", "check:packages"]) {
      const script = rootPackage.scripts?.[scriptName] ?? ""
      for (const packageName of [
        "@usesonar/api",
        "@usesonar/effect",
        "@usesonar/eve",
        "@usesonar/react",
      ]) {
        expect(script).toContain(packageName)
      }
    }
  })

  test("keeps public manifests runtime-safe and backend private", async () => {
    const packageNames = ["api", "effect", "react", "eve", "backend"]
    const manifests = await Promise.all(
      packageNames.map(
        async (name) =>
          [
            name,
            parseManifest<PackageManifest>(
              await Bun.file(new URL(`../packages/${name}/package.json`, import.meta.url)).text()
            ),
          ] as const
      )
    )
    const byName = new Map(manifests)
    for (const name of ["api", "effect", "react", "eve"]) {
      expect(byName.get(name)?.name).toBe(`@usesonar/${name}`)
      expect(byName.get(name)?.private).not.toBe(true)
      expect(byName.get(name)?.dependencies?.["@usesonar/backend"]).toBeUndefined()
      expect(byName.get(name)?.devDependencies?.["@usesonar/backend"]).toBeUndefined()
    }
    expect(byName.get("api")?.dependencies?.["@usesonar/backend"]).toBeUndefined()
    expect(byName.get("effect")?.dependencies?.["@usesonar/api"]).toBeDefined()
    for (const name of ["react", "eve"]) {
      expect(byName.get(name)?.dependencies?.["@usesonar/effect"]).toBeDefined()
    }
    expect(byName.get("backend")).toMatchObject({
      name: "@usesonar/backend",
      private: true,
    })
  })

  test("enumerates every public package in CI and release workflows", async () => {
    const publicPackageDirs = ["packages/api", "packages/effect", "packages/eve", "packages/react"]
    const workflowSources = await Promise.all(
      ["ci", "release"].map(async (name) => {
        const source = await Bun.file(
          new URL(`../.github/workflows/${name}.yml`, import.meta.url)
        ).text()
        return [name, source] as const
      })
    )
    for (const [name, source] of workflowSources) {
      const packageDirectoryLoops = [
        ...source.matchAll(/for package_dir in (?<packages>[^\n]+); do/gu),
      ].map((match) => match.groups?.packages ?? "")
      expect(packageDirectoryLoops).not.toHaveLength(0)
      expect(
        packageDirectoryLoops.some((loop) => publicPackageDirs.every((dir) => loop.includes(dir)))
      ).toBe(true)
      for (const dir of publicPackageDirs) {
        expect(source).toContain(dir)
      }
      expect(source).not.toContain("packages/backend")
      expect(source).toContain(name === "ci" ? "bun run check:packages" : "bun changeset publish")
    }
    for (const name of ["api", "effect", "eve", "react"]) {
      const ci = workflowSources.find(([workflowName]) => workflowName === "ci")?.[1] ?? ""
      expect(ci).toContain(`$RUNNER_TEMP/${name}-pack.json`)
    }
  })

  test("covers each public package with release metadata and changesets", async () => {
    const changesetFiles = [
      ...new Bun.Glob("*.md").scanSync({
        cwd: new URL("../.changeset", import.meta.url).pathname,
      }),
    ].filter((path) => path !== "README.md")
    expect(changesetFiles).not.toHaveLength(0)
    const changesetSources = await Promise.all(
      changesetFiles.map((path) =>
        Bun.file(new URL(`../.changeset/${path}`, import.meta.url)).text()
      )
    )
    const changesetText = changesetSources.join("\n")
    expect(changesetText).not.toContain("@usesonar/backend")
    const changesetFrontmatter = changesetSources
      .map((source) => source.split("---")[1] ?? "")
      .join("\n")
    for (const name of ["api", "effect", "eve", "react"]) {
      expect(
        [`"@usesonar/${name}":`, `'@usesonar/${name}':`, `@usesonar/${name}:`].some((marker) =>
          changesetFrontmatter.includes(marker)
        )
      ).toBe(true)
    }
    const releaseSource = await Bun.file(
      new URL("../.github/workflows/release.yml", import.meta.url)
    ).text()
    expect(releaseSource).toContain("bun changeset version")
    expect(releaseSource).toContain("bun changeset publish")
    for (const name of ["api", "effect", "eve", "react"]) {
      expect(releaseSource).toContain(`packages/${name}/package.json`)
      expect(releaseSource).toContain(`packages/${name}/CHANGELOG.md`)
    }
  })

  test("does not track generated public package output or disable stack cases", async () => {
    const trackedDist = Bun.spawnSync([
      "git",
      "ls-files",
      "packages/api/dist",
      "packages/effect/dist",
      "packages/eve/dist",
      "packages/react/dist",
    ])
    expect(new TextDecoder().decode(trackedDist.stdout).trim()).toBe("")
    const source = await Bun.file(new URL("stack.test.ts", import.meta.url)).text()
    expect(source).not.toMatch(/\.(?:only|skip|todo)\s*\(/u)
  })

  test("keeps public runtime imports on public boundaries", async () => {
    const publicSources = [
      "../packages/api/src",
      "../packages/effect/src",
      "../packages/react/src",
      "../packages/eve/src",
    ]
    await Promise.all(
      publicSources.map(async (relative) => {
        const root = new URL(`${relative}/`, import.meta.url)
        const files = [...new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: root.pathname })]
        expect(files).not.toHaveLength(0)
        const sources = await Promise.all(
          files
            .filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"))
            .map((path) => Bun.file(new URL(path, root)).text())
        )
        for (const source of sources) {
          expect(source).not.toMatch(/@usesonar\/backend/u)
          expect(source).not.toMatch(/from\s+["']next(?:\/|["'])/u)
          expect(source).not.toMatch(/from\s+["']node:/u)
          expect(source).not.toMatch(/packages\/(?:api|effect|react|eve)\/src/u)
        }
      })
    )
  })

  test("reproduces the canonical golden fingerprint in fresh processes", () => {
    const first = runFreshFingerprint()
    const second = runFreshFingerprint()
    expect(first).toBe(second)
    expect(first).toMatch(/^\{"fingerprint":"[0-9a-f]{64}"\}$/u)
  })
})
