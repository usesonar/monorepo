import { expect, test } from "bun:test"

const forbidden = [
  /from\s+["']@usesonar\/backend(?:\/|["'])/u,
  /from\s+["']@usesonar\/api\/src\//u,
  /from\s+["']next(?:\/|["'])/u,
  /from\s+["']node:/u,
  /from\s+["']ky(?:\/|["'])/u,
  /\bimport\s*\(\s*["'](?:@usesonar\/api|ky)/u,
  /\bfetch\s*\(/u,
  /\bprocess\b/u,
  /\bEventSource\b/u,
] as const

test("the browser-safe public source imports only public transport boundaries and has no module singleton", async () => {
  const root = new URL(".", import.meta.url)
  const files: string[] = []

  for await (const path of new Bun.Glob("**/*.ts").scan({ cwd: root.pathname })) {
    if (!path.endsWith(".test.ts")) {
      files.push(path)
    }
  }

  expect(files).not.toHaveLength(0)
  const sources = await Promise.all(
    files.map(async (path) => ({ path, source: await Bun.file(new URL(path, root)).text() }))
  )
  const clientSource = sources.find(({ path }) => path === "client.ts")?.source

  expect(clientSource).toMatch(/from\s+["']@usesonar\/api["']/u)
  for (const { source } of sources) {
    for (const pattern of forbidden) {
      expect(source).not.toMatch(pattern)
    }
    expect(source).not.toMatch(/(?:^|\n)\s*(?:const|let|var)\s+\w*(?:client|runtime)\w*\s*=/iu)
  }
})

test("the root and testing subpath expose only the locked runtime exports", async () => {
  const root = await import("./index.js")
  const testing = await import("./testing.js")

  expect(Object.keys(root).toSorted()).toEqual([
    "CompleteEvent",
    "DeepResearchRequest",
    "Field",
    "HTTPError",
    "JSONValue",
    "ProtocolError",
    "RequestError",
    "ResearchRequest",
    "SonarClient",
    "SonarSeed",
    "SonarSnapshot",
    "TTL",
    "TransportError",
    "canonicalRequestIdentity",
    "initialSnapshot",
    "layer",
    "layerFromAPI",
    "question",
    "reduceSnapshot",
  ])
  expect(Object.keys(testing).toSorted()).toEqual(["Scenario", "SonarTestProbe", "scenarioLayer"])
})

test("the verifier uses no timing-based synchronization", async () => {
  const root = new URL(".", import.meta.url)
  const files: string[] = []

  for await (const path of new Bun.Glob("*.test.ts").scan({ cwd: root.pathname })) {
    files.push(path)
  }

  const tests = await Promise.all(files.map((path) => Bun.file(new URL(path, root)).text()))
  for (const source of tests) {
    expect(source).not.toMatch(/\bBun\.sleep\b|\bset(?:Interval|Timeout)\s*\(/u)
  }
})
