
# 🐛 @smartplant/pests

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Estimates pest risk from environmental conditions and identifies pests from symptoms.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/pests
```

## Use

```js
import { createPlant } from 'smartplant'
import pests from '@smartplant/pests'

const plant = await createPlant( {
  name    : 'Rosa',
  species : 'Monstera deliciosa',
  sensor  : 'mock',                  // no hardware needed
  ai      : { provider : 'ollama' }, // or gemini / openai / claude / grok
} )

await plant.use( pests )
await plant.read()

const result = await plant.plugin( 'pests' ).monitorPests( {} )
console.log( result.advice, result.emoji )
```

## API

### `monitorPests( input? )`

Returns `{ advice, emoji, severity, risk, suspects, treatment }`.

`input` is optional; anything you pass is handed to the AI as extra context alongside the plant's readings, trends and care history.

If the AI is unreachable or unconfigured, the call returns the deterministic offline result rather than throwing.

### Identify from what you see

```js
const result = await plant.plugin( 'pests' ).identify( 'fine webbing under the leaves' )
// result.suspects → [ 'spider mites' ]
```

The report is written to the care log, so later analyses know it happened. Least-toxic treatment is preferred first.

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
