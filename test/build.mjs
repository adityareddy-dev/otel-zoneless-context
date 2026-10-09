// Builds every entry two ways, as written and through the plugin, for Node and for the browser.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as esbuild from 'esbuild'

import { esbuild as zonelessPlugin } from '../dist/plugin.js'

const here = dirname(fileURLToPath(import.meta.url))
export const out = join(here, 'out')
export const fixtures = /[\\/]test[\\/]fixtures[\\/](repro-5914|flows|shapes)\.mjs$/

export async function buildEntry(entry, { rewritten, platform }) {
	mkdirSync(out, { recursive: true })
	const name = `${platform}-${entry}-${rewritten ? 'rewritten' : 'raw'}`
	const outfile = join(out, `${name}.${platform === 'node' ? 'mjs' : 'js'}`)
	await esbuild.build({
		entryPoints: [join(here, 'fixtures', `entry-${entry}.mjs`)],
		bundle: true,
		format: platform === 'node' ? 'esm' : 'iife',
		platform: platform === 'node' ? 'node' : 'browser',
		packages: platform === 'node' ? 'external' : undefined,
		target: 'esnext',
		outfile,
		logLevel: 'error',
		plugins: rewritten ? [zonelessPlugin({ include: fixtures })] : [],
	})
	return outfile
}
