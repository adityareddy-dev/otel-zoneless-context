// Stands in for a third-party library, never rewritten.
export async function vendorFetch(ms, onDone) {
	await new Promise((resolve) => setTimeout(resolve, ms))
	onDone()
	await new Promise((resolve) => setTimeout(resolve, ms))
	return 'ok'
}
