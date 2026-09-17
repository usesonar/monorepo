import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { SonarClient } from "@usesonar/effect"
import { ManagedRuntime } from "effect"
import type { Layer } from "effect"
import { createContext, createElement, useEffect, useReducer, useRef } from "react"
import type { ReactNode } from "react"

const CACHE_TIME = 5 * 60 * 1000

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: CACHE_TIME,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        retryOnMount: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  })

const createResources = (layer: Layer.Layer<SonarClient>) => ({
  queryClient: createQueryClient(),
  runtime: ManagedRuntime.make(layer),
})

type ProviderResources = ReturnType<typeof createResources>

export const SonarContext = createContext<ProviderResources | null>(null)

export type SonarProviderProps = {
  readonly layer: Layer.Layer<SonarClient>
  readonly children: ReactNode
}

export const SonarProvider = ({ children, layer }: SonarProviderProps) => {
  const [resources] = useReducer((current: ProviderResources) => current, layer, createResources)
  const lifecycle = useRef(0)

  useEffect(() => {
    lifecycle.current += 1
    const mountedLifecycle = lifecycle.current
    return () => {
      queueMicrotask(() => {
        if (lifecycle.current !== mountedLifecycle) {
          return
        }
        const dispose = async () => {
          await resources.queryClient.cancelQueries()
          resources.queryClient.clear()
          await resources.runtime.dispose()
        }
        void dispose()
      })
    }
  }, [resources])

  return createElement(
    SonarContext.Provider,
    { value: resources },
    createElement(QueryClientProvider, { client: resources.queryClient }, children)
  )
}
