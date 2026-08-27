/* eslint-disable anti-slop/no-chained-type-assertions, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, eslint/no-extend-native, sort-keys, typescript/consistent-type-definitions, typescript/no-explicit-any, unicorn/consistent-function-scoping -- This adversarial verifier preserves genuine interface probes, inspects untrusted Standard Schema values, safely restores deliberate Object.prototype pollution, probes explicit any escape hatches, and preserves required field order. */
import { describe, expect, expectTypeOf, test } from "bun:test"

import { question } from "@usesonar/effect"
import type {
  DeepResearchConfig,
  Field,
  JSONValue,
  ResearchConfig,
  SonarSeed,
} from "@usesonar/effect"
import { Schema } from "effect"

import * as Eve from "./index.js"
import { deepResearchSonar, researchSonar } from "./index.js"

type ValidationResult = { readonly issues: readonly unknown[] } | { readonly value: unknown }

type StandardProperties = {
  readonly jsonSchema?: {
    readonly input: (options: { readonly target: string }) => Record<string, unknown>
    readonly output: (options: { readonly target: string }) => Record<string, unknown>
  }
  readonly validate: (value: unknown) => ValidationResult | Promise<ValidationResult>
}

type JSONSchemaObject = {
  readonly properties?: Record<string, JSONSchemaObject>
  readonly required?: readonly string[]
}

const standardProperties = (schema: unknown): StandardProperties => {
  if (
    (typeof schema !== "object" && typeof schema !== "function") ||
    schema === null ||
    !("~standard" in schema)
  ) {
    throw new Error("Expected an Effect Schema exposed through Standard Schema")
  }
  const properties = schema["~standard"]
  if (
    typeof properties !== "object" ||
    properties === null ||
    !("validate" in properties) ||
    typeof properties.validate !== "function"
  ) {
    throw new Error("Expected Standard Schema validation")
  }
  // SAFETY: The runtime guard above proves this property is callable; Standard Schema owns its signature.
  const validateProperty = properties.validate as StandardProperties["validate"]
  return { ...properties, validate: validateProperty }
}

const validate = (schema: unknown, value: unknown) => standardProperties(schema).validate(value)

const expectValid = async (schema: unknown, value: unknown) => {
  const result = await validate(schema, value)
  expect("issues" in result ? result.issues : undefined).toBeUndefined()
}

const expectInvalid = async (schema: unknown, value: unknown) => {
  const result = await validate(schema, value)
  expect("issues" in result ? result.issues.length : 0).toBeGreaterThan(0)
}

const decoded = async (schema: unknown, value: unknown) => {
  const result = await validate(schema, value)
  if ("issues" in result) {
    throw new Error("Expected valid decoded input")
  }
  return result.value
}

const withObjectPrototypeProperties = (
  entries: readonly (readonly [PropertyKey, PropertyDescriptor])[],
  run: () => void
) => {
  const originals = entries.map(
    ([key]) => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)] as const
  )
  try {
    for (const [key, descriptor] of entries) {
      Object.defineProperty(Object.prototype, key, { ...descriptor, configurable: true })
    }
    run()
  } finally {
    for (const [key, descriptor] of originals.toReversed()) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(Object.prototype, key)
      } else {
        Object.defineProperty(Object.prototype, key, descriptor)
      }
    }
  }
}

const researchConfig = {
  company: ["name", "domain"] as const,
  person: ["title", "linkedin"] as const,
  research: {
    sellsToSMB: "Does this company sell to small and medium businesses?",
    usesQuickBooks: "Does this company use QuickBooks?",
  },
  ttl: "12h",
} as const

const deepConfig = {
  company: ["legalName"] as const,
  deepResearch: {
    hasTaxExposure: "Does this company have multi-state tax exposure?",
  },
  person: ["phone"] as const,
  ttl: "365d",
} as const

describe("public factory contract", () => {
  test("exports exactly the two public factories", () => {
    expect(Object.keys(Eve).toSorted()).toEqual(["deepResearchSonar", "researchSonar"])
    expect(researchSonar).toBeFunction()
    expect(deepResearchSonar).toBeFunction()
  })

  test("pins external dependencies and uses an exact publishable internal version", async () => {
    const manifest: unknown = await Bun.file(new URL("../package.json", import.meta.url)).json()
    if (typeof manifest !== "object" || manifest === null || !("dependencies" in manifest)) {
      throw new Error("Expected package dependencies")
    }
    const { dependencies } = manifest
    if (typeof dependencies !== "object" || dependencies === null) {
      throw new Error("Expected package dependencies")
    }
    expect(dependencies).toEqual({
      "@usesonar/effect": expect.stringMatching(
        /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
      ),
      effect: "4.0.0-rc.112",
      eve: "0.45.1",
    })
    expect(JSON.stringify(dependencies)).not.toContain("workspace:")
  })

  test("returns Eve tool definitions with foreground execution by default", () => {
    const research = researchSonar(researchConfig)
    const deep = deepResearchSonar(deepConfig)

    expect(research.execution).toBeUndefined()
    expect(deep.execution).toBeUndefined()
    expect(research.execute).toBeFunction()
    expect(deep.execute).toBeFunction()
    expect(research.toModelOutput).toBeFunction()
    expect(deep.toModelOutput).toBeFunction()
  })

  test("allows only deep research to opt into Eve background execution", () => {
    const background = deepResearchSonar(deepConfig, { execution: "background" })
    expect(background.execution).toBe("background")

    const assertOptionTypes = () => {
      // @ts-expect-error Research is always an ordinary foreground Eve tool.
      researchSonar(researchConfig, { execution: "background" })
      // @ts-expect-error Tool approval remains owned by the Sonar factory.
      researchSonar(researchConfig, { approval: true })
      // @ts-expect-error Callers cannot replace the generated input schema.
      researchSonar(researchConfig, { inputSchema: {} })
      // @ts-expect-error Callers cannot replace execution.
      deepResearchSonar(deepConfig, { execute: () => ({}) })
      // @ts-expect-error Callers cannot replace model output projection.
      deepResearchSonar(deepConfig, { toModelOutput: () => ({}) })
    }
    expectTypeOf(assertOptionTypes).toBeFunction()
  })

  test("keeps tool behavior out of enrichment config", () => {
    const assertConfigTypes = () => {
      // @ts-expect-error Description is a factory option, not enrichment config.
      researchSonar({ ...researchConfig, description: "replacement" })
      // @ts-expect-error Execution is a factory option, not enrichment config.
      deepResearchSonar({ ...deepConfig, execution: "background" })
      // @ts-expect-error Dynamic mode cannot expose developer-owned TTL through model input.
      researchSonar({ dynamic: true })
    }
    expectTypeOf(assertConfigTypes).toBeFunction()
  })
})

describe("generated descriptions", () => {
  test("lists static fields in exact configured order and appends caller prose", () => {
    const appendix = "Prefer this after the user confirms the identity."
    const { description } = researchSonar(researchConfig, { description: appendix })
    const orderedTokens = ["title", "linkedin", "name", "domain", "sellsToSMB", "usesQuickBooks"]

    let cursor = -1
    for (const token of orderedTokens) {
      const next = description.indexOf(token)
      expect(next).toBeGreaterThan(cursor)
      cursor = next
    }
    expect(description).toMatch(/seconds/iu)
    expect(description.endsWith(appendix)).toBe(true)
    expect(researchSonar(researchConfig).description).toBe(
      researchSonar(researchConfig).description
    )
  })

  test("describes deep latency without claiming background execution by default", () => {
    const foreground = deepResearchSonar(deepConfig).description
    const background = deepResearchSonar(deepConfig, {
      execution: "background",
    }).description

    expect(foreground).toMatch(/minutes/iu)
    expect(foreground).not.toMatch(/later turn|delegat|poll/iu)
    expect(background).toMatch(/minutes/iu)
    expect(background).not.toMatch(/delegat|poll|task\.send/iu)
  })

  test("lists the full selectable catalog for dynamic tools", () => {
    const research = researchSonar({ dynamic: true, ttl: "12h" }).description
    const deep = deepResearchSonar({ dynamic: true, ttl: "12h" }).description

    for (const field of [
      "linkedin",
      "title",
      "x",
      "github",
      "domain",
      "name",
      "logo",
      "colors",
      "location",
      "description",
      "funding",
    ]) {
      expect(research).toContain(field)
    }
    expect(research.indexOf("linkedin")).toBeLessThan(research.indexOf("domain"))
    expect(research).toMatch(/seconds/iu)
    expect(deep).toContain("phone")
    expect(deep).toContain("legalName")
    expect(deep.indexOf("phone")).toBeLessThan(deep.indexOf("legalName"))
    expect(deep).toMatch(/minutes/iu)
  })
})

describe("Effect Schema compatibility", () => {
  test("keeps actual Effect Schema values while exposing Standard Schema and JSON Schema", () => {
    for (const schema of [
      researchSonar(researchConfig).inputSchema,
      researchSonar(researchConfig).outputSchema,
      deepResearchSonar(deepConfig).inputSchema,
      deepResearchSonar(deepConfig).outputSchema,
    ]) {
      expect(Schema.isSchema(schema)).toBe(true)
      const properties = standardProperties(schema)
      expect(properties.jsonSchema).toBeDefined()
      const inputJSONSchema = properties.jsonSchema?.input({ target: "draft-2020-12" })
      const outputJSONSchema = properties.jsonSchema?.output({ target: "draft-2020-12" })
      expect(inputJSONSchema).toBeObject()
      expect(outputJSONSchema).toBeObject()
    }
  })

  test("uses the shared SonarSeed boundary for trimming and strict email/domain rejection", async () => {
    const staticSchema = researchSonar(researchConfig).inputSchema
    const dynamicSchema = deepResearchSonar({ dynamic: true, ttl: "12h" }).inputSchema
    expect(
      await decoded(staticSchema, {
        domain: "  analytical-engines.example  ",
        email: "ada@example.com",
        fullName: "  Ada Lovelace  ",
      })
    ).toEqual({
      domain: "analytical-engines.example",
      email: "ada@example.com",
      fullName: "Ada Lovelace",
    })
    expect(
      await decoded(dynamicSchema, {
        company: ["legalName"],
        deepResearch: {},
        domain: "  analytical-engines.example  ",
        email: "ada@example.com",
        fullName: "  Ada Lovelace  ",
        person: [],
      })
    ).toMatchObject({
      domain: "analytical-engines.example",
      fullName: "Ada Lovelace",
    })

    await Promise.all(
      [".a@example.com", "a..b@example.com", "a@-example.com"].map((email) =>
        expectInvalid(staticSchema, { email, fullName: "Ada Lovelace" })
      )
    )
    await expectInvalid(staticSchema, {
      domain: "   ",
      linkedinURL: "https://linkedin.com/in/ada",
    })
  })

  test("models full snapshots with ordered nested built-ins and top-level custom keys", async () => {
    const schema = researchSonar(researchConfig).outputSchema
    const properties = standardProperties(schema)
    // SAFETY: Standard JSON Schema conversion returns an object; this verifier reads only optional object properties.
    const output = properties.jsonSchema?.output({ target: "draft-2020-12" }) as JSONSchemaObject
    const rootProperties = output.properties ?? {}
    const dataProperties = rootProperties.data?.properties ?? {}

    expect(Object.keys(rootProperties)).toEqual(["status", "data"])
    expect(Object.keys(dataProperties)).toEqual([
      "person",
      "company",
      "sellsToSMB",
      "usesQuickBooks",
    ])
    expect(Object.keys(dataProperties.person?.properties ?? {})).toEqual(["title", "linkedin"])
    expect(Object.keys(dataProperties.company?.properties ?? {})).toEqual(["name", "domain"])

    const complete = {
      status: "complete",
      data: {
        person: {
          title: {
            status: "resolved",
            value: "Founder",
            confidence: 0.9,
            sources: [],
            resolvedAt: "2026-08-26T00:00:00.000Z",
          },
          linkedin: { status: "pending" },
        },
        company: {
          name: { status: "pending" },
          domain: { status: "notFound" },
        },
        sellsToSMB: { status: "pending" },
        usesQuickBooks: { status: "skipped", reason: "noCompanySeed" },
      },
    }
    await expectValid(schema, complete)
    await expectInvalid(schema, {
      status: "complete",
      data: { person: complete.data.person, company: complete.data.company, research: {} },
    })
  })

  test("lets dynamic output select built-ins and add top-level custom answers", async () => {
    const schema = researchSonar({ dynamic: true, ttl: "12h" }).outputSchema
    await expectValid(schema, {
      status: "complete",
      data: {
        person: { title: { status: "pending" } },
        company: { name: { status: "pending" } },
        dynamicAnswer: { status: "pending" },
      },
    })
    await expectInvalid(schema, {
      status: "complete",
      data: { person: {}, company: {}, research: { dynamicAnswer: { status: "pending" } } },
    })
  })

  test("accepts every valid static seed prerequisite branch", async () => {
    const schema = researchSonar(researchConfig).inputSchema

    await expectValid(schema, { linkedinURL: "https://www.linkedin.com/in/ada" })
    await expectValid(schema, {
      fullName: "Ada Lovelace",
      xURL: "https://x.com/ada",
    })
    await expectValid(schema, {
      email: "ada@example.com",
      fullName: "Ada Lovelace",
    })
    await expectValid(schema, {
      context: {
        active: true,
        count: 3,
        nested: [null, "customer", { score: 0.8 }],
      },
      domain: "example.com",
      linkedinURL: "https://www.linkedin.com/in/ada",
    })
  })

  test("rejects absent and partial seed prerequisites before execution", async () => {
    const schema = researchSonar(researchConfig).inputSchema

    await Promise.all(
      [
        {},
        { domain: "example.com" },
        { email: "ada@example.com" },
        { fullName: "Ada Lovelace" },
        { xURL: "https://x.com/ada" },
        { email: "not-an-email", fullName: "Ada Lovelace" },
        { linkedinURL: "not-a-url" },
        { fullName: "Ada Lovelace", xURL: "not-a-url" },
        { linkedinURL: "https://linkedin.com/in/ada", unknown: true },
        { context: { value: undefined }, linkedinURL: "https://linkedin.com/in/ada" },
        { context: new Date(), linkedinURL: "https://linkedin.com/in/ada" },
      ].map((input) => expectInvalid(schema, input))
    )
  })

  test("keeps dynamic selection under tier maps while TTL stays out of input", async () => {
    const research = researchSonar({ dynamic: true, ttl: "12h" }).inputSchema
    const deep = deepResearchSonar({ dynamic: true, ttl: "365d" }).inputSchema

    await expectValid(research, {
      company: ["name", "funding"],
      linkedinURL: "https://linkedin.com/in/ada",
      person: ["title"],
      research: { sellsToSMB: "Does this company sell to SMBs?" },
    })
    await expectValid(deep, {
      company: ["legalName"],
      deepResearch: { hasTaxExposure: "Does it have tax exposure?" },
      email: "ada@example.com",
      fullName: "Ada Lovelace",
      person: ["phone"],
    })

    await Promise.all(
      [
        {
          linkedinURL: "https://linkedin.com/in/ada",
          person: ["phone"],
        },
        {
          company: ["legalName"],
          linkedinURL: "https://linkedin.com/in/ada",
        },
        {
          linkedinURL: "https://linkedin.com/in/ada",
          research: { BadKey: "Question?" },
        },
        {
          linkedinURL: "https://linkedin.com/in/ada",
          research: { person: "Question?" },
        },
        {
          linkedinURL: "https://linkedin.com/in/ada",
          research: { validKey: "" },
        },
        {
          linkedinURL: "https://linkedin.com/in/ada",
          ttl: "7d",
        },
        { linkedinURL: "https://linkedin.com/in/ada" },
      ].map((input) => expectInvalid(research, input))
    )

    await expectInvalid(deep, {
      deepResearch: { research: "Question?" },
      linkedinURL: "https://linkedin.com/in/ada",
    })
    await expectInvalid(deep, {
      linkedinURL: "https://linkedin.com/in/ada",
      person: ["title"],
    })
  })

  test("validates compact TTL boundaries and custom config keys", () => {
    expect(() => researchSonar({ ...researchConfig, ttl: "12h" })).not.toThrow()
    expect(() => researchSonar({ ...researchConfig, ttl: "365d" })).not.toThrow()
    expect(() => researchSonar({ ...researchConfig, ttl: "11h" })).toThrow()
    expect(() => researchSonar({ ...researchConfig, ttl: "366d" })).toThrow()
    expect(() => researchSonar({ ...researchConfig, ttl: "1y" })).toThrow()
    expect(() => researchSonar({ ...researchConfig, ttl: "12 hours" })).toThrow()

    // SAFETY: This verifier deliberately calls the public runtime boundary with untyped JavaScript input.
    const invokeResearch = researchSonar as unknown as (config: unknown) => void
    for (const research of [
      { BadKey: "Question?" },
      { snake_case: "Question?" },
      { person: "Question?" },
      { company: "Question?" },
      { research: "Question?" },
      { deepResearch: "Question?" },
      { ttl: "Question?" },
    ]) {
      expect(() => invokeResearch({ ...researchConfig, research })).toThrow()
    }
  })

  test("rejects symbol, non-enumerable, and accessor question properties", () => {
    // SAFETY: This verifier deliberately calls the public runtime boundary with untyped JavaScript input.
    const invokeResearch = researchSonar as unknown as (config: unknown) => void
    // SAFETY: This verifier deliberately calls the public runtime boundary with untyped JavaScript input.
    const invokeDeep = deepResearchSonar as unknown as (config: unknown) => void
    let accessorReads = 0
    const withSymbol = () => {
      const questions = { goodKey: "Question?" }
      Object.defineProperty(questions, Symbol("question"), {
        enumerable: true,
        value: "Hidden symbol question?",
      })
      return questions
    }
    const withNonEnumerable = () => {
      const questions = { goodKey: "Question?" }
      Object.defineProperty(questions, "hiddenKey", {
        enumerable: false,
        value: "Hidden question?",
      })
      return questions
    }
    const withAccessor = () => {
      const questions = { goodKey: "Question?" }
      Object.defineProperty(questions, "accessorKey", {
        enumerable: true,
        get() {
          accessorReads += 1
          return "Accessor question?"
        },
      })
      return questions
    }

    for (const makeQuestions of [withSymbol, withNonEnumerable, withAccessor]) {
      expect(() => invokeResearch({ ...researchConfig, research: makeQuestions() })).toThrow()
      expect(() => invokeDeep({ ...deepConfig, deepResearch: makeQuestions() })).toThrow()
    }
    expect(accessorReads).toBe(0)
  })

  test("rejects symbol properties on top-level configs and options", () => {
    // SAFETY: This verifier deliberately calls the public runtime boundary with untyped JavaScript input.
    const invokeResearch = researchSonar as unknown as (config: unknown, options?: unknown) => void
    // SAFETY: This verifier deliberately calls the public runtime boundary with untyped JavaScript input.
    const invokeDeep = deepResearchSonar as unknown as (config: unknown, options?: unknown) => void
    const researchWithSymbol = { ...researchConfig }
    const deepWithSymbol = { ...deepConfig }
    const researchOptionsWithSymbol = { description: "Research description" }
    const deepOptionsWithSymbol = {
      description: "Deep research description",
      execution: "background",
    }

    Object.defineProperty(researchWithSymbol, Symbol("config"), {
      enumerable: true,
      value: "private",
    })
    Object.defineProperty(deepWithSymbol, Symbol("config"), {
      enumerable: true,
      value: "private",
    })
    Object.defineProperty(researchOptionsWithSymbol, Symbol("options"), {
      enumerable: true,
      value: "private",
    })
    Object.defineProperty(deepOptionsWithSymbol, Symbol("options"), {
      enumerable: true,
      value: "private",
    })

    expect(() => invokeResearch(researchWithSymbol)).toThrow()
    expect(() => invokeDeep(deepWithSymbol)).toThrow()
    expect(() => invokeResearch(researchConfig, researchOptionsWithSymbol)).toThrow()
    expect(() => invokeDeep(deepConfig, deepOptionsWithSymbol)).toThrow()
  })

  test("requires static and dynamic discriminators to be own properties", () => {
    // SAFETY: This verifier deliberately calls the public runtime boundary with untyped JavaScript input.
    const invokeResearch = researchSonar as unknown as (config: unknown) => void
    // SAFETY: This verifier deliberately calls the public runtime boundary with untyped JavaScript input.
    const invokeDeep = deepResearchSonar as unknown as (config: unknown) => void

    for (const key of ["ttl", "person", "company", "research"] as const) {
      const config = { ...researchConfig }
      const inherited = config[key]
      Reflect.deleteProperty(config, key)
      withObjectPrototypeProperties(
        [[key, { enumerable: true, value: inherited, writable: true }]],
        () => expect(() => invokeResearch(config)).toThrow()
      )
    }
    for (const key of ["ttl", "person", "company", "deepResearch"] as const) {
      const config = { ...deepConfig }
      const inherited = config[key]
      Reflect.deleteProperty(config, key)
      withObjectPrototypeProperties(
        [[key, { enumerable: true, value: inherited, writable: true }]],
        () => expect(() => invokeDeep(config)).toThrow()
      )
    }
    withObjectPrototypeProperties(
      [["dynamic", { enumerable: true, value: true, writable: true }]],
      () => {
        expect(() => invokeResearch({ ttl: "12h" })).toThrow()
        expect(() => invokeDeep({ ttl: "12h" })).toThrow()
      }
    )
  })

  test("ignores inherited dynamic values when classifying valid static configs", () => {
    const researchDescription = researchSonar(researchConfig).description
    const deepDescription = deepResearchSonar(deepConfig).description
    let getterReads = 0
    const staticDescriptions: string[] = []

    withObjectPrototypeProperties(
      [["dynamic", { enumerable: true, value: true, writable: true }]],
      () => {
        staticDescriptions.push(
          researchSonar(researchConfig).description,
          deepResearchSonar(deepConfig).description
        )
      }
    )
    withObjectPrototypeProperties(
      [
        [
          "dynamic",
          {
            enumerable: true,
            get() {
              getterReads += 1
              return true
            },
          },
        ],
      ],
      () => {
        staticDescriptions.push(
          researchSonar(researchConfig).description,
          deepResearchSonar(deepConfig).description
        )
      }
    )

    expect(getterReads).toBe(0)
    expect(staticDescriptions).toEqual([
      researchDescription,
      deepDescription,
      researchDescription,
      deepDescription,
    ])
  })

  test("ignores inherited options without reading polluted accessors", () => {
    let inheritedReads = 0
    let researchTool: ReturnType<typeof researchSonar> | undefined
    let deepTool: ReturnType<typeof deepResearchSonar> | undefined
    let researchWithoutOptions: ReturnType<typeof researchSonar> | undefined
    let deepWithoutOptions: ReturnType<typeof deepResearchSonar> | undefined
    const researchDescription = researchSonar(researchConfig).description
    const deepDescription = deepResearchSonar(deepConfig).description
    const inherited = (value: unknown): PropertyDescriptor => ({
      enumerable: true,
      get() {
        inheritedReads += 1
        return value
      },
    })

    withObjectPrototypeProperties(
      [
        ["description", inherited("Polluted description")],
        ["execution", inherited("background")],
        ["layer", inherited(Symbol("polluted-layer"))],
      ],
      () => {
        researchTool = researchSonar(researchConfig, {})
        deepTool = deepResearchSonar(deepConfig, {})
        researchWithoutOptions = researchSonar(researchConfig)
        deepWithoutOptions = deepResearchSonar(deepConfig)
      }
    )

    expect(inheritedReads).toBe(0)
    expect(researchTool?.description).not.toContain("Polluted description")
    expect(Object.hasOwn(researchTool ?? {}, "execution")).toBe(false)
    expect(deepTool?.description).not.toContain("Polluted description")
    expect(Object.hasOwn(deepTool ?? {}, "execution")).toBe(false)
    expect(researchWithoutOptions?.description).toBe(researchDescription)
    expect(Object.hasOwn(researchWithoutOptions ?? {}, "execution")).toBe(false)
    expect(deepWithoutOptions?.description).toBe(deepDescription)
    expect(Object.hasOwn(deepWithoutOptions ?? {}, "execution")).toBe(false)
  })

  test("rejects config and option accessors without invoking getters", () => {
    // SAFETY: This verifier deliberately calls the public runtime boundary with untyped JavaScript input.
    const invokeResearch = researchSonar as unknown as (config: unknown, options?: unknown) => void
    // SAFETY: This verifier deliberately calls the public runtime boundary with untyped JavaScript input.
    const invokeDeep = deepResearchSonar as unknown as (config: unknown, options?: unknown) => void
    let getterReads = 0
    const accessor = (value: unknown): PropertyDescriptor => ({
      enumerable: true,
      get() {
        getterReads += 1
        return value
      },
    })
    const accessorProperty = (
      base: Readonly<Record<PropertyKey, unknown>>,
      key: PropertyKey,
      value: unknown
    ) => {
      const candidate = { ...base }
      Object.defineProperty(candidate, key, accessor(value))
      return candidate
    }
    const selfRedefiningTTL = { ...researchConfig }
    Object.defineProperty(selfRedefiningTTL, "ttl", {
      configurable: true,
      enumerable: true,
      get() {
        getterReads += 1
        Object.defineProperty(selfRedefiningTTL, "ttl", {
          enumerable: true,
          value: "365d",
        })
        return "12h"
      },
    })

    expect(() => invokeResearch(accessorProperty(researchConfig, "ttl", "12h"))).toThrow()
    expect(() => invokeDeep(accessorProperty(deepConfig, "ttl", "12h"))).toThrow()
    expect(() => invokeResearch(selfRedefiningTTL)).toThrow()
    expect(() => invokeResearch(accessorProperty({ ttl: "12h" }, "dynamic", true))).toThrow()
    expect(() => invokeDeep(accessorProperty({ ttl: "12h" }, "dynamic", true))).toThrow()
    for (const [key, value] of [
      ["description", "Description"],
      ["layer", Symbol("layer")],
    ] as const) {
      expect(() => invokeResearch(researchConfig, accessorProperty({}, key, value))).toThrow()
    }
    for (const [key, value] of [
      ["description", "Description"],
      ["execution", "background"],
      ["layer", Symbol("layer")],
    ] as const) {
      expect(() => invokeDeep(deepConfig, accessorProperty({}, key, value))).toThrow()
    }
    expect(getterReads).toBe(0)
  })

  test("treats a present dynamic property as the exact true discriminator", () => {
    // SAFETY: This verifier deliberately calls the public runtime boundary with untyped JavaScript input.
    const invokeResearch = researchSonar as unknown as (config: unknown) => void
    // SAFETY: This verifier deliberately calls the public runtime boundary with untyped JavaScript input.
    const invokeDeep = deepResearchSonar as unknown as (config: unknown) => void

    for (const dynamic of [false, "true", 1, null, undefined]) {
      expect(() => invokeResearch({ ...researchConfig, dynamic })).toThrow()
      expect(() => invokeDeep({ ...deepConfig, dynamic })).toThrow()
    }
    expect(() => invokeResearch({ dynamic: true, ttl: "12h" })).not.toThrow()
    expect(() => invokeDeep({ dynamic: true, ttl: "12h" })).not.toThrow()
  })
})

describe("config-derived type contract", () => {
  test("retains custom question maps in config and flattens only custom results", () => {
    const tool = researchSonar(researchConfig)
    type Input = Parameters<typeof tool.execute>[0]

    expectTypeOf<Input>().toEqualTypeOf<SonarSeed>()

    const assertConfigInference = () => {
      const questionSymbol = Symbol("question")
      // SAFETY: This compile-only helper is never executed; explicit any verifies the public tuple guard.
      const selectionAny = undefined as any
      type QuestionUnion = { readonly firstKey: string } | { readonly secondKey: string }
      const asQuestionUnion = (questions: QuestionUnion): QuestionUnion => questions
      // @ts-expect-error Research config cannot select a deep-only person field.
      researchSonar({ ...researchConfig, person: ["phone"] as const })
      // @ts-expect-error Research config cannot select a deep-only company field.
      researchSonar({ ...researchConfig, company: ["legalName"] as const })
      // @ts-expect-error Deep config cannot select a research-only person field.
      deepResearchSonar({ ...deepConfig, person: ["title"] as const })
      // @ts-expect-error Deep config cannot select a research-only company field.
      deepResearchSonar({ ...deepConfig, company: ["name"] as const })
      // @ts-expect-error A fixed research person tuple cannot contain any.
      researchSonar({
        ...researchConfig,
        person: [selectionAny] as const,
      })
      // @ts-expect-error A fixed research company tuple cannot contain any.
      researchSonar({
        ...researchConfig,
        company: [selectionAny] as const,
      })
      // @ts-expect-error A fixed deep person tuple cannot contain any.
      deepResearchSonar({
        ...deepConfig,
        person: [selectionAny] as const,
      })
      // @ts-expect-error A fixed deep company tuple cannot contain any.
      deepResearchSonar({
        ...deepConfig,
        company: [selectionAny] as const,
      })
      // @ts-expect-error Static research questions cannot use a reserved Sonar key.
      researchSonar({ ...researchConfig, research: { person: "Question?" } })
      // @ts-expect-error Static research question keys must begin with a lowercase letter.
      researchSonar({ ...researchConfig, research: { BadKey: "Question?" } })
      // @ts-expect-error Static deep questions cannot use a reserved Sonar key.
      deepResearchSonar({ ...deepConfig, deepResearch: { company: "Question?" } })
      deepResearchSonar(
        // @ts-expect-error Static deep question keys must be lower-camel identifiers.
        { ...deepConfig, deepResearch: { bad_key: "Question?" } },
        { execution: "background" }
      )
      // @ts-expect-error Static research question maps cannot use numeric keys.
      researchSonar({ ...researchConfig, research: { 0: "Question?" } })
      // @ts-expect-error Static research question maps cannot use symbol keys.
      researchSonar({ ...researchConfig, research: { [questionSymbol]: "Question?" } })
      // @ts-expect-error Static deep question maps cannot use numeric keys.
      deepResearchSonar({ ...deepConfig, deepResearch: { 0: "Question?" } })
      // @ts-expect-error Static deep question maps cannot use symbol keys.
      deepResearchSonar({ ...deepConfig, deepResearch: { [questionSymbol]: "Question?" } })
      researchSonar({
        ...researchConfig,
        // @ts-expect-error Static research questions must be one finite object, not a union.
        research: asQuestionUnion({ firstKey: "Question?" }),
      })
      deepResearchSonar({
        ...deepConfig,
        // @ts-expect-error Static deep questions must be one finite object, not a union.
        deepResearch: asQuestionUnion({ secondKey: "Question?" }),
      })
      // @ts-expect-error Static tool input cannot let the model replace research questions.
      tool.execute({
        linkedinURL: "https://linkedin.com/in/ada",
        research: { other: "Question?" },
      })
    }
    expectTypeOf(assertConfigInference).toBeFunction()
  })

  test("infers exact required static answers from branded and plain questions", () => {
    const research = researchSonar({
      ...researchConfig,
      research: {
        sellsToSMB: question<boolean>("Does this company sell to SMBs?"),
        usesQuickBooks: "Does this company use QuickBooks?",
      },
    })
    const deep = deepResearchSonar({
      ...deepConfig,
      deepResearch: {
        hasTaxExposure: question<number>("How many states create tax exposure?"),
      },
    })
    type Yielded<Value> = Value extends AsyncIterable<infer Output> ? Output : never
    type ResearchOutput = Yielded<ReturnType<typeof research.execute>>
    type DeepOutput = Yielded<ReturnType<typeof deep.execute>>

    expectTypeOf<ResearchOutput["data"]["person"]["title"]>().toEqualTypeOf<Field<string>>()
    expectTypeOf<ResearchOutput["data"]["company"]["name"]>().toEqualTypeOf<Field<string>>()
    expectTypeOf<ResearchOutput["data"]["sellsToSMB"]>().toEqualTypeOf<Field<boolean>>()
    expectTypeOf<ResearchOutput["data"]["usesQuickBooks"]>().toEqualTypeOf<Field<JSONValue>>()
    expectTypeOf<DeepOutput["data"]["hasTaxExposure"]>().toEqualTypeOf<Field<number>>()

    // @ts-expect-error Unselected catalog fields cannot appear in static output inference.
    const assertAbsentFields = (output: ResearchOutput) => output.data.person.github
    // @ts-expect-error Unconfigured custom fields cannot appear in exact static output inference.
    const assertAbsentAnswers = (output: ResearchOutput) => output.data.otherAnswer
    expectTypeOf(assertAbsentFields).toBeFunction()
    expectTypeOf(assertAbsentAnswers).toBeFunction()
  })

  test("keeps broad static catalog selections optional while literal tuples stay exact", () => {
    const broadResearchConfig: ResearchConfig = researchConfig
    const broadDeepConfig: DeepResearchConfig = deepConfig
    const broadResearch = researchSonar(broadResearchConfig)
    const broadDeep = deepResearchSonar(broadDeepConfig)
    type Yielded<Value> = Value extends AsyncIterable<infer Output> ? Output : never
    type ResearchOutput = Yielded<ReturnType<typeof broadResearch.execute>>
    type DeepOutput = Yielded<ReturnType<typeof broadDeep.execute>>

    expectTypeOf<ResearchOutput["data"]["person"]["title"]>().toEqualTypeOf<
      Field<string> | undefined
    >()
    expectTypeOf<ResearchOutput["data"]["person"]["github"]>().toEqualTypeOf<
      Field<string> | undefined
    >()
    expectTypeOf<ResearchOutput["data"]["company"]["name"]>().toEqualTypeOf<
      Field<string> | undefined
    >()
    expectTypeOf<ResearchOutput["data"]["company"]["funding"]>().toEqualTypeOf<
      Field<JSONValue> | undefined
    >()
    expectTypeOf<DeepOutput["data"]["person"]["phone"]>().toEqualTypeOf<Field<string> | undefined>()
    expectTypeOf<DeepOutput["data"]["company"]["legalName"]>().toEqualTypeOf<
      Field<string> | undefined
    >()

    type ResearchPersonTuple = readonly ["title"] | readonly ["github"]
    type DeepCompanyTuple = readonly [] | readonly ["legalName"]
    type ResearchPersonElementUnion = readonly ["title" | "github"]
    type ResearchCompanyElementUnion = readonly ["name" | "domain"]
    const asResearchPersonTuple = (value: ResearchPersonTuple): ResearchPersonTuple => value
    const asDeepCompanyTuple = (value: DeepCompanyTuple): DeepCompanyTuple => value
    const asResearchPersonElementUnion = (
      value: ResearchPersonElementUnion
    ): ResearchPersonElementUnion => value
    const asResearchCompanyElementUnion = (
      value: ResearchCompanyElementUnion
    ): ResearchCompanyElementUnion => value
    const tupleResearch = researchSonar({
      ...researchConfig,
      person: asResearchPersonTuple(["title"]),
    })
    const tupleDeep = deepResearchSonar({
      ...deepConfig,
      company: asDeepCompanyTuple(["legalName"]),
    })
    const elementUnionResearch = researchSonar({
      ...researchConfig,
      company: asResearchCompanyElementUnion(["name"]),
      person: asResearchPersonElementUnion(["title"]),
    })
    const exactMultiResearch = researchSonar({
      ...researchConfig,
      company: ["name", "domain"] as const,
      person: ["title", "github"] as const,
    })
    type TupleResearchOutput = Yielded<ReturnType<typeof tupleResearch.execute>>
    type TupleDeepOutput = Yielded<ReturnType<typeof tupleDeep.execute>>
    type ElementUnionResearchOutput = Yielded<ReturnType<typeof elementUnionResearch.execute>>
    type ExactMultiResearchOutput = Yielded<ReturnType<typeof exactMultiResearch.execute>>

    expectTypeOf<TupleResearchOutput["data"]["person"]["title"]>().toEqualTypeOf<
      Field<string> | undefined
    >()
    expectTypeOf<TupleResearchOutput["data"]["person"]["github"]>().toEqualTypeOf<
      Field<string> | undefined
    >()
    expectTypeOf<TupleDeepOutput["data"]["company"]["legalName"]>().toEqualTypeOf<
      Field<string> | undefined
    >()
    expectTypeOf<ElementUnionResearchOutput["data"]["person"]["title"]>().toEqualTypeOf<
      Field<string> | undefined
    >()
    expectTypeOf<ElementUnionResearchOutput["data"]["person"]["github"]>().toEqualTypeOf<
      Field<string> | undefined
    >()
    expectTypeOf<ElementUnionResearchOutput["data"]["company"]["name"]>().toEqualTypeOf<
      Field<string> | undefined
    >()
    expectTypeOf<ElementUnionResearchOutput["data"]["company"]["domain"]>().toEqualTypeOf<
      Field<string> | undefined
    >()
    expectTypeOf<ExactMultiResearchOutput["data"]["person"]["title"]>().toEqualTypeOf<
      Field<string>
    >()
    expectTypeOf<ExactMultiResearchOutput["data"]["person"]["github"]>().toEqualTypeOf<
      Field<string>
    >()
    expectTypeOf<ExactMultiResearchOutput["data"]["company"]["name"]>().toEqualTypeOf<
      Field<string>
    >()
    expectTypeOf<ExactMultiResearchOutput["data"]["company"]["domain"]>().toEqualTypeOf<
      Field<string>
    >()

    const assertBroadQuestionRecord = (questions: Readonly<Record<string, string>>) => {
      const broadRecordResearch = researchSonar({
        ...researchConfig,
        research: questions,
      })
      const broadRecordDeep = deepResearchSonar({
        ...deepConfig,
        deepResearch: questions,
      })
      type BroadRecordResearchOutput = Yielded<ReturnType<typeof broadRecordResearch.execute>>
      type BroadRecordDeepOutput = Yielded<ReturnType<typeof broadRecordDeep.execute>>

      expectTypeOf<BroadRecordResearchOutput["data"]["runtimeAnswer"]>().toEqualTypeOf<
        Field<JSONValue> | undefined
      >()
      expectTypeOf<BroadRecordDeepOutput["data"]["runtimeAnswer"]>().toEqualTypeOf<
        Field<JSONValue> | undefined
      >()
    }
    interface FiniteInterfaceQuestions {
      readonly interfaceQuestion: string
    }
    interface BroadInterfaceQuestions {
      readonly [key: string]: string
    }
    type CallableQuestions = {
      (): void
      readonly goodKey: string
    }
    type BroadQuestionObject = object
    const assertFiniteInterfaceQuestions = (questions: FiniteInterfaceQuestions) => {
      researchSonar({ ...researchConfig, research: questions })
      deepResearchSonar({ ...deepConfig, deepResearch: questions })
    }
    const assertBroadInterfaceQuestions = (questions: BroadInterfaceQuestions) => {
      researchSonar({ ...researchConfig, research: questions })
      deepResearchSonar({ ...deepConfig, deepResearch: questions })
    }
    const rejectCallableQuestions = (questions: CallableQuestions) => {
      // @ts-expect-error Static research question maps cannot be callable.
      researchSonar({ ...researchConfig, research: questions })
      // @ts-expect-error Static deep question maps cannot be callable.
      deepResearchSonar({ ...deepConfig, deepResearch: questions })
    }
    const rejectBroadQuestionObject = (questions: BroadQuestionObject) => {
      // @ts-expect-error Static research question maps cannot be broad object.
      researchSonar({ ...researchConfig, research: questions })
      // @ts-expect-error Static deep question maps cannot be broad object.
      deepResearchSonar({ ...deepConfig, deepResearch: questions })
    }
    const broadQuestionSymbol = Symbol("broad-question")
    type BroadQuestionsWithNumericKey = Readonly<Record<string, string>> & {
      readonly 0: string
    }
    type BroadQuestionsWithSymbolKey = Readonly<Record<string, string>> & {
      readonly [broadQuestionSymbol]: string
    }
    const rejectBroadNumericQuestions = (questions: BroadQuestionsWithNumericKey) => {
      // @ts-expect-error Broad research questions cannot add a numeric key.
      researchSonar({ ...researchConfig, research: questions })
      // @ts-expect-error Broad deep questions cannot add a numeric key.
      deepResearchSonar({ ...deepConfig, deepResearch: questions })
    }
    const rejectBroadSymbolQuestions = (questions: BroadQuestionsWithSymbolKey) => {
      // @ts-expect-error Broad research questions cannot add a symbol key.
      researchSonar({ ...researchConfig, research: questions })
      // @ts-expect-error Broad deep questions cannot add a symbol key.
      deepResearchSonar({ ...deepConfig, deepResearch: questions })
    }
    const rejectMaybeUndefinedQuestionRecord = (
      questions: Readonly<Record<string, string | undefined>>
    ) => {
      // @ts-expect-error Broad static research questions cannot permit undefined values.
      researchSonar({ ...researchConfig, research: questions })
      // @ts-expect-error Broad static deep questions cannot permit undefined values.
      deepResearchSonar({ ...deepConfig, deepResearch: questions })
    }
    assertBroadQuestionRecord({ runtimeAnswer: "Question?" })
    assertFiniteInterfaceQuestions({ interfaceQuestion: "Question?" })
    assertBroadInterfaceQuestions({ interfaceQuestion: "Question?" })
    researchSonar({ ...researchConfig, research: {} })
    deepResearchSonar({ ...deepConfig, deepResearch: {} })
    expectTypeOf(rejectMaybeUndefinedQuestionRecord).toBeFunction()
    expectTypeOf(rejectBroadNumericQuestions).toBeFunction()
    expectTypeOf(rejectBroadSymbolQuestions).toBeFunction()
    expectTypeOf(rejectCallableQuestions).toBeFunction()
    expectTypeOf(rejectBroadQuestionObject).toBeFunction()
  })

  test("keeps model-owned dynamic built-ins and declared answers optional", () => {
    const tool = researchSonar<{ riskScore: number }>({
      dynamic: true,
      ttl: "12h",
    })
    const deep = deepResearchSonar<{ dossier: string }>(
      { dynamic: true, ttl: "12h" },
      { execution: "background" }
    )
    const deepForeground = deepResearchSonar<{ dossier: string }>({
      dynamic: true,
      ttl: "12h",
    })
    type Output = ReturnType<typeof tool.execute> extends AsyncIterable<infer Value> ? Value : never
    type DeepOutput = Awaited<ReturnType<typeof deep.execute>>

    expectTypeOf<Output["data"]["riskScore"]>().toEqualTypeOf<Field<number> | undefined>()
    expectTypeOf<Output["data"]["person"]["title"]>().toEqualTypeOf<Field<string> | undefined>()
    expectTypeOf<DeepOutput["data"]["dossier"]>().toEqualTypeOf<Field<string> | undefined>()
    expectTypeOf<DeepOutput["data"]["company"]["legalName"]>().toEqualTypeOf<
      Field<string> | undefined
    >()

    const assertDynamicAnswerKeys = () => {
      const answerSymbol = Symbol("answer")
      type InvalidUnion = { readonly goodKey: string } | { readonly person: string }
      type OpenUnion = { readonly goodKey: string } | Readonly<Record<string, JSONValue>>
      type ValidUnion = { readonly goodKey: string } | { readonly otherKey: number }
      type NumericAnswers = { readonly 0: string }
      type OptionalAnswers = { readonly goodKey?: string }
      type SymbolAnswers = { readonly [answerSymbol]: string }
      type UndefinedAnswers = { readonly goodKey: undefined }
      interface FiniteInterfaceAnswers {
        readonly interfaceAnswer: string
      }
      type CallableAnswers = {
        (): void
        readonly goodKey: string
      }
      type ConstructableAnswers = {
        new (): object
        readonly goodKey: string
      }

      researchSonar<{ lowerCamel: string }>({ dynamic: true, ttl: "12h" })
      deepResearchSonar<{ lowerCamel: string }>({ dynamic: true, ttl: "12h" })
      deepResearchSonar<{ lowerCamel: string }>(
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      researchSonar<FiniteInterfaceAnswers>({ dynamic: true, ttl: "12h" })
      deepResearchSonar<FiniteInterfaceAnswers>({ dynamic: true, ttl: "12h" })
      deepResearchSonar<FiniteInterfaceAnswers>(
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      researchSonar<Readonly<Record<never, never>>>({ dynamic: true, ttl: "12h" })
      deepResearchSonar<Readonly<Record<never, never>>>({ dynamic: true, ttl: "12h" })
      deepResearchSonar<Readonly<Record<never, never>>>(
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      // @ts-expect-error Explicit any cannot bypass dynamic research answer-map validation.
      researchSonar<any>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Explicit any cannot bypass foreground deep answer-map validation.
      deepResearchSonar<any>({ dynamic: true, ttl: "12h" })
      deepResearchSonar<any>(
        // @ts-expect-error Explicit any cannot bypass background deep answer-map validation.
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      // @ts-expect-error Dynamic research answer maps cannot be callable.
      researchSonar<CallableAnswers>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Dynamic research answer maps cannot be constructable.
      researchSonar<ConstructableAnswers>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Dynamic research answer maps cannot be broad object.
      researchSonar<object>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Foreground deep answer maps cannot be callable.
      deepResearchSonar<CallableAnswers>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Foreground deep answer maps cannot be constructable.
      deepResearchSonar<ConstructableAnswers>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Foreground deep answer maps cannot be broad object.
      deepResearchSonar<object>({ dynamic: true, ttl: "12h" })
      deepResearchSonar<CallableAnswers>(
        // @ts-expect-error Background deep answer maps cannot be callable.
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      deepResearchSonar<ConstructableAnswers>(
        // @ts-expect-error Background deep answer maps cannot be constructable.
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      deepResearchSonar<object>(
        // @ts-expect-error Background deep answer maps cannot be broad object.
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      // @ts-expect-error Explicit dynamic research answer maps cannot be unions.
      researchSonar<ValidUnion>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Explicit foreground deep answer maps cannot be unions.
      deepResearchSonar<ValidUnion>({ dynamic: true, ttl: "12h" })
      deepResearchSonar<ValidUnion>(
        // @ts-expect-error Explicit background deep answer maps cannot be unions.
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      // @ts-expect-error Dynamic research answers cannot use a reserved Sonar key.
      researchSonar<{ person: string }>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Dynamic research answers must use lower-camel keys.
      researchSonar<{ "bad-key": string }>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Dynamic research answers require a finite key map.
      researchSonar<Readonly<Record<string, JSONValue>>>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Foreground deep answers cannot use a reserved Sonar key.
      deepResearchSonar<{ person: string }>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Foreground deep answers require a finite key map.
      deepResearchSonar<Readonly<Record<string, JSONValue>>>({ dynamic: true, ttl: "12h" })
      deepResearchSonar<{ "bad-key": string }>(
        // @ts-expect-error Background deep answers must use lower-camel keys.
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      deepResearchSonar<Readonly<Record<string, JSONValue>>>(
        // @ts-expect-error Background deep answers require a finite key map.
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      // @ts-expect-error Every dynamic research union member must use valid custom keys.
      researchSonar<InvalidUnion>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error An open-record union member makes dynamic research keys unbounded.
      researchSonar<OpenUnion>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Every foreground deep union member must use valid custom keys.
      deepResearchSonar<InvalidUnion>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error An open-record union member makes foreground deep keys unbounded.
      deepResearchSonar<OpenUnion>({ dynamic: true, ttl: "12h" })
      deepResearchSonar<InvalidUnion>(
        // @ts-expect-error Every background deep union member must use valid custom keys.
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      deepResearchSonar<OpenUnion>(
        // @ts-expect-error An open-record union member makes background deep keys unbounded.
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      // @ts-expect-error Dynamic research answer properties cannot be optional.
      researchSonar<OptionalAnswers>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Dynamic research answer values cannot be undefined.
      researchSonar<UndefinedAnswers>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Dynamic research answer maps cannot use numeric keys.
      researchSonar<NumericAnswers>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Dynamic research answer maps cannot use symbol keys.
      researchSonar<SymbolAnswers>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Foreground deep answer properties cannot be optional.
      deepResearchSonar<OptionalAnswers>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Foreground deep answer values cannot be undefined.
      deepResearchSonar<UndefinedAnswers>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Foreground deep answer maps cannot use numeric keys.
      deepResearchSonar<NumericAnswers>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Foreground deep answer maps cannot use symbol keys.
      deepResearchSonar<SymbolAnswers>({ dynamic: true, ttl: "12h" })
      deepResearchSonar<OptionalAnswers>(
        // @ts-expect-error Background deep answer properties cannot be optional.
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      deepResearchSonar<UndefinedAnswers>(
        // @ts-expect-error Background deep answer values cannot be undefined.
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      deepResearchSonar<NumericAnswers>(
        // @ts-expect-error Background deep answer maps cannot use numeric keys.
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
      deepResearchSonar<SymbolAnswers>(
        // @ts-expect-error Background deep answer maps cannot use symbol keys.
        { dynamic: true, ttl: "12h" },
        { execution: "background" }
      )
    }
    expectTypeOf(assertDynamicAnswerKeys).toBeFunction()

    type ResearchNext = Awaited<ReturnType<ReturnType<typeof tool.execute>["next"]>>
    type DeepNext = Awaited<ReturnType<ReturnType<typeof deepForeground.execute>["next"]>>
    expectTypeOf<Extract<ResearchNext, { done: true }>["value"]>().toEqualTypeOf<undefined>()
    expectTypeOf<Extract<DeepNext, { done: true }>["value"]>().toEqualTypeOf<undefined>()
  })
})
