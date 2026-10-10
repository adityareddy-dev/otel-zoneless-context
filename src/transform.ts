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
	// Files without await are left alone without parsing.
	if (!code.includes('await')) {
		return null
	}

	const { program, errors } = parseSync(id, code, { sourceType: 'module', preserveParens: true })
	if (errors.length) {
		throw new SyntaxError(`${id}: ${errors.map((e) => e.message).join('\n')}`)
	}

	const runtimeSource = options.runtime ?? 'otel-zoneless-context/runtime'
	const unwrap = (node: Node): Node => node.type === 'ParenthesizedExpression' ? unwrap(node.expression) : node
	const call = (node: Node | undefined, name: string): boolean =>
		node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === name
	for (const statement of (program as unknown as Node).body as Node[]) {
		if (statement.type !== 'ImportDeclaration' || statement.source.value !== runtimeSource) continue
		const helpers = new Map<string, string>()
		for (const specifier of statement.specifiers as Node[]) {
			if (specifier.type === 'ImportSpecifier') helpers.set(specifier.imported.name, specifier.local.name)
		}
		const settle = helpers.get('settle')
		const take = helpers.get('take')
		const save = helpers.get('save')
		const current = helpers.get('current')
		const restore = helpers.get('restore')
		if (!settle || !take || !save || !current || !restore) continue
		let injected = false
		walk(program as unknown as Node, (node) => {
			if (call(node, take) && node.arguments.length === 1) {
				const sequence = unwrap(node.arguments[0])
				if (sequence.type !== 'SequenceExpression' || sequence.expressions.length !== 5) return
				const [value, back, awaited, resume, result] = sequence.expressions as Node[]
				if (value.type !== 'AssignmentExpression' || back.type !== 'AssignmentExpression' || awaited.type !== 'AssignmentExpression') return
				injected ||= call(value.right, settle) && call(back.right, save) &&
					awaited.right.type === 'AwaitExpression' && awaited.right.argument.name === value.left.name &&
					awaited.left.name === value.left.name && call(resume, back.left.name) && result.name === value.left.name
			}
			if (node.type === 'BlockStatement' && node.body.length === 2) {
				const [declaration, guarded] = node.body as Node[]
				if (declaration.type !== 'VariableDeclaration' || declaration.declarations.length !== 1 || guarded.type !== 'TryStatement') return
				const saved = declaration.declarations[0] as Node
				const resumed = guarded.finalizer?.body[0]?.expression as Node | undefined
				let loop = guarded.block.body[0] as Node | undefined
				while (loop?.type === 'LabeledStatement') loop = loop.body
				injected ||= call(saved.init, current) && call(resumed, restore) &&
					resumed?.arguments[0]?.name === saved.id.name && loop?.type === 'ForOfStatement' && loop.await
			}
		})
		if (injected) return null
	}

	const names = new Set<string>()
	walk(program as unknown as Node, (node) => {
		if (node.type === 'Identifier' || node.type === 'JSXIdentifier') names.add(node.name)
	})
	const allocate = (base: string): string => {
		let name = base
		let suffix = 1
		while (names.has(name)) name = base + suffix++
		names.add(name)
		return name
	}
	const settle = allocate('__ctxSettle')
	const take = allocate('__ctxTake')
	const save = allocate('__ctxSave')
	const current = allocate('__ctxCurrent')
	const restore = allocate('__ctxRestore')

	const s = new MagicString(code)
	let awaits = 0
	let loops = 0

	const rewrite = (body: Node, value: string, back: string): boolean => {
		let found = false
		const parents = new Map<Node, Node | null>()
		walk(body, (node, parent) => {
			if (node !== body && functionTypes.has(node.type)) {
				return false
			}
			parents.set(node, parent)

			if (node.type === 'ForOfStatement' && node.await) {
				found = true
				const name = allocate(`__ctxLoop${loops++}`)
				let outer = node
				while (parents.get(outer)?.type === 'LabeledStatement') {
					outer = parents.get(outer) as Node
				}
				s.appendLeft(outer.start, `{const ${name} = ${current}();try{`)
				s.prependLeft(outer.end, `}finally{${restore}(${name});}}`)
				if (node.body.type === 'BlockStatement') {
					s.appendLeft(node.body.start + 1, `${restore}(${name});`)
				} else {
					s.appendLeft(node.body.start, `{${restore}(${name});`)
					s.prependLeft(node.body.end, '}')
				}
			}

			if (node.type !== 'AwaitExpression') {
				return
			}

			found = true
			awaits++
			// Starts with a name, not a bracket, so it never joins the line before it.
			s.overwrite(node.start, node.argument.start, `${take}((${value} = ${settle}(`)
			s.prependLeft(
				node.argument.end,
				`), ${back} = ${save}(), ${value} = await ${value}, ${back}(), ${value}))`,
			)
		})
		return found
	}

	walk(program as unknown as Node, (node) => {
		if (!functionTypes.has(node.type) || !node.async || !node.body) {
			return
		}
		const body = node.body as Node
		const value = allocate('__ctxValue')
		const back = allocate('__ctxBack')
		if (!rewrite(body, value, back)) {
			return
		}
		if (body.type === 'BlockStatement') {
			const directives = (body.body as Node[]).filter((statement) => statement.directive)
			const at = directives.length ? directives[directives.length - 1].end : body.start + 1
			s.prependLeft(at, `${directives.length ? ';' : ''}let ${value}, ${back};`)
		} else {
			s.appendLeft(body.start, `{let ${value}, ${back}; return (`)
			s.appendLeft(body.end, ');}')
		}
	})

	const value = allocate('__ctxValue')
	const back = allocate('__ctxBack')
	const topLevel = rewrite(program as unknown as Node, value, back)
	if (!awaits && !loops) {
		return null
	}

	const runtime = JSON.stringify(runtimeSource)
	const head =
		`import { settle as ${settle}, take as ${take}, save as ${save}, current as ${current}, restore as ${restore} } from ${runtime};` +
		(topLevel ? `let ${value}, ${back};` : '')
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
