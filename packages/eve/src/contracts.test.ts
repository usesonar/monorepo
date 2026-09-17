/* eslint-disable anti-slop/no-chained-type-assertions, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, no-use-before-define, sort-keys, typescript/consistent-type-definitions, typescript/no-explicit-any, unicorn/consistent-function-scoping -- This verifier probes public runtime and compile-time boundaries with deliberately untrusted values and type-only assertion helpers. */
import { describe, expect, expectTypeOf, test } from "bun:test"

import type { Field, JSONValue, ResearchConfig, StandardJSONSchemaV1 } from "@usesonar/effect"
import { Schema } from "effect"

import * as Eve from "./index.js"
import { deepResearchSonar, researchSonar } from "./index.js"

type StandardProperties = {
  readonly jsonSchema?: {
    readonly output: (options: { readonly target: string }) => Record<string, unknown>
  }
  readonly validate: (
    value: unknown
  ) =>
    | { readonly issues: readonly unknown[] }
    | { readonly value: unknown }
    | Promise<{ readonly issues: readonly unknown[] } | { readonly value: unknown }>
}

const standardProperties = (schema: unknown): StandardProperties => {
  if (
    (typeof schema !== "object" && typeof schema !== "function") ||
    schema === null ||
    !("~standard" in schema)
  ) {
    throw new Error("Expected Standard Schema")
  }
  // SAFETY: Every Eve schema is constructed through the local Standard Schema adapter.
  return schema["~standard"] as StandardProperties
}

const expectValid = async (schema: unknown, value: unknown) => {
  const result = await standardProperties(schema).validate(value)
  expect("issues" in result ? result.issues : undefined).toBeUndefined()
}

const expectInvalid = async (schema: unknown, value: unknown) => {
  const result = await standardProperties(schema).validate(value)
  expect("issues" in result ? result.issues.length : 0).toBeGreaterThan(0)
}

const typedValidator = <Output extends JSONValue>(
  description: string,
  schema: Readonly<Record<string, JSONValue>>
): StandardJSONSchemaV1<unknown, Output> => ({
  "~standard": {
    jsonSchema: {
      input: () => ({ description, ...schema }),
      output: () => ({ description, ...schema }),
    },
    vendor: "eve-contract-test",
    version: 1,
  },
})

const researchConfig = {
  person: {
    title: true,
    research: {
      careerFit: typedValidator<{ evidence: string[]; fit: boolean }>(
        "Assess public evidence that this person fits the role.",
        { type: "object" }
      ),
    },
  },
  company: {
    name: true,
    research: {
      sellsToSMB: {
        description: "Assess whether this company sells to small businesses.",
        type: "object",
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
  ttl: "365d",
} as const

describe("public factory contract", () => {
  test("exports exactly the static and dynamic Eve factories", () => {
    expect(Object.keys(Eve).toSorted()).toEqual(["deepResearchSonar", "researchSonar"])
    expect(researchSonar).toBeFunction()
    expect(deepResearchSonar).toBeFunction()
  })

  test("keeps execution behavior in options", () => {
    expect(researchSonar(researchConfig).execution).toBeUndefined()
    expect(deepResearchSonar(deepConfig).execution).toBeUndefined()
    expect(deepResearchSonar(deepConfig, { execution: "background" }).execution).toBe("background")

    const assertTypes = () => {
      // @ts-expect-error Research cannot run with Eve background semantics.
      researchSonar(researchConfig, { execution: "background" })
      // @ts-expect-error Research cannot accept the deep-research namespace.
      researchSonar({ ...researchConfig, person: { deepResearch: {} } })
      // @ts-expect-error Deep research cannot accept the research namespace.
      deepResearchSonar({ ...deepConfig, company: { research: {} } })
    }
    expectTypeOf(assertTypes).toBeFunction()
  })

  test("describes entity-owned answer locations", () => {
    expect(researchSonar(researchConfig).description).toContain("nested")
    expect(researchSonar(researchConfig).description).not.toContain("top-level")
    expect(deepResearchSonar(deepConfig).description).toContain("deepResearch")
  })
})

describe("generated schemas", () => {
  test("keeps static model input seed-only and nests full output namespaces", async () => {
    const tool = researchSonar(researchConfig)
    expect(Schema.isSchema(tool.inputSchema)).toBe(true)
    expect(Schema.isSchema(tool.outputSchema)).toBe(true)
    await expectValid(tool.inputSchema, { linkedinURL: "https://linkedin.com/in/ada" })
    await expectInvalid(tool.inputSchema, {
      linkedinURL: "https://linkedin.com/in/ada",
      person: {},
    })

    await expectValid(tool.outputSchema, {
      status: "complete",
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
    })
    await expectInvalid(tool.outputSchema, {
      status: "complete",
      data: {
        person: { title: { status: "pending" } },
        company: { name: { status: "pending" } },
        careerFit: { status: "pending" },
      },
    })

    const output = standardProperties(tool.outputSchema).jsonSchema?.output({
      target: "draft-2020-12",
    })
    expect(output).toBeObject()
  })

  test("accepts nested dynamic route maps and rejects cross-route shapes", async () => {
    const research = researchSonar({ dynamic: true, ttl: "12h" }).inputSchema
    const deep = deepResearchSonar({ dynamic: true, ttl: "12h" }).inputSchema
    await expectValid(research, {
      linkedinURL: "https://linkedin.com/in/ada",
      person: {
        title: true,
        research: {
          careerFit: { description: "Assess fit.", type: "boolean" },
        },
      },
      company: {},
    })
    await expectValid(deep, {
      linkedinURL: "https://linkedin.com/in/ada",
      person: { deepResearch: { biography: "Write a biography." } },
      company: { legalName: true },
    })
    await expectInvalid(research, {
      linkedinURL: "https://linkedin.com/in/ada",
      person: { deepResearch: { biography: "Wrong route." } },
      company: {},
    })
    await expectInvalid(deep, {
      linkedinURL: "https://linkedin.com/in/ada",
      person: { research: { biography: { description: "Wrong route." } } },
      company: {},
    })
    await expectInvalid(research, {
      linkedinURL: "https://linkedin.com/in/ada",
      person: { research: { missingDescription: { type: "string" } } },
      company: {},
    })
  })
})

describe("runtime validation and static inference", () => {
  test("compiles authored research validators and snapshots caller-owned maps", () => {
    const mutable = {
      person: {
        title: true as const,
        research: {
          careerFit: typedValidator<boolean>("Assess public career fit.", {
            type: "boolean",
          }),
        },
      },
      company: {},
      ttl: "12h",
    }
    const tool = researchSonar(mutable)
    mutable.ttl = "365d"
    expect(tool.description).toContain("careerFit")
    expect(() => researchSonar({ ...mutable, person: {}, company: {} })).toThrow()
  })

  test("rejects malformed keys, route values, and TTLs before execution", () => {
    // SAFETY: These calls deliberately probe the untyped JavaScript boundary.
    const invokeResearch = researchSonar as unknown as (config: unknown) => unknown
    // SAFETY: These calls deliberately probe the untyped JavaScript boundary.
    const invokeDeep = deepResearchSonar as unknown as (config: unknown) => unknown
    expect(() => invokeResearch({ ...researchConfig, ttl: "11h" })).toThrow()
    expect(() =>
      invokeResearch({
        ...researchConfig,
        person: { research: { BadKey: { description: "Invalid key.", type: "string" } } },
      })
    ).toThrow()
    expect(() =>
      invokeDeep({ ...deepConfig, company: { deepResearch: { ownership: "   " } } })
    ).toThrow()
    expect(() => invokeResearch({ ...researchConfig, person: { title: false } })).toThrow()
  })

  test("preserves exact finite outputs and broad-map optionality", () => {
    const tool = researchSonar(researchConfig)
    type Snapshot = Awaited<ReturnType<ReturnType<typeof tool.execute>["next"]>>["value"]
    type Data = Exclude<Snapshot, undefined>["data"]
    const assertExact = (data: Data) => {
      const title: Field<string> = data.person.title
      const careerFit: Field<{ evidence: string[]; fit: boolean }> = data.person.research.careerFit
      const sellsToSMB: Field<JSONValue> = data.company.research.sellsToSMB
      return { careerFit, sellsToSMB, title }
    }
    expectTypeOf(assertExact).toBeFunction()

    expectTypeOf(declareBroadConfig).toBeFunction()
  })
})

const declareBroadConfig = (config: ResearchConfig) => {
  const tool = researchSonar(config)
  type Snapshot = Awaited<ReturnType<ReturnType<typeof tool.execute>["next"]>>["value"]
  type Data = Exclude<Snapshot, undefined>["data"]
  const assertBroad = (data: Data) => {
    const title: Field<string> | undefined = data.person.title
    return title
  }
  expectTypeOf(assertBroad).toBeFunction()
  return tool
}

describe("dynamic explicit answer maps", () => {
  test("keeps possible answer keys under their entity namespace", () => {
    const tool = researchSonar<{
      readonly person: { readonly careerFit: boolean }
      readonly company: { readonly signals: string[] }
    }>({ dynamic: true, ttl: "12h" })
    type Snapshot = Awaited<ReturnType<ReturnType<typeof tool.execute>["next"]>>["value"]
    type Data = Exclude<Snapshot, undefined>["data"]
    expectTypeOf<Data["person"]["research"]>().toMatchTypeOf<
      { readonly careerFit?: Field<boolean> } | undefined
    >()
    expectTypeOf<Data["company"]["research"]>().toMatchTypeOf<
      { readonly signals?: Field<string[]> } | undefined
    >()

    const assertInvalid = () => {
      // @ts-expect-error Dynamic answers must identify an entity namespace.
      researchSonar<{ careerFit: boolean }>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Deep-research answer fields are strings.
      deepResearchSonar<{ person: { biography: number } }>({ dynamic: true, ttl: "12h" })
      // @ts-expect-error Dynamic answer maps must be finite.
      researchSonar<{ person: Readonly<Record<string, JSONValue>> }>({
        dynamic: true,
        ttl: "12h",
      })
    }
    expectTypeOf(assertInvalid).toBeFunction()
  })
})
