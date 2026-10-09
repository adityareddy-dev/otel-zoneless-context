// Runs one Node bundle in its own process and prints the result as JSON.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { done } = await import(pathToFileURL(resolve(process.argv[2])).href)
process.stdout.write(JSON.stringify(await done))
