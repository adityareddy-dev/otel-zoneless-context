import { context, trace } from '@opentelemetry/api'
import { ZoneContextManager } from '@opentelemetry/context-zone'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'

import { runSuite } from './suite.mjs'

trace.setGlobalTracerProvider(new BasicTracerProvider())
context.setGlobalContextManager(new ZoneContextManager().enable())

export const done = runSuite()
globalThis.__done = done
