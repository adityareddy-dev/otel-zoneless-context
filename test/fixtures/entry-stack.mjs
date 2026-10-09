import { context, trace } from '@opentelemetry/api'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { StackContextManager } from '@opentelemetry/sdk-trace-web'

import { runSuite } from './suite.mjs'

trace.setGlobalTracerProvider(new BasicTracerProvider())
context.setGlobalContextManager(new StackContextManager().enable())

export const done = runSuite()
globalThis.__done = done
