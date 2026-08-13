
# 💨 @smartplant/ventilation

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Recommends airflow and humidity adjustments from temperature and humidity.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/ventilation
```

## Use

```js
import { createPlant } from 'smartplant'
import ventilation from '@smartplant/ventilation'

const plant = await createPlant( {
  name    : 'Ivy',
  species : 'Monstera deliciosa',
  sensor  : 'mock',                  // no hardware needed
  ai      : { provider : 'ollama' }, // or gemini / openai / claude / grok
} )

await plant.use( ventilation )
await plant.read()

const result = await plant.plugin( 'ventilation' ).adjustVentilation( { room : 'bathroom' } )
console.log( result.advice, result.emoji )
```

## API

### `adjustVentilation( input? )`

Returns `{ advice, emoji, severity, action, targetHumidity }`.

`input` is optional; anything you pass is handed to the AI as extra context alongside the plant's readings, trends and care history.

If the AI is unreachable or unconfigured, the call returns the deterministic offline result rather than throwing.

## Events

* Listens to `plant:too-hot`, emits `ventilation:needed`.

### VPD, computed locally

Vapour pressure deficit is the number that actually drives transpiration. Calculated with the Tetens equation — no AI, no network.

```js
plant.plugin( 'ventilation' ).vpd()   // 1.58  (kPa)
```

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
