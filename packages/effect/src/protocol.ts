import { Effect, Option, Schema } from "effect"

import { ProtocolError } from "./errors.js"
import { fieldAtPath, snapshotPaths, withField } from "./model.js"
import type { DeepResearchConfig, ResearchConfig, SonarSnapshot } from "./model.js"
import { Field } from "./schemas.js"

const ProtocolEvent = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("CompleteEvent") }),
  Schema.Struct({ _tag: Schema.Literal("FieldEvent"), field: Field, path: Schema.String }),
])

const protocolFailure = (message: string) => Effect.fail(new ProtocolError({ message }))

export const reduceSnapshot = <const C extends ResearchConfig<object> | DeepResearchConfig<object>>(
  snapshot: SonarSnapshot<C>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This public boundary immediately decodes adversarial input with ProtocolEvent.
  input: unknown
): Effect.Effect<SonarSnapshot<C>, ProtocolError> => {
  const event = Option.getOrUndefined(Schema.decodeUnknownOption(ProtocolEvent)(input))
  if (snapshot.status === "complete") {
    return protocolFailure("Received an event after completion")
  }
  if (!event) {
    return protocolFailure("Received an unknown protocol event")
  }
  if (event._tag === "CompleteEvent") {
    const pending = snapshotPaths(snapshot).some(
      (path) => fieldAtPath(snapshot, path)?.status === "pending"
    )
    return pending
      ? protocolFailure("Received completion before every requested field settled")
      : Effect.succeed({ ...snapshot, status: "complete" })
  }

  const existing = fieldAtPath(snapshot, event.path)
  if (!existing) {
    return protocolFailure(`Received an event for unrequested field ${event.path}`)
  }
  if (existing.status !== "pending") {
    return protocolFailure(`Received a duplicate event for ${event.path}`)
  }
  if (event.field.status === "pending") {
    return protocolFailure(`Received a non-terminal field event for ${event.path}`)
  }

  // SAFETY: withField preserves C's selected keys and only replaces a requested leaf.
  return Effect.succeed(withField(snapshot, event.path, event.field))
}
