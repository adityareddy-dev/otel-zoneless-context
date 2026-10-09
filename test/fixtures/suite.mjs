import { order, rows } from './harness.mjs'
import { flows } from './flows.mjs'
import { repro } from './repro-5914.mjs'
import { shapes } from './shapes.mjs'

export function runSuite() {
	return repro()
		.then(() => flows())
		.then(() => shapes())
		.then(() => ({ rows, order }))
}
