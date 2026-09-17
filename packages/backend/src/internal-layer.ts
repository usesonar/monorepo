import { Context, Effect, Layer } from "effect"

import type { BackendEngine } from "./engine.ts"

export class BackendEnvironment extends Context.Service<BackendEnvironment, BackendEngine>()(
  "@usesonar/backend/internal/BackendEnvironment"
) {}

export const makeLayerInput = (engine: BackendEngine): Layer.Layer<BackendEnvironment> =>
  Layer.effect(
    BackendEnvironment,
    Effect.acquireRelease(
      Effect.sync(() => {
        engine.acquireScope()
        return engine
      }),
      () =>
        Effect.sync(() => {
          engine.releaseScope()
        })
    )
  )
