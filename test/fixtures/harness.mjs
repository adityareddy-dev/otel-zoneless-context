import { context, createContextKey } from '@opentelemetry/api'

export const KEY = createContextKey('flow')
export const rows = []
export const order = []
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const rejectAfter = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('boom')), ms))

export function record(kase, flow, step, expected, got) {
	rows.push({ kase, flow, step, expected, got, ok: got === expected })
	if (flow !== '-') order.push(`${kase}:${flow}:${step}`)
}

// Reads the flow value from the active context, expected is the flow's own name unless given.
export function check(kase, flow, step, expected = flow) {
	record(kase, flow, step, expected, context.active().getValue(KEY) ?? null)
}
