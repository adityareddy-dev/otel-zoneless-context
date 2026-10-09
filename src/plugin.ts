import { createUnplugin } from 'unplugin'

import { transform } from './transform.js'

export interface PluginOptions {
	/** Files to rewrite. Defaults to JavaScript and TypeScript files outside node_modules. */
	include?: RegExp | RegExp[]
	/** Files to leave alone. Defaults to node_modules. */
	exclude?: RegExp | RegExp[]
	/** Where the rewritten code imports its helpers from. */
	runtime?: string
}

const defaultInclude = /\.(?:m?[jt]s|[jt]sx)$/
const defaultExclude = /[\\/]node_modules[\\/]/
const ownFiles = /[\\/]otel-zoneless-context[\\/](dist|src)[\\/]/

const list = (value: RegExp | RegExp[] | undefined, fallback: RegExp[]): RegExp[] =>
	value === undefined ? fallback : Array.isArray(value) ? value : [value]

export const unplugin = createUnplugin((options: PluginOptions | undefined) => {
	const include = list(options?.include, [defaultInclude])
	const exclude = list(options?.exclude, [defaultExclude])

	return {
		name: 'otel-zoneless-context',
		enforce: 'pre',
		transformInclude(id) {
			const file = id.split('?')[0]
			if (ownFiles.test(file)) return false
			if (exclude.some((pattern) => pattern.test(file))) return false
			return include.some((pattern) => pattern.test(file))
		},
		transform(code, id) {
			const result = transform(code, id.split('?')[0], { runtime: options?.runtime })
			return result ? { code: result.code, map: result.map } : null
		},
	}
})

export const vite = unplugin.vite
export const rollup = unplugin.rollup
export const rolldown = unplugin.rolldown
export const webpack = unplugin.webpack
export const rspack = unplugin.rspack
export const esbuild = unplugin.esbuild
export default unplugin
