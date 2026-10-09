import { context, trace } from '@opentelemetry/api'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'

import { ZonelessContextManager } from '../../dist/index.js'
import { runSuite } from './suite.mjs'

trace.setGlobalTracerProvider(new BasicTracerProvider())
context.setGlobalContextManager(new ZonelessContextManager().enable())

export const done = runSuite()
globalThis.__done = done
