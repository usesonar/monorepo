// oxlint-disable sort-keys -- Event assertions preserve the locked normalized protocol order.

import { describe, expect, test } from "bun:test"

import { isNetworkError } from "ky"

import {
  SonarStreamError,
  compileResearchRequest,
  createSonar,
  streamDeepResearch,
  streamResearch,
} from "../src/index.ts"
import type { SonarEvent } from "../src/index.ts"
import {
  collectStream,
  concatenateBytes,
  deepResearchRequest,
  encodeSSE,
  eventStreamResponse,
  minimalPendingResearchSnapshot,
  minimalResearchRequest,
  pendingResearchSnapshot,
  researchRequest,
  resolvedField,
} from "./fixtures.ts"

const resolvedLocation = {
  status: "resolved",
  value: { city: "München", note: "satellite 🛰️" },
  confidence: 0.88,
  sources: ["https://example.com/location"],
  resolvedAt: "2026-08-25T20:00:00.000Z",
} as const

const resolvedTitle = {
  status: "resolved",
  value: "Founder",
  confidence: 0.91,
  sources: ["https://example.com/about"],
  resolvedAt: "2026-08-25T20:00:01.000Z",
} as const

const fragmentedResearchRequest = {
  seed: { fullName: "Ada Lovelace", email: "ada@example.com" },
  ttl: "12h",
  person: {
    title: true,
    research: {
      accountSignals: {
        description: "Which buying signals are publicly visible?",
        type: "object",
      },
    },
  },
  company: { location: true },
} as const

const fragmentedPendingSnapshot = {
  status: "pending",
  data: {
    person: {
      title: { status: "pending" },
      research: { accountSignals: { status: "pending" } },
    },
    company: { location: { status: "pending" } },
  },
} as const

const resolvedSignals = resolvedField({
  intent: "high",
  evidence: ["Hiring finance operators"],
})
const resolvedName = resolvedField("Example Analytics")

const streamClient = (fetch: (request: Request) => Response | Promise<Response>) =>
  createSonar({
    baseURL: "https://api.example.test/",
    publishableKey: "pk_test_verify",
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      return await fetch(request)
    },
  })

const microtaskCheckpoint = () => {
  const checkpoint = Promise.withResolvers<"still-pending">()
  let remainingTurns = 8
  const advance = () => {
    remainingTurns -= 1
    if (remainingTurns === 0) {
      checkpoint.resolve("still-pending")
      return
    }
    queueMicrotask(advance)
  }
  queueMicrotask(advance)
  return checkpoint.promise
}

const expectProtocolFailure = async (
  raw: string,
  maxReconnects = 0,
  request: Parameters<typeof streamResearch>[1] = researchRequest
) => {
  const client = streamClient(() =>
    Promise.resolve(eventStreamResponse([new TextEncoder().encode(raw)]))
  )
  const stream = await streamResearch(client, request, { maxReconnects })
  try {
    await collectStream(stream)
    throw new Error("Expected stream protocol failure")
  } catch (error) {
    expect(error).toBeInstanceOf(SonarStreamError)
  }
}

const expectInitialSnapshotFailure = async (
  snapshot: Parameters<typeof encodeSSE>[2],
  request: Parameters<typeof streamResearch>[1] = minimalResearchRequest
) => {
  const client = streamClient(() =>
    Promise.resolve(eventStreamResponse([encodeSSE("snapshot", "0", snapshot)], { keepOpen: true }))
  )
  const stream = await streamResearch(client, request, { maxReconnects: 0 })
  const reader = stream.getReader()
  try {
    await expect(reader.read()).rejects.toBeInstanceOf(SonarStreamError)
  } finally {
    await reader.cancel().catch(() => null)
    reader.releaseLock()
  }
}

type ResearchFieldValueFailure = {
  request: Parameters<typeof streamResearch>[1]
  snapshot: Parameters<typeof encodeSSE>[2]
  path: string
  field: ReturnType<typeof resolvedField>
}

const expectResearchFieldValueFailure = async ({
  request,
  snapshot,
  path,
  field,
}: ResearchFieldValueFailure) => {
  const client = streamClient(() =>
    Promise.resolve(
      eventStreamResponse([
        concatenateBytes(
          encodeSSE("snapshot", "0", snapshot),
          encodeSSE("field", "1", { path, ...field }),
          encodeSSE("complete", "2", { hash: "catalog_hash_123" })
        ),
      ])
    )
  )
  const stream = await streamResearch(client, request, { maxReconnects: 0 })
  await expect(collectStream(stream)).rejects.toBeInstanceOf(SonarStreamError)
}

describe("V-API-03 SSE transport and protocol", () => {
  test("POSTs SSE with auth and parses arbitrary byte, newline, multiline, and UTF-8 splits", async () => {
    const raw = [
      ": verifier comment\r\nretry: 1\r\n",
      `id: 0\r\nevent: snapshot\r\ndata: ${JSON.stringify(fragmentedPendingSnapshot)}\r\n\r\n`,
      `id: 1\r\nevent: field\r\ndata: ${JSON.stringify({ path: "person.title", ...resolvedTitle })}\r\n\r\n`,
      "id: 2\revent: field\r",
      'data: {"path":"company.location",\r',
      `data: ${JSON.stringify(resolvedLocation).slice(1)}\r\r`,
      `id: 3\nevent: field\ndata: ${JSON.stringify({ path: "person.research.accountSignals", ...resolvedSignals })}\n\n`,
      'id: 4\nevent: complete\ndata: {"hash":"sonar_hash_123"}\n\n',
    ].join("")
    const bytes = new TextEncoder().encode(raw)
    const chunks = Array.from({ length: bytes.byteLength }, (_, index) =>
      bytes.slice(index, index + 1)
    )
    const requests: Request[] = []
    let hookCalls = 0
    const client = createSonar({
      baseURL: "https://api.example.test/",
      publishableKey: "pk_test_verify",
      headers: {
        accept: "application/json",
        "content-type": "text/plain",
        "x-research-sse-instance": "preserved",
      },
      hooks: {
        beforeRequest: [
          ({ request }) => {
            hookCalls += 1
            request.headers.set("x-research-sse-hook", "ran")
          },
        ],
      },
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        requests.push(request)
        return Promise.resolve(eventStreamResponse(chunks))
      },
    })

    const stream = await streamResearch(client, fragmentedResearchRequest)
    expect(stream).toBeInstanceOf(ReadableStream)
    const events = await collectStream(stream)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe("POST")
    expect(requests[0]?.url).toBe("https://api.example.test/v1/research")
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer pk_test_verify")
    expect(requests[0]?.headers.get("accept")).toBe("text/event-stream")
    expect(requests[0]?.headers.get("content-type")).toBe("application/json")
    expect(requests[0]?.headers.get("x-research-sse-instance")).toBe("preserved")
    expect(requests[0]?.headers.get("x-research-sse-hook")).toBe("ran")
    expect(hookCalls).toBe(1)
    expect(await requests[0]?.json()).toEqual(compileResearchRequest(fragmentedResearchRequest))
    expect(events).toEqual([
      { id: "0", type: "snapshot", snapshot: fragmentedPendingSnapshot },
      { id: "1", type: "field", path: "person.title", field: resolvedTitle },
      { id: "2", type: "field", path: "company.location", field: resolvedLocation },
      { id: "3", type: "field", path: "person.research.accountSignals", field: resolvedSignals },
      { id: "4", type: "complete", hash: "sonar_hash_123" },
    ])
  })

  test("POSTs deepResearch SSE to its exact tier route", async () => {
    const requests: Request[] = []
    const deepSnapshot = {
      status: "pending",
      data: {
        person: { phone: { status: "pending" } },
        company: {
          legalName: { status: "pending" },
          deepResearch: { regulatoryStatus: { status: "pending" } },
        },
      },
    } as const
    const phone = resolvedField("+1-202-555-0100")
    const legalName = resolvedField("Example Analytics Ltd")
    const regulatoryStatus = resolvedField("Registered in GB")
    let hookCalls = 0
    const client = createSonar({
      baseURL: "https://api.example.test/",
      publishableKey: "pk_test_verify",
      headers: {
        AcCePt: "application/json",
        "CoNtEnT-TyPe": "text/plain",
        "x-deep-sse-instance": "preserved",
      },
      hooks: {
        beforeRequest: [
          ({ request }) => {
            hookCalls += 1
            request.headers.set("x-deep-sse-hook", "ran")
          },
        ],
      },
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        requests.push(request)
        return Promise.resolve(
          eventStreamResponse([
            concatenateBytes(
              encodeSSE("snapshot", "0", deepSnapshot),
              encodeSSE("field", "1", { path: "person.phone", ...phone }),
              encodeSSE("field", "2", { path: "company.legalName", ...legalName }),
              encodeSSE("field", "3", {
                path: "company.deepResearch.regulatoryStatus",
                ...regulatoryStatus,
              }),
              encodeSSE("complete", "4", { hash: "deep_hash_123" })
            ),
          ])
        )
      },
    })

    const events = await collectStream(await streamDeepResearch(client, deepResearchRequest))

    expect(events).toEqual([
      { id: "0", type: "snapshot", snapshot: deepSnapshot },
      { id: "1", type: "field", path: "person.phone", field: phone },
      { id: "2", type: "field", path: "company.legalName", field: legalName },
      {
        id: "3",
        type: "field",
        path: "company.deepResearch.regulatoryStatus",
        field: regulatoryStatus,
      },
      { id: "4", type: "complete", hash: "deep_hash_123" },
    ])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe("https://api.example.test/v1/deepResearch")
    expect(requests[0]?.headers.get("accept")).toBe("text/event-stream")
    expect(requests[0]?.headers.get("content-type")).toBe("application/json")
    expect(requests[0]?.headers.get("x-deep-sse-instance")).toBe("preserved")
    expect(requests[0]?.headers.get("x-deep-sse-hook")).toBe("ran")
    expect(hookCalls).toBe(1)
    expect(await requests[0]?.json()).toEqual(deepResearchRequest)
  })

  test("requires a full all-pending snapshot as the first event", async () => {
    const statuses = Object.values(pendingResearchSnapshot.data).flatMap((entity) =>
      Object.entries(entity).flatMap(([key, value]) =>
        key === "research" ? Object.values(value).map((field) => field.status) : [value.status]
      )
    )
    expect(statuses).not.toHaveLength(0)
    expect(statuses.every((status) => status === "pending")).toBe(true)

    const fieldFirst = concatenateBytes(
      encodeSSE("field", "0", { path: "person.title", ...resolvedTitle }),
      encodeSSE("complete", "1", { hash: "sonar_hash_123" })
    )
    const client = streamClient(() => Promise.resolve(eventStreamResponse([fieldFirst])))
    const stream = await streamResearch(client, researchRequest, { maxReconnects: 0 })
    await expect(collectStream(stream)).rejects.toBeInstanceOf(SonarStreamError)
  })

  test("requires the initial snapshot leaves to exactly match the request", async () => {
    expect(Object.keys(minimalPendingResearchSnapshot.data)).toEqual(["person", "company"])
    expect(Object.keys(minimalPendingResearchSnapshot.data.person.research)).toEqual([
      "accountSignals",
    ])

    const invalidSnapshots = [
      {
        ...minimalPendingResearchSnapshot,
        data: {
          person: {},
          company: minimalPendingResearchSnapshot.data.company,
        },
      },
      {
        ...minimalPendingResearchSnapshot,
        data: {
          person: {
            title: { status: "pending" },
            phone: { status: "pending" },
            research: minimalPendingResearchSnapshot.data.person.research,
          },
          company: minimalPendingResearchSnapshot.data.company,
        },
      },
      {
        ...minimalPendingResearchSnapshot,
        data: {
          person: minimalPendingResearchSnapshot.data.person,
          company: {},
        },
      },
      {
        ...minimalPendingResearchSnapshot,
        data: {
          person: minimalPendingResearchSnapshot.data.person,
          company: {
            name: { status: "pending" },
            legalName: { status: "pending" },
          },
        },
      },
      {
        ...minimalPendingResearchSnapshot,
        data: {
          person: { title: { status: "pending" } },
          company: minimalPendingResearchSnapshot.data.company,
        },
      },
      {
        ...minimalPendingResearchSnapshot,
        data: {
          person: {
            ...minimalPendingResearchSnapshot.data.person,
            research: {
              ...minimalPendingResearchSnapshot.data.person.research,
              unrequestedAnswer: { status: "pending" },
            },
          },
          company: minimalPendingResearchSnapshot.data.company,
        },
      },
      {
        ...minimalPendingResearchSnapshot,
        data: {
          person: {
            title: resolvedTitle,
            research: minimalPendingResearchSnapshot.data.person.research,
          },
          company: minimalPendingResearchSnapshot.data.company,
        },
      },
    ]

    await Promise.all(invalidSnapshots.map((snapshot) => expectInitialSnapshotFailure(snapshot)))
  })

  test("requires requested custom answers to be own initial snapshot properties", async () => {
    const prototypeKeyRequest = {
      ...minimalResearchRequest,
      person: {
        title: true,
        research: {
          toString: { description: "What is the public description?", type: "string" },
        },
      },
    } as const
    const sameCountWrongKeySnapshot = {
      ...minimalPendingResearchSnapshot,
      data: {
        person: {
          title: { status: "pending" },
          research: { foo: { status: "pending" } },
        },
        company: minimalPendingResearchSnapshot.data.company,
      },
    } as const
    expect(Object.keys(sameCountWrongKeySnapshot.data.person.research)).toHaveLength(1)
    expect(Object.hasOwn(sameCountWrongKeySnapshot.data.person.research, "toString")).toBe(false)
    expect("toString" in sameCountWrongKeySnapshot.data.person.research).toBe(true)

    await expectInitialSnapshotFailure(sameCountWrongKeySnapshot, prototypeKeyRequest)
  })

  test("rejects complete while any requested leaf remains pending", async () => {
    const client = streamClient(() =>
      Promise.resolve(
        eventStreamResponse([
          concatenateBytes(
            encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
            encodeSSE("complete", "1", { hash: "minimal_hash_123" })
          ),
        ])
      )
    )

    const stream = await streamResearch(client, minimalResearchRequest, { maxReconnects: 0 })
    await expect(collectStream(stream)).rejects.toBeInstanceOf(SonarStreamError)
  })

  test("rejects field events whose values do not match their catalog paths", async () => {
    const seed = { fullName: "Ada Lovelace", email: "ada@example.com" } as const
    const cases = [
      {
        request: { seed, ttl: "12h", person: { title: true }, company: {} },
        snapshot: {
          status: "pending",
          data: { person: { title: { status: "pending" } }, company: {} },
        },
        path: "person.title",
        field: resolvedField(42),
      },
      {
        request: { seed, ttl: "12h", person: { linkedin: true }, company: {} },
        snapshot: {
          status: "pending",
          data: { person: { linkedin: { status: "pending" } }, company: {} },
        },
        path: "person.linkedin",
        field: resolvedField("not a URL"),
      },
      {
        request: { seed, ttl: "12h", person: {}, company: { logo: true } },
        snapshot: {
          status: "pending",
          data: { person: {}, company: { logo: { status: "pending" } } },
        },
        path: "company.logo",
        field: resolvedField("/relative-logo.png"),
      },
      {
        request: { seed, ttl: "12h", person: {}, company: { name: true } },
        snapshot: {
          status: "pending",
          data: { person: {}, company: { name: { status: "pending" } } },
        },
        path: "company.name",
        field: resolvedField({ words: ["not", "a", "string"] }),
      },
    ] as const

    await Promise.all(cases.map(expectResearchFieldValueFailure))
  })

  test("rejects post-complete events already present in the same parser feed", async () => {
    const terminalChunk = concatenateBytes(
      encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
      encodeSSE("field", "1", { path: "person.title", ...resolvedTitle }),
      encodeSSE("field", "2", { path: "company.name", ...resolvedName }),
      encodeSSE("field", "3", { path: "person.research.accountSignals", ...resolvedSignals }),
      encodeSSE("complete", "4", { hash: "minimal_hash_123" })
    )
    const invalidTrailingChunks = [
      encodeSSE("complete", "5", { hash: "minimal_hash_123" }),
      encodeSSE("field", "5", { path: "person.title", ...resolvedTitle }),
    ]

    await Promise.all(
      invalidTrailingChunks.map(async (invalidTrailingChunk) => {
        const client = streamClient(() =>
          eventStreamResponse([concatenateBytes(terminalChunk, invalidTrailingChunk)])
        )
        const stream = await streamResearch(client, minimalResearchRequest, {
          maxReconnects: 0,
        })
        await expect(collectStream(stream)).rejects.toBeInstanceOf(SonarStreamError)
      })
    )
  })

  test("completes a valid keep-open stream and cancels unread upstream bytes", async () => {
    let bodyCancelCalls = 0
    const terminalChunk = concatenateBytes(
      encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
      encodeSSE("field", "1", { path: "person.title", ...resolvedTitle }),
      encodeSSE("field", "2", { path: "company.name", ...resolvedName }),
      encodeSSE("field", "3", { path: "person.research.accountSignals", ...resolvedSignals }),
      encodeSSE("complete", "4", { hash: "minimal_hash_123" })
    )
    const client = streamClient(() =>
      eventStreamResponse([terminalChunk], {
        keepOpen: true,
        onCancel: () => {
          bodyCancelCalls += 1
        },
      })
    )

    const events = await collectStream(
      await streamResearch(client, minimalResearchRequest, { maxReconnects: 0 })
    )
    expect(events).toHaveLength(5)
    expect(events.at(-1)).toEqual({
      id: "4",
      type: "complete",
      hash: "minimal_hash_123",
    })
    expect(bodyCancelCalls).toBe(1)
  })

  test("requires the initial event ID to be zero", async () => {
    const client = streamClient(() =>
      eventStreamResponse([
        concatenateBytes(
          encodeSSE("snapshot", "1", minimalPendingResearchSnapshot),
          encodeSSE("field", "2", { path: "person.title", ...resolvedTitle }),
          encodeSSE("field", "3", { path: "company.name", ...resolvedName }),
          encodeSSE("field", "4", { path: "person.research.accountSignals", ...resolvedSignals }),
          encodeSSE("complete", "5", { hash: "minimal_hash_123" })
        ),
      ])
    )

    const stream = await streamResearch(client, minimalResearchRequest, { maxReconnects: 0 })
    await expect(collectStream(stream)).rejects.toBeInstanceOf(SonarStreamError)
  })

  test("rejects noncanonical and nonnumeric event IDs", async () => {
    const invalidIds = ["00", "01", "abc", "1.0", "-1", "+1"]

    await Promise.all(
      invalidIds.map(async (invalidId) => {
        const client = streamClient(() =>
          eventStreamResponse([
            concatenateBytes(
              encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
              encodeSSE("field", invalidId, { path: "person.title", ...resolvedTitle }),
              encodeSSE("field", "2", { path: "company.name", ...resolvedName }),
              encodeSSE("field", "3", {
                path: "person.research.accountSignals",
                ...resolvedSignals,
              }),
              encodeSSE("complete", "4", { hash: "minimal_hash_123" })
            ),
          ])
        )
        const stream = await streamResearch(client, minimalResearchRequest, {
          maxReconnects: 0,
        })
        await expect(collectStream(stream)).rejects.toBeInstanceOf(SonarStreamError)
      })
    )
  })

  test("rejects gaps between newly accepted event IDs", async () => {
    const client = streamClient(() =>
      eventStreamResponse([
        concatenateBytes(
          encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
          encodeSSE("field", "2", { path: "person.title", ...resolvedTitle }),
          encodeSSE("field", "3", { path: "company.name", ...resolvedName }),
          encodeSSE("field", "4", { path: "person.research.accountSignals", ...resolvedSignals }),
          encodeSSE("complete", "5", { hash: "minimal_hash_123" })
        ),
      ])
    )

    const stream = await streamResearch(client, minimalResearchRequest, { maxReconnects: 0 })
    await expect(collectStream(stream)).rejects.toBeInstanceOf(SonarStreamError)
  })

  test("rejects malformed or colliding accepted IDs before replay suppression", async () => {
    const firstChunk = concatenateBytes(
      encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
      encodeSSE("field", "1", { path: "person.title", ...resolvedTitle })
    )
    const replayCases = [
      {
        chunk: new TextEncoder().encode("id: 1\nevent: unknown\ndata: not-json\n\n"),
        message: "SSE event data is not valid JSON",
      },
      {
        chunk: encodeSSE("field", "1", {
          path: "person.title",
          ...resolvedField(42),
        }),
        message: "Invalid field event for person.title",
      },
      {
        chunk: encodeSSE("field", "1", { path: "company.name", ...resolvedName }),
        message: "SSE event ID 1 does not match its accepted event",
      },
    ]

    await Promise.all(
      replayCases.map(async ({ chunk, message }) => {
        let fetchCalls = 0
        const client = streamClient(() => {
          fetchCalls += 1
          return eventStreamResponse([fetchCalls === 1 ? firstChunk : chunk])
        })
        const stream = await streamResearch(client, minimalResearchRequest, { maxReconnects: 1 })
        try {
          await collectStream(stream)
          throw new Error("Expected replay validation to reject")
        } catch (error) {
          expect(error).toBeInstanceOf(SonarStreamError)
          expect(error).toHaveProperty("message", message)
        }
        expect(fetchCalls).toBe(2)
      })
    )
  })

  test("suppresses one semantically identical replay with reordered JSON keys", async () => {
    let fetchCalls = 0
    const reorderedTitleReplay = encodeSSE("field", "1", {
      resolvedAt: resolvedTitle.resolvedAt,
      sources: resolvedTitle.sources,
      confidence: resolvedTitle.confidence,
      value: resolvedTitle.value,
      status: resolvedTitle.status,
      path: "person.title",
    })
    const firstChunk = concatenateBytes(
      encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
      encodeSSE("field", "1", { path: "person.title", ...resolvedTitle })
    )
    const reconnectChunk = concatenateBytes(
      reorderedTitleReplay,
      encodeSSE("field", "2", { path: "company.name", ...resolvedName }),
      encodeSSE("field", "3", { path: "person.research.accountSignals", ...resolvedSignals }),
      encodeSSE("complete", "4", { hash: "minimal_hash_123" })
    )
    const client = streamClient(() => {
      fetchCalls += 1
      return eventStreamResponse([fetchCalls === 1 ? firstChunk : reconnectChunk])
    })

    const events = await collectStream(
      await streamResearch(client, minimalResearchRequest, { maxReconnects: 1 })
    )
    expect(events).toEqual([
      { id: "0", type: "snapshot", snapshot: minimalPendingResearchSnapshot },
      { id: "1", type: "field", path: "person.title", field: resolvedTitle },
      { id: "2", type: "field", path: "company.name", field: resolvedName },
      { id: "3", type: "field", path: "person.research.accountSignals", field: resolvedSignals },
      { id: "4", type: "complete", hash: "minimal_hash_123" },
    ])
    expect(fetchCalls).toBe(2)
  })

  test("rejects the same reordered replay ID twice within one reconnect response", async () => {
    let fetchCalls = 0
    const reorderedTitleReplay = encodeSSE("field", "1", {
      resolvedAt: resolvedTitle.resolvedAt,
      sources: resolvedTitle.sources,
      confidence: resolvedTitle.confidence,
      value: resolvedTitle.value,
      status: resolvedTitle.status,
      path: "person.title",
    })
    const firstChunk = concatenateBytes(
      encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
      encodeSSE("field", "1", { path: "person.title", ...resolvedTitle })
    )
    const reconnectChunk = concatenateBytes(
      reorderedTitleReplay,
      reorderedTitleReplay,
      encodeSSE("field", "2", { path: "company.name", ...resolvedName }),
      encodeSSE("field", "3", { path: "person.research.accountSignals", ...resolvedSignals }),
      encodeSSE("complete", "4", { hash: "minimal_hash_123" })
    )
    const client = streamClient(() => {
      fetchCalls += 1
      return eventStreamResponse([fetchCalls === 1 ? firstChunk : reconnectChunk])
    })

    const stream = await streamResearch(client, minimalResearchRequest, { maxReconnects: 1 })
    await expect(collectStream(stream)).rejects.toBeInstanceOf(SonarStreamError)
    expect(fetchCalls).toBe(2)
  })

  test("rejects an old replay after complete in the same reconnect feed", async () => {
    const requests: Request[] = []
    const firstChunk = concatenateBytes(
      encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
      encodeSSE("field", "1", { path: "person.title", ...resolvedTitle })
    )
    const reconnectChunk = concatenateBytes(
      encodeSSE("field", "1", { path: "person.title", ...resolvedTitle }),
      encodeSSE("field", "2", { path: "company.name", ...resolvedName }),
      encodeSSE("field", "3", { path: "person.research.accountSignals", ...resolvedSignals }),
      encodeSSE("complete", "4", { hash: "minimal_hash_123" }),
      encodeSSE("snapshot", "0", minimalPendingResearchSnapshot)
    )
    const client = streamClient((request) => {
      requests.push(request)
      return eventStreamResponse([requests.length === 1 ? firstChunk : reconnectChunk])
    })

    const stream = await streamResearch(client, minimalResearchRequest, { maxReconnects: 1 })
    await expect(collectStream(stream)).rejects.toBeInstanceOf(SonarStreamError)
    expect(requests.map((request) => request.headers.get("last-event-id"))).toEqual([null, "1"])
  })

  test("reconnects three times by default with latest Last-Event-ID and suppresses duplicates", async () => {
    const snapshot = encodeSSE("snapshot", "0", minimalPendingResearchSnapshot)
    const title = encodeSSE("field", "1", { path: "person.title", ...resolvedTitle })
    const name = encodeSSE("field", "2", { path: "company.name", ...resolvedName })
    const signals = encodeSSE("field", "3", {
      path: "person.research.accountSignals",
      ...resolvedSignals,
    })
    const complete = encodeSSE("complete", "4", { hash: "sonar_hash_123" })
    const bodies = [
      concatenateBytes(snapshot, title),
      concatenateBytes(title, name),
      concatenateBytes(name, signals),
      concatenateBytes(signals, complete),
    ]
    const requests: Request[] = []
    const client = streamClient((request) => {
      requests.push(request)
      const body = bodies[requests.length - 1]
      if (!body) {
        throw new Error("Unexpected fifth connection")
      }
      return Promise.resolve(eventStreamResponse([body]))
    })

    const events = await collectStream(await streamResearch(client, minimalResearchRequest))

    expect(events).toEqual([
      { id: "0", type: "snapshot", snapshot: minimalPendingResearchSnapshot },
      { id: "1", type: "field", path: "person.title", field: resolvedTitle },
      { id: "2", type: "field", path: "company.name", field: resolvedName },
      { id: "3", type: "field", path: "person.research.accountSignals", field: resolvedSignals },
      { id: "4", type: "complete", hash: "sonar_hash_123" },
    ])
    expect(requests).toHaveLength(4)
    expect(requests.map((request) => request.headers.get("last-event-id"))).toEqual([
      null,
      "1",
      "2",
      "3",
    ])
  })

  test("surfaces a raw TypeError from a reconnect hook without retrying it", async () => {
    let fetchCalls = 0
    let reconnectHookCalls = 0
    const client = createSonar({
      baseURL: "https://api.example.test/",
      publishableKey: "pk_test_verify",
      hooks: {
        beforeRequest: [
          ({ request }) => {
            if (request.headers.get("last-event-id") !== null) {
              reconnectHookCalls += 1
              throw new TypeError("caller hook rejected reconnect")
            }
          },
        ],
      },
      fetch: () => {
        fetchCalls += 1
        return Promise.resolve(
          eventStreamResponse([encodeSSE("snapshot", "0", minimalPendingResearchSnapshot)])
        )
      },
    })

    const stream = await streamResearch(client, minimalResearchRequest, { maxReconnects: 3 })
    try {
      await collectStream(stream)
      throw new Error("Expected the reconnect hook to reject")
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError)
      expect(error).not.toBeInstanceOf(SonarStreamError)
      expect(error).toHaveProperty("message", "caller hook rejected reconnect")
    }
    expect(reconnectHookCalls).toBe(1)
    expect(fetchCalls).toBe(1)
  })

  test("continues after a transient reconnect acquisition failure within the retry budget", async () => {
    const requests: Request[] = []
    const observedErrors: Error[] = []
    const initialBody = concatenateBytes(
      encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
      encodeSSE("field", "1", { path: "person.title", ...resolvedTitle })
    )
    const completedReconnectBody = concatenateBytes(
      encodeSSE("field", "1", { path: "person.title", ...resolvedTitle }),
      encodeSSE("field", "2", { path: "company.name", ...resolvedName }),
      encodeSSE("field", "3", { path: "person.research.accountSignals", ...resolvedSignals }),
      encodeSSE("complete", "4", { hash: "sonar_hash_123" })
    )
    const client = createSonar({
      baseURL: "https://api.example.test/",
      publishableKey: "pk_test_verify",
      hooks: {
        beforeError: [
          ({ error }) => {
            observedErrors.push(error)
            return error
          },
        ],
      },
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        requests.push(request)
        if (requests.length === 1) {
          return Promise.resolve(eventStreamResponse([initialBody]))
        }
        if (requests.length === 2) {
          return Promise.reject(new TypeError("Failed to fetch"))
        }
        return Promise.resolve(eventStreamResponse([completedReconnectBody]))
      },
    })

    const events = await collectStream(
      await streamResearch(client, minimalResearchRequest, { maxReconnects: 2 })
    )

    expect(events).toEqual([
      { id: "0", type: "snapshot", snapshot: minimalPendingResearchSnapshot },
      { id: "1", type: "field", path: "person.title", field: resolvedTitle },
      { id: "2", type: "field", path: "company.name", field: resolvedName },
      { id: "3", type: "field", path: "person.research.accountSignals", field: resolvedSignals },
      { id: "4", type: "complete", hash: "sonar_hash_123" },
    ])
    expect(requests).toHaveLength(3)
    expect(requests.map((request) => request.headers.get("last-event-id"))).toEqual([
      null,
      "1",
      "1",
    ])
    expect(observedErrors).toHaveLength(1)
    expect(isNetworkError(observedErrors[0])).toBe(true)
  })

  test("maps exhausted reconnect acquisition failures to SonarStreamError", async () => {
    let fetchCalls = 0
    const observedErrors: Error[] = []
    const client = createSonar({
      baseURL: "https://api.example.test/",
      publishableKey: "pk_test_verify",
      hooks: {
        beforeError: [
          ({ error }) => {
            observedErrors.push(error)
            return error
          },
        ],
      },
      fetch: () => {
        fetchCalls += 1
        if (fetchCalls === 1) {
          return Promise.resolve(
            eventStreamResponse([encodeSSE("snapshot", "0", minimalPendingResearchSnapshot)])
          )
        }
        return Promise.reject(new TypeError("Failed to fetch"))
      },
    })

    const stream = await streamResearch(client, minimalResearchRequest, { maxReconnects: 2 })
    await expect(collectStream(stream)).rejects.toBeInstanceOf(SonarStreamError)
    expect(fetchCalls).toBe(3)
    expect(observedErrors).toHaveLength(2)
    expect(observedErrors.every(isNetworkError)).toBe(true)
  })

  test("honors maxReconnects and fails premature streams after the bounded attempts", async () => {
    const requests: Request[] = []
    const client = streamClient((request) => {
      requests.push(request)
      return Promise.resolve(
        eventStreamResponse([
          requests.length === 1
            ? encodeSSE("snapshot", "0", pendingResearchSnapshot)
            : encodeSSE("field", "1", { path: "person.title", ...resolvedTitle }),
        ])
      )
    })

    const stream = await streamResearch(client, researchRequest, { maxReconnects: 1 })
    await expect(collectStream(stream)).rejects.toBeInstanceOf(SonarStreamError)
    expect(requests).toHaveLength(2)
    expect(requests[1]?.headers.get("last-event-id")).toBe("0")
  })

  test("does not retry malformed protocol data", async () => {
    let calls = 0
    const raw =
      'id: 0\nevent: snapshot\ndata: {"status":"pending","data":{}}\n\n' +
      "id: 1\nevent: field\ndata: not-json\n\n"
    const client = streamClient(() => {
      calls += 1
      return Promise.resolve(eventStreamResponse([new TextEncoder().encode(raw)]))
    })

    const stream = await streamResearch(client, researchRequest)
    await expect(collectStream(stream)).rejects.toBeInstanceOf(SonarStreamError)
    expect(calls).toBe(1)
  })

  test("cancels a keep-open response body after malformed protocol data", async () => {
    let bodyCancelCalls = 0
    let fetchCalls = 0
    const malformedBody = concatenateBytes(
      encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
      new TextEncoder().encode("id: 1\nevent: field\ndata: not-json\n\n")
    )
    const client = streamClient(() => {
      fetchCalls += 1
      return eventStreamResponse([malformedBody], {
        keepOpen: true,
        onCancel: () => {
          bodyCancelCalls += 1
        },
      })
    })

    const stream = await streamResearch(client, minimalResearchRequest)
    await expect(collectStream(stream)).rejects.toBeInstanceOf(SonarStreamError)
    expect(fetchCalls).toBe(1)
    expect(bodyCancelCalls).toBe(1)
  })

  test("does not await or leak body cancellation failures after malformed protocol", async () => {
    const unhandledReasons: Error[] = []
    const recordUnhandled = (reason: Error) => {
      unhandledReasons.push(reason)
    }
    process.on("unhandledRejection", recordUnhandled)

    try {
      await Promise.all(
        (["pending", "rejected"] as const).map(async (cancelBehavior) => {
          const cancelStarted = Promise.withResolvers<true>()
          const pendingCancel = Promise.withResolvers<undefined>()
          const cancelFailure = new Error("upstream cancellation failed")
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encodeSSE("snapshot", "0", { status: "pending", data: 42 }))
            },
            cancel() {
              cancelStarted.resolve(true)
              return cancelBehavior === "pending"
                ? pendingCancel.promise
                : Promise.reject(cancelFailure)
            },
          })
          const client = streamClient(
            () => new Response(body, { headers: { "content-type": "text/event-stream" } })
          )
          const stream = await streamResearch(client, minimalResearchRequest, {
            maxReconnects: 0,
          })
          const result = collectStream(stream).then(
            () => ({ status: "resolved" as const }),
            (error: Error) => ({ status: "rejected" as const, error })
          )

          await cancelStarted.promise
          const outcome = await Promise.race([result, microtaskCheckpoint()])
          if (outcome === "still-pending") {
            throw new Error("Protocol failure waited for upstream body cancellation")
          }
          expect(outcome.status).toBe("rejected")
          if (outcome.status === "rejected") {
            expect(outcome.error).toBeInstanceOf(SonarStreamError)
            expect(outcome.error).not.toBe(cancelFailure)
          }
        })
      )
      await microtaskCheckpoint()
      expect(unhandledReasons).toEqual([])
    } finally {
      process.off("unhandledRejection", recordUnhandled)
    }
  })

  test("rejects malformed, invalid, unknown, missing-id, and out-of-order events", async () => {
    const snapshot = `id: 0\nevent: snapshot\ndata: ${JSON.stringify(minimalPendingResearchSnapshot)}\n\n`
    const title = `id: 1\nevent: field\ndata: ${JSON.stringify({ path: "person.title", ...resolvedTitle })}\n\n`
    const name = `id: 2\nevent: field\ndata: ${JSON.stringify({ path: "company.name", ...resolvedName })}\n\n`
    const signals = `id: 3\nevent: field\ndata: ${JSON.stringify({ path: "person.research.accountSignals", ...resolvedSignals })}\n\n`
    const terminalPrefix = `${snapshot}${title}${name}${signals}`
    const complete = 'id: 4\nevent: complete\ndata: {"hash":"sonar_hash_123"}\n\n'
    const cases = [
      `${snapshot}id: 1\nevent: field\ndata: not-json\n\n`,
      `${snapshot}id: 1\nevent: field\ndata: {"path":"person.title","status":"resolved"}\n\n`,
      `${snapshot}id: 1\nevent: mystery\ndata: {}\n\n`,
      `${snapshot}event: field\ndata: {"path":"person.title","status":"pending"}\n\n`,
      `${terminalPrefix}${complete}id: 5\nevent: complete\ndata: {"hash":"sonar_hash_123"}\n\n`,
      `${terminalPrefix}${complete}id: 5\nevent: field\ndata: {"path":"person.title","status":"pending"}\n\n`,
      `${snapshot}id: 0\nevent: field\ndata: {"path":"person.title","status":"pending"}\n\n`,
    ]

    await Promise.all(cases.map((raw) => expectProtocolFailure(raw, 0, minimalResearchRequest)))
  })

  test("rejects an oversized SSE event", async () => {
    const hugeField = {
      path: "person.research.accountSignals",
      status: "resolved",
      value: "x".repeat(1024 * 1024 + 1),
      confidence: 0.5,
      sources: [],
      resolvedAt: "2026-08-25T20:00:00Z",
    }
    const raw =
      `id: 0\nevent: snapshot\ndata: ${JSON.stringify(pendingResearchSnapshot)}\n\n` +
      `id: 1\nevent: field\ndata: ${JSON.stringify(hugeField)}\n\n`
    await expectProtocolFailure(raw)
  })

  test("measures the SSE event limit in UTF-8 bytes rather than JavaScript characters", async () => {
    const oneMiB = 1024 * 1024
    const multibyteField = {
      path: "person.research.accountSignals",
      status: "resolved",
      value: "é".repeat(600_000),
      confidence: 0.5,
      sources: [],
      resolvedAt: "2026-08-25T20:00:00Z",
    }
    const oversizedEvent = `id: 1\nevent: field\ndata: ${JSON.stringify(multibyteField)}\n\n`
    expect(oversizedEvent.length).toBeLessThan(oneMiB)
    expect(new TextEncoder().encode(oversizedEvent).byteLength).toBeGreaterThan(oneMiB)

    const raw = `id: 0\nevent: snapshot\ndata: ${JSON.stringify(pendingResearchSnapshot)}\n\n${oversizedEvent}`
    await expectProtocolFailure(raw)
  })

  test("rejects the CRLF byte that crosses the exact 1 MiB event boundary", async () => {
    const encoder = new TextEncoder()
    const oneMiB = 1024 * 1024
    const emptyField = {
      path: "person.research.accountSignals",
      status: "resolved",
      value: "",
      confidence: 0.5,
      sources: [],
      resolvedAt: "2026-08-25T20:00:00Z",
    }
    const eventPrefix = "id: 1\r\nevent: field\r\ndata: "
    const emptyEventThroughCR = `${eventPrefix}${JSON.stringify(emptyField)}\r`
    const paddingBytes = oneMiB - encoder.encode(emptyEventThroughCR).byteLength
    const oversizedField = { ...emptyField, value: "x".repeat(paddingBytes) }
    const eventThroughCR = encoder.encode(`${eventPrefix}${JSON.stringify(oversizedField)}\r`)
    const pairedLF = encoder.encode("\n")
    const blankDelimiter = encoder.encode("\r\n")
    expect(eventThroughCR.byteLength).toBe(oneMiB)
    expect(concatenateBytes(eventThroughCR, pairedLF).byteLength).toBe(oneMiB + 1)

    const bodyController = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()
    const client = streamClient(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              bodyController.resolve(controller)
              controller.enqueue(encodeSSE("snapshot", "0", minimalPendingResearchSnapshot))
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        )
    )
    const stream = await streamResearch(client, minimalResearchRequest, { maxReconnects: 0 })
    const reader = stream.getReader()

    try {
      expect(await reader.read()).toEqual({
        done: false,
        value: { id: "0", type: "snapshot", snapshot: minimalPendingResearchSnapshot },
      })
      const controller = await bodyController.promise
      controller.enqueue(eventThroughCR)
      controller.enqueue(concatenateBytes(pairedLF, blankDelimiter))
      await expect(reader.read()).rejects.toBeInstanceOf(SonarStreamError)
    } finally {
      await reader.cancel().catch(() => null)
      reader.releaseLock()
    }
  })

  test("accepts the normalized SSE media type and rejects prefix lookalikes", async () => {
    const terminalBody = concatenateBytes(
      encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
      encodeSSE("field", "1", { path: "person.title", ...resolvedTitle }),
      encodeSSE("field", "2", { path: "company.name", ...resolvedName }),
      encodeSSE("field", "3", { path: "person.research.accountSignals", ...resolvedSignals }),
      encodeSSE("complete", "4", { hash: "minimal_hash_123" })
    )

    await Promise.all(
      ["text/event-stream", "text/event-stream; charset=utf-8"].map(async (contentType) => {
        const client = streamClient(
          () => new Response(terminalBody, { headers: { "content-type": contentType } })
        )
        const events = await collectStream(
          await streamResearch(client, minimalResearchRequest, { maxReconnects: 0 })
        )
        expect(events).toHaveLength(5)
      })
    )

    const prefixLookalike = streamClient(
      () =>
        new Response(terminalBody, {
          headers: { "content-type": "text/event-streaming" },
        })
    )
    await expect(streamResearch(prefixLookalike, minimalResearchRequest)).rejects.toThrow()
  })

  test("rejects non-success SSE responses even when Ky HTTP errors are disabled", async () => {
    const terminalBody = concatenateBytes(
      encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
      encodeSSE("field", "1", { path: "person.title", ...resolvedTitle }),
      encodeSSE("field", "2", { path: "company.name", ...resolvedName }),
      encodeSSE("field", "3", { path: "person.research.accountSignals", ...resolvedSignals }),
      encodeSSE("complete", "4", { hash: "minimal_hash_123" })
    )
    const client = createSonar({
      baseURL: "https://api.example.test/",
      publishableKey: "pk_test_verify",
      throwHttpErrors: false,
      fetch: () =>
        Promise.resolve(
          new Response(terminalBody, {
            status: 503,
            headers: { "content-type": "text/event-stream" },
          })
        ),
    })

    await expect(
      streamResearch(client, minimalResearchRequest, { maxReconnects: 0 })
    ).rejects.toThrow()
  })

  test("rejects non-SSE responses and missing bodies", async () => {
    const wrongType = streamClient(() =>
      Promise.resolve(
        new Response("not an event stream", {
          headers: { "content-type": "application/json" },
        })
      )
    )
    await expect(streamResearch(wrongType, researchRequest)).rejects.toThrow()

    const missingBody = streamClient(() =>
      Promise.resolve(new Response(null, { headers: { "content-type": "text/event-stream" } }))
    )
    await expect(streamResearch(missingBody, researchRequest)).rejects.toThrow()
  })

  test("uses the injected fetch even when ambient fetch throws", async () => {
    const originalFetch = globalThis.fetch
    let injectedCalls = 0
    globalThis.fetch = () => {
      throw new Error("ambient fetch must never be called")
    }

    try {
      const client = streamClient(() => {
        injectedCalls += 1
        return Promise.resolve(
          eventStreamResponse([
            concatenateBytes(
              encodeSSE("snapshot", "0", minimalPendingResearchSnapshot),
              encodeSSE("field", "1", { path: "person.title", ...resolvedTitle }),
              encodeSSE("field", "2", { path: "company.name", ...resolvedName }),
              encodeSSE("field", "3", {
                path: "person.research.accountSignals",
                ...resolvedSignals,
              }),
              encodeSSE("complete", "4", { hash: "sonar_hash_123" })
            ),
          ])
        )
      })
      const events = await collectStream(await streamResearch(client, minimalResearchRequest))
      expect(events).toHaveLength(5)
      expect(injectedCalls).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("V-API-04 stream cancellation", () => {
  test("rejects an already-aborted signal without invoking fetch", async () => {
    const controller = new AbortController()
    controller.abort(new DOMException("verification abort", "AbortError"))
    let fetchCalls = 0
    const client = streamClient(() => {
      fetchCalls += 1
      return eventStreamResponse([])
    })

    await expect(
      streamResearch(client, researchRequest, { signal: controller.signal })
    ).rejects.toThrow()
    expect(fetchCalls).toBe(0)
  })

  test("aborts response acquisition when injected fetch ignores the signal", async () => {
    const controller = new AbortController()
    const fetchStarted = Promise.withResolvers<true>()
    const stalledResponse = Promise.withResolvers<Response>()
    let fetchCalls = 0
    const client = streamClient(() => {
      fetchCalls += 1
      fetchStarted.resolve(true)
      return stalledResponse.promise
    })
    const result = streamResearch(client, researchRequest, {
      signal: controller.signal,
    }).then(
      () => "resolved" as const,
      () => "rejected" as const
    )

    await fetchStarted.promise
    controller.abort(new DOMException("verification abort", "AbortError"))

    expect(await Promise.race([result, microtaskCheckpoint()])).toBe("rejected")
    expect(fetchCalls).toBe(1)
  })

  test("aborts immediately while acquiring the response", async () => {
    const controller = new AbortController()
    let fetchAborted = false
    const client = streamClient(
      (request) =>
        // oxlint-disable-next-line promise/avoid-new -- The fixture must remain pending until the caller aborts its Request.
        new Promise<Response>((_resolve, reject) => {
          const abort = () => {
            fetchAborted = true
            reject(request.signal.reason)
          }
          if (request.signal.aborted) {
            abort()
            return
          }
          request.signal.addEventListener("abort", abort, { once: true })
        })
    )

    const streamPromise = streamResearch(client, researchRequest, {
      signal: controller.signal,
    })
    controller.abort(new DOMException("verification abort", "AbortError"))

    await expect(streamPromise).rejects.toThrow()
    expect(fetchAborted).toBe(true)
  })

  test("aborts an active body and does not reconnect", async () => {
    const controller = new AbortController()
    let fetchCalls = 0
    let bodyCancelCalls = 0
    const client = streamClient(() => {
      fetchCalls += 1
      return Promise.resolve(
        eventStreamResponse([encodeSSE("snapshot", "0", pendingResearchSnapshot)], {
          keepOpen: true,
          onCancel: () => {
            bodyCancelCalls += 1
          },
        })
      )
    })
    const stream = await streamResearch(client, researchRequest, {
      signal: controller.signal,
    })
    const reader = stream.getReader()
    const firstRead = await reader.read()
    expect(firstRead.value).toEqual({
      id: "0",
      type: "snapshot",
      snapshot: pendingResearchSnapshot,
    })

    controller.abort(new DOMException("verification abort", "AbortError"))
    const outcome = await Promise.race([
      reader.read().then(
        () => "resolved",
        () => "rejected"
      ),
      microtaskCheckpoint(),
    ])

    expect(outcome).toBe("rejected")
    expect(fetchCalls).toBe(1)
    expect(bodyCancelCalls).toBe(1)
  })

  test("preserves external abort reasons when body cancellation stalls or rejects", async () => {
    const unhandledReasons: Error[] = []
    const recordUnhandled = (reason: Error) => {
      unhandledReasons.push(reason)
    }
    process.on("unhandledRejection", recordUnhandled)

    try {
      await Promise.all(
        (["pending", "rejected"] as const).map(async (cancelBehavior) => {
          const controller = new AbortController()
          const cancelStarted = Promise.withResolvers<true>()
          const pendingCancel = Promise.withResolvers<undefined>()
          const cancelFailure = new Error("upstream abort cancellation failed")
          const body = new ReadableStream<Uint8Array>({
            cancel() {
              cancelStarted.resolve(true)
              return cancelBehavior === "pending"
                ? pendingCancel.promise
                : Promise.reject(cancelFailure)
            },
          })
          const client = streamClient(
            () => new Response(body, { headers: { "content-type": "text/event-stream" } })
          )
          const stream = await streamResearch(client, minimalResearchRequest, {
            signal: controller.signal,
          })
          const result = collectStream(stream).then(
            () => ({ status: "resolved" as const }),
            (error: Error) => ({ status: "rejected" as const, error })
          )
          const abortReason = new DOMException("verification abort", "AbortError")
          controller.abort(abortReason)

          await cancelStarted.promise
          const outcome = await Promise.race([result, microtaskCheckpoint()])
          if (outcome === "still-pending") {
            throw new Error("Abort waited for upstream body cancellation")
          }
          expect(outcome.status).toBe("rejected")
          if (outcome.status === "rejected") {
            expect(outcome.error).toBe(abortReason)
          }
        })
      )
      await microtaskCheckpoint()
      expect(unhandledReasons).toEqual([])
    } finally {
      process.off("unhandledRejection", recordUnhandled)
    }
  })

  test("handles rejected upstream cancellation after consumer cancellation", async () => {
    const unhandledReasons: Error[] = []
    const recordUnhandled = (reason: Error) => {
      unhandledReasons.push(reason)
    }
    process.on("unhandledRejection", recordUnhandled)
    const cancelStarted = Promise.withResolvers<true>()
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelStarted.resolve(true)
        return Promise.reject(new Error("upstream consumer cancellation failed"))
      },
    })
    const client = streamClient(
      () => new Response(body, { headers: { "content-type": "text/event-stream" } })
    )

    try {
      const stream = await streamResearch(client, minimalResearchRequest, {
        maxReconnects: 0,
      })
      const reader = stream.getReader()
      await reader.cancel("verification consumer stop")
      await cancelStarted.promise
      await microtaskCheckpoint()
      expect(unhandledReasons).toEqual([])
      reader.releaseLock()
    } finally {
      process.off("unhandledRejection", recordUnhandled)
    }
  })

  test("consumer cancellation reaches the response body and stops reconnects", async () => {
    let fetchCalls = 0
    let bodyCancelCalls = 0
    const client = streamClient(() => {
      fetchCalls += 1
      return Promise.resolve(
        eventStreamResponse([encodeSSE("snapshot", "0", pendingResearchSnapshot)], {
          keepOpen: true,
          onCancel: () => {
            bodyCancelCalls += 1
          },
        })
      )
    })
    const stream: ReadableStream<SonarEvent> = await streamResearch(client, researchRequest)
    const reader = stream.getReader()
    await reader.read()
    await reader.cancel("consumer finished")

    expect(fetchCalls).toBe(1)
    expect(bodyCancelCalls).toBe(1)
    expect(stream.locked).toBe(true)
    reader.releaseLock()
    expect(stream.locked).toBe(false)
  })
})
