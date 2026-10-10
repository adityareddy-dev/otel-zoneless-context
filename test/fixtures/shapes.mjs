// One small case per shape, each runs two flows at once with crossing timers.
import { context, ROOT_CONTEXT, trace } from '@opentelemetry/api'

import { check, KEY, record, rejectAfter, sleep } from './harness.mjs'
import { vendorFetch } from './vendor/lib.mjs'

const both = async (a, b) => {
	const pa = context.with(ROOT_CONTEXT.setValue(KEY, 'A'), a)
	const pb = context.with(ROOT_CONTEXT.setValue(KEY, 'B'), b)
	await Promise.allSettled([pa, pb])
}

const delays = { A: [20, 60, 30], B: [50, 10, 60] }

const tryShape = (n) => async () => {
	try {
		await sleep(delays[n][0])
		check('try catch finally', n, 'in try')
		await rejectAfter(delays[n][1])
	} catch {
		check('try catch finally', n, 'in catch')
	} finally {
		await sleep(delays[n][2])
		check('try catch finally', n, 'in finally')
	}
}

const forShape = (n) => async () => {
	for (let i = 0; i < 3; i++) {
		await sleep(delays[n][i])
		check('for loop', n, `iteration ${i}`)
	}
}

async function* ticks(list) {
	for (const ms of list) {
		await sleep(ms)
		yield ms
	}
}

const forAwaitShape = (n) => async () => {
	let i = 0
	for await (const _ of ticks(delays[n])) {
		check('for await', n, `body ${i++}`)
	}
	check('for await', n, 'after the loop')
}

const forAwaitRejectShape = (n) => async () => {
	const iterator = {
		[Symbol.asyncIterator]() { return this },
		next() { return rejectAfter(delays[n][0]) },
	}
	try {
		for await (const value of iterator) {
			void value
		}
	} catch {
		check('for await rejection', n, 'in catch')
	} finally {
		check('for await rejection', n, 'in finally')
	}
	check('for await rejection', n, 'after the loop')
}

const forAwaitExitShape = (n, exit) => async () => {
	const label = 'for await ' + exit
	let closed = false
	const iterator = {
		[Symbol.asyncIterator]() { return this },
		next() { return sleep(delays[n][0]).then(() => ({ value: 1, done: false })) },
		return() {
			return sleep(delays[n][1]).then(() => {
				closed = true
				return { done: true }
			})
		},
	}
	const leave = async () => {
		try {
			outer: for (let i = 0; i < 1; i++) {
				for await (const value of iterator) {
					check(label, n, 'in body')
					if (exit === 'return') return value
					if (exit === 'throw') throw new Error('exit')
					if (exit === 'continue') continue outer
					break
				}
			}
		} catch {
			check(label, n, 'in catch')
		} finally {
			check(label, n, 'after cleanup')
			record(label, n, 'iterator closed', true, closed)
		}
	}
	await leave()
	check(label, n, 'caller, after exit')
}

const nestedShape = (n) => async () => {
	const inner = async () => {
		await sleep(delays[n][0])
		check('nested async arrow', n, 'inside, after await 1')
		await sleep(delays[n][1])
		check('nested async arrow', n, 'inside, after await 2')
	}
	await inner()
	check('nested async arrow', n, 'caller, after awaiting it')
}

const allShape = (n) => async () => {
	await Promise.all([
		(async () => {
			await sleep(delays[n][0])
			check('Promise.all', n, 'inside an async callback')
		})(),
		sleep(delays[n][1]),
	])
	check('Promise.all', n, 'after awaiting all')
}

class Service {
	async work(n) {
		await sleep(delays[n][0])
		check('class method', n, 'inside the method')
	}
}

const classShape = (n) => async () => {
	await new Service().work(n)
	check('class method', n, 'caller, after awaiting it')
}

const spanShape = (n) => async () => {
	const name = `span ${n}`
	await trace.getTracer('shapes').startActiveSpan(name, async (span) => {
		await sleep(delays[n][0])
		check('startActiveSpan', n, 'flow value after await')
		record('startActiveSpan', n, 'active span after await', name, trace.getActiveSpan() === span ? name : null)
		span.end()
	})
}

const thenShape = (n) => async () => {
	await sleep(delays[n][0]).then(() => check('.then callback', n, 'awaited'))
	sleep(delays[n][1]).then(() => check('.then callback', n, 'not awaited'))
	await sleep(delays[n][2] + 40)
	check('.then callback', n, 'caller, after await')
}

const vendorShape = (n) => async () => {
	await vendorFetch(delays[n][0], () => check('library callback', n, 'inside the callback'))
	check('library callback', n, 'caller, after awaiting the library')
}

// Two awaits that settle in the same task, one rejects and one resolves.
const race = async (label, rejectFirst) => {
	let rejectA
	let resolveB
	const pa = new Promise((_, reject) => {
		rejectA = reject
	})
	const pb = new Promise((resolve) => {
		resolveB = resolve
	})
	const a = async () => {
		try {
			await pa
		} catch {
			check(label, 'A', 'in catch')
		}
	}
	const b = async () => {
		await pb
		check(label, 'B', 'after await')
	}
	setTimeout(() => {
		if (rejectFirst) {
			rejectA(new Error('x'))
			resolveB()
		} else {
			resolveB()
			rejectA(new Error('x'))
		}
	}, 10)
	await both(a, b)
}

export const shapes = async () => {
	await both(tryShape('A'), tryShape('B'))
	await both(forShape('A'), forShape('B'))
	await both(forAwaitShape('A'), forAwaitShape('B'))
	await both(forAwaitRejectShape('A'), forAwaitRejectShape('B'))
	for (const exit of ['break', 'return', 'throw', 'continue']) {
		await both(forAwaitExitShape('A', exit), forAwaitExitShape('B', exit))
	}
	await both(nestedShape('A'), nestedShape('B'))
	await both(allShape('A'), allShape('B'))
	await both(classShape('A'), classShape('B'))
	await both(spanShape('A'), spanShape('B'))
	await both(thenShape('A'), thenShape('B'))
	await both(vendorShape('A'), vendorShape('B'))
	await race('reject and resolve in one task, reject first', true)
	await race('reject and resolve in one task, resolve first', false)
}
