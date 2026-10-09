import { type Context, ROOT_CONTEXT } from '@opentelemetry/api'

import { slot } from './state.js'
import { getOriginalFunction } from './utils.js'

// The rewritten code calls these around every await, see src/transform.ts.

export type Settled = { ok: true; value: unknown } | { ok: false; error: unknown }

const fulfilled = (value: unknown): Settled => ({ ok: true, value })
const rejected = (error: unknown): Settled => ({ ok: false, error })

// Never rejects, so the restore after the await runs on the reject path too.
export function settle(value: unknown): Promise<Settled> {
	const promise = Promise.resolve(value)
	return getOriginalFunction(promise.then).call(promise, fulfilled, rejected) as Promise<Settled>
}

export function take(result: Settled): unknown {
	if (result.ok) {
		return result.value
	}
	throw result.error
}

export function current(): Context {
	return slot.current
}

export function save(): () => void {
	const saved = slot.current
	return () => restore(saved)
}

// Puts the context back, then drops to root once this stretch of code is done if nothing else set one.
export function restore(saved: Context): void {
	slot.current = saved
	if (saved !== ROOT_CONTEXT) {
		queueMicrotask(() => {
			if (slot.current === saved) {
				slot.current = ROOT_CONTEXT
			}
		})
	}
}
