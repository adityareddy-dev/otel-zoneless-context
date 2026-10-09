import { type Context, ROOT_CONTEXT } from '@opentelemetry/api'

type Slot = { current: Context }

// One slot per page, so two copies of this package still agree on the active context.
const key = Symbol.for('otel-zoneless-context')
const holder = globalThis as typeof globalThis & { [key]?: Slot }

export const slot: Slot = holder[key] ?? (holder[key] = { current: ROOT_CONTEXT })
