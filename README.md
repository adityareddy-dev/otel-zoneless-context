# otel-zoneless-context

An OpenTelemetry context manager for the browser, no zone.js, that keeps concurrent flows apart across a native await in code the plugin rewrites, as of 2026-10-08. Zoneless managers already exist. Splunk's RUM SDK and Elastic's EDOT browser both ship one, and they carry the context by patching `Promise.prototype.then` and the callback APIs. A native `await` on a native promise doesn't go through the patched `then` though, so the context is gone once the function resumes. What this package adds is a bundler plugin that rewrites each `await` in your code to put the context back when the function resumes. The manager itself is a changed copy of the Apache-2.0 `SplunkContextManager` from [splunk-otel-js-web](https://github.com/signalfx/splunk-otel-js-web), see [Credit](#credit).

## Use

```sh
npm install otel-zoneless-context
```

```js
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { ZonelessContextManager } from 'otel-zoneless-context'

const provider = new WebTracerProvider({ spanProcessors: [/* yours */] })
provider.register({ contextManager: new ZonelessContextManager() })
```

Then the plugin, here for Vite:

```js
// vite.config.js
import { vite as zonelessContext } from 'otel-zoneless-context/plugin'

export default {
  plugins: [zonelessContext()],
}
```

`otel-zoneless-context/plugin` also exports `rollup`, `webpack` and `esbuild`, plus `rspack` and `rolldown` which I haven't tested. Options are `include` and `exclude` (a RegExp or a list of them, by default every JavaScript and TypeScript file outside `node_modules`) and `runtime` if the helpers need to come from somewhere else. The manager takes `{ patch: false }` to leave `then`, timers and events alone.

## What the plugin does

This:

```js
async function load(id) {
  const res = await fetch(`/items/${id}`)
  return res.json()
}
```

comes out as:

```js
import { settle as __ctxSettle, take as __ctxTake, save as __ctxSave, current as __ctxCurrent, restore as __ctxRestore } from "otel-zoneless-context/runtime";async function load(id) {let __ctxValue, __ctxBack;
  const res = (__ctxValue = __ctxSettle(fetch(`/items/${id}`)), __ctxBack = __ctxSave(), __ctxValue = await __ctxValue, __ctxBack(), __ctxTake(__ctxValue))
  return res.json()
}
```

It runs before TypeScript and JSX are compiled, takes every async function in the file including top level await and `for await` loops, and leaves files with no await alone.

## Results

Run on 2026-10-09 on Windows in headless Chromium 153.0.8010.12 with `@opentelemetry/api` 1.9.1, `@opentelemetry/sdk-trace-web` and `@opentelemetry/context-zone` 2.12.0, zone.js 0.16.3, built with esbuild 0.28.2 to `esnext` so every await stays native. Every case runs two flows, A and B, at the same time on timers that cross, and after each await checks that the active context is still its own. The leak rows check from code outside both flows that it sees no context at all. The #5914 row is the repro from [that issue](https://github.com/open-telemetry/opentelemetry-js/issues/5914) with the same function names, its console logs swapped for a check that the `repro` span is active.

| case | stack manager | zone manager | this one, plugin off | this one, plugin on |
| --- | --- | --- | --- | --- |
| #5914 | 4/6 | 4/6 | 4/6 | 6/6 |
| two flows | 2/8 | 2/8 | 2/8 | 8/8 |
| leak | 3/3 | 3/3 | 3/3 | 3/3 |
| try catch finally | 0/6 | 0/6 | 0/6 | 6/6 |
| for loop | 0/6 | 0/6 | 0/6 | 6/6 |
| for await | 0/8 | 0/8 | 0/8 | 8/8 |
| nested async arrow | 0/6 | 0/6 | 0/6 | 6/6 |
| Promise.all | 0/4 | 0/4 | 0/4 | 4/4 |
| class method | 0/4 | 0/4 | 0/4 | 4/4 |
| .then callback | 0/6 | 2/6 | 2/6 | 6/6 |
| library callback | 0/4 | 0/4 | 0/4 | 2/4 |
| reject and resolve in one task, reject first | 0/2 | 0/2 | 0/2 | 2/2 |
| reject and resolve in one task, resolve first | 0/2 | 0/2 | 0/2 | 2/2 |

In #5914 the three others lose the span at `test2` and `general.end`, the same two steps the issue reports. CI runs all of it on every push and prints these tables in the log, with a Node table next to it. Node has no `window`, so nothing gets patched there and the `.then` row stays at 2/6. Built through Rollup 4.64.3, Vite 8.3.4 and webpack 5.111.1 the plugin gets the same Node numbers as through esbuild. The tests assert the misses of the other managers too, so if one of them starts keeping the context the run goes red and this table gets fixed.

## What it misses

- A library the plugin doesn't rewrite, which awaits and then calls back into your code. The callback saw no context in the test (the library callback row).
- `setTimeout` with a delay over 34 ms doesn't carry the context. That's Splunk's cut-off and I kept it.
- Each await gets one more promise and a closure. I haven't measured what that does to a real app.
- Not tested yet: Angular CLI, whose builder takes no bundler plugin without a custom builder, rspack, rolldown, `yield` inside an async generator, async code downleveled to generators, and the plugin over `node_modules`.

## Credit

`src/manager.ts` is a changed copy of `SplunkContextManager` from [splunk-otel-js-web](https://github.com/signalfx/splunk-otel-js-web/blob/3e3f139f48a5936e594a2a50a52b142058e3d968/packages/web/src/splunk-context-manager.ts), Copyright 2020-2026 Splunk Inc., licensed under the Apache License 2.0. `src/utils.ts` holds three of its helpers. Both files keep Splunk's license header and say at the top that I changed them and how. The patching of `then`, timers, XHR, MessagePort and MutationObserver is their work. Their class in turn copies the StackContextManager from OpenTelemetry JS, and [NOTICE](NOTICE) credits both.

## License

Apache-2.0, see [LICENSE](LICENSE).
