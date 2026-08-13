
# 💧 @smartplant/watering

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Predicts watering needs from soil moisture, trends and care history.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/watering
```

## Use

```js
import { createPlant } from 'smartplant'
import watering from '@smartplant/watering'

const plant = await createPlant( {
  name    : 'Ivy',
  species : 'Monstera deliciosa',
  sensor  : 'mock',                  // no hardware needed
  ai      : { provider : 'ollama' }, // or gemini / openai / claude / grok
} )

await plant.use( watering )
await plant.read()

const result = await plant.plugin( 'watering' ).predictWatering( { potSizeCm : 20, substrate : 'coco coir' } )
console.log( result.advice, result.emoji )
```

## API

### `predictWatering( input? )`

Returns `{ advice, emoji, severity, daysUntilWater, amountMl }`.

`input` is optional; anything you pass is handed to the AI as extra context alongside the plant's readings, trends and care history.

If the AI is unreachable or unconfigured, the call returns the deterministic offline result rather than throwing.

## Events

* Listens to `plant:thirsty`, emits `watering:needed`.

### Recording a watering

```js
await plant.plugin( 'watering' ).recordWatering( { amount : 200 } )
```

This updates the care log, so the next prediction knows how long it has been.

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
