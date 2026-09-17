/* eslint-disable anti-slop/no-chained-type-assertions, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, sort-keys -- The verifier probes untrusted execution boundaries through documented assertion bridges. */
import { describe, expect, test } from "bun:test"

import { SonarClient } from "@usesonar/effect"
import type { SonarClientError, SonarClientService } from "@usesonar/effect"
import { Effect, Layer, Stream } from "effect"
import type { TaskExec, ToolContext } from "eve/tools"

import { deepResearchSonar, researchSonar } from "./index.js"

const seed = { linkedinURL: "https://www.linkedin.com/in/ada" } as const

const researchConfig = {
  person: {
    title: true,
    research: {
      careerFit: {
        description: "Assess public evidence that this person fits the role.",
        type: "object",
      },
    },
  },
  company: {
    name: true,
    research: {
      sellsToSMB: {
        description: "Assess whether this company sells to small businesses.",
        type: "string",
      },
    },
  },
  ttl: "12h",
} as const

const deepConfig = {
  person: { phone: true, deepResearch: { biography: "Write a sourced biography." } },
  company: {
    legalName: true,
    deepResearch: { ownership: "Describe the ownership structure." },
  },
  ttl: "12h",
} as const

const resolved = <Value>(value: Value, confidence: number) => ({
  confidence,
  resolvedAt: "2026-08-26T18:00:00.000Z",
  sources: ["https://example.com/evidence"],
  status: "resolved" as const,
  value,
})

const pendingResearch = {
  status: "pending",
  data: {
    person: {
      title: { status: "pending" },
      research: { careerFit: { status: "pending" } },
    },
    company: {
      name: { status: "pending" },
      research: { sellsToSMB: { status: "pending" } },
    },
  },
} as const

const completeResearch = {
  status: "complete",
  data: {
    person: {
      title: resolved("Founder", 0.94),
      research: { careerFit: resolved({ evidence: ["Founder"], fit: true }, 0.83) },
    },
    company: {
      name: resolved("Analytical Engines", 0.88),
      research: { sellsToSMB: resolved("yes", 0.72) },
    },
  },
} as const

const completeDeep = {
  status: "complete",
  data: {
    person: {
      phone: { reason: "consumerEmail", status: "skipped" },
      deepResearch: { biography: resolved("Ada founded Analytical Engines.", 0.75) },
    },
    company: {
      legalName: resolved("Analytical Engines LLC", 0.91),
      deepResearch: { ownership: resolved("Privately held.", 0.67) },
    },
  },
} as const

type LayerStreams = {
  readonly deepResearch?: Stream.Stream<unknown, SonarClientError>
  readonly research?: Stream.Stream<unknown, SonarClientError>
  readonly onDeepResearch?: (request: unknown) => void
  readonly onResearch?: (request: unknown) => void
}

const clientLayer = ({
  deepResearch = Stream.never,
  onDeepResearch,
  onResearch,
  research = Stream.never,
}: LayerStreams) => {
  const service = {
    // SAFETY: The generic service method is backed by snapshots derived from the tested config.
    deepResearch: ((request: unknown) => {
      onDeepResearch?.(request)
      // SAFETY: Tests supply snapshots derived from the exact config passed to the tool.
      return deepResearch as never
    }) as SonarClientService["deepResearch"],
    // SAFETY: The generic service method is backed by snapshots derived from the tested config.
    research: ((request: unknown) => {
      onResearch?.(request)
      // SAFETY: Tests supply snapshots derived from the exact config passed to the tool.
      return research as never
    }) as SonarClientService["research"],
    retrieve: () =>
      // SAFETY: Retrieve is outside the Eve adapter contract and never evaluated here.
      Effect.never as never,
  } satisfies SonarClientService
  return Layer.succeed(SonarClient, service)
}

// SAFETY: Eve tools consume only the documented AbortSignal in these tests.
const toolContext = (abortSignal: AbortSignal): ToolContext => ({ abortSignal }) as ToolContext

const unusedTask = (): TaskExec => {
  const task = new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`Background Sonar must not use Eve task.${String(property)}`)
      },
    }
  )
  // SAFETY: The proxy fails if the adapter touches any TaskExec capability.
  return task as TaskExec
}

const collect = async <Input, Output>(
  tool: {
    readonly execute: (
      input: Input,
      context: ToolContext
    ) => AsyncGenerator<Output, undefined, unknown>
  },
  input: Input,
  signal = new AbortController().signal
) => {
  const output: Output[] = []
  for await (const snapshot of tool.execute(input, toolContext(signal))) {
    output.push(snapshot)
  }
  return output
}

describe("SonarClient routing", () => {
  test("compiles static research validators and preserves entity ownership", async () => {
    const requests: unknown[] = []
    const tool = researchSonar(researchConfig, {
      layer: clientLayer({
        onResearch: (request) => requests.push(request),
        research: Stream.fromArray([pendingResearch, completeResearch]),
      }),
    })

    expect(await collect(tool, seed)).toEqual([pendingResearch, completeResearch])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      seed,
      ttl: "12h",
      person: {
        title: true,
        research: {
          careerFit: { description: "Assess public evidence that this person fits the role." },
        },
      },
      company: {
        name: true,
        research: {
          sellsToSMB: {
            description: "Assess whether this company sells to small businesses.",
          },
        },
      },
    })
    expect(requests[0]).not.toHaveProperty("research")
    expect(JSON.stringify(requests[0])).not.toContain("~standard")
  })

  test("compiles dynamic raw JSON Schemas under each research entity", async () => {
    const requests: unknown[] = []
    const input = {
      ...seed,
      person: {
        title: true as const,
        research: { careerFit: { description: "Assess fit.", type: "boolean" } },
      },
      company: {},
    }
    const tool = researchSonar(
      { dynamic: true, ttl: "12h" },
      {
        layer: clientLayer({
          onResearch: (request) => requests.push(request),
          research: Stream.fromArray([completeResearch]),
        }),
      }
    )

    await collect(tool, input)
    expect(requests).toEqual([
      {
        company: {},
        person: input.person,
        seed,
        ttl: "12h",
      },
    ])
  })

  test("routes deep research without widening to research", async () => {
    const deepRequests: unknown[] = []
    let researchCalls = 0
    const tool = deepResearchSonar(deepConfig, {
      layer: clientLayer({
        deepResearch: Stream.fromArray([completeDeep]),
        onDeepResearch: (request) => deepRequests.push(request),
        onResearch: () => {
          researchCalls += 1
        },
      }),
    })

    expect(await collect(tool, seed)).toEqual([completeDeep])
    expect(deepRequests).toEqual([{ ...deepConfig, seed }])
    expect(researchCalls).toBe(0)
  })
})

describe("Eve execution and projection", () => {
  test("foreground streams full snapshots and background deep research drains to the final one", async () => {
    const research = researchSonar(researchConfig, {
      layer: clientLayer({ research: Stream.fromArray([pendingResearch, completeResearch]) }),
    })
    const deep = deepResearchSonar(deepConfig, {
      execution: "background",
      layer: clientLayer({ deepResearch: Stream.fromArray([completeDeep]) }),
    })

    expect(await collect(research, seed)).toEqual([pendingResearch, completeResearch])
    expect(
      await deep.execute(seed, toolContext(new AbortController().signal), unusedTask())
    ).toEqual(completeDeep)
  })

  test("preserves nested answer locations and strips execution metadata", async () => {
    const research = researchSonar(researchConfig)
    const deep = deepResearchSonar(deepConfig)
    const original = structuredClone(completeResearch)

    expect(await research.toModelOutput?.(completeResearch)).toEqual({
      type: "json",
      value: {
        person: {
          title: { value: "Founder", confidence: 0.94 },
          research: {
            careerFit: {
              value: { evidence: ["Founder"], fit: true },
              confidence: 0.83,
            },
          },
        },
        company: {
          name: { value: "Analytical Engines", confidence: 0.88 },
          research: { sellsToSMB: { value: "yes", confidence: 0.72 } },
        },
      },
    })
    expect(await deep.toModelOutput?.(completeDeep)).toEqual({
      type: "json",
      value: {
        person: {
          deepResearch: {
            biography: { value: "Ada founded Analytical Engines.", confidence: 0.75 },
          },
        },
        company: {
          legalName: { value: "Analytical Engines LLC", confidence: 0.91 },
          deepResearch: {
            ownership: { value: "Privately held.", confidence: 0.67 },
          },
        },
      },
    })

    const serialized = JSON.stringify(await research.toModelOutput?.(completeResearch))
    expect(serialized).not.toContain("sources")
    expect(serialized).not.toContain("resolvedAt")
    expect(serialized).not.toContain('"status"')
    expect(completeResearch).toEqual(original)
  })

  test("static projection filters unselected built-ins and unconfigured answers", async () => {
    const tool = researchSonar(researchConfig)
    // SAFETY: This adversarial snapshot deliberately includes extra but schema-shaped fields.
    expect(
      await tool.toModelOutput?.({
        status: "complete",
        data: {
          person: {
            title: resolved("Founder", 0.9),
            github: resolved("ada", 0.8),
            research: {
              careerFit: resolved(true, 0.7),
              injected: resolved("no", 1),
            },
          },
          company: {
            name: resolved("Analytical Engines", 0.9),
            funding: resolved(1_000_000, 0.8),
            research: { sellsToSMB: resolved("yes", 0.6) },
          },
        },
      } as never)
    ).toEqual({
      type: "json",
      value: {
        person: {
          title: { value: "Founder", confidence: 0.9 },
          research: { careerFit: { value: true, confidence: 0.7 } },
        },
        company: {
          name: { value: "Analytical Engines", confidence: 0.9 },
          research: { sellsToSMB: { value: "yes", confidence: 0.6 } },
        },
      },
    })
  })

  test("cancels a blocked stream without leaking provider details", async () => {
    const controller = new AbortController()
    const tool = researchSonar(researchConfig, { layer: clientLayer({}) })
    const running = collect(tool, seed, controller.signal)
    controller.abort()
    await expect(running).rejects.toThrow("cancelled")
  })
})
