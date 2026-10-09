// Runs each browser bundle in its own page of headless Chromium and returns what the page recorded.
import { chromium } from 'playwright-core'

import { buildEntry } from './build.mjs'

export const browserRuns = [
	['stack', false],
	['zone', false],
	['ours', false],
	['ours', true],
]

export const runName = (entry, rewritten) => `${entry} ${rewritten ? 'rewritten' : 'raw'}`

export async function runInBrowser() {
	const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined })
	const results = {}
	try {
		for (const [entry, rewritten] of browserRuns) {
			const file = await buildEntry(entry, { rewritten, platform: 'browser' })
			const page = await browser.newPage()
			const errors = []
			page.on('pageerror', (error) => errors.push(error.message))
			await page.setContent('<!doctype html><title>run</title><body></body>')
			await page.addScriptTag({ path: file })
			const result = await page.evaluate(() => globalThis.__done)
			if (errors.length) throw new Error(`${runName(entry, rewritten)}: ${errors.join('\n')}`)
			results[runName(entry, rewritten)] = result
			await page.close()
		}
	} finally {
		await browser.close()
	}
	return results
}
