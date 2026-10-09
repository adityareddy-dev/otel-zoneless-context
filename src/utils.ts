/**
 *
 * Copyright 2020-2026 Splunk Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

// Changed by Aditya Reddy on 2026-10-09: isFunction, wrapNatively and getOriginalFunction taken from splunk-otel-js-web packages/web/src/utils.ts at 3e3f139, wrap and unwrap written here in place of shimmer.

type Wrapped = { __original?: unknown; __wrapped?: boolean }

export function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
	return typeof value === 'function'
}

export function wrap<Nodule extends object, FieldName extends keyof Nodule>(
	nodule: Nodule,
	name: FieldName,
	wrapper: (original: Nodule[FieldName]) => Nodule[FieldName],
): void {
	const original = nodule[name]
	if (!isFunction(original)) {
		return
	}

	const wrapped = wrapper(original) as Nodule[FieldName] & Wrapped
	Object.defineProperty(wrapped, '__original', { configurable: true, enumerable: false, value: original })
	Object.defineProperty(wrapped, '__wrapped', { configurable: true, enumerable: false, value: true })
	nodule[name] = wrapped
}

export function unwrap<Nodule extends object, FieldName extends keyof Nodule>(nodule: Nodule, name: FieldName): void {
	const current = nodule[name] as Nodule[FieldName] & Wrapped
	if (current && current.__wrapped && current.__original) {
		nodule[name] = current.__original as Nodule[FieldName]
	}
}

/**
 * Wrap function while keeping the toString calling the original as some frameworks
 * use it to determine if the function's native or polyfilled
 *
 * Example:
 * https://github.com/vuejs/vue/blob/0603ff695d2f41286239298210113cbe2b209e28/src/core/util/env.js#L58
 * https://github.com/vuejs/vue/blob/0603ff695d2f41286239298210113cbe2b209e28/src/core/util/next-tick.js#L42
 *
 * @param nodule Target object
 * @param name Property to patch
 * @param wrapper Wrapper
 */
export function wrapNatively<Nodule extends object, FieldName extends keyof Nodule>(
	nodule: Nodule,
	name: FieldName,
	wrapper: (original: Nodule[FieldName]) => Nodule[FieldName],
): void {
	const orig = nodule[name] as Nodule[FieldName] & { toString?: () => string }
	wrap(nodule, name, wrapper)
	const wrapped = nodule[name] as Nodule[FieldName] & { toString?: () => string }
	if (orig && orig.toString && wrapped !== orig) {
		wrapped.toString = orig.toString.bind(orig)
	}
}

/**
 * Get the original version of function (without all of the shimmer wrappings)
 */
export function getOriginalFunction<T extends CallableFunction>(func: T): T {
	// @ts-expect-error __original isn't mentioned in types
	while (func.__original && func.__original !== func) {
		// @ts-expect-error same
		func = func.__original as T
	}

	return func
}
