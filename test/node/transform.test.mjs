import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSync } from 'oxc-parser'

import { transform } from '../../dist/transform.js'

const parses = (code, id = 'out.mjs') => {
	const { errors } = parseSync(id, code, { sourceType: 'module' })
	assert.deepEqual(errors.map((e) => e.message), [], code)
}

const cases = {
	'plain await': 'async function f() { const a = await g(); return a }',
	'await as a statement': 'async function f() { await g()\n await h() }',
	'await in an arrow body': 'const f = async () => await g()',
	'object returned from an arrow': 'const f = async () => ({ a: await g() })',
	'nested awaits': 'async function f() { return await h(await g()) }',
	'await of await': 'async function f() { return await await g() }',
	'await in a class method': 'class A { async run() { await g() } }',
	'await in an object method': 'const o = { async run() { await g() } }',
	'for await with a block': 'async function f(it) { for await (const x of it) { use(x) } done() }',
	'for await without a block': 'async function f(it) { for await (const x of it) await use(x)\n done() }',
	'labeled for await': 'async function f(it) { outer: for await (const x of it) { if (x) continue outer } }',
	'for await under an if': 'async function f(it, c) { if (c) for await (const x of it) use(x) }',
	'for await first in the body': 'async function f(it) { for await (const x of it) {} await g() }',
	'top level await': 'const a = await g()\nexport { a }',
	'try catch finally': 'async function f() { try { await g() } catch (e) { await h(e) } finally { await k() } }',
	'await in a template': 'async function f() { return `${await g()}` }',
	'await with a binary': 'async function f() { return (await g()) + await h() * 2 }',
	'async generator': 'async function* f() { yield await g() }',
	'nested async functions': 'async function f() { const inner = async () => { await g() }; await inner() }',
}

for (const [name, code] of Object.entries(cases)) {
	test(`rewritten output parses: ${name}`, () => {
		const result = transform(code, 'in.mjs')
		assert.ok(result, 'expected a rewrite')
		parses(result.code)
	})
}

test('use strict stays the first statement', () => {
	const result = transform('async function f() { "use strict"; await g() }', 'in.mjs')
	assert.match(result.code, /\{ "use strict";;let __ctxValue/)
})

test('typescript and jsx input', () => {
	const ts = transform('export async function f(a: number): Promise<number> { return (await g(a)) as number }', 'in.ts')
	parses(ts.code, 'out.ts')
	const tsx = transform('export const C = async (p: { id: string }) => <div>{await load(p.id)}</div>', 'in.tsx')
	parses(tsx.code, 'out.tsx')
})

test('files without await are left alone', () => {
	assert.equal(transform('function f() { return 1 }', 'in.mjs'), null)
	assert.equal(transform('const awaitable = 1', 'in.mjs'), null)
})

test('a rewritten file is not rewritten again', () => {
	const once = transform('async function f() { await g() }', 'in.mjs')
	assert.equal(transform(once.code, 'in.mjs'), null)
})

test('hashbang stays on the first line', () => {
	const result = transform('#!/usr/bin/env node\nawait g()', 'in.mjs')
	assert.ok(result.code.startsWith('#!/usr/bin/env node\n'))
})

test('a source map comes back', () => {
	const result = transform('async function f() { await g() }', 'in.mjs')
	assert.equal(result.map.sources[0], 'in.mjs')
})

// Runs rewritten code for real, from test/out so the runtime import resolves to this package.
let runs = 0
const runRewritten = async (code) => {
	const { mkdirSync, writeFileSync } = await import('node:fs')
	const { join } = await import('node:path')
	const { pathToFileURL } = await import('node:url')
	const dir = join(import.meta.dirname, '..', 'out')
	mkdirSync(dir, { recursive: true })
	const file = join(dir, `exec-${process.pid}-${runs++}.mjs`)
	writeFileSync(file, transform(code, 'in.mjs', { sourceMap: false }).code)
	return (await import(pathToFileURL(file).href)).run()
}

test('an await that is the whole body of an if only runs when the if does', async () => {
	const code = 'export async function run() { let n = 0; const inc = async () => { n++ }; if (false) await inc(); return n }'
	assert.equal(await runRewritten(code), 0)
})

test('an await that is the whole body of a while loop', { timeout: 5000 }, async () => {
	const code = 'export async function run() { let i = 0; while (i < 3) await (async () => { i++ })(); return i }'
	assert.equal(await runRewritten(code), 3)
})

test('an await at the start of a line after a call with no semicolon', async () => {
	const code = 'export async function run() { let x = 0; const f = () => { x++ }\n f()\n await 1 + 1\n return x }'
	assert.equal(await runRewritten(code), 1)
})

test('use strict with no semicolon stays a directive', async () => {
	const code = "export async function run() { 'use strict'\n await 1\n return (function () { return this })() }"
	assert.equal(await runRewritten(code), undefined)
})

test('for await under two labels, continue on the outer one', async () => {
	const code = 'export async function run() { let n = 0; a: b: for await (const x of [1, 2, 3]) { n += x; continue a } return n }'
	assert.equal(await runRewritten(code), 6)
})

test('a rejected await still throws into the catch', async () => {
	const code = "export async function run() { try { await Promise.reject(new Error('no')) } catch (e) { return e.message } }"
	assert.equal(await runRewritten(code), 'no')
})
