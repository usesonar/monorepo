import { describe, expect, test } from "bun:test"

import { Effect, Stream } from "effect"

import { SonarClient, initialSnapshot } from "./index.js"
import type { ResearchConfig, ResearchRequest } from "./index.js"
import { Scenario, SonarTestProbe, scenarioLayer } from "./testing.js"

/* eslint-disable react-hooks/rules-of-hooks -- Context.Service.use retrieves an Effect service; it is not a React Hook. */

const config = {
  company: [],
  person: ["title"],
  research: {},
  ttl: "12h",
} as const satisfies ResearchConfig

const request = {
  seed: { email: "ada@example.com", fullName: "Ada Lovelace" },
  ...config,
} as const satisfies ResearchRequest

const terminalTitle = {
  _tag: "FieldEvent",
  field: {
    confidence: 0.98,
    resolvedAt: "2026-08-26T12:00:00.000Z",
    sources: [],
    status: "resolved",
    value: "Mathematician",
  },
  path: "person.title",
} as const

const completion = { _tag: "CompleteEvent" } as const

const collect = (testLayer: ReturnType<typeof scenarioLayer>) =>
  Effect.runPromise(
    SonarClient.use((client) => Stream.runCollect(client.research(request))).pipe(
      Effect.provide(testLayer)
    )
  )

describe("@usesonar/effect/testing", () => {
  test("exports a keyless deterministic scenario Layer that emits normalized snapshots", async () => {
    const scenario = Scenario.make({ events: [terminalTitle, completion], request })
    const snapshots = [...(await collect(scenarioLayer(scenario)))]

    expect(snapshots[0]).toEqual(initialSnapshot(config))
    expect(snapshots.at(-1)).toMatchObject({
      data: { person: { title: terminalTitle.field } },
      status: "complete",
    })
  })

  test("keeps scenario Layers and their probes isolated", async () => {
    const first = Scenario.make({ events: [terminalTitle, completion], request })
    const second = Scenario.make({
      events: [
        {
          ...terminalTitle,
          field: { ...terminalTitle.field, value: "Programmer" },
        },
        completion,
      ],
      request,
    })
    const firstLayer = scenarioLayer(first)
    const secondLayer = scenarioLayer(second)

    const [firstSnapshots, secondSnapshots, firstRequests, secondRequests] = await Promise.all([
      collect(firstLayer),
      collect(secondLayer),
      Effect.runPromise(
        SonarTestProbe.use((probe) => probe.requests).pipe(Effect.provide(firstLayer))
      ),
      Effect.runPromise(
        SonarTestProbe.use((probe) => probe.requests).pipe(Effect.provide(secondLayer))
      ),
    ])

    expect([...firstSnapshots].at(-1)).toMatchObject({
      data: { person: { title: { value: "Mathematician" } } },
    })
    expect([...secondSnapshots].at(-1)).toMatchObject({
      data: { person: { title: { value: "Programmer" } } },
    })
    expect(firstRequests).toEqual([request])
    expect(secondRequests).toEqual([request])
  })

  test("runs stream finalizers when a consumer interrupts a scenario", async () => {
    const testLayer = scenarioLayer(Scenario.make({ events: [terminalTitle, completion], request }))

    await Effect.runPromise(
      SonarClient.use((client) => Stream.runDrain(Stream.take(client.research(request), 1))).pipe(
        Effect.provide(testLayer)
      )
    )
    const interruptions = await Effect.runPromise(
      SonarTestProbe.use((probe) => probe.interruptions).pipe(Effect.provide(testLayer))
    )

    expect(interruptions).toBe(1)
  })
})
