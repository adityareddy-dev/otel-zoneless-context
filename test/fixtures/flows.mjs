// Two flows started together, three awaits each on timers that cross, so they interleave.
import { context, ROOT_CONTEXT } from '@opentelemetry/api'

import { check, KEY, sleep } from './harness.mjs'

const flow = (name, delays) => async () => {
	check('flows', name, 'start')
	await sleep(delays[0])
	check('flows', name, 'after await 1')
	await sleep(delays[1])
	check('flows', name, 'after await 2')
	await sleep(delays[2])
	check('flows', name, 'after await 3')
}

// A resumes at 20, 100, 140 ms and B at 60, 80, 170 ms.
export const flows = async () => {
	setTimeout(() => check('leak', '-', 'timer at 70 ms, both waiting', null), 70)
	setTimeout(() => check('leak', '-', 'timer at 200 ms, both done', null), 200)
	const a = context.with(ROOT_CONTEXT.setValue(KEY, 'A'), flow('A', [20, 80, 40]))
	const b = context.with(ROOT_CONTEXT.setValue(KEY, 'B'), flow('B', [60, 20, 90]))
	check('leak', '-', 'right after starting both', null)
	await Promise.all([a, b])
	await sleep(60)
}
