
# ☀️ @smartplant/lighting

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Advises on placement, exposure hours and grow-light use.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/lighting
```

## Use

```js
import { createPlant } from 'smartplant'
import lighting from '@smartplant/lighting'

const plant = await createPlant( {
  name    : 'Ivy',
  species : 'Monstera deliciosa',
  sensor  : 'mock',                  // no hardware needed
  ai      : { provider : 'ollama' }, // or gemini / openai / claude / grok
} )

await plant.use( lighting )
await plant.read()

const result = await plant.plugin( 'lighting' ).optimizeLight( { windowDirection : 'north' } )
console.log( result.advice, result.emoji )
```

## API

### `optimizeLight( input? )`

Returns `{ advice, emoji, severity, hoursNeeded, needsGrowLight }`.

`input` is optional; anything you pass is handed to the AI as extra context alongside the plant's readings, trends and care history.

If the AI is unreachable or unconfigured, the call returns the deterministic offline result rather than throwing.

## Events

* Listens to `plant:too-dark`, emits `lighting:insufficient`.

### Daily light hours, computed locally

```js
plant.plugin( 'lighting' ).dailyLightHours( 200 )  // hours above 200 lux in the last 24h
```

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
