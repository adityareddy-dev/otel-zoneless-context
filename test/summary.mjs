// Counts passing checks per case, and lists what each failing check saw.
export function summarize(result) {
	const byCase = {}
	for (const row of result.rows) {
		const c = (byCase[row.kase] ??= { pass: 0, total: 0, misses: [] })
		c.total++
		if (row.ok) c.pass++
		else c.misses.push(`${row.flow === '-' ? '' : row.flow + ' '}${row.step}: saw ${row.got}`)
	}
	return byCase
}

export function table(title, runs) {
	const cases = [...new Set(Object.values(runs).flatMap((r) => Object.keys(r)))]
	const names = Object.keys(runs)
	const lines = [`${title}`, `| case | ${names.join(' | ')} |`, `| --- |${names.map(() => ' --- |').join('')}`]
	for (const kase of cases) {
		lines.push(
			`| ${kase} | ${names.map((n) => (runs[n][kase] ? `${runs[n][kase].pass}/${runs[n][kase].total}` : '-')).join(' | ')} |`,
		)
	}
	return lines.join('\n')
}
