import { describe, expect, test } from "bun:test"

import { createSonar } from "@usesonar/api"
import { Effect, Stream } from "effect"

import { SonarClient, compileResearchRequest, layer, layerFromAPI } from "./index.js"
import type {
  DeepResearchConfig,
  DeepResearchRequest,
  Field,
  JSONValue,
  ResearchConfig,
  ResearchRequest,
  SonarClientError,
  SonarClientService,
  SonarSnapshot,
  StandardJSONSchemaV1,
} from "./index.js"

/* eslint-disable react-hooks/rules-of-hooks -- Context.Service.use retrieves an Effect service. */

type AccountFit = { rationale: string; score: number }

const accountFit: StandardJSONSchemaV1<unknown, AccountFit> = {
  "~standard": {
    jsonSchema: {
      input: () => ({ description: "How strong is the account fit?", type: "object" }),
      output: () => ({
        additionalProperties: false,
        description: "How strong is the account fit?",
        properties: {
          rationale: { type: "string" },
          score: { type: "number" },
        },
        required: ["rationale", "score"],
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
    funding: true,
    name: true,
    research: {
      accountFit: { description: "How strong is the company fit?", type: "object" },
    },
  },
  person: {
    github: true,
    research: { accountFit },
    title: true,
  },
  ttl: "12h",
} as const satisfies ResearchConfig

const researchRequest = {
  ...researchConfig,
  seed: { email: "ada@example.com", fullName: "Ada Lovelace" },
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

const pendingResearchSnapshot = {
  data: {
    company: {
      funding: { status: "pending" },
      name: { status: "pending" },
      research: { accountFit: { status: "pending" } },
    },
    person: {
      github: { status: "pending" },
      research: { accountFit: { status: "pending" } },
      title: { status: "pending" },
    },
  },
  status: "pending",
} as const

const pendingDeepResearchSnapshot = {
  data: {
    company: {
      deepResearch: { background: { status: "pending" } },
      legalName: { status: "pending" },
    },
    person: {
      deepResearch: { background: { status: "pending" } },
      phone: { status: "pending" },
    },
  },
  status: "pending",
} as const

const sseResponse = (body: string) =>
  new Response(body, { headers: { "content-type": "text/event-stream" } })

const snapshotEvent = (snapshot: JSONValue) =>
  `id: 0\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`

const fieldEvent = (id: number, path: string, field: Field) =>
  `id: ${id}\nevent: field\ndata: ${JSON.stringify({ path, ...field })}\n\n`

const completeEvent = (id: number) =>
  `id: ${id}\nevent: complete\ndata: {"hash":"sonar_effect_verifier"}\n\n`

const notFound = { reason: "providerEmpty", status: "notFound" } as const
const asPublicService = (client: SonarClientService) => client
const publicErrorTag = (error: SonarClientError) => error._tag

const researchSSE = () =>
  sseResponse(
    [
      snapshotEvent(pendingResearchSnapshot),
      fieldEvent(1, "person.github", notFound),
      fieldEvent(2, "person.title", notFound),
      fieldEvent(3, "person.research.accountFit", notFound),
      fieldEvent(4, "company.funding", notFound),
      fieldEvent(5, "company.name", notFound),
      fieldEvent(6, "company.research.accountFit", notFound),
      completeEvent(7),
    ].join("")
  )

const deepResearchSSE = () =>
  sseResponse(
    [
      snapshotEvent(pendingDeepResearchSnapshot),
      fieldEvent(1, "person.phone", notFound),
      fieldEvent(2, "person.deepResearch.background", notFound),
      fieldEvent(3, "company.legalName", notFound),
      fieldEvent(4, "company.deepResearch.background", notFound),
      completeEvent(5),
    ].join("")
  )

const assertDerivedTypes = (client: SonarClientService) => {
  client.research(researchRequest).pipe(
    Stream.map((snapshot) => {
      const typed: Field<AccountFit> = snapshot.data.person.research.accountFit
      const raw: Field<JSONValue> = snapshot.data.company.research.accountFit
      const funding: Field<JSONValue> = snapshot.data.company.funding
      const github: Field<string> = snapshot.data.person.github
      // @ts-expect-error An unselected built-in is absent.
      void snapshot.data.person.linkedin
      // @ts-expect-error Research answers remain owned by their entity.
      void snapshot.data.research
      // @ts-expect-error The other entity's identically named answer keeps its own type.
      const wrong: Field<AccountFit> = snapshot.data.company.research.accountFit
      return { funding, github, raw, typed, wrong }
    })
  )

  client.deepResearch(deepResearchRequest).pipe(
    Stream.map((snapshot) => {
      const personBackground: Field<string> = snapshot.data.person.deepResearch.background
      const companyBackground: Field<string> = snapshot.data.company.deepResearch.background
      const phone: Field<string> = snapshot.data.person.phone
      // @ts-expect-error Deep-research results do not expose the research namespace.
      void snapshot.data.person.research
      return { companyBackground, personBackground, phone }
    })
  )
}

void assertDerivedTypes

const assertBroadMapTypes = (
  research: SonarSnapshot<ResearchConfig>,
  deepResearch: SonarSnapshot<DeepResearchConfig>
) => {
  const researchAnswer: Field<JSONValue> | undefined = research.data.company.research?.anyAnswer
  const deepResearchAnswer: Field<string> | undefined =
    deepResearch.data.person.deepResearch?.anyAnswer
  return { deepResearchAnswer, researchAnswer }
}

void assertBroadMapTypes

describe("@usesonar/effect API Layers", () => {
  test("compiles authored validators before streaming and returns hash-free nested snapshots", async () => {
    const requests: Request[] = []
    const snapshots = await Effect.runPromise(
      SonarClient.use((client) => Stream.runCollect(client.research(researchRequest))).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: (input) => {
              requests.push(input instanceof Request ? input : new Request(input))
              return Promise.resolve(researchSSE())
            },
            publishableKey: "pk_test_effect_verifier",
          })
        )
      )
    )

    const values = [...snapshots]
    expect(values[0]).toEqual(pendingResearchSnapshot)
    expect(values.at(-1)?.status).toBe("complete")
    expect("hash" in (values.at(-1) ?? {})).toBeFalse()
    expect(requests[0]?.url).toBe("https://sonar.example.test/v1/research")
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer pk_test_effect_verifier")
    await expect(requests[0]?.json()).resolves.toEqual(compileResearchRequest(researchRequest))
  })

  test("keeps deepResearch prompts serializable and namespaced by entity", async () => {
    const requests: Request[] = []
    const snapshots = await Effect.runPromise(
      SonarClient.use((client) => Stream.runCollect(client.deepResearch(deepResearchRequest))).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: (input) => {
              requests.push(input instanceof Request ? input : new Request(input))
              return Promise.resolve(deepResearchSSE())
            },
            secretKey: "sk_test_effect_verifier",
          })
        )
      )
    )

    expect([...snapshots][0]).toEqual(pendingDeepResearchSnapshot)
    expect([...snapshots].at(-1)?.status).toBe("complete")
    expect(requests[0]?.url).toBe("https://sonar.example.test/v1/deepResearch")
    await expect(requests[0]?.json()).resolves.toEqual(deepResearchRequest)
  })

  test("retrieves a matching nested snapshot, encodes the hash, and strips it", async () => {
    const requests: Request[] = []
    const hash = "tenant/hash ?"
    const snapshot = await Effect.runPromise(
      SonarClient.use((client) => client.retrieve(hash, researchConfig)).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: (input) => {
              requests.push(input instanceof Request ? input : new Request(input))
              return Promise.resolve(
                Response.json({ hash: "private_hash", ...pendingResearchSnapshot })
              )
            },
            publishableKey: "pk_test_effect_verifier",
          })
        )
      )
    )

    expect(snapshot).toEqual(pendingResearchSnapshot)
    expect("hash" in snapshot).toBeFalse()
    expect(requests[0]?.url).toBe("https://sonar.example.test/v1/tenant%2Fhash%20%3F")
  })

  test("rejects retrieve shape mismatches inside either entity namespace", async () => {
    const failure = await Effect.runPromise(
      SonarClient.use((client) => client.retrieve("hash", researchConfig)).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () =>
              Promise.resolve(
                Response.json({
                  hash: "private_hash",
                  ...pendingResearchSnapshot,
                  data: {
                    ...pendingResearchSnapshot.data,
                    company: {
                      ...pendingResearchSnapshot.data.company,
                      research: {},
                    },
                  },
                })
              ),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.flip
      )
    )

    expect(failure._tag).toBe("ProtocolError")
  })

  test("maps request, HTTP, transport, and protocol failures to safe tags", async () => {
    let fetchCalls = 0
    const invalidRequest = {
      ...researchRequest,
      person: { research: { missingDescription: { type: "string" } } },
    }
    const requestFailure = await Effect.runPromise(
      SonarClient.use((client) =>
        // SAFETY: This fixture intentionally violates the public type to verify runtime rejection.
        Stream.runDrain(client.research(invalidRequest as never))
      ).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => {
              fetchCalls += 1
              return Promise.resolve(researchSSE())
            },
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.flip
      )
    )
    expect(requestFailure._tag).toBe("RequestError")
    expect(fetchCalls).toBe(0)

    const failures = await Promise.all(
      [
        () => Promise.resolve(new Response("denied", { status: 401 })),
        () => Promise.reject(new Error("network failed")),
        () => Promise.resolve(sseResponse("not valid SSE")),
      ].map((fetch) =>
        Effect.runPromise(
          SonarClient.use((client) => Stream.runDrain(client.research(researchRequest))).pipe(
            Effect.provide(
              layer({
                baseURL: "https://sonar.example.test/",
                fetch,
                publishableKey: "pk_test_effect_verifier",
              })
            ),
            Effect.flip,
            Effect.map((error) => error._tag)
          )
        )
      )
    )
    expect(failures).toEqual(["HTTPError", "TransportError", "ProtocolError"])
  })

  test("adapts a raw API instance and interrupts a live response body", async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
      start(controller) {
        controller.enqueue(new TextEncoder().encode(snapshotEvent(pendingResearchSnapshot)))
      },
    })
    const api = createSonar({
      baseURL: "https://sonar.example.test/",
      fetch: () =>
        Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } })),
      publishableKey: "pk_test_effect_verifier",
    })
    const snapshots = await Effect.runPromise(
      SonarClient.use((client) =>
        Stream.runCollect(Stream.take(client.research(researchRequest), 1))
      ).pipe(Effect.provide(layerFromAPI(api)))
    )

    expect([...snapshots]).toEqual([pendingResearchSnapshot])
    expect(cancelled).toBeTrue()
  })

  test("keeps the public service and error union stable", () => {
    expect(asPublicService).toBeFunction()
    expect(publicErrorTag).toBeFunction()
  })
})

type LiteralSnapshot = SonarSnapshot<typeof researchConfig>
const assertLiteralSnapshotTypes = (literalSnapshot: LiteralSnapshot) => {
  const typedAnswer: Field<AccountFit> = literalSnapshot.data.person.research.accountFit
  const rawAnswer: Field<JSONValue> = literalSnapshot.data.company.research.accountFit
  return { rawAnswer, typedAnswer }
}

void assertLiteralSnapshotTypes
