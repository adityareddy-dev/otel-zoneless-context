// The calls from the repro linked on open-telemetry/opentelemetry-js#5914, logging replaced by a check.
import * as api from '@opentelemetry/api'

import { record } from './harness.mjs'

let span

const seen = (step) => {
	const active = api.trace.getActiveSpan()
	record('5914', '-', step, 'repro', active === undefined ? null : active === span ? 'repro' : 'other span')
}

const general = async () => {
	seen('general')
	await test1()
	await test2()
	seen('general.end')
}

const test1 = async () => {
	seen('test1')
	await test1b()
}

const test1b = async () => {
	seen('test1b')
}

const test2 = async () => {
	seen('test2')
}

export const repro = async () => {
	const tracer = api.trace.getTracer('repro', '0.0.1')
	span = tracer.startSpan('repro')
	const ctx = api.trace.setSpan(api.context.active(), span)
	await api.context
		.with(ctx, async () => {
			seen('repro')
			await general()
		})
		.finally(() => span.end())
}
