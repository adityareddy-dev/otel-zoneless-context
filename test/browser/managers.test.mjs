import { test } from 'node:test'

import { runInBrowser } from '../browser-run.mjs'
import { checkRuns } from '../check.mjs'
import { expectedBrowser } from '../expected.mjs'

test('#5914, two flows and the shapes in headless Chromium, stack, zone and this manager', async () => {
	const results = await runInBrowser()
	checkRuns('Chromium, passing checks per case', results, expectedBrowser)
})
