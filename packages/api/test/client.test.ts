// oxlint-disable sort-keys -- Requests and responses preserve the public person-before-company order.

import { describe, expect, test } from "bun:test"

import { HTTPError } from "ky"
import type { KyInstance } from "ky"

import { createDeepResearch, createResearch, createSonar, retrieveSonar } from "../src/index.ts"
import {
  completeResearchResponse,
  deepResearchRequest,
  jsonResponse,
  minimalPendingResearchResponse,
  minimalResearchRequest,
  minimalResearchWireRequest,
  pendingResearchResponse,
  researchRequest,
  researchWireRequest,
  resolvedField,
} from "./fixtures.ts"

type FetchCall = {
  request: Request
}

const recordingFetch =
  (calls: FetchCall[], respond: (request: Request) => Response | Promise<Response>) =>
  async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    calls.push({ request })
    return await respond(request)
  }

const inertFetch = () => Promise.resolve(jsonResponse(pendingResearchResponse))

const pendingDeepResearchResponse = {
  hash: "deep_hash_123",
  status: "pending",
  data: {
    person: { phone: { status: "pending" } },
    company: {
      legalName: { status: "pending" },
      deepResearch: { regulatoryStatus: { status: "pending" } },
    },
  },
} as const

describe("V-API-02 Ky client and JSON transport", () => {
  test("requires a baseURL and exactly one non-empty capability key", () => {
    // SAFETY: These deliberately malformed options bypass TypeScript so runtime validation is tested.
    const missingBaseURL = { fetch: inertFetch } as never
    // SAFETY: These deliberately malformed options bypass TypeScript so runtime validation is tested.
    const missingKey = { baseURL: "https://api.example.test", fetch: inertFetch } as never
    // SAFETY: These deliberately malformed options bypass TypeScript so runtime validation is tested.
    const bothKeys = {
      baseURL: "https://api.example.test",
      publishableKey: "pk_test_verify",
      secretKey: "sk_verify",
      fetch: inertFetch,
    } as never
    expect(() => createSonar(missingBaseURL)).toThrow()
    expect(() => createSonar(missingKey)).toThrow()
    expect(() => createSonar(bothKeys)).toThrow()
    expect(() =>
      createSonar({
        baseURL: "https://api.example.test",
        publishableKey: "",
        fetch: inertFetch,
      })
    ).toThrow()
    expect(() =>
      createSonar({
        baseURL: "relative/path",
        secretKey: "sk_verify",
        fetch: inertFetch,
      })
    ).toThrow()

    expect(
      createSonar({
        baseURL: "https://api.example.test",
        publishableKey: "pk_test_verify",
        fetch: inertFetch,
      })
    ).toBeFunction()
    expect(
      createSonar({
        baseURL: "https://api.example.test",
        secretKey: "sk_verify",
        fetch: inertFetch,
      })
    ).toBeFunction()
  })

  test("returns Ky directly and preserves Ky hooks, headers, and extend", async () => {
    const calls: FetchCall[] = []
    let hookCalls = 0
    const client: KyInstance = createSonar({
      baseURL: "https://api.example.test/",
      publishableKey: "pk_test_verify",
      fetch: recordingFetch(calls, () => jsonResponse(pendingResearchResponse)),
      headers: { "x-client-option": "preserved" },
      hooks: {
        beforeRequest: [
          ({ request }) => {
            hookCalls += 1
            request.headers.set("x-hook", "ran")
          },
        ],
      },
      retry: 0,
      timeout: false,
    })

    expect(client.extend).toBeFunction()
    const extended = client.extend({ headers: { "x-extended": "yes" } })
    await createResearch(extended, researchRequest)

    expect(hookCalls).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.request.headers.get("x-client-option")).toBe("preserved")
    expect(calls[0]?.request.headers.get("x-hook")).toBe("ran")
    expect(calls[0]?.request.headers.get("x-extended")).toBe("yes")
  })

  test("uses the exact research JSON route, headers, and body", async () => {
    const calls: FetchCall[] = []
    let hookCalls = 0
    const client = createSonar({
      baseURL: "https://api.example.test",
      publishableKey: "pk_test_verify",
      fetch: recordingFetch(calls, () => jsonResponse(pendingResearchResponse)),
      headers: {
        accept: "text/plain",
        "content-type": "application/problem+json",
        "x-research-instance": "preserved",
      },
      hooks: {
        beforeRequest: [
          ({ request }) => {
            hookCalls += 1
            request.headers.set("x-research-hook", "ran")
          },
        ],
      },
    })

    const result = await createResearch(client, researchRequest)

    expect(result).toEqual(pendingResearchResponse)
    expect(calls).toHaveLength(1)
    const request = calls[0]?.request
    expect(request?.method).toBe("POST")
    expect(request?.url).toBe("https://api.example.test/v1/research")
    expect(request?.headers.get("authorization")).toBe("Bearer pk_test_verify")
    expect(request?.headers.get("accept")).toBe("application/json")
    expect(request?.headers.get("content-type")).toBe("application/json")
    expect(request?.headers.get("x-research-instance")).toBe("preserved")
    expect(request?.headers.get("x-research-hook")).toBe("ran")
    expect(hookCalls).toBe(1)
    expect(await request?.json()).toEqual(researchWireRequest)
  })

  test("uses the exact deepResearch JSON route with a secret key", async () => {
    const calls: FetchCall[] = []
    let hookCalls = 0
    const client = createSonar({
      baseURL: "https://api.example.test/",
      secretKey: "sk_verify",
      fetch: recordingFetch(calls, () => jsonResponse(pendingDeepResearchResponse)),
      headers: {
        AcCePt: "text/plain",
        "CoNtEnT-TyPe": "application/problem+json",
        "x-deep-instance": "preserved",
      },
      hooks: {
        beforeRequest: [
          ({ request }) => {
            hookCalls += 1
            request.headers.set("x-deep-hook", "ran")
          },
        ],
      },
    })

    expect(await createDeepResearch(client, deepResearchRequest)).toEqual(
      pendingDeepResearchResponse
    )
    expect(calls).toHaveLength(1)
    const request = calls[0]?.request
    expect(request?.method).toBe("POST")
    expect(request?.url).toBe("https://api.example.test/v1/deepResearch")
    expect(request?.headers.get("authorization")).toBe("Bearer sk_verify")
    expect(request?.headers.get("accept")).toBe("application/json")
    expect(request?.headers.get("content-type")).toBe("application/json")
    expect(request?.headers.get("x-deep-instance")).toBe("preserved")
    expect(request?.headers.get("x-deep-hook")).toBe("ran")
    expect(hookCalls).toBe(1)
    expect(await request?.json()).toEqual(deepResearchRequest)
  })

  test("snapshots a changing research request before delayed transport", async () => {
    const fetchStarted = Promise.withResolvers<Request>()
    const responseGate = Promise.withResolvers<Response>()
    const reads = { seed: 0, ttl: 0, person: 0, company: 0 }
    const initial = {
      seed: { ...minimalResearchRequest.seed },
      ttl: minimalResearchRequest.ttl,
      person: {
        ...minimalResearchRequest.person,
        research: { ...minimalResearchRequest.person.research },
      },
      company: { ...minimalResearchRequest.company },
    }
    const later = {
      seed: { fullName: "Grace Hopper", email: "grace@example.com" },
      ttl: "7d",
      person: {
        github: true,
        research: {
          changedAnswer: { description: "Changed after invocation.", type: "string" },
        },
      },
      company: { domain: true },
    }
    // SAFETY: Accessor-backed request properties deliberately change after their first read so
    // the runtime boundary can prove it parses the caller value exactly once into an owned copy.
    const changingRequest = Object.defineProperties(
      {},
      {
        seed: {
          enumerable: true,
          get: () => ((reads.seed += 1) === 1 ? initial.seed : later.seed),
        },
        ttl: {
          enumerable: true,
          get: () => ((reads.ttl += 1) === 1 ? initial.ttl : later.ttl),
        },
        person: {
          enumerable: true,
          get: () => ((reads.person += 1) === 1 ? initial.person : later.person),
        },
        company: {
          enumerable: true,
          get: () => ((reads.company += 1) === 1 ? initial.company : later.company),
        },
      }
    ) as never
    const client = createSonar({
      baseURL: "https://api.example.test/",
      secretKey: "sk_verify",
      fetch: (request: RequestInfo | URL) => {
        const normalizedRequest = request instanceof Request ? request : new Request(request)
        fetchStarted.resolve(normalizedRequest)
        return responseGate.promise
      },
    })

    const result = createResearch(client, changingRequest)
    const sentRequest = await fetchStarted.promise
    initial.seed.email = "mutated@example.com"
    Reflect.deleteProperty(initial.person, "title")
    initial.person.github = true
    Reflect.deleteProperty(initial.person.research, "accountSignals")
    initial.company.name = true
    responseGate.resolve(jsonResponse(minimalPendingResearchResponse))

    await expect(result).resolves.toEqual(minimalPendingResearchResponse)
    expect(await sentRequest.json()).toEqual(minimalResearchWireRequest)
    expect(reads).toEqual({ seed: 1, ttl: 1, person: 1, company: 1 })
  })

  test("snapshots a changing deepResearch request before delayed transport", async () => {
    const fetchStarted = Promise.withResolvers<Request>()
    const responseGate = Promise.withResolvers<Response>()
    const reads = { seed: 0, ttl: 0, person: 0, company: 0 }
    const initial = {
      seed: { ...deepResearchRequest.seed },
      ttl: deepResearchRequest.ttl,
      person: { ...deepResearchRequest.person },
      company: {
        ...deepResearchRequest.company,
        deepResearch: { ...deepResearchRequest.company.deepResearch },
      },
    }
    const later = {
      seed: { fullName: "Grace Hopper", xURL: "https://x.com/grace" },
      ttl: "7d",
      person: { phone: true },
      company: {
        legalName: true,
        deepResearch: { changedAnswer: "Changed after invocation." },
      },
    }
    // SAFETY: Accessor-backed request properties deliberately change after their first read so
    // the runtime boundary can prove it parses the caller value exactly once into an owned copy.
    const changingRequest = Object.defineProperties(
      {},
      {
        seed: {
          enumerable: true,
          get: () => ((reads.seed += 1) === 1 ? initial.seed : later.seed),
        },
        ttl: {
          enumerable: true,
          get: () => ((reads.ttl += 1) === 1 ? initial.ttl : later.ttl),
        },
        person: {
          enumerable: true,
          get: () => ((reads.person += 1) === 1 ? initial.person : later.person),
        },
        company: {
          enumerable: true,
          get: () => ((reads.company += 1) === 1 ? initial.company : later.company),
        },
      }
    ) as never
    const client = createSonar({
      baseURL: "https://api.example.test/",
      secretKey: "sk_verify",
      fetch: (request: RequestInfo | URL) => {
        const normalizedRequest = request instanceof Request ? request : new Request(request)
        fetchStarted.resolve(normalizedRequest)
        return responseGate.promise
      },
    })

    const result = createDeepResearch(client, changingRequest)
    const sentRequest = await fetchStarted.promise
    initial.seed.email = "mutated@example.com"
    initial.company.deepResearch.regulatoryStatus = "Changed while fetch was pending."
    Object.assign(initial.company.deepResearch, { changedAnswer: "New key after invocation." })
    responseGate.resolve(jsonResponse(pendingDeepResearchResponse))

    await expect(result).resolves.toEqual(pendingDeepResearchResponse)
    expect(await sentRequest.json()).toEqual(deepResearchRequest)
    expect(reads).toEqual({ seed: 1, ttl: 1, person: 1, company: 1 })
  })

  test("retrieves by an encoded hash using GET and validates the response", async () => {
    const calls: FetchCall[] = []
    const client = createSonar({
      baseURL: "https://api.example.test/",
      secretKey: "sk_verify",
      fetch: recordingFetch(calls, () => jsonResponse(completeResearchResponse)),
    })

    expect(await retrieveSonar(client, "hash/with spaces?and=query")).toEqual(
      completeResearchResponse
    )
    expect(calls).toHaveLength(1)
    const request = calls[0]?.request
    expect(request?.method).toBe("GET")
    expect(request?.url).toBe("https://api.example.test/v1/hash%2Fwith%20spaces%3Fand%3Dquery")
    expect(request?.headers.get("authorization")).toBe("Bearer sk_verify")
    expect(request?.headers.get("accept")).toBe("application/json")
  })

  test("rejects empty and dot-segment hashes before invoking fetch", async () => {
    const calls: FetchCall[] = []
    const client = createSonar({
      baseURL: "https://api.example.test/",
      secretKey: "sk_verify",
      fetch: recordingFetch(calls, () => jsonResponse(completeResearchResponse)),
    })

    await Promise.all(
      ["", ".", ".."].map((hash) => expect(retrieveSonar(client, hash)).rejects.toThrow())
    )
    expect(calls).toHaveLength(0)
  })

  test("keeps retrieve built-ins closed while allowing nested custom answers", async () => {
    const withCustomAnswer = {
      ...completeResearchResponse,
      data: {
        ...completeResearchResponse.data,
        person: {
          ...completeResearchResponse.data.person,
          research: {
            ...completeResearchResponse.data.person.research,
            investmentThesis: resolvedField({ fit: "high", evidence: ["public signal"] }),
          },
        },
      },
    }
    const validClient = createSonar({
      baseURL: "https://api.example.test/",
      secretKey: "sk_verify",
      fetch: () => Promise.resolve(jsonResponse(withCustomAnswer)),
    })
    await expect(retrieveSonar(validClient, "custom_hash_123")).resolves.toEqual(withCustomAnswer)

    const invalidResponses = [
      {
        ...completeResearchResponse,
        data: {
          ...completeResearchResponse.data,
          person: {
            ...completeResearchResponse.data.person,
            providerInternal: resolvedField("job-123"),
          },
        },
      },
      {
        ...completeResearchResponse,
        data: {
          ...completeResearchResponse.data,
          company: {
            ...completeResearchResponse.data.company,
            providerInternal: resolvedField({ cacheKey: "private" }),
          },
        },
      },
    ]

    await Promise.all(
      invalidResponses.map(async (invalidResponse) => {
        const client = createSonar({
          baseURL: "https://api.example.test/",
          secretKey: "sk_verify",
          fetch: () => Promise.resolve(jsonResponse(invalidResponse)),
        })
        await expect(retrieveSonar(client, "catalog_hash_123")).rejects.toThrow()
      })
    )
  })

  test("rejects invalid requests before invoking fetch", async () => {
    const calls: FetchCall[] = []
    const client = createSonar({
      baseURL: "https://api.example.test/",
      secretKey: "sk_verify",
      fetch: recordingFetch(calls, () => jsonResponse(pendingResearchResponse)),
    })

    // SAFETY: The wrong-tier field is intentional and must be rejected at the runtime boundary.
    const invalidRequest = { ...researchRequest, person: { phone: true } } as never
    await expect(createResearch(client, invalidRequest)).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  test("rejects malformed and semantically contradictory JSON responses", async () => {
    const invalidResponses = [
      { ...pendingResearchResponse, status: "complete" },
      { ...pendingResearchResponse, status: "unknown" },
      {
        ...pendingResearchResponse,
        data: {
          ...pendingResearchResponse.data,
          accountSignals: { status: "resolved" },
        },
      },
      { status: "pending", data: pendingResearchResponse.data },
    ]

    await Promise.all(
      invalidResponses.map(async (invalidResponse) => {
        const client = createSonar({
          baseURL: "https://api.example.test/",
          secretKey: "sk_verify",
          fetch: () => Promise.resolve(jsonResponse(invalidResponse)),
        })
        await expect(createResearch(client, researchRequest)).rejects.toThrow()
      })
    )

    const emptyClient = createSonar({
      baseURL: "https://api.example.test/",
      secretKey: "sk_verify",
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
    })
    await expect(createResearch(emptyClient, researchRequest)).rejects.toThrow()
  })

  test("rejects JSON snapshots whose leaves do not exactly match the request", async () => {
    const invalidResponses = [
      {
        ...minimalPendingResearchResponse,
        data: {
          person: {},
          company: minimalPendingResearchResponse.data.company,
        },
      },
      {
        ...minimalPendingResearchResponse,
        data: {
          person: {
            title: { status: "pending" },
            phone: { status: "pending" },
            research: minimalPendingResearchResponse.data.person.research,
          },
          company: minimalPendingResearchResponse.data.company,
        },
      },
      {
        ...minimalPendingResearchResponse,
        data: {
          person: minimalPendingResearchResponse.data.person,
          company: {},
        },
      },
      {
        ...minimalPendingResearchResponse,
        data: {
          person: minimalPendingResearchResponse.data.person,
          company: {
            name: { status: "pending" },
            legalName: { status: "pending" },
          },
        },
      },
      {
        ...minimalPendingResearchResponse,
        data: {
          person: { title: { status: "pending" } },
          company: minimalPendingResearchResponse.data.company,
        },
      },
      {
        ...minimalPendingResearchResponse,
        data: {
          person: {
            ...minimalPendingResearchResponse.data.person,
            research: {
              ...minimalPendingResearchResponse.data.person.research,
              unrequestedAnswer: { status: "pending" },
            },
          },
          company: minimalPendingResearchResponse.data.company,
        },
      },
    ]

    await Promise.all(
      invalidResponses.map(async (invalidResponse) => {
        const client = createSonar({
          baseURL: "https://api.example.test/",
          secretKey: "sk_verify",
          fetch: () => Promise.resolve(jsonResponse(invalidResponse)),
        })
        await expect(createResearch(client, minimalResearchRequest)).rejects.toThrow()
      })
    )
  })

  test("requires requested custom answers to be own JSON response properties", async () => {
    const prototypeKeyRequest = {
      ...minimalResearchRequest,
      person: {
        title: true,
        research: {
          toString: { description: "What is the public description?", type: "string" },
        },
      },
    } as const
    const sameCountWrongKeyResponse = {
      ...minimalPendingResearchResponse,
      data: {
        person: {
          title: { status: "pending" },
          research: { foo: { status: "pending" } },
        },
        company: minimalPendingResearchResponse.data.company,
      },
    } as const
    expect(Object.keys(sameCountWrongKeyResponse.data.person.research)).toHaveLength(1)
    expect(Object.hasOwn(sameCountWrongKeyResponse.data.person.research, "toString")).toBe(false)
    expect("toString" in sameCountWrongKeyResponse.data.person.research).toBe(true)

    const client = createSonar({
      baseURL: "https://api.example.test/",
      secretKey: "sk_verify",
      fetch: () => Promise.resolve(jsonResponse(sameCountWrongKeyResponse)),
    })
    await expect(createResearch(client, prototypeKeyRequest)).rejects.toThrow()
  })

  test("rejects deepResearch JSON snapshots whose leaves do not exactly match the request", async () => {
    const baseResponse = {
      hash: "deep_hash_123",
      status: "pending",
      data: {
        person: { phone: { status: "pending" } },
        company: { legalName: { status: "pending" } },
        regulatoryStatus: { status: "pending" },
      },
    } as const
    const invalidResponses = [
      {
        ...baseResponse,
        data: {
          person: {},
          company: baseResponse.data.company,
          regulatoryStatus: { status: "pending" },
        },
      },
      {
        ...baseResponse,
        data: {
          person: {
            phone: { status: "pending" },
            title: { status: "pending" },
          },
          company: baseResponse.data.company,
          regulatoryStatus: { status: "pending" },
        },
      },
      {
        ...baseResponse,
        data: {
          person: baseResponse.data.person,
          company: {},
          regulatoryStatus: { status: "pending" },
        },
      },
      {
        ...baseResponse,
        data: {
          person: baseResponse.data.person,
          company: {
            legalName: { status: "pending" },
            name: { status: "pending" },
          },
          regulatoryStatus: { status: "pending" },
        },
      },
      {
        ...baseResponse,
        data: {
          person: baseResponse.data.person,
          company: baseResponse.data.company,
        },
      },
      {
        ...baseResponse,
        data: {
          person: baseResponse.data.person,
          company: baseResponse.data.company,
          regulatoryStatus: { status: "pending" },
          unrequestedAnswer: { status: "pending" },
        },
      },
    ]

    await Promise.all(
      invalidResponses.map(async (invalidResponse) => {
        const client = createSonar({
          baseURL: "https://api.example.test/",
          secretKey: "sk_verify",
          fetch: () => Promise.resolve(jsonResponse(invalidResponse)),
        })
        await expect(createDeepResearch(client, deepResearchRequest)).rejects.toThrow()
      })
    )
  })

  test("rejects catalog built-ins with values that do not match their field paths", async () => {
    const invalidResearchResponses = [
      {
        ...completeResearchResponse,
        data: {
          ...completeResearchResponse.data,
          person: {
            ...completeResearchResponse.data.person,
            title: resolvedField(42),
          },
        },
      },
      {
        ...completeResearchResponse,
        data: {
          ...completeResearchResponse.data,
          person: {
            ...completeResearchResponse.data.person,
            linkedin: resolvedField("not a URL"),
          },
        },
      },
      {
        ...completeResearchResponse,
        data: {
          ...completeResearchResponse.data,
          person: {
            ...completeResearchResponse.data.person,
            x: resolvedField("@ada"),
          },
        },
      },
      {
        ...completeResearchResponse,
        data: {
          ...completeResearchResponse.data,
          person: {
            ...completeResearchResponse.data.person,
            github: resolvedField("ada"),
          },
        },
      },
      {
        ...completeResearchResponse,
        data: {
          ...completeResearchResponse.data,
          company: {
            ...completeResearchResponse.data.company,
            logo: resolvedField("/relative-logo.png"),
          },
        },
      },
      {
        ...completeResearchResponse,
        data: {
          ...completeResearchResponse.data,
          company: {
            ...completeResearchResponse.data.company,
            domain: resolvedField({ hostname: "example.com" }),
          },
        },
      },
      {
        ...completeResearchResponse,
        data: {
          ...completeResearchResponse.data,
          company: {
            ...completeResearchResponse.data.company,
            name: resolvedField(false),
          },
        },
      },
      {
        ...completeResearchResponse,
        data: {
          ...completeResearchResponse.data,
          company: {
            ...completeResearchResponse.data.company,
            description: resolvedField(["not", "a", "string"]),
          },
        },
      },
    ]
    const invalidDeepResponses = [
      {
        hash: "deep_hash_123",
        status: "complete",
        data: {
          person: { phone: resolvedField(12_025_550_100) },
          company: { legalName: resolvedField("Example Analytics Ltd") },
          regulatoryStatus: resolvedField({ registered: true }),
        },
      },
      {
        hash: "deep_hash_123",
        status: "complete",
        data: {
          person: { phone: resolvedField("+1-202-555-0100") },
          company: { legalName: resolvedField({ name: "Example Analytics Ltd" }) },
          regulatoryStatus: resolvedField({ registered: true }),
        },
      },
    ]

    await Promise.all([
      ...invalidResearchResponses.map(async (invalidResponse) => {
        const client = createSonar({
          baseURL: "https://api.example.test/",
          secretKey: "sk_verify",
          fetch: () => Promise.resolve(jsonResponse(invalidResponse)),
        })
        await expect(createResearch(client, researchRequest)).rejects.toThrow()
      }),
      ...invalidDeepResponses.map(async (invalidResponse) => {
        const client = createSonar({
          baseURL: "https://api.example.test/",
          secretKey: "sk_verify",
          fetch: () => Promise.resolve(jsonResponse(invalidResponse)),
        })
        await expect(createDeepResearch(client, deepResearchRequest)).rejects.toThrow()
      }),
      (async () => {
        const invalidResponse = {
          ...completeResearchResponse,
          data: {
            ...completeResearchResponse.data,
            person: {
              ...completeResearchResponse.data.person,
              title: resolvedField(42),
            },
          },
        }
        const client = createSonar({
          baseURL: "https://api.example.test/",
          secretKey: "sk_verify",
          fetch: () => Promise.resolve(jsonResponse(invalidResponse)),
        })
        await expect(retrieveSonar(client, "catalog_hash_123")).rejects.toThrow()
      })(),
    ])
  })

  test("keeps rich built-ins and custom answers as runtime JSONValue", async () => {
    const response = {
      ...completeResearchResponse,
      data: {
        ...completeResearchResponse.data,
        company: {
          ...completeResearchResponse.data.company,
          logo: resolvedField("https://example.com/logo.png"),
        },
      },
    }
    const client = createSonar({
      baseURL: "https://api.example.test/",
      secretKey: "sk_verify",
      fetch: () => Promise.resolve(jsonResponse(response)),
    })

    expect(await createResearch(client, researchRequest)).toEqual(response)
    expect(response.data.company.colors.value).toEqual({
      primary: "#123456",
      palette: ["#123456", "#abcdef"],
    })
    expect(response.data.company.location.value).toEqual({ city: "London", country: "GB" })
    expect(response.data.company.funding.value).toEqual({ totalUSD: 1_000_000, rounds: ["seed"] })
    expect(response.data.person.research.accountSignals.value).toEqual({
      intent: "high",
      evidence: ["Hiring finance operators"],
    })
  })

  test("preserves Ky HTTP errors and their parsed JSON data", async () => {
    const errorData = {
      error: "invalid_request",
      message: "person.phone belongs on /v1/deepResearch",
    }
    const client = createSonar({
      baseURL: "https://api.example.test/",
      secretKey: "sk_verify",
      fetch: () => Promise.resolve(jsonResponse(errorData, { status: 422 })),
    })

    try {
      await createResearch(client, researchRequest)
      throw new Error("Expected createResearch to reject")
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPError)
      if (!(error instanceof HTTPError)) {
        throw error
      }
      expect(error.response.status).toBe(422)
      expect(error.data).toEqual(errorData)
    }
  })

  test("uses only the injected fetch when ambient fetch throws", async () => {
    const originalFetch = globalThis.fetch
    let injectedCalls = 0
    globalThis.fetch = () => {
      throw new Error("ambient fetch must never be called")
    }

    try {
      const client = createSonar({
        baseURL: "https://api.example.test/",
        publishableKey: "pk_test_verify",
        fetch: () => {
          injectedCalls += 1
          return Promise.resolve(jsonResponse(pendingResearchResponse))
        },
      })
      await createResearch(client, researchRequest)
      expect(injectedCalls).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
