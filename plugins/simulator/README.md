
# 🔮 @smartplant/simulator

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Projects how the plant would fare under hypothetical conditions.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/simulator
```

## Use

```js
import { createPlant } from 'smartplant'
import simulator from '@smartplant/simulator'

const plant = await createPlant( {
  name    : 'Ivy',
  species : 'Monstera deliciosa',
  sensor  : 'mock',                  // no hardware needed
  ai      : { provider : 'ollama' }, // or gemini / openai / claude / grok
} )

await plant.use( simulator )
await plant.read()

const result = await plant.plugin( 'simulator' ).simulateConditions( { conditions : { temperature : 35 }, days : 7 } )
console.log( result.advice, result.emoji )
```

## API

### `simulateConditions( input? )`

Returns `{ advice, emoji, severity, outcome, survivalDays }`.

`input` is optional; anything you pass is handed to the AI as extra context alongside the plant's readings, trends and care history.

If the AI is unreachable or unconfigured, the call returns the deterministic offline result rather than throwing.

### Instant scoring, no AI

Runs the hypothetical through the same comfort model the kernel uses — arithmetic first, AI second.

```js
const sim = plant.plugin( 'simulator' )

sim.score( { soil : 5 } )
// { wellbeing: 38, delta: -55 }

sim.sweep( 'temperature', [ 5, 15, 22, 30, 40 ] )
// [ { value: 5, wellbeing: 0 }, { value: 22, wellbeing: 100 }, ... ]
```

Use `sweep` to find exactly where a plant's tolerance breaks down.

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
