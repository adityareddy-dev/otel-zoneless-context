import MagicString from 'magic-string'
import { parseSync } from 'oxc-parser'

export interface TransformOptions {
	/** Where the rewritten code imports its helpers from. */
	runtime?: string
	/** Source map for the output. On by default. */
	sourceMap?: boolean
}

export interface TransformResult {
	code: string
	map: ReturnType<MagicString['generateMap']> | null
	awaits: number
}

type Node = { type: string; start: number; end: number; [key: string]: any }

const functionTypes = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'])

function walk(node: Node, enter: (node: Node, parent: Node | null) => boolean | void, parent: Node | null = null): void {
	if (enter(node, parent) === false) {
		return
	}
	for (const key in node) {
		if (key === 'parent') continue
		const value = node[key]
		if (Array.isArray(value)) {
			for (const child of value) {
				if (child && typeof child.type === 'string') walk(child, enter, node)
			}
		} else if (value && typeof value.type === 'string') {
			walk(value, enter, node)
		}
	}
}

export function transform(code: string, id: string, options: TransformOptions = {}): TransformResult | null {
	// Files without the word are left alone without parsing, and a file is never rewritten twice.
	if (!code.includes('await') || code.includes('__ctxSettle')) {
		return null
	}

	const { program, errors } = parseSync(id, code, { sourceType: 'module', preserveParens: true })
	if (errors.length) {
		throw new SyntaxError(`${id}: ${errors.map((e) => e.message).join('\n')}`)
	}

	const s = new MagicString(code)
	let awaits = 0
	let loops = 0

	const rewrite = (body: Node): boolean => {
		let found = false
		const parents = new Map<Node, Node | null>()
		walk(body, (node, parent) => {
			if (node !== body && functionTypes.has(node.type)) {
				return false
			}
			parents.set(node, parent)

			if (node.type === 'ForOfStatement' && node.await) {
				found = true
				const name = `__ctxLoop${loops++}`
				let outer = node
				while (parents.get(outer)?.type === 'LabeledStatement') {
					outer = parents.get(outer) as Node
				}
				s.appendLeft(outer.start, `{const ${name} = __ctxCurrent();try{`)
				s.prependLeft(outer.end, `}finally{__ctxRestore(${name});}}`)
				if (node.body.type === 'BlockStatement') {
					s.appendLeft(node.body.start + 1, `__ctxRestore(${name});`)
				} else {
					s.appendLeft(node.body.start, `{__ctxRestore(${name});`)
					s.prependLeft(node.body.end, '}')
				}
			}

			if (node.type !== 'AwaitExpression') {
				return
			}

			found = true
			awaits++
			// Starts with a name, not a bracket, so it never joins the line before it.
			s.overwrite(node.start, node.argument.start, '__ctxTake((__ctxValue = __ctxSettle(')
			s.prependLeft(
				node.argument.end,
				'), __ctxBack = __ctxSave(), __ctxValue = await __ctxValue, __ctxBack(), __ctxValue))',
			)
		})
		return found
	}

	walk(program as unknown as Node, (node) => {
		if (!functionTypes.has(node.type) || !node.async || !node.body) {
			return
		}
		const body = node.body as Node
		if (!rewrite(body)) {
			return
		}
		if (body.type === 'BlockStatement') {
			const directives = (body.body as Node[]).filter((statement) => statement.directive)
			const at = directives.length ? directives[directives.length - 1].end : body.start + 1
			s.prependLeft(at, `${directives.length ? ';' : ''}let __ctxValue, __ctxBack;`)
		} else {
			s.appendLeft(body.start, '{let __ctxValue, __ctxBack; return (')
			s.appendLeft(body.end, ');}')
		}
	})

	const topLevel = rewrite(program as unknown as Node)
	if (!awaits && !loops) {
		return null
	}

	const runtime = JSON.stringify(options.runtime ?? 'otel-zoneless-context/runtime')
	const head =
		`import { settle as __ctxSettle, take as __ctxTake, save as __ctxSave, current as __ctxCurrent, restore as __ctxRestore } from ${runtime};` +
		(topLevel ? 'let __ctxValue, __ctxBack;' : '')
	const hashbang = (program as unknown as Node).hashbang as Node | null | undefined
	if (hashbang) {
		s.appendLeft(hashbang.end, `\n${head}`)
	} else {
		s.prepend(head)
	}

	return {
		code: s.toString(),
		map: options.sourceMap === false ? null : s.generateMap({ source: id, includeContent: true, hires: 'boundary' }),
		awaits,
	}
}
