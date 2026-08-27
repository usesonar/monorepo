import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  spyOn,
} from "bun:test"

import { QueryCache } from "@tanstack/react-query"
import {
  TransportError,
  canonicalRequestIdentity,
  initialSnapshot,
  question,
} from "@usesonar/effect"
import type { SonarSeed } from "@usesonar/effect"
import { act, createElement, useEffect, useState } from "react"

import {
  createTestLayer,
  flushReact,
  installHappyDOM,
  mountTree,
  partialSnapshot,
  strict,
  terminalSnapshot,
  waitFor,
} from "../test/harness"
import type { MountedTree } from "../test/harness"
import { SonarProvider, useDeepSonar, useSonar } from "./index"
import type { SonarProviderProps } from "./index"

const researchConfig = {
  company: ["name"],
  person: ["title", "linkedin"],
  research: { sellsToSMB: question<boolean>("Does this company sell to SMBs?") },
  ttl: "12h",
} as const

const deepConfig = {
  company: ["legalName"],
  deepResearch: { usesQuickBooks: question<boolean>("Does it use QuickBooks?") },
  person: ["phone"],
  ttl: "7d",
} as const

const adaSeed = {
  context: { plan: "enterprise" },
  domain: "example.test",
  email: "ada@example.test",
  fullName: "Ada Lovelace",
} as const

type CapturedResult = {
  data: unknown
  error: unknown
  loading: boolean
  resolve: (seed: SonarSeed) => void
  status: unknown
}

type MutableResearchConfigFixture = {
  company: ("domain" | "name")[]
  person: ("github" | "title")[]
  research: { sellsToSMB: string }
  ttl: "12h" | "30d"
}

type MutableDeepConfigFixture = {
  company: "legalName"[]
  deepResearch: { usesQuickBooks: string }
  person: "phone"[]
  ttl: "7d" | "30d"
}

const emptyResult = (): CapturedResult => ({
  data: Symbol("not rendered"),
  error: Symbol("not rendered"),
  loading: true,
  resolve: () => {
    throw new Error("The hook has not rendered")
  },
  status: Symbol("not rendered"),
})

const mounted = new Set<MountedTree>()
let restoreDOM: (() => void) | undefined
let originalFetch: typeof globalThis.fetch

beforeAll(() => {
  restoreDOM = installHappyDOM()
  originalFetch = globalThis.fetch
})

beforeEach(() => {
  globalThis.fetch = () => Promise.reject(new Error("React verifier blocked an unexpected fetch"))
})

afterEach(async () => {
  jest.useRealTimers()
  await Promise.all([...mounted].map((tree) => tree.unmount()))
  mounted.clear()
})

afterAll(() => {
  globalThis.fetch = originalFetch
  restoreDOM?.()
})

const mount = async (element: ReturnType<typeof createElement>) => {
  const tree = await mountTree(element)
  mounted.add(tree)
  return tree
}

const provider = (
  layer: ReturnType<typeof createTestLayer>["layer"],
  children: ReturnType<typeof createElement>
) => {
  const props: SonarProviderProps = { children, layer }
  return createElement(SonarProvider, props)
}

const researchProbes = new WeakMap<CapturedResult, () => null>()
const captureResearch = (target: CapturedResult) => {
  const existing = researchProbes.get(target)
  if (existing) {
    return createElement(existing)
  }
  const ResearchProbe = () => {
    Object.assign(target, useSonar(researchConfig))
    return null
  }
  researchProbes.set(target, ResearchProbe)
  return createElement(ResearchProbe)
}

const deepResearchProbes = new WeakMap<CapturedResult, () => null>()
const captureDeepResearch = (target: CapturedResult) => {
  const existing = deepResearchProbes.get(target)
  if (existing) {
    return createElement(existing)
  }
  const DeepResearchProbe = () => {
    Object.assign(target, useDeepSonar(deepConfig))
    return null
  }
  deepResearchProbes.set(target, DeepResearchProbe)
  return createElement(DeepResearchProbe)
}

describe("Sonar hooks", () => {
  it("starts idle inside its own provider and dispatches each tier", async () => {
    const { layer, recorder } = createTestLayer()
    const research = emptyResult()
    const deepResearch = emptyResult()
    const Probes = () =>
      createElement("div", null, captureResearch(research), captureDeepResearch(deepResearch))

    await mount(strict(provider(layer, createElement(Probes))))

    expect(research).toMatchObject({
      data: null,
      error: null,
      loading: false,
      status: undefined,
    })
    expect(deepResearch).toMatchObject({
      data: null,
      error: null,
      loading: false,
      status: undefined,
    })

    await act(() => {
      research.resolve(adaSeed)
      deepResearch.resolve({ linkedinURL: "https://linkedin.com/in/ada" })
    })

    await waitFor(() => expect(recorder.starts).toHaveLength(2))
    expect(recorder.starts.map(({ tier }) => tier).toSorted()).toEqual(["deepResearch", "research"])
    await waitFor(() => {
      expect(research.status).toBe("pending")
      expect(deepResearch.status).toBe("pending")
      expect(research.loading).toBe(true)
      expect(deepResearch.loading).toBe(true)
    })

    recorder.starts[0]?.source.push(
      recorder.starts[0].tier === "research"
        ? terminalSnapshot(researchConfig)
        : terminalSnapshot(deepConfig)
    )
    recorder.starts[0]?.source.complete()
    recorder.starts[1]?.source.push(
      recorder.starts[1].tier === "research"
        ? terminalSnapshot(researchConfig)
        : terminalSnapshot(deepConfig)
    )
    recorder.starts[1]?.source.complete()

    await waitFor(() => {
      expect(research.status).toBe("complete")
      expect(deepResearch.status).toBe("complete")
      expect(research.loading).toBe(false)
      expect(deepResearch.loading).toBe(false)
    })
  })

  it("shares one stream for identical hook requests", async () => {
    const { layer, recorder } = createTestLayer()
    const first = emptyResult()
    const second = emptyResult()
    const Probes = () => createElement("div", null, captureResearch(first), captureResearch(second))
    await mount(strict(provider(layer, createElement(Probes))))

    await act(() => {
      first.resolve(adaSeed)
      second.resolve(adaSeed)
    })

    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    await waitFor(() => {
      expect(first.data).toEqual(initialSnapshot(researchConfig).data)
      expect(second.data).toEqual(first.data)
    })
  })

  it("keeps identical query keys isolated across provider instances", async () => {
    const firstSetup = createTestLayer()
    const secondSetup = createTestLayer()
    const first = emptyResult()
    const second = emptyResult()
    const firstTree = await mount(provider(firstSetup.layer, captureResearch(first)))
    const secondTree = await mount(provider(secondSetup.layer, captureResearch(second)))

    await act(() => {
      first.resolve(adaSeed)
      second.resolve(adaSeed)
    })
    await waitFor(() => {
      expect(firstSetup.recorder.starts).toHaveLength(1)
      expect(secondSetup.recorder.starts).toHaveLength(1)
    })

    firstSetup.recorder.starts[0]?.source.push(terminalSnapshot(researchConfig))
    firstSetup.recorder.starts[0]?.source.complete()
    secondSetup.recorder.starts[0]?.source.push(partialSnapshot(researchConfig))
    await waitFor(() => {
      expect(first.status).toBe("complete")
      expect(first.data).toEqual(terminalSnapshot(researchConfig).data)
      expect(second.status).toBe("pending")
      expect(second.data).toEqual(partialSnapshot(researchConfig).data)
    })

    await firstTree.unmount()
    mounted.delete(firstTree)
    await waitFor(() => {
      expect(firstSetup.recorder.disposals).toBe(1)
      expect(secondSetup.recorder.disposals).toBe(0)
      expect(secondSetup.recorder.cancellations).toBe(0)
      expect(second.status).toBe("pending")
    })

    await secondTree.unmount()
    mounted.delete(secondTree)
    await waitFor(() => {
      expect(secondSetup.recorder.cancellations).toBe(1)
      expect(secondSetup.recorder.disposals).toBe(1)
    })
  })

  it("deduplicates canonically equivalent config and seed values", async () => {
    const { layer, recorder } = createTestLayer()
    const first = emptyResult()
    const second = emptyResult()
    const equivalentConfig = {
      company: ["name"],
      person: ["title", "linkedin"],
      research: { sellsToSMB: question<boolean>("Does this company sell to SMBs?") },
      ttl: "12h",
    } as const
    const Probes = () => {
      Object.assign(first, useSonar(researchConfig))
      Object.assign(second, useSonar(equivalentConfig))
      return null
    }
    await mount(strict(provider(layer, createElement(Probes))))

    await act(() => {
      first.resolve({
        context: { plan: "enterprise" },
        domain: " EXAMPLE.TEST ",
        email: " ADA@EXAMPLE.TEST ",
        fullName: "Ada Lovelace",
      })
      second.resolve({
        context: { plan: "enterprise" },
        domain: "example.test",
        email: "ada@example.test",
        fullName: "Ada Lovelace",
      })
    })

    await waitFor(() => expect(recorder.starts).toHaveLength(1))
  })

  it("uses the exact canonical provider-local key and locked query defaults", async () => {
    const build = spyOn(QueryCache.prototype, "build")
    try {
      const { layer, recorder } = createTestLayer()
      const result = emptyResult()
      const seed = {
        context: { plan: "enterprise" },
        domain: " EXAMPLE.TEST ",
        email: " ADA@EXAMPLE.TEST ",
        fullName: "Ada Lovelace",
      }
      await mount(provider(layer, captureResearch(result)))
      await act(() => result.resolve(seed))
      await waitFor(() => expect(recorder.starts).toHaveLength(1))

      const canonical = JSON.parse(
        canonicalRequestIdentity({ config: researchConfig, seed, tier: "research" })
      )
      const expectedKey = ["sonar", "research", canonical.config, canonical.seed]
      const activeBuild = build.mock.calls.find(([, options]) => options.queryKey[1] === "research")

      expect(activeBuild?.[1].queryKey).toEqual(expectedKey)
      expect(activeBuild?.[0].getDefaultOptions().queries).toMatchObject({
        gcTime: 300_000,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        retryOnMount: false,
        staleTime: Number.POSITIVE_INFINITY,
      })
    } finally {
      build.mockRestore()
    }
  })

  it("surfaces an invalid LinkedIn URL through the query without throwing from render", async () => {
    const { layer } = createTestLayer()
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))

    await act(() => result.resolve({ linkedinURL: "not-a-url" }))

    await waitFor(() => {
      expect(result.error).toMatchObject({ _tag: "RequestError" })
      expect(result.loading).toBe(false)
    })
    expect(result.data).toBeNull()
    expect(result.status).toBeUndefined()
  })

  it("surfaces an invalid X URL through the query without throwing from render", async () => {
    const { layer } = createTestLayer()
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))

    await act(() => result.resolve({ fullName: "Ada Lovelace", xURL: "not-a-url" }))

    await waitFor(() => {
      expect(result.error).toMatchObject({ _tag: "RequestError" })
      expect(result.loading).toBe(false)
    })
    expect(result.data).toBeNull()
    expect(result.status).toBeUndefined()
  })

  it("captures the config from the render that supplied resolve", async () => {
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    const updatedConfig = {
      ...researchConfig,
      company: ["domain"] as const,
      person: ["github"] as const,
      ttl: "30d" as const,
    }
    let updated = false
    const Probe = () => {
      Object.assign(result, useSonar(updated ? updatedConfig : researchConfig))
      return null
    }
    const tree = await mount(provider(layer, createElement(Probe)))

    updated = true
    await tree.render(provider(layer, createElement(Probe)))
    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))

    const { seed: _seed, ...capturedConfig } = recorder.starts[0]?.request ?? {}
    expect(capturedConfig).toEqual(updatedConfig)
  })

  it("keeps the captured research request when config rerenders before stream start", async () => {
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    const updatedConfig = {
      ...researchConfig,
      research: { sellsToSMB: question<boolean>("Use the updated question.") },
      ttl: "30d" as const,
    }
    let renderedConfig: typeof researchConfig | typeof updatedConfig = researchConfig
    let resolveAndRerender: (() => void) | undefined
    const Probe = () => {
      const [, forceRender] = useState(0)
      Object.assign(result, useSonar(renderedConfig))
      useEffect(() => {
        resolveAndRerender = () => {
          result.resolve(adaSeed)
          renderedConfig = updatedConfig
          forceRender((value) => value + 1)
        }
      })
      return null
    }
    await mount(provider(layer, createElement(Probe)))

    const trigger = resolveAndRerender
    if (!trigger) {
      throw new Error("Research probe has not rendered")
    }
    await act(trigger)

    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    expect(recorder.starts[0]?.request).toEqual({ ...researchConfig, seed: adaSeed })
  })

  it("keeps the captured deep request when config rerenders before stream start", async () => {
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    const updatedConfig = {
      ...deepConfig,
      deepResearch: { usesQuickBooks: question<boolean>("Use the updated deep question.") },
      ttl: "30d" as const,
    }
    let renderedConfig: typeof deepConfig | typeof updatedConfig = deepConfig
    let resolveAndRerender: (() => void) | undefined
    const Probe = () => {
      const [, forceRender] = useState(0)
      Object.assign(result, useDeepSonar(renderedConfig))
      useEffect(() => {
        resolveAndRerender = () => {
          result.resolve(adaSeed)
          renderedConfig = updatedConfig
          forceRender((value) => value + 1)
        }
      })
      return null
    }
    await mount(provider(layer, createElement(Probe)))

    const trigger = resolveAndRerender
    if (!trigger) {
      throw new Error("Deep research probe has not rendered")
    }
    await act(trigger)

    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    expect(recorder.starts[0]?.request).toEqual({ ...deepConfig, seed: adaSeed })
  })

  it("snapshots mutable research config and seed values when resolve is called", async () => {
    const build = spyOn(QueryCache.prototype, "build")
    try {
      const { layer, recorder } = createTestLayer()
      const result = emptyResult()
      const config: MutableResearchConfigFixture = {
        company: ["name"],
        person: ["title"],
        research: { sellsToSMB: question<boolean>("Use the original question.") },
        ttl: "12h",
      }
      const seed = {
        context: { flags: ["original"], profile: { plan: "enterprise" } },
        email: "ada@example.test",
        fullName: "Ada Lovelace",
      }
      const expectedConfig = structuredClone(config)
      const expectedSeed = structuredClone(seed)
      const Probe = () => {
        Object.assign(result, useSonar(config))
        return null
      }
      await mount(provider(layer, createElement(Probe)))

      await act(() => {
        result.resolve(seed)
        config.company.splice(0, 1, "domain")
        config.person.splice(0, 1, "github")
        config.research.sellsToSMB = question<boolean>("Use the mutated question.")
        config.ttl = "30d"
        seed.email = "mutated@example.test"
        seed.context.flags.push("mutated")
        seed.context.profile.plan = "mutated"
      })

      await waitFor(() => expect(recorder.starts).toHaveLength(1))
      expect(recorder.starts[0]?.request).toEqual({ ...expectedConfig, seed: expectedSeed })

      const canonical = JSON.parse(
        canonicalRequestIdentity({ config: expectedConfig, seed: expectedSeed, tier: "research" })
      )
      const activeBuild = build.mock.calls.find(([, options]) => options.queryKey[1] === "research")
      expect(activeBuild?.[1].queryKey).toEqual([
        "sonar",
        "research",
        canonical.config,
        canonical.seed,
      ])
    } finally {
      build.mockRestore()
    }
  })

  it("snapshots mutable deep config and seed values when resolve is called", async () => {
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    const config: MutableDeepConfigFixture = {
      company: ["legalName"],
      deepResearch: { usesQuickBooks: question<boolean>("Use the original deep question.") },
      person: ["phone"],
      ttl: "7d",
    }
    const seed = {
      context: { flags: ["original"], profile: { plan: "enterprise" } },
      email: "ada@example.test",
      fullName: "Ada Lovelace",
    }
    const expectedConfig = structuredClone(config)
    const expectedSeed = structuredClone(seed)
    const Probe = () => {
      Object.assign(result, useDeepSonar(config))
      return null
    }
    await mount(provider(layer, createElement(Probe)))

    await act(() => {
      result.resolve(seed)
      config.company.splice(0)
      config.person.splice(0)
      config.deepResearch.usesQuickBooks = question<boolean>("Use the mutated deep question.")
      config.ttl = "30d"
      seed.email = "mutated@example.test"
      seed.context.flags.push("mutated")
      seed.context.profile.plan = "mutated"
    })

    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    expect(recorder.starts[0]?.request).toEqual({ ...expectedConfig, seed: expectedSeed })
  })

  it("keeps distinct requests isolated", async () => {
    const { layer, recorder } = createTestLayer()
    const first = emptyResult()
    const second = emptyResult()
    const Probes = () => createElement("div", null, captureResearch(first), captureResearch(second))
    await mount(provider(layer, createElement(Probes)))

    await act(() => {
      first.resolve(adaSeed)
      second.resolve({ email: "grace@example.test", fullName: "Grace Hopper" })
    })
    await waitFor(() => expect(recorder.starts).toHaveLength(2))

    recorder.starts[0]?.source.push(terminalSnapshot(researchConfig))
    recorder.starts[0]?.source.complete()
    await waitFor(() => {
      expect(first.status).toBe("complete")
      expect(second.status).toBe("pending")
    })
  })

  it("switches to the latest key and cancels the superseded stream", async () => {
    const { layer, recorder } = createTestLayer({ cooperativeCancellation: false })
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))

    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    const [superseded] = recorder.starts

    await act(() => result.resolve({ email: "grace@example.test", fullName: "Grace Hopper" }))
    await waitFor(() => {
      expect(recorder.starts).toHaveLength(2)
      expect(recorder.cancellations).toBe(1)
    })

    const latestPartial = partialSnapshot(researchConfig)
    recorder.starts[1]?.source.push(latestPartial)
    await waitFor(() => {
      expect(result.status).toBe("pending")
      expect(result.data).toEqual(latestPartial.data)
    })

    superseded?.source.push(terminalSnapshot(researchConfig))
    superseded?.source.complete()
    await flushReact()
    expect(result.status).toBe("pending")
    expect(result.data).toEqual(latestPartial.data)

    recorder.starts[1]?.source.push(terminalSnapshot(researchConfig))
    recorder.starts[1]?.source.complete()
    await waitFor(() => expect(result.status).toBe("complete"))
  })

  it("cancels only after the last shared observer detaches", async () => {
    const { layer, recorder } = createTestLayer()
    const first = emptyResult()
    const second = emptyResult()
    let showFirst = true
    let showSecond = true
    const Probes = () =>
      createElement(
        "div",
        null,
        showFirst ? captureResearch(first) : null,
        showSecond ? captureResearch(second) : null
      )
    const tree = await mount(provider(layer, createElement(Probes)))
    await act(() => {
      first.resolve(adaSeed)
      second.resolve(adaSeed)
    })
    await waitFor(() => expect(recorder.starts).toHaveLength(1))

    showFirst = false
    await tree.render(provider(layer, createElement(Probes)))
    expect(recorder.cancellations).toBe(0)

    showSecond = false
    await tree.render(provider(layer, createElement(Probes)))
    await waitFor(() => expect(recorder.cancellations).toBe(1))
  })

  it("does not duplicate a stream under React Strict Mode", async () => {
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    await mount(strict(provider(layer, captureResearch(result))))

    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(result.status).toBe("pending"))
    expect(recorder.starts).toHaveLength(1)
    expect(recorder.cancellations).toBe(0)
    expect(recorder.disposals).toBe(0)
  })

  it("reuses a completed same-key query inside one provider", async () => {
    const { layer, recorder } = createTestLayer()
    const first = emptyResult()
    const second = emptyResult()
    let visible: "first" | "second" | "none" = "first"
    const firstProbe = captureResearch(first)
    const secondProbe = captureResearch(second)
    const Probes = () => {
      if (visible === "first") {
        return firstProbe
      }
      return visible === "second" ? secondProbe : null
    }
    const tree = await mount(provider(layer, createElement(Probes)))

    await act(() => first.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    recorder.starts[0]?.source.push(terminalSnapshot(researchConfig))
    recorder.starts[0]?.source.complete()
    await waitFor(() => expect(first.status).toBe("complete"))

    visible = "none"
    await tree.render(provider(layer, createElement(Probes)))
    visible = "second"
    await tree.render(provider(layer, createElement(Probes)))
    await act(() => second.resolve(adaSeed))

    await waitFor(() => expect(second.status).toBe("complete"))
    expect(recorder.starts).toHaveLength(1)
  })

  it("retains a detached query just before five minutes and evicts it after", async () => {
    const { layer, recorder } = createTestLayer()
    const first = emptyResult()
    const second = emptyResult()
    const third = emptyResult()
    let visible: "first" | "second" | "third" | "none" = "first"
    const firstProbe = captureResearch(first)
    const secondProbe = captureResearch(second)
    const thirdProbe = captureResearch(third)
    const Probes = () => {
      if (visible === "first") {
        return firstProbe
      }
      if (visible === "second") {
        return secondProbe
      }
      return visible === "third" ? thirdProbe : null
    }
    const tree = await mount(provider(layer, createElement(Probes)))
    await act(() => first.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    recorder.starts[0]?.source.push(terminalSnapshot(researchConfig))
    recorder.starts[0]?.source.complete()
    await waitFor(() => expect(first.status).toBe("complete"))

    jest.useFakeTimers()
    visible = "none"
    await tree.render(provider(layer, createElement(Probes)))
    await act(() => jest.advanceTimersByTime(299_999))

    visible = "second"
    await tree.render(provider(layer, createElement(Probes)))
    await act(() => second.resolve(adaSeed))
    await waitFor(() => {
      expect(recorder.starts).toHaveLength(1)
      expect(second.status).toBe("complete")
    })

    visible = "none"
    await tree.render(provider(layer, createElement(Probes)))
    await act(() => jest.advanceTimersByTime(300_001))
    jest.useRealTimers()

    visible = "third"
    await tree.render(provider(layer, createElement(Probes)))
    await act(() => third.resolve(adaSeed))
    await waitFor(() => {
      expect(recorder.starts).toHaveLength(2)
      expect(third.status).toBe("pending")
    })
  })

  it("clears cached data and cancels active work on provider teardown", async () => {
    const { layer, recorder } = createTestLayer()
    const first = emptyResult()
    const firstTree = await mount(provider(layer, captureResearch(first)))
    await act(() => first.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))

    await firstTree.unmount()
    mounted.delete(firstTree)
    await waitFor(() => {
      expect(recorder.cancellations).toBe(1)
      expect(recorder.disposals).toBe(1)
    })

    const second = emptyResult()
    await mount(provider(layer, captureResearch(second)))
    await act(() => second.resolve(adaSeed))
    await waitFor(() => {
      expect(recorder.starts).toHaveLength(2)
      expect(second.status).toBe("pending")
    })
  })

  it("clears a completed cache entry on provider teardown", async () => {
    const { layer, recorder } = createTestLayer()
    const first = emptyResult()
    const firstTree = await mount(provider(layer, captureResearch(first)))
    await act(() => first.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    recorder.starts[0]?.source.push(terminalSnapshot(researchConfig))
    recorder.starts[0]?.source.complete()
    await waitFor(() => expect(first.status).toBe("complete"))

    await firstTree.unmount()
    mounted.delete(firstTree)
    await waitFor(() => expect(recorder.disposals).toBe(1))

    const second = emptyResult()
    await mount(provider(layer, captureResearch(second)))
    await act(() => second.resolve(adaSeed))
    await waitFor(() => {
      expect(recorder.starts).toHaveLength(2)
      expect(second.status).toBe("pending")
    })
  })

  it("does not refetch on focus, reconnect, remount, or a stable rerender", async () => {
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    const tree = await mount(provider(layer, captureResearch(result)))
    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    recorder.starts[0]?.source.push(terminalSnapshot(researchConfig))
    recorder.starts[0]?.source.complete()
    await waitFor(() => expect(result.loading).toBe(false))

    window.dispatchEvent(new Event("focus"))
    window.dispatchEvent(new Event("online"))
    await tree.render(provider(layer, captureResearch(result)))
    await flushReact()

    expect(recorder.starts).toHaveLength(1)
  })

  it("preserves partial data on a typed error and clears it on a later resolve", async () => {
    const clientError = new TransportError({ message: "fixture failed" })
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))

    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    const expectedPartial = partialSnapshot(researchConfig)
    recorder.starts[0]?.source.push(expectedPartial)
    recorder.starts[0]?.source.fail(clientError)
    await waitFor(() => expect(result.error).toBe(clientError))
    expect(result.status).toBe("pending")
    expect(result.data).toEqual(expectedPartial.data)
    expect(result.loading).toBe(false)
    await flushReact()
    expect(recorder.starts).toHaveLength(1)

    await act(() => result.resolve({ email: "grace@example.test", fullName: "Grace Hopper" }))
    await waitFor(() => expect(recorder.starts).toHaveLength(2))
    recorder.starts[1]?.source.push(terminalSnapshot(researchConfig))
    recorder.starts[1]?.source.complete()
    await waitFor(() => {
      expect(result.error).toBeNull()
      expect(result.status).toBe("complete")
    })
  })

  it("rejects stream EOF before complete while preserving pending data", async () => {
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))

    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    const expectedPartial = partialSnapshot(researchConfig)
    recorder.starts[0]?.source.push(expectedPartial)
    recorder.starts[0]?.source.complete()

    await waitFor(() => {
      expect(result.error).toMatchObject({ _tag: "ProtocolError" })
      expect(result.loading).toBe(false)
    })
    expect(result.status).toBe("pending")
    expect(result.data).toEqual(expectedPartial.data)
  })

  it("accepts pending progression followed by one complete snapshot", async () => {
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))

    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    const expectedPartial = partialSnapshot(researchConfig)
    recorder.starts[0]?.source.push(expectedPartial)
    await waitFor(() => expect(result.data).toEqual(expectedPartial.data))

    const expectedTerminal = terminalSnapshot(researchConfig)
    recorder.starts[0]?.source.push(expectedTerminal)
    recorder.starts[0]?.source.complete()
    await waitFor(() => {
      expect(result.error).toBeNull()
      expect(result.loading).toBe(false)
      expect(result.status).toBe("complete")
    })
    expect(result.data).toEqual(expectedTerminal.data)
  })

  it("rejects an initial pending snapshot that already contains a resolved leaf", async () => {
    const { layer, recorder } = createTestLayer({ emitInitialSnapshot: false })
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))

    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    recorder.starts[0]?.source.push(partialSnapshot(researchConfig))

    await waitFor(() => {
      expect(result.error).toMatchObject({ _tag: "ProtocolError" })
      expect(result.loading).toBe(false)
    })
    expect(result.data).toBeNull()
    expect(result.status).toBeUndefined()
  })

  it("rejects a terminal leaf regressing to pending and preserves the latest partial", async () => {
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))

    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    const expectedPartial = partialSnapshot(researchConfig)
    recorder.starts[0]?.source.push(expectedPartial)
    await waitFor(() => expect(result.data).toEqual(expectedPartial.data))
    recorder.starts[0]?.source.push(initialSnapshot(researchConfig))

    await waitFor(() => {
      expect(result.error).toMatchObject({ _tag: "ProtocolError" })
      expect(result.loading).toBe(false)
    })
    expect(result.data).toEqual(expectedPartial.data)
    expect(result.status).toBe("pending")
  })

  it("rejects a terminal leaf changing value and preserves the latest partial", async () => {
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))

    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    const expectedPartial = partialSnapshot(researchConfig)
    recorder.starts[0]?.source.push(expectedPartial)
    await waitFor(() => expect(result.data).toEqual(expectedPartial.data))
    const { title } = expectedPartial.data.person
    if (title?.status !== "resolved") {
      throw new Error("Partial fixture did not resolve the expected title field")
    }
    recorder.starts[0]?.source.pushMalformed({
      data: {
        ...expectedPartial.data,
        person: {
          ...expectedPartial.data.person,
          title: { ...title, value: "mutated-title-value" },
        },
      },
      status: "pending",
    })

    await waitFor(() => {
      expect(result.error).toMatchObject({ _tag: "ProtocolError" })
      expect(result.loading).toBe(false)
    })
    expect(result.data).toEqual(expectedPartial.data)
    expect(result.status).toBe("pending")
  })

  it("rejects an initial snapshot with a requested leaf inherited instead of owned", async () => {
    const { layer, recorder } = createTestLayer({ emitInitialSnapshot: false })
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))

    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    const pending = initialSnapshot(researchConfig)
    const person = { linkedin: pending.data.person.linkedin }
    Object.setPrototypeOf(person, { title: pending.data.person.title })
    recorder.starts[0]?.source.pushMalformed({
      data: { ...pending.data, person },
      status: "pending",
    })

    await waitFor(() => {
      expect(result.error).toMatchObject({ _tag: "ProtocolError" })
      expect(result.loading).toBe(false)
    })
    expect(result.data).toBeNull()
    expect(result.status).toBeUndefined()
  })

  it("rejects a complete snapshot before the initial pending snapshot", async () => {
    const { layer, recorder } = createTestLayer({ emitInitialSnapshot: false })
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))

    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    recorder.starts[0]?.source.push(terminalSnapshot(researchConfig))
    recorder.starts[0]?.source.complete()

    await waitFor(() => {
      expect(result.error).toMatchObject({ _tag: "ProtocolError" })
      expect(result.loading).toBe(false)
    })
    expect(result.data).toBeNull()
    expect(result.status).toBeUndefined()
  })

  it("rejects snapshots after complete without regressing terminal data", async () => {
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))

    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    const expectedTerminal = terminalSnapshot(researchConfig)
    recorder.starts[0]?.source.push(expectedTerminal)
    recorder.starts[0]?.source.push(partialSnapshot(researchConfig))
    recorder.starts[0]?.source.complete()

    await waitFor(() => {
      expect(result.error).toMatchObject({ _tag: "ProtocolError" })
      expect(result.loading).toBe(false)
    })
    expect(result.status).toBe("complete")
    expect(result.data).toEqual(expectedTerminal.data)
  })

  it("surfaces malformed client output as a protocol error", async () => {
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))
    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(result.status).toBe("pending"))

    recorder.starts[0]?.source.pushMalformed({
      data: { company: {}, person: {} },
      status: "complete",
    })
    await waitFor(() => {
      expect(result.error).toMatchObject({ _tag: "ProtocolError" })
      expect(result.loading).toBe(false)
      expect(result.data).toEqual(initialSnapshot(researchConfig).data)
    })
  })

  it("never exposes hashes or backend metadata through the consumer result", async () => {
    const { layer, recorder } = createTestLayer()
    const result = emptyResult()
    await mount(provider(layer, captureResearch(result)))
    await act(() => result.resolve(adaSeed))
    await waitFor(() => expect(recorder.starts).toHaveLength(1))
    recorder.starts[0]?.source.push(terminalSnapshot(researchConfig))
    recorder.starts[0]?.source.complete()
    await waitFor(() => expect(result.status).toBe("complete"))

    expect(Object.keys(result).toSorted()).toEqual([
      "data",
      "error",
      "loading",
      "resolve",
      "status",
    ])
    for (const key of ["hash", "jobId", "provider", "cacheKey"]) {
      expect(result).not.toHaveProperty(key)
      expect(JSON.stringify({ data: result.data, status: result.status })).not.toContain(`"${key}"`)
    }
  })

  it("fails clearly when a hook is rendered without SonarProvider", async () => {
    const Probe = () => {
      useSonar(researchConfig)
      return null
    }

    await expect(mountTree(createElement(Probe))).rejects.toThrow(/SonarProvider/u)
  })
})
