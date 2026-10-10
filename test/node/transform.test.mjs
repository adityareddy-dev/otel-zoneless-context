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

for (const source of [
	'async function f(it) { a: b: for await (const x of it) { continue a } }',
	'async function f(it, c) { if (c) for await (const x of it) use(x); else other() }',
]) {
	test('for await restoration is in finally: ' + source, () => {
		const result = transform(source, 'in.mjs')
		parses(result.code)
		const { program } = parseSync('out.mjs', result.code, { sourceType: 'module' })
		const body = program.body.find((node) => node.type === 'FunctionDeclaration').body.body
		const wrapper = body.find((node) => node.type === 'BlockStatement' || node.type === 'IfStatement')
		const block = wrapper.type === 'IfStatement' ? wrapper.consequent : wrapper
		const guarded = block.body.find((node) => node.type === 'TryStatement')
		assert.equal(guarded.finalizer.body[0].expression.callee.name, '__ctxRestore')
		let loop = guarded.block.body[0]
		while (loop.type === 'LabeledStatement') loop = loop.body
		assert.equal(loop.type, 'ForOfStatement')
		assert.equal(loop.await, true)
	})
}

const contextSetup = `
import { ROOT_CONTEXT, createContextKey } from '@opentelemetry/api'
import { ZonelessContextManager } from 'otel-zoneless-context'
const manager = new ZonelessContextManager({ patch: false })
const key = createContextKey('iterator')
const active = () => manager.active().getValue(key) ?? null
`

test('a rejected iterator restores both interleaved contexts in catch and finally', async () => {
	const code = contextSetup + `
export async function run() {
	const flow = (name, delay) => manager.with(ROOT_CONTEXT.setValue(key, name), async () => {
		const seen = []
		let closed = false
		const iterator = {
			[Symbol.asyncIterator]() { return this },
			next() { return new Promise((_, reject) => setTimeout(() => reject(new Error('iterator failed')), delay)) },
			return() { closed = true; return Promise.resolve({ done: true }) },
		}
		try {
			for await (const value of iterator) { void value }
		} catch (error) {
			seen.push(error.message, active())
		} finally {
			seen.push(active(), closed)
		}
		seen.push(active())
		return seen
	})
	return Promise.all([flow('A', 10), flow('B', 5)])
}
`
	assert.deepEqual(await runRewritten(code), [
		['iterator failed', 'A', 'A', false, 'A'],
		['iterator failed', 'B', 'B', false, 'B'],
	])
})

for (const exit of ['break', 'return', 'throw', 'continue', 'close rejection']) {
	test('for await restores after iterator cleanup on ' + exit, async () => {
		const code = contextSetup + `
export async function run() {
	const seen = []
	let closed = false
	const iterator = {
		[Symbol.asyncIterator]() { return this },
		next() { return Promise.resolve({ value: 1, done: false }) },
		return() {
			return new Promise((resolve, reject) => setTimeout(() => {
				closed = true
				if (${JSON.stringify(exit)} === 'close rejection') reject(new Error('close'))
				else resolve({ done: true })
			}, 5))
		},
	}
	const leave = () => manager.with(ROOT_CONTEXT.setValue(key, 'A'), async () => {
		try {
			outer: for (let i = 0; i < 1; i++) {
				for await (const value of iterator) {
					seen.push(active())
					${exit === 'return' ? 'return value' : exit === 'throw' ? "throw new Error('body')" : exit === 'continue' ? 'continue outer' : 'break'}
				}
			}
		} catch (error) {
			seen.push(error.message, active())
		} finally {
			seen.push(closed, active())
		}
	})
	await leave()
	return seen
}
`
		const middle = exit === 'throw' ? ['body', 'A'] : exit === 'close rejection' ? ['close', 'A'] : []
		assert.deepEqual(await runRewritten(code), ['A', ...middle, true, 'A'])
	})
}

test('a user local named __ctxValue keeps its value', async () => {
	const code = 'export async function run() { const __ctxValue = 1; await Promise.resolve(); return __ctxValue }'
	parses(transform(code, 'in.mjs').code)
	assert.equal(await runRewritten(code), 1)
})

test('helper imports and locals avoid bindings and references throughout the file', async () => {
	const code = String.raw`
const __ctxTake = 2, __ctxSave = 3, __ctxCurrent = 4, __ctxRestore = 5
const __ctxLoop0 = 6, __ctxValue = 7, __ctxValue1 = 8, __ctxBack = 9
const __ctxSet\u0074le = 10
const f = async (__ctxValue2) => {
	const inner = async (__ctxBack1) => { await 1; return __ctxBack1 }
	for await (const __ctxLoop01 of [1]) { await 1 }
	return [__ctxValue2, await inner(11)]
}
export async function run() {
	await 1
	return [__ctxTake, __ctxSave, __ctxCurrent, __ctxRestore, __ctxLoop0, __ctxValue, __ctxValue1, __ctxBack, __ctxSet\u0074le, await f(12)]
}
`
	const result = transform(code, 'in.mjs')
	parses(result.code)
	assert.match(result.code, /settle as __ctxSettle1/)
	assert.deepEqual(await runRewritten(code), [2, 3, 4, 5, 6, 7, 8, 9, 10, [12, 11]])
})

test('top level locals and imports avoid existing import names', () => {
	const code = 'import { value as __ctxTake } from "user"; const __ctxValue = 1; await load(__ctxValue, __ctxTake)'
	const result = transform(code, 'in.mjs')
	parses(result.code)
	assert.match(result.code, /take as __ctxTake1/)
	assert.match(result.code, /let __ctxValue1, __ctxBack/)
})

test('generated locals leave free references alone', async () => {
	const code = 'export async function run() { await 1; return [typeof __ctxValue, typeof __ctxBack] }'
	assert.deepEqual(await runRewritten(code), ['undefined', 'undefined'])
})
