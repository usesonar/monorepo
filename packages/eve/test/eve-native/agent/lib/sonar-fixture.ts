/* eslint-disable sort-keys -- Fixture snapshots preserve Sonar's required person-before-company order. */
import { SonarClient } from "@usesonar/effect"
import type { SonarClientService } from "@usesonar/effect"
import { Effect, Layer, Stream } from "effect"

export const researchConfig = {
  company: {
    name: true,
    research: {
      sellsToSMB: {
        description: "Does this company sell to small and medium businesses?",
        type: "string",
      },
    },
  },
  person: { title: true },
  ttl: "12h",
} as const

export const deepConfig = {
  company: {
    legalName: true,
    deepResearch: {
      hasTaxExposure: "Does this company have multi-state tax exposure?",
    },
  },
  person: { phone: true },
  ttl: "12h",
} as const

const researchPending = {
  status: "pending",
  data: {
    person: { title: { status: "pending" } },
    // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
    company: {
      name: { status: "pending" },
      research: { sellsToSMB: { status: "pending" } },
    },
  },
} as const

export const researchComplete = {
  status: "complete",
  data: {
    person: {
      title: {
        confidence: 0.94,
        resolvedAt: "2026-08-26T18:00:00.000Z",
        sources: ["https://fixture.invalid/profile"],
        status: "resolved",
        value: "Founder",
      },
    },
    // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
    company: {
      name: {
        confidence: 0.88,
        resolvedAt: "2026-08-26T18:00:01.000Z",
        sources: ["https://fixture.invalid/about"],
        status: "resolved",
        value: "Analytical Engines",
      },
      research: {
        sellsToSMB: {
          confidence: 0.72,
          resolvedAt: "2026-08-26T18:00:02.000Z",
          sources: ["https://fixture.invalid/customers"],
          status: "resolved",
          value: "yes",
        },
      },
    },
  },
} as const

export const deepComplete = {
  status: "complete",
  data: {
    person: { phone: { reason: "consumerEmail", status: "skipped" } },
    // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
    company: {
      legalName: {
        confidence: 0.91,
        resolvedAt: "2026-08-26T18:04:00.000Z",
        sources: ["https://fixture.invalid/entity"],
        status: "resolved",
        value: "Analytical Engines LLC",
      },
      deepResearch: {
        hasTaxExposure: {
          confidence: 0.67,
          resolvedAt: "2026-08-26T18:05:00.000Z",
          sources: ["https://fixture.invalid/tax"],
          status: "resolved",
          value: "likely",
        },
      },
    },
  },
} as const

export const deepPending = {
  status: "pending",
  data: {
    person: { phone: { status: "pending" } },
    // oxlint-disable-next-line sort-keys -- Sonar's public contract lists person before company.
    company: {
      legalName: { status: "pending" },
      deepResearch: { hasTaxExposure: { status: "pending" } },
    },
  },
} as const

const research = Stream.fromArray([researchPending, researchComplete])
const deepResearch = Stream.fromArray([deepPending, deepComplete])

const service = {
  // SAFETY: The fixture tool always uses deepConfig, which produced deepComplete.
  deepResearch: () => deepResearch as never,
  // SAFETY: The fixture tool always uses researchConfig, which produced both research snapshots.
  research: () => research as never,
  // SAFETY: Retrieve is outside this Eve fixture and cannot be called by either tool.
  retrieve: () => Effect.never as never,
} satisfies SonarClientService

export const sonarFixtureLayer = Layer.succeed(SonarClient, service)
