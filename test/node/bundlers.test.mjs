// The same suite built through the plugin on Rollup and Vite, and on webpack too, then run in Node.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { rollup } from 'rollup'
import { build as viteBuild } from 'vite'
import webpack from 'webpack'

import { rollup as rollupPlugin, vite as vitePlugin, webpack as webpackPlugin } from '../../dist/plugin.js'
import { fixtures, out } from '../build.mjs'
import { checkRuns } from '../check.mjs'
import { expectedNode } from '../expected.mjs'

const entry = join(import.meta.dirname, '..', 'fixtures', 'entry-ours.mjs')
const external = (id) => /^(@opentelemetry\/|otel-zoneless-context)/.test(id)

const run = (file) => JSON.parse(execFileSync(process.execPath, ['test/run-one.mjs', file], { encoding: 'utf8' }))

async function withRollup() {
	const bundle = await rollup({ input: entry, external, plugins: [rollupPlugin({ include: fixtures })] })
	const file = join(out, 'rollup', 'entry.mjs')
	await bundle.write({ file, format: 'es' })
	await bundle.close()
	return file
}

async function withVite() {
	const dir = join(out, 'vite')
	await viteBuild({
		configFile: false,
		logLevel: 'silent',
		plugins: [vitePlugin({ include: fixtures })],
		build: {
			outDir: dir,
			emptyOutDir: true,
			minify: false,
			lib: { entry, formats: ['es'], fileName: () => 'entry.mjs' },
			rollupOptions: { external },
		},
	})
	return join(dir, 'entry.mjs')
}

async function withWebpack() {
	const dir = join(out, 'webpack')
	mkdirSync(dir, { recursive: true })
	const compiler = webpack({
		mode: 'none',
		target: 'node',
		entry,
		experiments: { outputModule: true },
		output: { path: dir, filename: 'entry.mjs', module: true, library: { type: 'module' } },
		externalsType: 'module',
		externals: [({ request }, callback) => (external(request) ? callback(null, request) : callback())],
		plugins: [webpackPlugin({ include: fixtures })],
	})
	await new Promise((resolve, reject) =>
		compiler.run((error, stats) => {
			if (error) return reject(error)
			if (stats.hasErrors()) return reject(new Error(stats.toString('errors-only')))
			compiler.close(() => resolve())
		}),
	)
	return join(dir, 'entry.mjs')
}

test('the plugin on Rollup, Vite and webpack keeps the same results as on esbuild', async () => {
	const results = {
		rollup: run(await withRollup()),
		vite: run(await withVite()),
		webpack: run(await withWebpack()),
	}
	const expected = expectedNode['ours rewritten']
	checkRuns('Node, through each bundler', results, { rollup: expected, vite: expected, webpack: expected })
})
