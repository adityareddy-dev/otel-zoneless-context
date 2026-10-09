# otel-zoneless-context

An OpenTelemetry context manager for the browser, no zone.js, that keeps concurrent flows apart across a native await in code the plugin rewrites, as of 2026-10-08. Zoneless managers already exist. Splunk's RUM SDK and Elastic's EDOT browser both ship one, and they carry the context by patching `Promise.prototype.then` and the callback APIs. A native `await` on a native promise doesn't go through the patched `then` though, so the context is gone after the first await. What this package adds is a bundler plugin that rewrites each `await` in your code to put the context back when the function resumes. The manager itself is a changed copy of the Apache-2.0 `SplunkContextManager` from [splunk-otel-js-web](https://github.com/signalfx/splunk-otel-js-web), see [Credit](#credit).

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

`otel-zoneless-context/plugin` also exports `rollup`, `webpack`, `esbuild`, `rspack` and `rolldown`, and I haven't tested the last two. Options are `include` and `exclude`, a RegExp or a list of them. By default every `.js`, `.mjs`, `.ts`, `.mts`, `.jsx` and `.tsx` file outside `node_modules` gets rewritten. `runtime` sets where the helpers get imported from. The manager takes `{ patch: false }` to leave the browser APIs alone.

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
  const res = __ctxTake((__ctxValue = __ctxSettle(fetch(`/items/${id}`)), __ctxBack = __ctxSave(), __ctxValue = await __ctxValue, __ctxBack(), __ctxValue))
  return res.json()
}
```

It runs before TypeScript and JSX are compiled and takes every async function, top level await and `for await` included. Files with no await are left alone.

## Results

Run on 2026-10-09 on Windows in headless Chromium 156.0.8078.4 with `@opentelemetry/api` 1.9.1, `@opentelemetry/sdk-trace-web` and `@opentelemetry/context-zone` 2.12.0, zone.js 0.16.3, built with esbuild 0.28.2 to `esnext` so every await stays native. Every case except #5914 runs two flows, A and B, at the same time on timers that cross, and after each await checks that the active context is still its own. The leak row checks from code outside both flows that it sees no context at all. The #5914 row is the repro from [that issue](https://github.com/open-telemetry/opentelemetry-js/issues/5914) with the same function names, its console logs swapped for a check that the `repro` span is active.

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
| startActiveSpan | 0/4 | 0/4 | 0/4 | 4/4 |
| .then callback | 0/6 | 2/6 | 2/6 | 6/6 |
| library callback | 0/4 | 0/4 | 0/4 | 2/4 |
| reject and resolve in one task, reject first | 0/2 | 0/2 | 0/2 | 2/2 |
| reject and resolve in one task, resolve first | 0/2 | 0/2 | 0/2 | 2/2 |

In #5914 the three others lose the span at `test2` and `general.end`, the same two steps the issue reports. CI runs all of it on pushes to main and on pull requests and prints these tables in the log, the Node ones in their own job. Node has no `window`, so nothing gets patched there and the `.then` row stays at 2/6. Built through Rollup 4.64.3 and Vite 8.3.4 the plugin gets the same Node numbers as through esbuild, and through webpack 5.111.1 too. The tests assert the misses of the other managers too, so if one of them starts keeping the context the run goes red and this table gets fixed.

## What it misses

- A library the plugin doesn't rewrite, which awaits and then calls back into your code. The callback saw no context in the test (the library callback row).
- `setTimeout` with a delay over 34 ms doesn't carry the context. That's Splunk's cut-off and I kept it.
- Each await gets one more promise and a closure. I haven't measured what that does to a real app.
- Angular CLI's default builder. I tried Angular 22.2.2 with @angular-builders/custom-esbuild 22.0.1 on 2026-10-09 and nothing got rewritten. That builder adds plugins after Angular's own compiler plugin, and that one loads every `.ts` and `.js` file itself, so this plugin never sees the code. The older webpack builder (`@angular-devkit/build-angular:browser`) turns async functions into generators, which go through the patched `then`. In the same scratch app built that way the manager kept the context with nothing rewritten, 13 of 13 checks on the #5914 steps and two flows.
- Not tested yet: rspack, rolldown, `yield` inside an async generator, async code downleveled to generators, and the plugin over `node_modules`.

## Credit

`src/manager.ts` is a changed copy of `SplunkContextManager` from [splunk-otel-js-web](https://github.com/signalfx/splunk-otel-js-web/blob/3e3f139f48a5936e594a2a50a52b142058e3d968/packages/web/src/splunk-context-manager.ts), Copyright 2020-2026 Splunk Inc., licensed under the Apache License 2.0. `src/utils.ts` holds three of its helpers. Both files keep Splunk's license header and say at the top that I changed them and how. The patching of `then`, timers, XHR, MessagePort and MutationObserver is their work. Their class in turn copies the StackContextManager from OpenTelemetry JS, and [NOTICE](NOTICE) credits both.

## License

Apache-2.0, see [LICENSE](LICENSE).
