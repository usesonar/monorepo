import { BackendEngine } from "./engine.ts"
import type { EngineOptions, FakeFieldInput } from "./engine.ts"
import { createSonarHandler, layer } from "./index.ts"
import { makeLayerInput } from "./internal-layer.ts"

export type { FakeScenario, TestTenant } from "./engine.ts"

export const createBackendTestHarness = (options: Partial<EngineOptions> = {}) => {
  if (options.serverSecret === undefined || options.tenants === undefined) {
    throw new TypeError("The backend test harness requires a server secret and tenants")
  }
  const engine = new BackendEngine({
    providerRunner: options.providerRunner,
    scenario: options.scenario,
    serverSecret: options.serverSecret,
    tenants: options.tenants,
  })
  const layerInput = makeLayerInput(engine)
  const fetch = createSonarHandler(layer(layerInput))

  return {
    advanceBy: (milliseconds: number) => {
      engine.advanceBy(milliseconds)
    },
    cacheField: (
      path: string,
      field: FakeFieldInput,
      cacheOptions: { readonly scope: "builtIn" | "custom" }
    ) => {
      engine.cacheField(path, field, cacheOptions)
    },
    close: () => engine.close(),
    collectSSE: (response: Response) => engine.collectSSE(response),
    disconnect: (response: Response) => engine.disconnect(response),
    fetch,
    inspect: () => engine.inspect(),
    layerInput,
    nextSSE: (response: Response) => engine.nextSSE(response),
    settle: (path: string, field?: FakeFieldInput) => {
      engine.settle(path, field)
    },
    settleAll: () => {
      engine.settleAll()
    },
    settleIdentify: (field: FakeFieldInput) => {
      engine.settleIdentify(field)
    },
    snapshot: (hash: string) => engine.snapshot(hash),
    timeout: (path: string) => {
      engine.timeout(path)
    },
  }
}
