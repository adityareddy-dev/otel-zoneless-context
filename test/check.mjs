import assert from 'node:assert/strict'

import { missing5914 } from './expected.mjs'
import { summarize, table } from './summary.mjs'

export function checkRuns(title, results, expected) {
	const summaries = Object.fromEntries(Object.entries(results).map(([name, result]) => [name, summarize(result)]))
	console.log(`\n${table(title, summaries)}\n`)

	for (const [name, cases] of Object.entries(expected)) {
		const got = summaries[name]
		assert.ok(got, `${name} did not run`)
		for (const [kase, [pass, total]] of Object.entries(cases)) {
			assert.deepEqual(
				[got[kase]?.pass, got[kase]?.total],
				[pass, total],
				`${name}, ${kase}: ${got[kase]?.misses.join('; ')}`,
			)
		}

		const gone = results[name].rows.filter((row) => row.kase === '5914' && !row.ok).map((row) => row.step)
		assert.deepEqual(gone, missing5914[name] ?? [], `${name}, #5914 steps without the span`)
	}

	// The two flows have to interleave, or a pass says nothing.
	for (const [name, result] of Object.entries(results)) {
		const steps = result.order.filter((step) => step.startsWith('flows:'))
		const lastA = steps.lastIndexOf('flows:A:after await 3')
		const firstB = steps.indexOf('flows:B:after await 1')
		assert.ok(firstB > -1 && firstB < lastA, `${name}: flows did not interleave, ${steps.join(' ')}`)
	}
}
