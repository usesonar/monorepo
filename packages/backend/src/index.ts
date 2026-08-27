import { Context, Effect, Layer } from "effect"

import { BackendEnvironment } from "./internal-layer.ts"

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
