import { fileURLToPath } from "node:url"

import { plugin } from "bun"

const fromRoot = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url))

const workspaceEntries = new Map<string, string>([
  ["@usesonar/api", fromRoot("packages/api/src/index.ts")],
  ["@usesonar/backend", fromRoot("packages/backend/src/index.ts")],
  ["@usesonar/backend/testing", fromRoot("packages/backend/src/testing.ts")],
  ["@usesonar/effect", fromRoot("packages/effect/src/index.ts")],
  ["@usesonar/effect/testing", fromRoot("packages/effect/src/testing.ts")],
  ["@usesonar/eve", fromRoot("packages/eve/src/index.ts")],
  ["@usesonar/react", fromRoot("packages/react/src/index.ts")],
])

plugin({
  name: "usesonar-test-workspaces",
  setup(build) {
    build.onResolve({ filter: /^@usesonar\//u }, ({ path }) => {
      const entry = workspaceEntries.get(path)
      return entry === undefined ? undefined : { path: entry }
    })
  },
})
