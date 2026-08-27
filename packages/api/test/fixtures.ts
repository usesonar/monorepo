// oxlint-disable sort-keys -- Verifier fixtures preserve the public person, company, and catalog order.

type FixtureJSON = null | boolean | number | string | FixtureJSON[] | { [key: string]: FixtureJSON }

export const researchRequest = {
  seed: {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    domain: "example.com",
    context: { source: "verification", attempts: 1 },
  },
  ttl: "7d",
  person: ["linkedin", "title", "x", "github"],
  company: ["domain", "name", "logo", "colors", "location", "description", "funding"],
  research: {
    accountSignals: "Which buying signals are publicly visible?",
  },
} as const

export const deepResearchRequest = {
  seed: {
    linkedinURL: "https://www.linkedin.com/in/ada-lovelace",
    fullName: "Ada Lovelace",
    xURL: "https://x.com/ada",
    email: "ada@example.com",
  },
  ttl: "12h",
  person: ["phone"],
  company: ["legalName"],
  deepResearch: {
    regulatoryStatus: "What is the company's current regulatory status?",
  },
} as const

export const minimalResearchRequest = {
  seed: { fullName: "Ada Lovelace", email: "ada@example.com" },
  ttl: "12h",
  person: ["title"],
  company: ["name"],
  research: { accountSignals: "Which buying signals are publicly visible?" },
} as const

export const minimalPendingResearchSnapshot = {
  status: "pending",
  data: {
    person: { title: { status: "pending" } },
    company: { name: { status: "pending" } },
    accountSignals: { status: "pending" },
  },
} as const

export const minimalPendingResearchResponse = {
  hash: "minimal_hash_123",
  ...minimalPendingResearchSnapshot,
} as const

export const resolvedField = (value: FixtureJSON) => ({
  status: "resolved" as const,
  value,
  confidence: 0.9,
  sources: ["https://example.com/source"],
  resolvedAt: "2026-08-25T20:00:00.000Z",
})

export const pendingResearchSnapshot = {
  status: "pending",
  data: {
    person: {
      linkedin: { status: "pending" },
      title: { status: "pending" },
      x: { status: "pending" },
      github: { status: "pending" },
    },
    company: {
      domain: { status: "pending" },
      name: { status: "pending" },
      logo: { status: "pending" },
      colors: { status: "pending" },
      location: { status: "pending" },
      description: { status: "pending" },
      funding: { status: "pending" },
    },
    accountSignals: { status: "pending" },
  },
} as const

export const completeResearchSnapshot = {
  status: "complete",
  data: {
    person: {
      linkedin: {
        status: "resolved",
        value: "https://www.linkedin.com/in/ada-lovelace",
        confidence: 0.99,
        sources: ["https://www.linkedin.com/in/ada-lovelace"],
        resolvedAt: "2026-08-25T20:00:00.000Z",
      },
      title: {
        status: "resolved",
        value: "Founder",
        confidence: 0.95,
        sources: ["https://example.com/about"],
        resolvedAt: "2026-08-25T20:00:01.000Z",
      },
      x: { status: "notFound", reason: "providerEmpty" },
      github: { status: "notFound" },
    },
    company: {
      domain: {
        status: "resolved",
        value: "example.com",
        confidence: 1,
        sources: ["https://example.com"],
        resolvedAt: "2026-08-25T20:00:00.000Z",
      },
      name: {
        status: "resolved",
        value: "Example",
        confidence: 0.9,
        sources: ["https://example.com"],
        resolvedAt: "2026-08-25T20:00:02.000Z",
      },
      logo: { status: "skipped", reason: "noCompanySeed" },
      colors: {
        status: "resolved",
        value: { primary: "#123456", palette: ["#123456", "#abcdef"] },
        confidence: 0.8,
        sources: ["https://example.com"],
        resolvedAt: "2026-08-25T20:00:03.000Z",
      },
      location: {
        status: "resolved",
        value: { city: "London", country: "GB" },
        confidence: 0.85,
        sources: ["https://example.com/contact"],
        resolvedAt: "2026-08-25T20:00:04.000Z",
      },
      description: {
        status: "resolved",
        value: "Analytical engines",
        confidence: 0.75,
        sources: ["https://example.com/about"],
        resolvedAt: "2026-08-25T20:00:05.000Z",
      },
      funding: {
        status: "resolved",
        value: { totalUSD: 1_000_000, rounds: ["seed"] },
        confidence: 0.7,
        sources: ["https://example.com/funding"],
        resolvedAt: "2026-08-25T20:00:06.000Z",
      },
    },
    accountSignals: {
      status: "resolved",
      value: { intent: "high", evidence: ["Hiring finance operators"] },
      confidence: 0.73,
      sources: ["https://example.com/jobs"],
      resolvedAt: "2026-08-25T20:00:07.000Z",
    },
  },
} as const

export const pendingResearchResponse = {
  hash: "sonar_hash_123",
  ...pendingResearchSnapshot,
} as const

export const completeResearchResponse = {
  hash: "sonar_hash_123",
  ...completeResearchSnapshot,
} as const

export const jsonResponse = (value: FixtureJSON, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json")
  return Response.json(value, { ...init, headers })
}

export const eventStreamResponse = (
  chunks: readonly Uint8Array[],
  options: {
    onCancel?: () => void
    keepOpen?: boolean
  } = {}
) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk)
        }
        if (!options.keepOpen) {
          controller.close()
        }
      },
      cancel() {
        options.onCancel?.()
      },
    }),
    { headers: { "content-type": "text/event-stream; charset=utf-8" } }
  )

export const encodeSSE = (
  type: "snapshot" | "field" | "complete",
  id: string,
  data: FixtureJSON,
  newline = "\n"
) =>
  new TextEncoder().encode(
    `id: ${id}${newline}event: ${type}${newline}data: ${JSON.stringify(data)}${newline}${newline}`
  )

export const concatenateBytes = (...chunks: readonly Uint8Array[]) => {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export const splitBytes = (bytes: Uint8Array, cuts: readonly number[]) => {
  const chunks: Uint8Array[] = []
  let start = 0
  for (const cut of cuts) {
    chunks.push(bytes.slice(start, cut))
    start = cut
  }
  chunks.push(bytes.slice(start))
  return chunks
}

export const collectStream = async <T>(stream: ReadableStream<T>) => {
  const values: T[] = []
  for await (const value of stream) {
    values.push(value)
  }
  return values
}
