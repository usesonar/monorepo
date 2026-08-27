// oxlint-disable no-await-in-loop -- Byte reads and reconnect attempts are intentionally sequential.
// oxlint-disable promise/prefer-await-to-callbacks, promise/prefer-await-to-then -- The stream pump must run in the background so consumers receive events before completion.
// oxlint-disable sort-keys -- Normalized events preserve the locked id-type-payload public order.

import { createParser } from "eventsource-parser"
import { isNetworkError, isTimeoutError } from "ky"
import type { KyInstance } from "ky"
import { z } from "zod"

import {
  CompleteEvent,
  DeepResearchRequest,
  Field,
  FieldEvent,
  JSONValue,
  ResearchRequest,
  SnapshotEvent,
  SonarSnapshot,
  fieldMatchesPath,
  requestPaths,
  snapshotMatchesRequest,
} from "./schemas.ts"
import type { SonarEvent } from "./schemas.ts"

const maximumEventSize = 1024 * 1024
const defaultMaxReconnects = 3

export class SonarStreamError extends Error {
  override readonly name = "SonarStreamError"
}

export type StreamOptions = {
  signal?: AbortSignal
  maxReconnects?: number
}

type StreamRequest = ResearchRequest | DeepResearchRequest
type SSEMessage = {
  data: string
  event?: string
  id?: string
}

type ProtocolState = {
  acceptedEvents: Map<string, string>
  completed: boolean
  hasSnapshot: boolean
  latestId?: string
  nextId: bigint
  pendingPaths: Set<string>
}

type EventByteState = {
  boundaryAfterCR: boolean
  eventBytes: number
  lineBytes: number
  pendingCR: boolean
}

const RawFieldEvent = z.object({ path: z.string().min(1) }).passthrough()
const RawCompleteEvent = z.object({ hash: z.string().min(1) }).strict()

const parseJSON = (data: string): JSONValue => {
  try {
    return JSONValue.parse(JSON.parse(data))
  } catch (error) {
    throw new SonarStreamError("SSE event data is not valid JSON", { cause: error })
  }
}

const accountEventBytes = (chunk: Uint8Array, state: EventByteState) => {
  for (const byte of chunk) {
    if (state.pendingCR) {
      const previousCRWasBoundary = state.boundaryAfterCR
      state.pendingCR = false
      state.boundaryAfterCR = false
      if (byte === 10) {
        if (!previousCRWasBoundary) {
          state.eventBytes += 1
          if (state.eventBytes > maximumEventSize) {
            throw new SonarStreamError("SSE event exceeds 1 MiB")
          }
        }
        continue
      }
    }

    if (byte === 10 || byte === 13) {
      if (state.lineBytes === 0) {
        state.eventBytes = 0
        state.boundaryAfterCR = byte === 13
      } else {
        state.eventBytes += 1
        state.lineBytes = 0
      }
      state.pendingCR = byte === 13
    } else {
      state.eventBytes += 1
      state.lineBytes += 1
    }

    if (state.eventBytes > maximumEventSize) {
      throw new SonarStreamError("SSE event exceeds 1 MiB")
    }
  }
}

const validateInitialSnapshot = (snapshot: SonarSnapshot, request: StreamRequest) => {
  if (
    snapshot.status !== "pending" ||
    !snapshotMatchesRequest(snapshot, request) ||
    [...Object.values(snapshot.data.person), ...Object.values(snapshot.data.company)].some(
      (field) => field.status !== "pending"
    ) ||
    Object.entries(snapshot.data)
      .filter(([key]) => key !== "person" && key !== "company")
      .some(([, field]) => {
        const parsed = Field.safeParse(field)
        return !parsed.success || parsed.data.status !== "pending"
      })
  ) {
    throw new SonarStreamError("The first SSE event must contain the full pending snapshot")
  }
}

const compareKeys = (left: string, right: string) => {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

const canonicalJSONValue = (value: JSONValue): string => {
  if (value === null) {
    return "null"
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSONValue).join(",")}]`
  }
  if (Object(value) === value) {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => compareKeys(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJSONValue(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

const isJSONRecord = (value: JSONValue): value is { [key: string]: JSONValue } =>
  value !== null && !Array.isArray(value) && Object(value) === value

const parseNormalizedEvent = (id: string, type: string, data: JSONValue): SonarEvent => {
  try {
    if (isJSONRecord(data) && Object.hasOwn(data, "__proto__")) {
      throw new SonarStreamError(`Invalid ${type} SSE event`)
    }
    switch (type) {
      case "snapshot": {
        return SnapshotEvent.parse({ id, type, snapshot: SonarSnapshot.parse(data) })
      }
      case "field": {
        const { path, ...rawField } = RawFieldEvent.parse(data)
        const field = Field.parse(rawField)
        if (!fieldMatchesPath(path, field)) {
          throw new SonarStreamError(`Invalid field event for ${path}`)
        }
        return FieldEvent.parse({ id, type, path, field })
      }
      case "complete": {
        const { hash } = RawCompleteEvent.parse(data)
        return CompleteEvent.parse({ id, type, hash })
      }
      default: {
        throw new SonarStreamError(`Unknown SSE event name: ${type}`)
      }
    }
  } catch (error) {
    if (error instanceof SonarStreamError) {
      throw error
    }
    throw new SonarStreamError(`Invalid ${type} SSE event`, { cause: error })
  }
}

const applyNewEvent = (event: SonarEvent, request: StreamRequest, state: ProtocolState) => {
  switch (event.type) {
    case "snapshot": {
      if (state.hasSnapshot) {
        throw new SonarStreamError("Received more than one snapshot event")
      }
      validateInitialSnapshot(event.snapshot, request)
      state.hasSnapshot = true
      state.pendingPaths = new Set(requestPaths(request))
      return
    }
    case "field": {
      if (!state.pendingPaths.has(event.path) || event.field.status === "pending") {
        throw new SonarStreamError(`Invalid field event for ${event.path}`)
      }
      state.pendingPaths.delete(event.path)
      return
    }
    case "complete": {
      if (state.pendingPaths.size > 0) {
        throw new SonarStreamError("Received completion before every requested field settled")
      }
      state.completed = true
      return
    }
    default: {
      throw new SonarStreamError("Unknown normalized SSE event")
    }
  }
}

const normalizedEvent = (
  message: SSEMessage,
  request: StreamRequest,
  state: ProtocolState,
  connectionIds: Set<string>
): SonarEvent | undefined => {
  const { id, event: type } = message
  if (!id) {
    throw new SonarStreamError("Every SSE event requires a non-empty ID")
  }
  if (!type) {
    throw new SonarStreamError("Every SSE event requires an event name")
  }
  if (state.completed) {
    throw new SonarStreamError("Received an SSE event after completion")
  }

  const data = parseJSON(message.data)
  const normalized = parseNormalizedEvent(id, type, data)
  const signature = `${JSON.stringify(type)}:${canonicalJSONValue(data)}`

  const acceptedSignature = state.acceptedEvents.get(id)
  if (acceptedSignature !== undefined) {
    if (connectionIds.has(id)) {
      throw new SonarStreamError(`Repeated SSE event ID: ${id}`)
    }
    if (acceptedSignature !== signature) {
      throw new SonarStreamError(`SSE event ID ${id} does not match its accepted event`)
    }
    connectionIds.add(id)
    return undefined
  }
  if (id !== state.nextId.toString()) {
    throw new SonarStreamError(`Expected SSE event ID ${state.nextId.toString()}, received ${id}`)
  }
  if (!state.hasSnapshot && type !== "snapshot") {
    throw new SonarStreamError("The first SSE event must be a snapshot")
  }

  applyNewEvent(normalized, request, state)

  connectionIds.add(id)
  state.acceptedEvents.set(id, signature)
  state.latestId = id
  state.nextId += 1n
  return normalized
}

const openResponse = async (
  client: KyInstance,
  route: "/v1/research" | "/v1/deepResearch",
  request: StreamRequest,
  signal: AbortSignal,
  lastEventId?: string
) => {
  if (signal.aborted) {
    throw signal.reason
  }

  const headers = new Headers({
    accept: "text/event-stream",
    "content-type": "application/json",
  })
  if (lastEventId !== undefined) {
    headers.set("last-event-id", lastEventId)
  }
  // oxlint-disable-next-line promise/avoid-new -- This must reject even when an injected fetch ignores its AbortSignal.
  const response = await new Promise<Response>((resolve, reject) => {
    const rejectOnAbort = () => {
      signal.removeEventListener("abort", rejectOnAbort)
      reject(signal.reason)
    }
    signal.addEventListener("abort", rejectOnAbort, { once: true })
    void client
      .post(route, { headers, json: request, retry: 0, signal, throwHttpErrors: true })
      .then(
        (value) => {
          signal.removeEventListener("abort", rejectOnAbort)
          resolve(value)
        },
        (error: Error) => {
          signal.removeEventListener("abort", rejectOnAbort)
          reject(error)
        }
      )
  })
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType !== "text/event-stream") {
    void response.body?.cancel().catch(() => null)
    throw new SonarStreamError("Expected a text/event-stream response")
  }
  if (!response.body) {
    throw new SonarStreamError("The SSE response has no body")
  }
  return response
}

const consumeResponse = async (
  response: Response,
  request: StreamRequest,
  state: ProtocolState,
  signal: AbortSignal,
  emit: (event: SonarEvent) => void
) => {
  if (!response.body) {
    throw new SonarStreamError("The SSE response has no body")
  }

  const reader = response.body.getReader()
  let cancellationStarted = false
  const cancelReader = () => {
    if (cancellationStarted) {
      return
    }
    cancellationStarted = true
    void reader.cancel().catch(() => null)
  }
  const cancelBody = () => {
    cancelReader()
  }
  signal.addEventListener("abort", cancelBody, { once: true })

  const connectionIds = new Set<string>()
  const decoder = new TextDecoder()
  const eventByteState: EventByteState = {
    boundaryAfterCR: false,
    eventBytes: 0,
    lineBytes: 0,
    pendingCR: false,
  }
  const parser = createParser({
    maxBufferSize: maximumEventSize,
    onError(error) {
      throw new SonarStreamError("Invalid SSE framing", { cause: error })
    },
    onEvent(message) {
      const event = normalizedEvent(message, request, state, connectionIds)
      if (event) {
        emit(event)
      }
    },
  })

  try {
    if (signal.aborted) {
      cancelReader()
      throw signal.reason
    }

    while (true) {
      let result
      try {
        result = await reader.read()
      } catch {
        if (signal.aborted) {
          throw signal.reason
        }
        return
      }
      if (result.done) {
        parser.feed(decoder.decode())
        parser.reset({ consume: true })
        return
      }
      accountEventBytes(result.value, eventByteState)
      parser.feed(decoder.decode(result.value, { stream: true }))
      if (state.completed) {
        cancelReader()
        return
      }
    }
  } catch (error) {
    cancelReader()
    throw error
  } finally {
    signal.removeEventListener("abort", cancelBody)
    reader.releaseLock()
  }
}

const validateMaxReconnects = (maxReconnects: number) => {
  if (!Number.isInteger(maxReconnects) || maxReconnects < 0) {
    throw new TypeError("maxReconnects must be a non-negative integer")
  }
}

const stream = async (
  client: KyInstance,
  route: "/v1/research" | "/v1/deepResearch",
  request: StreamRequest,
  options: StreamOptions
): Promise<ReadableStream<SonarEvent>> => {
  const maxReconnects = options.maxReconnects ?? defaultMaxReconnects
  validateMaxReconnects(maxReconnects)

  const transport = new AbortController()
  const forwardAbort = () => transport.abort(options.signal?.reason)
  if (options.signal?.aborted) {
    forwardAbort()
  } else {
    options.signal?.addEventListener("abort", forwardAbort, { once: true })
  }

  let firstResponse: Response
  try {
    firstResponse = await openResponse(client, route, request, transport.signal)
  } catch (error) {
    options.signal?.removeEventListener("abort", forwardAbort)
    throw error
  }

  let cancelled = false

  return new ReadableStream<SonarEvent>({
    cancel(reason) {
      cancelled = true
      transport.abort(reason)
      options.signal?.removeEventListener("abort", forwardAbort)
    },
    start(controller) {
      const state: ProtocolState = {
        acceptedEvents: new Map(),
        completed: false,
        hasSnapshot: false,
        nextId: 0n,
        pendingPaths: new Set(),
      }

      const run = async () => {
        let response = firstResponse
        let reconnects = 0
        while (true) {
          await consumeResponse(response, request, state, transport.signal, (event) =>
            controller.enqueue(event)
          )

          if (state.completed) {
            controller.close()
            options.signal?.removeEventListener("abort", forwardAbort)
            return
          }
          if (transport.signal.aborted) {
            throw transport.signal.reason
          }
          while (true) {
            if (reconnects === maxReconnects) {
              throw new SonarStreamError(
                `SSE stream ended before completion after ${maxReconnects} reconnects`
              )
            }
            reconnects += 1
            try {
              response = await openResponse(
                client,
                route,
                request,
                transport.signal,
                state.latestId
              )
              break
            } catch (error) {
              if (transport.signal.aborted) {
                throw transport.signal.reason
              }
              if (!isNetworkError(error) && !isTimeoutError(error)) {
                throw error
              }
            }
          }
        }
      }

      void run().catch((error: Error) => {
        options.signal?.removeEventListener("abort", forwardAbort)
        if (!cancelled) {
          controller.error(error)
        }
      })
    },
  })
}

export const streamResearch = (
  client: KyInstance,
  request: ResearchRequest,
  options: StreamOptions = {}
): Promise<ReadableStream<SonarEvent>> =>
  stream(client, "/v1/research", ResearchRequest.parse(request), options)

export const streamDeepResearch = (
  client: KyInstance,
  request: DeepResearchRequest,
  options: StreamOptions = {}
): Promise<ReadableStream<SonarEvent>> =>
  stream(client, "/v1/deepResearch", DeepResearchRequest.parse(request), options)
