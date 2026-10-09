import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

import { buildEntry } from '../build.mjs'
import { checkRuns } from '../check.mjs'
import { expectedNode } from '../expected.mjs'

const runs = [
	['stack', false],
	['stack', true],
	['ours', false],
	['ours', true],
]

test('#5914, two flows and the shapes in Node, each manager as written and rewritten', async () => {
	const results = {}
	for (const [entry, rewritten] of runs) {
		const file = await buildEntry(entry, { rewritten, platform: 'node' })
		const output = execFileSync(process.execPath, ['test/run-one.mjs', file], { encoding: 'utf8' })
		results[`${entry} ${rewritten ? 'rewritten' : 'raw'}`] = JSON.parse(output)
	}
	checkRuns('Node, passing checks per case', results, expectedNode)
})
