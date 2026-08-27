# `@usesonar/react`

`@usesonar/react` provides React hooks for progressive Sonar research. It uses an injected Effect client and keeps its TanStack streamed-query cache inside `SonarProvider`.

## Install after the first public release

```sh
bun add @usesonar/react @usesonar/effect react@19.2.8
```

## Provide the client

Create a browser-safe Effect Layer with a publishable capability, then mount it once for the subtree that shares Sonar results:

```tsx
import { layer, question } from "@usesonar/effect"
import { SonarProvider, useSonar } from "@usesonar/react"

type AccountSignals = {
  intent: "low" | "medium" | "high"
  evidence: string[]
}

const sonarLayer = layer({
  baseURL: "https://sonar.example",
  publishableKey: "pk_example",
})

const research = {
  ttl: "7d",
  person: ["title", "linkedin"],
  company: ["domain", "name"],
  research: {
    accountSignals: question<AccountSignals>("Which buying signals are publicly visible?"),
  },
} as const

const Profile = () => {
  const sonar = useSonar(research)

  return (
    <button
      onClick={() =>
        sonar.resolve({
          fullName: "Ada Lovelace",
          email: "ada@example.com",
        })
      }
      type="button"
    >
      {sonar.loading ? "Researching" : "Research profile"}
    </button>
  )
}

export const App = () => (
  <SonarProvider layer={sonarLayer}>
    <Profile />
  </SonarProvider>
)
```

When allowed origins are configured for the publishable capability, the browser's `Origin` must match one of them. Never put a secret capability in client code.

`useSonar` and `useDeepSonar` infer their results from the config and return `{ resolve, data, status, loading, error }`; neither hook accepts a separate answer map. In this example, `data.accountSignals` is `Field<AccountSignals>`. Plain prompt strings produce `Field<JSONValue>`, selected built-ins keep their exact catalog types, and unselected built-ins are absent. Keep the config literal or use `satisfies` when exact inference matters. Finite interfaces and finite type aliases keep exact required fields. A question map annotated as `Readonly<Record<string, string>>` exposes arbitrary custom reads as `Field<JSONValue> | undefined`, while broad catalog arrays make reads optional without changing catalog value types. Union, optional-keyed, callable, constructable, and numeric or symbol key hybrid maps are rejected.

Before `resolve`, data and error are `null`, status is `undefined`, and loading is false. Built-ins appear under `data.person` and `data.company`, while custom answers remain top-level fields.

`SonarProvider` includes its own `QueryClientProvider`, so the app does not need a separate TanStack provider. Identical canonical requests share one active query and completed result within that Sonar provider for five minutes. Separate providers stay isolated, and a new `resolve` call switches the hook to the latest request and interrupts superseded work.
