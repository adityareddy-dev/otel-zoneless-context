// What each manager got on 2026-10-09, misses included so any change fails the run.

const lost = {
	5914: [4, 6],
	flows: [2, 8],
	leak: [3, 3],
	'try catch finally': [0, 6],
	'for loop': [0, 6],
	'for await': [0, 8],
	'for await rejection': [0, 6],
	'for await break': [2, 8],
	'for await return': [2, 8],
	'for await throw': [2, 10],
	'for await continue': [2, 8],
	'nested async arrow': [0, 6],
	'Promise.all': [0, 4],
	'class method': [0, 4],
	startActiveSpan: [0, 4],
	'.then callback': [0, 6],
	'library callback': [0, 4],
	'reject and resolve in one task, reject first': [0, 2],
	'reject and resolve in one task, resolve first': [0, 2],
}

const kept = {
	5914: [6, 6],
	flows: [8, 8],
	leak: [3, 3],
	'try catch finally': [6, 6],
	'for loop': [6, 6],
	'for await': [8, 8],
	'for await rejection': [6, 6],
	'for await break': [8, 8],
	'for await return': [8, 8],
	'for await throw': [10, 10],
	'for await continue': [8, 8],
	'nested async arrow': [6, 6],
	'Promise.all': [4, 4],
	'class method': [4, 4],
	startActiveSpan: [4, 4],
	'.then callback': [6, 6],
	'library callback': [2, 4],
	'reject and resolve in one task, reject first': [2, 2],
	'reject and resolve in one task, resolve first': [2, 2],
}

export const expectedBrowser = {
	'stack raw': lost,
	// zone.js and the patched Promise.then both carry the context into a .then callback that is awaited
	'zone raw': { ...lost, '.then callback': [2, 6] },
	'ours raw': { ...lost, '.then callback': [2, 6] },
	'ours rewritten': kept,
}

// Node has no window, so the manager patches nothing there and only the rewrite is at work.
export const expectedNode = {
	'stack raw': lost,
	'stack rewritten': lost,
	'ours raw': lost,
	'ours rewritten': { ...kept, '.then callback': [2, 6] },
}

// The steps of the #5914 repro where the active span was gone, per run.
export const missing5914 = {
	'stack raw': ['test2', 'general.end'],
	'stack rewritten': ['test2', 'general.end'],
	'zone raw': ['test2', 'general.end'],
	'ours raw': ['test2', 'general.end'],
	'ours rewritten': [],
}
