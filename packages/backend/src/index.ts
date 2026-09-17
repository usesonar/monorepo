import { Context, Effect, Layer } from "effect"

import { BackendEngine } from "./engine.ts"
import type { EngineOptions } from "./engine.ts"
import { BackendEnvironment, makeLayerInput } from "./internal-layer.ts"
import {
  makeFirecrawlSDKLayer,
  makeKyProviderTransportLayer,
  makeParallelSDKLayer,
  makeProviderGatewayLayer,
  makeProviderRunStoreLayer,
  makeProviderRunner,
  providerClockLayer,
} from "./providers.ts"
import type {
  FirecrawlSDKOptions,
  HTTPTransportOptions,
  ParallelSDKOptions,
  ProviderGatewayOptions,
} from "./providers.ts"

export type SonarBackendService = {
  readonly fetch: (request: Request) => Effect.Effect<Response>
}

export class SonarBackend extends Context.Service<SonarBackend, SonarBackendService>()(
  "@usesonar/backend/SonarBackend"
) {}

export const layer = (input: Layer.Layer<BackendEnvironment>): Layer.Layer<SonarBackend> =>
  Layer.effect(
    SonarBackend,
    Effect.map(Effect.service(BackendEnvironment), (engine) =>
      Effect.succeed({
        fetch: (request: Request) => Effect.promise(() => engine.handle(request)),
      })
    ).pipe(Effect.flatten)
  ).pipe(Layer.provide(input))

export type ProviderLayerOptions = Omit<EngineOptions, "providerRunner"> & {
  readonly firecrawl: FirecrawlSDKOptions
  readonly parallel: ParallelSDKOptions
  readonly provider?: ProviderGatewayOptions
  readonly sixtyFour: HTTPTransportOptions["sixtyFour"]
}

export const layerWithProviders = (options: ProviderLayerOptions): Layer.Layer<SonarBackend> => {
  const dependencies = Layer.mergeAll(
    makeFirecrawlSDKLayer(options.firecrawl),
    makeParallelSDKLayer(options.parallel),
    makeKyProviderTransportLayer({ sixtyFour: options.sixtyFour }),
    makeProviderRunStoreLayer(),
    providerClockLayer
  )
  const gateway = makeProviderGatewayLayer(options.provider).pipe(Layer.provide(dependencies))
  const engine = new BackendEngine({
    providerRunner: makeProviderRunner(gateway),
    scenario: options.scenario,
    serverSecret: options.serverSecret,
    tenants: options.tenants,
  })
  return layer(makeLayerInput(engine))
}

export const createSonarHandler =
  (backendLayer: Layer.Layer<SonarBackend>) =>
  async (request: Request): Promise<Response> =>
    await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(Effect.service(SonarBackend), (backend) => backend.fetch(request)).pipe(
          Effect.provide(backendLayer)
        )
      )
    )
