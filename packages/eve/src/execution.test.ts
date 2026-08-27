/* eslint-disable anti-slop/no-chained-type-assertions, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, sort-keys, unicorn/consistent-function-scoping -- The verifier probes untrusted boundaries through documented assertion bridges and keeps test helpers beside their behavioral conditions. */
import { describe, expect, test } from "bun:test"

import { SonarClient } from "@usesonar/effect"
import type { SonarClientError, SonarClientService } from "@usesonar/effect"
import { Effect, Layer, Stream } from "effect"
import type { TaskExec, ToolContext } from "eve/tools"

import { deepResearchSonar, researchSonar } from "./index.js"

const seed = { linkedinURL: "https://www.linkedin.com/in/ada" } as const

const researchConfig = {
  company: ["name"] as const,
  person: ["title"] as const,
  research: {
    sellsToSMB: "Does this company sell to small and medium businesses?",
  },
  ttl: "12h",
} as const

const deepConfig = {
  company: ["legalName"] as const,
  deepResearch: {
    hasTaxExposure: "Does this company have multi-state tax exposure?",
  },
  person: ["phone"] as const,
  ttl: "12h",
} as const

const pendingResearch = {
  status: "pending",
  data: {
    person: { title: { status: "pending" } },
    // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
    company: { name: { status: "pending" } },
    sellsToSMB: { status: "pending" },
  },
} as const

const partialResearch = {
  status: "pending",
  data: {
    person: {
      title: {
        confidence: 0.94,
        resolvedAt: "2026-08-26T18:00:00.000Z",
        sources: ["https://example.com/profile"],
        status: "resolved",
        value: "Founder",
      },
    },
    // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
    company: { name: { status: "pending" } },
    sellsToSMB: { status: "pending" },
  },
} as const

const completeResearch = {
  status: "complete",
  data: {
    person: {
      title: {
        confidence: 0.94,
        resolvedAt: "2026-08-26T18:00:00.000Z",
        sources: ["https://example.com/profile"],
        status: "resolved",
        value: "Founder",
      },
    },
    // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
    company: {
      name: {
        confidence: 0.88,
        resolvedAt: "2026-08-26T18:00:01.000Z",
        sources: ["https://example.com/about"],
        status: "resolved",
        value: "Analytical Engines",
      },
    },
    sellsToSMB: {
      confidence: 0.72,
      resolvedAt: "2026-08-26T18:00:02.000Z",
      sources: ["https://example.com/customers"],
      status: "resolved",
      value: { answer: "yes", evidenceCount: 3 },
    },
  },
} as const

const mixedResearch = {
  status: "complete",
  data: {
    person: {
      title: {
        confidence: 0.94,
        resolvedAt: "2026-08-26T18:00:00.000Z",
        sources: ["https://example.com/profile"],
        status: "resolved",
        value: "Founder",
      },
    },
    // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
    company: { name: { reason: "providerEmpty", status: "notFound" } },
    sellsToSMB: { reason: "noCompanySeed", status: "skipped" },
  },
} as const

const pendingDeep = {
  status: "pending",
  data: {
    person: { phone: { status: "pending" } },
    // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
    company: { legalName: { status: "pending" } },
    hasTaxExposure: { status: "pending" },
  },
} as const

const completeDeep = {
  status: "complete",
  data: {
    person: { phone: { reason: "consumerEmail", status: "skipped" } },
    // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
    company: {
      legalName: {
        confidence: 0.91,
        resolvedAt: "2026-08-26T18:04:00.000Z",
        sources: ["https://example.gov/entity"],
        status: "resolved",
        value: "Analytical Engines LLC",
      },
    },
    hasTaxExposure: {
      confidence: 0.67,
      resolvedAt: "2026-08-26T18:05:00.000Z",
      sources: ["https://example.gov/tax"],
      status: "resolved",
      value: "likely",
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
    deepResearch: (request: unknown) => {
      onDeepResearch?.(request)
      // SAFETY: Each test supplies snapshots derived from the same literal config passed to the tool.
      return deepResearch as never
    },
    research: (request: unknown) => {
      onResearch?.(request)
      // SAFETY: Each test supplies snapshots derived from the same literal config passed to the tool.
      return research as never
    },
    retrieve: () =>
      // SAFETY: Retrieve is outside the Eve adapter contract and is never evaluated by these tests.
      Effect.never as never,
  } satisfies SonarClientService

  return Layer.succeed(SonarClient, service)
}

// SAFETY: The Eve adapter contract under test may consume only the tool AbortSignal.
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
  // SAFETY: The Proxy deliberately fails if the background adapter touches any TaskExec capability.
  return task as TaskExec
}

const enumerableKeys = (value: unknown) => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new TypeError("Expected an enumerable object")
  }
  return Object.keys(value)
}

const caughtError = (value: unknown): Error => {
  if (!(value instanceof Error)) {
    throw new TypeError("Expected a thrown Error")
  }
  return value
}

const collectResearch = async <Input, Output>(
  tool: {
    readonly execute: (
      input: Input,
      context: ToolContext
    ) => AsyncGenerator<Output, undefined, unknown>
  },
  input: Input,
  abortSignal = new AbortController().signal
) => {
  const result = tool.execute(input, toolContext(abortSignal))
  if (typeof result !== "object" || result === null || !(Symbol.asyncIterator in result)) {
    throw new Error("researchSonar.execute must return an async generator")
  }

  const snapshots: unknown[] = []
  for await (const snapshot of result) {
    snapshots.push(snapshot)
  }
  return snapshots
}

const collectDeep = async <Input, Output>(
  tool: {
    readonly execute: (
      input: Input,
      context: ToolContext
    ) => AsyncGenerator<Output, undefined, unknown> | Promise<Output>
  },
  input: Input,
  abortSignal = new AbortController().signal
) => {
  const result = tool.execute(input, toolContext(abortSignal))
  if (typeof result === "object" && result !== null && Symbol.asyncIterator in result) {
    const snapshots: unknown[] = []
    for await (const snapshot of result) {
      snapshots.push(snapshot)
    }
    return snapshots
  }
  return [await result]
}

describe("SonarClient routing", () => {
  test("passes the static research seed and config through the public Effect service", async () => {
    const requests: unknown[] = []
    const tool = researchSonar(researchConfig, {
      layer: clientLayer({
        onResearch: (request) => requests.push(request),
        research: Stream.fromArray([pendingResearch, partialResearch, completeResearch]),
      }),
    })

    expect(await collectResearch(tool, seed)).toEqual([
      pendingResearch,
      partialResearch,
      completeResearch,
    ])
    expect(requests).toEqual([{ ...researchConfig, seed }])
  })

  test("passes dynamic selections under research without flattening the request", async () => {
    const requests: unknown[] = []
    const dynamicConfig = { dynamic: true, ttl: "12h" } as const
    const dynamicInput = {
      company: ["name"] as const,
      linkedinURL: seed.linkedinURL,
      person: ["title"] as const,
      research: {
        sellsToSMB: "Does this company sell to SMBs?",
      },
    }
    const tool = researchSonar(dynamicConfig, {
      layer: clientLayer({
        onResearch: (request) => requests.push(request),
        research: Stream.fromArray([completeResearch]),
      }),
    })

    await collectResearch(tool, dynamicInput)
    expect(requests).toEqual([
      {
        company: dynamicInput.company,
        person: dynamicInput.person,
        research: dynamicInput.research,
        seed,
        ttl: dynamicConfig.ttl,
      },
    ])
    const [request] = requests
    expect(request).toBeObject()
    expect(enumerableKeys(request)).toEqual(["seed", "ttl", "person", "company", "research"])
  })

  test("routes deep tools only through deepResearch", async () => {
    const deepRequests: unknown[] = []
    let researchCalls = 0
    const tool = deepResearchSonar(deepConfig, {
      layer: clientLayer({
        deepResearch: Stream.fromArray([pendingDeep, completeDeep]),
        onDeepResearch: (request) => deepRequests.push(request),
        onResearch: () => {
          researchCalls += 1
        },
      }),
    })

    expect(await collectDeep(tool, seed)).toEqual([pendingDeep, completeDeep])
    expect(deepRequests).toEqual([{ ...deepConfig, seed }])
    expect(researchCalls).toBe(0)
  })

  test("routes dynamic deep selections through the flat deep request", async () => {
    const requests: unknown[] = []
    const dynamicConfig = { dynamic: true, ttl: "365d" } as const
    const dynamicInput = {
      company: ["legalName"] as const,
      deepResearch: { hasTaxExposure: "Does it have tax exposure?" },
      email: "ada@example.com",
      fullName: "Ada Lovelace",
      person: ["phone"] as const,
    }
    const tool = deepResearchSonar(dynamicConfig, {
      layer: clientLayer({
        deepResearch: Stream.fromArray([completeDeep]),
        onDeepResearch: (request) => requests.push(request),
      }),
    })

    await collectDeep(tool, dynamicInput)
    expect(requests).toEqual([
      {
        company: dynamicInput.company,
        deepResearch: dynamicInput.deepResearch,
        person: dynamicInput.person,
        seed: { email: dynamicInput.email, fullName: dynamicInput.fullName },
        ttl: dynamicConfig.ttl,
      },
    ])
    const [request] = requests
    expect(request).toBeObject()
    expect(enumerableKeys(request)).toEqual(["seed", "ttl", "person", "company", "deepResearch"])
  })

  test("normalizes shared SonarSeed strings before invoking the service", async () => {
    const requests: unknown[] = []
    const tool = researchSonar(researchConfig, {
      layer: clientLayer({
        onResearch: (request) => requests.push(request),
        research: Stream.fromArray([completeResearch]),
      }),
    })

    await collectResearch(tool, {
      domain: "  analytical-engines.example  ",
      email: "ada@example.com",
      fullName: "  Ada Lovelace  ",
    })
    expect(requests).toEqual([
      {
        seed: {
          fullName: "Ada Lovelace",
          email: "ada@example.com",
          domain: "analytical-engines.example",
        },
        ttl: researchConfig.ttl,
        person: researchConfig.person,
        company: researchConfig.company,
        research: researchConfig.research,
      },
    ])
  })

  test("snapshots static configs so caller mutation cannot change later execution", async () => {
    const researchRequests: unknown[] = []
    const deepRequests: unknown[] = []
    const mutableResearchConfig = {
      company: ["name"] as const,
      person: ["title"] as const,
      research: { sellsToSMB: "Does this company sell to SMBs?" },
      ttl: "12h",
    }
    const mutableDeepConfig = {
      company: ["legalName"] as const,
      deepResearch: { hasTaxExposure: "Does this company have tax exposure?" },
      person: ["phone"] as const,
      ttl: "12h",
    }
    const researchTool = researchSonar(mutableResearchConfig, {
      layer: clientLayer({
        onResearch: (request) => researchRequests.push(request),
        research: Stream.fromArray([completeResearch]),
      }),
    })
    const deepTool = deepResearchSonar(mutableDeepConfig, {
      layer: clientLayer({
        deepResearch: Stream.fromArray([completeDeep]),
        onDeepResearch: (request) => deepRequests.push(request),
      }),
    })

    mutableResearchConfig.ttl = "365d"
    mutableResearchConfig.research.sellsToSMB = "Mutated research question"
    mutableDeepConfig.ttl = "365d"
    mutableDeepConfig.deepResearch.hasTaxExposure = "Mutated deep question"

    await collectResearch(researchTool, seed)
    await collectDeep(deepTool, seed)
    expect(researchRequests).toEqual([
      {
        company: ["name"],
        person: ["title"],
        research: { sellsToSMB: "Does this company sell to SMBs?" },
        seed,
        ttl: "12h",
      },
    ])
    expect(deepRequests).toEqual([
      {
        company: ["legalName"],
        deepResearch: { hasTaxExposure: "Does this company have tax exposure?" },
        person: ["phone"],
        seed,
        ttl: "12h",
      },
    ])
  })

  test("detaches TTL before selection getters can mutate caller configs", async () => {
    const researchRequests: unknown[] = []
    const deepRequests: unknown[] = []
    const researchPerson = ["title"] as const
    const deepCompany = ["legalName"] as const
    const mutableResearchConfig = {
      company: ["name"] as const,
      person: researchPerson,
      research: { sellsToSMB: "Does this company sell to SMBs?" },
      ttl: "12h",
    }
    const mutableDeepConfig = {
      company: deepCompany,
      deepResearch: { hasTaxExposure: "Does this company have tax exposure?" },
      person: ["phone"] as const,
      ttl: "12h",
    }
    Object.defineProperty(researchPerson, 0, {
      enumerable: true,
      get() {
        mutableResearchConfig.ttl = "365d"
        return "title"
      },
    })
    Object.defineProperty(deepCompany, 0, {
      enumerable: true,
      get() {
        mutableDeepConfig.ttl = "365d"
        return "legalName"
      },
    })

    const researchTool = researchSonar(mutableResearchConfig, {
      layer: clientLayer({
        onResearch: (request) => researchRequests.push(request),
        research: Stream.fromArray([completeResearch]),
      }),
    })
    const deepTool = deepResearchSonar(mutableDeepConfig, {
      layer: clientLayer({
        deepResearch: Stream.fromArray([completeDeep]),
        onDeepResearch: (request) => deepRequests.push(request),
      }),
    })

    expect(mutableResearchConfig.ttl).toBe("365d")
    expect(mutableDeepConfig.ttl).toBe("365d")
    await collectResearch(researchTool, seed)
    await collectDeep(deepTool, seed)
    expect(researchRequests).toEqual([
      {
        company: ["name"],
        person: ["title"],
        research: { sellsToSMB: "Does this company sell to SMBs?" },
        seed,
        ttl: "12h",
      },
    ])
    expect(deepRequests).toEqual([
      {
        company: ["legalName"],
        deepResearch: { hasTaxExposure: "Does this company have tax exposure?" },
        person: ["phone"],
        seed,
        ttl: "12h",
      },
    ])
  })

  test("does not invoke SonarClient when static or dynamic input is rejected", async () => {
    let calls = 0
    const layer = clientLayer({
      deepResearch: Stream.fromArray([completeDeep]),
      onDeepResearch: () => {
        calls += 1
      },
      onResearch: () => {
        calls += 1
      },
      research: Stream.fromArray([completeResearch]),
    })
    const staticTool = researchSonar(researchConfig, { layer })
    const dynamicResearchTool = researchSonar({ dynamic: true, ttl: "12h" }, { layer })
    const dynamicDeepTool = deepResearchSonar({ dynamic: true, ttl: "12h" }, { layer })
    // SAFETY: This verifier deliberately calls the public runtime boundary with untyped JavaScript config.
    const invokeResearch = researchSonar as unknown as (config: unknown, options: unknown) => void
    // SAFETY: This verifier deliberately calls the public runtime boundary with untyped JavaScript config.
    const invokeDeep = deepResearchSonar as unknown as (config: unknown, options: unknown) => void
    const sparseSelection: unknown[] = []
    sparseSelection.length = 1

    expect(() => invokeResearch({ ...researchConfig, person: [undefined] }, { layer })).toThrow()
    expect(() =>
      invokeResearch({ ...researchConfig, person: sparseSelection }, { layer })
    ).toThrow()
    expect(() => invokeDeep({ ...deepConfig, company: [undefined] }, { layer })).toThrow()
    expect(() => invokeDeep({ ...deepConfig, company: sparseSelection }, { layer })).toThrow()

    // SAFETY: These intentionally invalid inputs verify the runtime boundary before the service.
    await expect(collectResearch(staticTool, {} as never)).rejects.toThrow()
    // SAFETY: This omits person/company/question selections to exercise dynamic validation.
    await expect(collectDeep(dynamicDeepTool, seed as never)).rejects.toThrow()
    // SAFETY: Undefined dynamic selections must fail before reaching the injected service.
    await expect(
      collectResearch(dynamicResearchTool, {
        ...seed,
        company: [],
        person: [undefined],
        research: {},
      } as never)
    ).rejects.toThrow()
    // SAFETY: Sparse dynamic selections must fail before reaching the injected service.
    await expect(
      collectResearch(dynamicResearchTool, {
        ...seed,
        company: [],
        person: sparseSelection,
        research: {},
      } as never)
    ).rejects.toThrow()
    // SAFETY: Undefined dynamic deep selections must fail before reaching the injected service.
    await expect(
      collectDeep(dynamicDeepTool, {
        ...seed,
        company: [undefined],
        deepResearch: {},
        person: [],
      } as never)
    ).rejects.toThrow()
    // SAFETY: Sparse dynamic deep selections must fail before reaching the injected service.
    await expect(
      collectDeep(dynamicDeepTool, {
        ...seed,
        company: sparseSelection,
        deepResearch: {},
        person: [],
      } as never)
    ).rejects.toThrow()
    expect(calls).toBe(0)
  })
})

describe("Eve execution forms", () => {
  test("snapshots caller-owned options before later mutation", async () => {
    let capturedResearchCalls = 0
    let capturedDeepCalls = 0
    let mutatedResearchCalls = 0
    let mutatedDeepCalls = 0
    const capturedResearchLayer = clientLayer({
      onResearch: () => {
        capturedResearchCalls += 1
      },
      research: Stream.fromArray([completeResearch]),
    })
    const capturedDeepLayer = clientLayer({
      deepResearch: Stream.fromArray([completeDeep]),
      onDeepResearch: () => {
        capturedDeepCalls += 1
      },
    })
    const mutatedResearchLayer = clientLayer({
      onResearch: () => {
        mutatedResearchCalls += 1
      },
      research: Stream.fromArray([completeResearch]),
    })
    const mutatedDeepLayer = clientLayer({
      deepResearch: Stream.fromArray([completeDeep]),
      onDeepResearch: () => {
        mutatedDeepCalls += 1
      },
    })
    const researchOptions = {
      description: "Original research appendix.",
      layer: capturedResearchLayer,
    }
    const deepOptions = {
      description: "Original deep appendix.",
      execution: "background" as const,
      layer: capturedDeepLayer,
    }
    const researchTool = researchSonar(researchConfig, researchOptions)
    const deepTool = deepResearchSonar(deepConfig, deepOptions)

    Object.assign(researchOptions, {
      description: "Mutated research appendix.",
      layer: mutatedResearchLayer,
    })
    Object.assign(deepOptions, {
      description: "Mutated deep appendix.",
      execution: undefined,
      layer: mutatedDeepLayer,
    })

    expect(await collectResearch(researchTool, seed)).toEqual([completeResearch])
    expect(
      await deepTool.execute(seed, toolContext(new AbortController().signal), unusedTask())
    ).toEqual(completeDeep)
    expect(capturedResearchCalls).toBe(1)
    expect(capturedDeepCalls).toBe(1)
    expect(mutatedResearchCalls).toBe(0)
    expect(mutatedDeepCalls).toBe(0)
    expect(researchTool.description).toContain("Original research appendix.")
    expect(researchTool.description).not.toContain("Mutated research appendix.")
    expect(researchTool.execution).toBeUndefined()
    expect(deepTool.description).toContain("Original deep appendix.")
    expect(deepTool.description).not.toContain("Mutated deep appendix.")
    expect(deepTool.execution).toBe("background")
  })

  test("research yields full progressive snapshots and the settled final snapshot", async () => {
    const tool = researchSonar(researchConfig, {
      layer: clientLayer({
        research: Stream.fromArray([pendingResearch, partialResearch, completeResearch]),
      }),
    })

    const snapshots = await collectResearch(tool, seed)
    expect(snapshots).toHaveLength(3)
    expect(snapshots[0]).toEqual(pendingResearch)
    expect(snapshots[1]).toEqual(partialResearch)
    expect(snapshots[2]).toEqual(completeResearch)
    expect(Object.keys(completeResearch)).toEqual(["status", "data"])
    expect(Object.keys(completeResearch.data)).toEqual(["person", "company", "sellsToSMB"])
  })

  test("deep foreground preserves supported streaming semantics", async () => {
    const tool = deepResearchSonar(deepConfig, {
      layer: clientLayer({
        deepResearch: Stream.fromArray([pendingDeep, completeDeep]),
      }),
    })

    const snapshots = await collectDeep(tool, seed)
    expect(snapshots.at(-1)).toEqual(completeDeep)
    if (snapshots.length > 1) {
      expect(snapshots).toEqual([pendingDeep, completeDeep])
    }
  })

  test("deep background drains to a normal final value without TaskExec", async () => {
    const tool = deepResearchSonar(deepConfig, {
      execution: "background",
      layer: clientLayer({
        deepResearch: Stream.fromArray([pendingDeep, completeDeep]),
      }),
    })

    const output = await tool.execute(seed, toolContext(new AbortController().signal), unusedTask())
    expect(output).toEqual(completeDeep)
    expect(output).not.toMatchObject({ status: "working" })
  })
})

describe("model output projection", () => {
  test("omits adversarial built-ins that the static config did not select", async () => {
    const resolved = (value: unknown) => ({
      confidence: 0.8,
      resolvedAt: "2026-08-26T18:00:00.000Z",
      sources: [],
      status: "resolved" as const,
      value,
    })
    const researchTool = researchSonar(researchConfig)
    const deepTool = deepResearchSonar({
      company: [] as const,
      deepResearch: { hasTaxExposure: "Does this company have tax exposure?" },
      person: [] as const,
      ttl: "12h",
    })

    // SAFETY: The extra resolved built-ins deliberately simulate an adversarial snapshot boundary.
    const researchProjected = await researchTool.toModelOutput?.({
      status: "complete",
      data: {
        person: { title: resolved("Founder"), github: resolved("ada") },
        company: { name: resolved("Analytical Engines"), funding: resolved(10_000) },
        sellsToSMB: resolved("yes"),
      },
    } as never)
    // SAFETY: The extra deep built-ins deliberately simulate an adversarial snapshot boundary.
    const deepProjected = await deepTool.toModelOutput?.({
      status: "complete",
      data: {
        person: { phone: resolved("+1-555-0100") },
        company: { legalName: resolved("Analytical Engines LLC") },
        hasTaxExposure: resolved("likely"),
      },
    } as never)

    expect(researchProjected).toEqual({
      type: "json",
      value: {
        person: { title: { value: "Founder", confidence: 0.8 } },
        company: { name: { value: "Analytical Engines", confidence: 0.8 } },
        sellsToSMB: { value: "yes", confidence: 0.8 },
      },
    })
    expect(deepProjected).toEqual({
      type: "json",
      value: { hasTaxExposure: { value: "likely", confidence: 0.8 } },
    })
  })

  test("preserves nested built-ins, flattens custom keys, and strips execution metadata", async () => {
    const tool = researchSonar(researchConfig, {
      layer: clientLayer({ research: Stream.fromArray([completeResearch]) }),
    })

    const original = structuredClone(completeResearch)
    const projected = await tool.toModelOutput?.(completeResearch)
    expect(projected).toEqual({
      type: "json",
      value: {
        person: {
          title: { value: "Founder", confidence: 0.94 },
        },
        // oxlint-disable-next-line sort-keys -- Sonar's model projection preserves person before company.
        company: {
          name: { value: "Analytical Engines", confidence: 0.88 },
        },
        sellsToSMB: {
          value: { answer: "yes", evidenceCount: 3 },
          confidence: 0.72,
        },
      },
    })
    if (
      projected?.type !== "json" ||
      typeof projected.value !== "object" ||
      projected.value === null
    ) {
      throw new Error("Expected Eve JSON model output")
    }
    expect(Object.keys(projected.value)).toEqual(["person", "company", "sellsToSMB"])
    expect(JSON.stringify(projected)).toContain('"title":{"value":"Founder","confidence":0.94}')
    expect(JSON.stringify(projected)).toContain(
      '"name":{"value":"Analytical Engines","confidence":0.88}'
    )
    expect(JSON.stringify(projected)).toContain(
      '"sellsToSMB":{"value":{"answer":"yes","evidenceCount":3},"confidence":0.72}'
    )

    const serialized = JSON.stringify(projected)
    for (const forbidden of [
      "status",
      "sources",
      "resolvedAt",
      "hash",
      "provider",
      "cache",
      "jobId",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(completeResearch.data.person.title.sources).toEqual(["https://example.com/profile"])
    expect(completeResearch).toEqual(original)
  })

  test("omits unresolved leaves and empty containers", async () => {
    const tool = researchSonar(researchConfig, {
      layer: clientLayer({ research: Stream.fromArray([mixedResearch]) }),
    })

    expect(await tool.toModelOutput?.(mixedResearch)).toEqual({
      type: "json",
      value: {
        person: {
          title: { value: "Founder", confidence: 0.94 },
        },
      },
    })
  })

  test("ignores inherited and hostile descriptors throughout static and dynamic projection", async () => {
    type DescriptorMode = "accessor" | "inherited" | "nonEnumerable"
    type Projection = { readonly type: "json"; readonly value: unknown }
    const getterReads = { count: 0 }
    const hostileProperties = (
      entries: readonly (readonly [PropertyKey, unknown])[],
      mode: DescriptorMode
    ) => {
      const target = {}
      if (mode === "inherited") {
        Object.setPrototypeOf(target, Object.fromEntries(entries))
        return target
      }
      for (const [key, value] of entries) {
        if (mode === "accessor") {
          Object.defineProperty(target, key, {
            enumerable: true,
            get() {
              getterReads.count += 1
              return value
            },
          })
        } else {
          Object.defineProperty(target, key, { enumerable: false, value })
        }
      }
      return target
    }
    const resolvedLeaf = { confidence: 0.8, status: "resolved", value: "private" }
    const normalData = {
      company: { name: resolvedLeaf },
      person: { title: resolvedLeaf },
      sellsToSMB: resolvedLeaf,
    }
    const snapshots: unknown[] = []

    for (const mode of ["inherited", "accessor", "nonEnumerable"] as const) {
      const hostileData = hostileProperties([["data", normalData]], mode)
      const hostileContainers = {
        data: hostileProperties(
          [
            ["person", { title: resolvedLeaf }],
            ["company", { name: resolvedLeaf }],
            ["sellsToSMB", resolvedLeaf],
          ],
          mode
        ),
      }

      const slotData = hostileProperties([["sellsToSMB", resolvedLeaf]], mode)
      Object.defineProperties(slotData, {
        company: {
          enumerable: true,
          value: hostileProperties([["name", resolvedLeaf]], mode),
        },
        person: {
          enumerable: true,
          value: hostileProperties([["title", resolvedLeaf]], mode),
        },
      })
      const hostileSlots = { data: slotData }

      const hostileLeaf = hostileProperties(
        [
          ["status", "resolved"],
          ["value", "private"],
          ["confidence", 0.8],
        ],
        mode
      )
      const hostileLeaves = {
        data: {
          company: { name: hostileLeaf },
          person: { title: hostileLeaf },
          sellsToSMB: hostileLeaf,
        },
      }
      snapshots.push(hostileData, hostileContainers, hostileSlots, hostileLeaves)
    }

    const staticTool = researchSonar(researchConfig)
    const dynamicTool = researchSonar({ dynamic: true, ttl: "12h" })
    // SAFETY: Every factory-owned tool defines this callback; the unknown input deliberately probes its public hostile-data boundary.
    const projectStatic = staticTool.toModelOutput as unknown as (
      snapshot: unknown
    ) => Projection | Promise<Projection>
    // SAFETY: Every factory-owned tool defines this callback; the unknown input deliberately probes its public hostile-data boundary.
    const projectDynamic = dynamicTool.toModelOutput as unknown as (
      snapshot: unknown
    ) => Projection | Promise<Projection>

    const projections = await Promise.all(
      snapshots.flatMap((snapshot) => [projectStatic(snapshot), projectDynamic(snapshot)])
    )
    for (const projection of projections) {
      expect(projection).toEqual({ type: "json", value: {} })
    }
    expect(getterReads.count).toBe(0)
  })

  test("uses the same projection shape for deep results", async () => {
    const tool = deepResearchSonar(deepConfig, {
      layer: clientLayer({ deepResearch: Stream.fromArray([completeDeep]) }),
    })

    const original = structuredClone(completeDeep)
    const projected = await tool.toModelOutput?.(completeDeep)
    expect(projected).toEqual({
      type: "json",
      value: {
        company: {
          legalName: {
            value: "Analytical Engines LLC",
            confidence: 0.91,
          },
        },
        hasTaxExposure: { value: "likely", confidence: 0.67 },
      },
    })
    if (
      projected?.type !== "json" ||
      typeof projected.value !== "object" ||
      projected.value === null
    ) {
      throw new Error("Expected Eve JSON model output")
    }
    expect(Object.keys(projected.value)).toEqual(["company", "hasTaxExposure"])
    expect(JSON.stringify(projected)).toContain(
      '"legalName":{"value":"Analytical Engines LLC","confidence":0.91}'
    )
    expect(JSON.stringify(projected)).toContain(
      '"hasTaxExposure":{"value":"likely","confidence":0.67}'
    )
    expect(completeDeep).toEqual(original)
  })

  test("preserves a legitimate jobFit answer while removing exact private metadata", async () => {
    const tool = researchSonar({
      ...researchConfig,
      research: { jobFit: "Is this person a fit for the role?" },
    })
    const resolved = (value: string) => ({
      confidence: 0.81,
      resolvedAt: "2026-08-26T18:00:00.000Z",
      sources: ["https://fixture.invalid/private"],
      status: "resolved" as const,
      value,
    })
    const snapshot = {
      status: "complete",
      data: {
        person: {},
        company: {},
        jobFit: resolved("strong"),
        jobId: resolved("job-private"),
        hash: resolved("hash-private"),
        cacheKey: resolved("cache-private"),
        provider: resolved("provider-private"),
        transport: resolved("transport-private"),
        headers: resolved("Authorization: Bearer private"),
        body: resolved("raw-body-private"),
      },
    }

    // SAFETY: Extra resolved leaves deliberately simulate hostile transport metadata at the projection boundary.
    const projected = await tool.toModelOutput?.(snapshot as never)
    expect(projected).toEqual({
      type: "json",
      value: { jobFit: { value: "strong", confidence: 0.81 } },
    })
    const serialized = JSON.stringify(projected)
    for (const forbidden of [
      "job-private",
      "hash-private",
      "cache-private",
      "provider-private",
      "transport-private",
      "Authorization",
      "raw-body-private",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test("treats configured custom keys as answers even when their names resemble metadata", async () => {
    const tool = researchSonar({
      ...researchConfig,
      research: {
        provider: "Which provider does the customer use?",
        cache: "Does the company sell caching software?",
        jobId: "What public job identifier is relevant?",
        hash: "Which public content hash did the customer publish?",
      },
    })
    const resolved = (value: string) => ({
      confidence: 0.8,
      resolvedAt: "2026-08-26T18:00:00.000Z",
      sources: [],
      status: "resolved" as const,
      value,
    })
    const snapshot = {
      status: "complete",
      data: {
        person: {},
        company: {},
        provider: resolved("Acme Cloud"),
        cache: resolved("yes"),
        jobId: resolved("public-role-42"),
        hash: resolved("public-content-hash"),
        rawBody: resolved("unconfigured-private-body"),
      },
    }

    // SAFETY: The configured custom leaves are valid answers; rawBody is an unconfigured hostile extra.
    const projected = await tool.toModelOutput?.(snapshot as never)
    expect(projected).toEqual({
      type: "json",
      value: {
        provider: { value: "Acme Cloud", confidence: 0.8 },
        cache: { value: "yes", confidence: 0.8 },
        jobId: { value: "public-role-42", confidence: 0.8 },
        hash: { value: "public-content-hash", confidence: 0.8 },
      },
    })
    expect(JSON.stringify(projected)).not.toContain("unconfigured-private-body")
  })

  test("projects every schema-valid dynamic custom answer without leaking envelope metadata", async () => {
    const tool = researchSonar({ dynamic: true, ttl: "12h" })
    const resolved = (value: string) => ({
      confidence: 0.8,
      resolvedAt: "2026-08-26T18:00:00.000Z",
      sources: ["https://fixture.invalid/private"],
      status: "resolved" as const,
      value,
    })
    const snapshot = {
      status: "complete",
      hash: "transport-envelope-hash",
      data: {
        person: {},
        company: {},
        jobFit: resolved("strong"),
        provider: resolved("Acme Cloud"),
        rawBody: resolved("caller-requested answer"),
        hash: resolved("public-content-hash"),
      },
    }

    // SAFETY: Every data leaf follows the dynamic output schema; the extra envelope hash probes projection isolation.
    const projected = await tool.toModelOutput?.(snapshot as never)
    expect(projected).toEqual({
      type: "json",
      value: {
        jobFit: { value: "strong", confidence: 0.8 },
        provider: { value: "Acme Cloud", confidence: 0.8 },
        rawBody: { value: "caller-requested answer", confidence: 0.8 },
        hash: { value: "public-content-hash", confidence: 0.8 },
      },
    })
    expect(JSON.stringify(projected)).not.toContain("transport-envelope-hash")
    expect(JSON.stringify(projected)).not.toContain("fixture.invalid")
    expect(JSON.stringify(projected)).not.toContain("resolvedAt")
  })
})

describe("cancellation", () => {
  const nextTurn = () => {
    const turn = Promise.withResolvers<undefined>()
    setImmediate(() => turn.resolve())
    return turn.promise
  }

  const verifyCancellation = async (form: "research" | "deep" | "background") => {
    const started = Promise.withResolvers<undefined>()
    let calls = 0
    let finalized = 0
    let emissions = 0
    const blocked = Stream.never.pipe(
      Stream.ensuring(
        Effect.sync(() => {
          finalized += 1
        })
      )
    )
    const layer = clientLayer({
      deepResearch: blocked,
      onDeepResearch: () => {
        calls += 1
        started.resolve()
      },
      onResearch: () => {
        calls += 1
        started.resolve()
      },
      research: blocked,
    })
    const controller = new AbortController()
    let result: Promise<unknown>
    if (form === "research") {
      result = collectResearch(researchSonar(researchConfig, { layer }), seed, controller.signal)
    } else if (form === "deep") {
      result = collectDeep(deepResearchSonar(deepConfig, { layer }), seed, controller.signal)
    } else {
      result = Promise.resolve(
        deepResearchSonar(deepConfig, { execution: "background", layer }).execute(
          seed,
          toolContext(controller.signal),
          unusedTask()
        )
      )
    }
    const observed = result.then(
      (values) => {
        emissions += Array.isArray(values) ? values.length : 1
        return "resolved" as const
      },
      () => "rejected" as const
    )

    await started.promise
    controller.abort("cancelled by Eve")
    expect(await Promise.race([observed, nextTurn().then(() => "still-running" as const)])).toBe(
      "rejected"
    )
    expect(calls).toBe(1)
    expect(finalized).toBe(1)
    expect(emissions).toBe(0)
    await nextTurn()
    expect({ calls, emissions, finalized }).toEqual({ calls: 1, emissions: 0, finalized: 1 })
  }

  test("interrupts research, deep foreground, and deep background promptly", async () => {
    await Promise.all([
      verifyCancellation("research"),
      verifyCancellation("deep"),
      verifyCancellation("background"),
    ])
  })
})

describe("error and secret safety", () => {
  const hostileError = () => {
    const privateToken = "sk_should_never_escape"
    const hostile = Object.assign(new Error("Research could not be completed"), {
      _tag: "SonarClientError",
      cause: new Error(`Authorization: Bearer ${privateToken}`),
      cacheKey: "cache-private",
      hash: "hash-private",
      jobId: "job-private",
      provider: "private-provider",
      rawBody: { detail: "upstream-private" },
      headers: { authorization: `Bearer ${privateToken}` },
      body: "raw-body-private",
    })
    const unknownHostile: unknown = hostile
    // SAFETY: The hostile fixture deliberately supplies extra private properties to a typed client error.
    return unknownHostile as SonarClientError
  }

  const assertSanitized = (thrown: unknown, publicMessage: RegExp) => {
    expect(thrown).toBeInstanceOf(Error)
    expect(String(thrown)).toMatch(publicMessage)
    const ownProperties =
      typeof thrown === "object" && thrown !== null ? Object.getOwnPropertyNames(thrown) : []
    for (const forbiddenProperty of [
      "cause",
      "stack",
      "rawBody",
      "jobId",
      "hash",
      "cacheKey",
      "provider",
      "headers",
      "body",
      "authorization",
    ]) {
      expect(ownProperties).not.toContain(forbiddenProperty)
    }
    const visible = JSON.stringify(thrown)
    for (const forbiddenText of [
      "sk_should_never_escape",
      "Authorization",
      "upstream-private",
      "job-private",
      "hash-private",
      "cache-private",
      "private-provider",
      "raw-body-private",
    ]) {
      expect(visible).not.toContain(forbiddenText)
    }
  }

  test("sanitizes research, deep foreground, and deep background failures structurally", async () => {
    const research = researchSonar(researchConfig, {
      layer: clientLayer({ research: Stream.fail(hostileError()) }),
    })
    const deep = deepResearchSonar(deepConfig, {
      layer: clientLayer({ deepResearch: Stream.fail(hostileError()) }),
    })
    const background = deepResearchSonar(deepConfig, {
      execution: "background",
      layer: clientLayer({ deepResearch: Stream.fail(hostileError()) }),
    })

    const capture = async (execution: Promise<unknown>) => {
      try {
        await execution
        throw new Error("Expected Sonar execution to fail")
      } catch (error) {
        return caughtError(error)
      }
    }
    const [researchError, deepError, backgroundError] = await Promise.all([
      capture(collectResearch(research, seed)),
      capture(collectDeep(deep, seed)),
      capture(
        Promise.resolve(
          background.execute(seed, toolContext(new AbortController().signal), unusedTask())
        )
      ),
    ])

    assertSanitized(researchError, /Research could not be completed/iu)
    assertSanitized(deepError, /Deep research could not be completed/iu)
    assertSanitized(backgroundError, /Deep research could not be completed/iu)
  })

  test("uses one package-owned tagged sanitized error family at every public failure boundary", async () => {
    const capture = async (operation: Promise<unknown>) => {
      try {
        await operation
        throw new Error("Expected operation to fail")
      } catch (error) {
        return caughtError(error)
      }
    }
    const captureFactory = (factory: () => void) => {
      try {
        factory()
        throw new Error("Expected factory to fail")
      } catch (error) {
        return caughtError(error)
      }
    }
    const validationTool = researchSonar(researchConfig, {
      layer: clientLayer({ research: Stream.fromArray([completeResearch]) }),
    })
    const serviceTool = researchSonar(researchConfig, {
      layer: clientLayer({ research: Stream.fail(hostileError()) }),
    })
    const previousBaseURL = process.env.SONAR_BASE_URL
    const previousSecretKey = process.env.SONAR_SECRET_KEY
    delete process.env.SONAR_BASE_URL
    delete process.env.SONAR_SECRET_KEY

    try {
      const configError = captureFactory(() => {
        researchSonar({ ...researchConfig, ttl: "private-invalid-ttl" })
      })
      // SAFETY: The invalid seed deliberately crosses the public runtime validation boundary.
      const validationError = await capture(collectResearch(validationTool, {} as never))
      const defaultLayerError = await capture(collectResearch(researchSonar(researchConfig), seed))
      const serviceError = await capture(collectResearch(serviceTool, seed))
      const failures = [configError, validationError, defaultLayerError, serviceError]
      const tags = failures.map((failure) =>
        typeof failure === "object" && failure !== null && "_tag" in failure
          ? failure._tag
          : undefined
      )
      const prototypes = failures.map((failure) =>
        typeof failure === "object" && failure !== null ? Object.getPrototypeOf(failure) : undefined
      )

      expect(tags.every((tag) => typeof tag === "string" && tag.startsWith("Sonar"))).toBe(true)
      expect(new Set(tags).size).toBe(1)
      expect(new Set(prototypes).size).toBe(1)
      for (const failure of failures) {
        assertSanitized(failure, /Sonar|Research|configuration|input/iu)
        expect(String(failure)).not.toContain("private-invalid-ttl")
      }
    } finally {
      if (previousBaseURL === undefined) {
        delete process.env.SONAR_BASE_URL
      } else {
        process.env.SONAR_BASE_URL = previousBaseURL
      }
      if (previousSecretKey === undefined) {
        delete process.env.SONAR_SECRET_KEY
      } else {
        process.env.SONAR_SECRET_KEY = previousSecretKey
      }
    }
  })

  test("uses an injected Layer with no environment key or network", async () => {
    const previousBaseURL = process.env.SONAR_BASE_URL
    const previousSecretKey = process.env.SONAR_SECRET_KEY
    const previousFetch = globalThis.fetch

    delete process.env.SONAR_BASE_URL
    delete process.env.SONAR_SECRET_KEY
    globalThis.fetch = Object.assign(
      () => Promise.reject(new Error("Network access is forbidden in deterministic Eve tests")),
      { preconnect() {} }
    )

    try {
      const tool = researchSonar(researchConfig, {
        layer: clientLayer({ research: Stream.fromArray([completeResearch]) }),
      })
      expect(await collectResearch(tool, seed)).toEqual([completeResearch])
    } finally {
      globalThis.fetch = previousFetch
      if (previousBaseURL === undefined) {
        delete process.env.SONAR_BASE_URL
      } else {
        process.env.SONAR_BASE_URL = previousBaseURL
      }
      if (previousSecretKey === undefined) {
        delete process.env.SONAR_SECRET_KEY
      } else {
        process.env.SONAR_SECRET_KEY = previousSecretKey
      }
    }
  })

  test("defers missing default-client configuration until execution", async () => {
    const previousBaseURL = process.env.SONAR_BASE_URL
    const previousSecretKey = process.env.SONAR_SECRET_KEY
    const previousFetch = globalThis.fetch

    delete process.env.SONAR_BASE_URL
    delete process.env.SONAR_SECRET_KEY
    let networkCalls = 0
    globalThis.fetch = Object.assign(
      () => {
        networkCalls += 1
        return Promise.reject(new Error("Unexpected network call"))
      },
      { preconnect() {} }
    )

    try {
      let tool: ReturnType<typeof researchSonar> | undefined
      expect(() => {
        tool = researchSonar(researchConfig)
      }).not.toThrow()
      expect(networkCalls).toBe(0)

      if (tool === undefined) {
        throw new Error("Factory did not return a tool")
      }
      await expect(collectResearch(tool, seed)).rejects.toThrow(
        /SONAR_BASE_URL|SONAR_SECRET_KEY|configuration/iu
      )
      expect(networkCalls).toBe(0)
    } finally {
      globalThis.fetch = previousFetch
      if (previousBaseURL === undefined) {
        delete process.env.SONAR_BASE_URL
      } else {
        process.env.SONAR_BASE_URL = previousBaseURL
      }
      if (previousSecretKey === undefined) {
        delete process.env.SONAR_SECRET_KEY
      } else {
        process.env.SONAR_SECRET_KEY = previousSecretKey
      }
    }
  })
})
