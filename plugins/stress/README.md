
# 😟 @smartplant/stress

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Detects compound and chronic stress patterns across metrics and time.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/stress
```

## Use

```js
import { createPlant } from 'smartplant'
import stress from '@smartplant/stress'

const plant = await createPlant( {
  name    : 'Rosa',
  species : 'Monstera deliciosa',
  sensor  : 'mock',                  // no hardware needed
  ai      : { provider : 'ollama' }, // or gemini / openai / claude / grok
} )

await plant.use( stress )
await plant.read()

const result = await plant.plugin( 'stress' ).detectStress( { symptoms : 'yellowing lower leaves' } )
console.log( result.advice, result.emoji )
```

## API

### `detectStress( input? )`

Returns `{ advice, emoji, severity, stressed, stressType, causes }`.

`input` is optional; anything you pass is handed to the AI as extra context alongside the plant's readings, trends and care history.

If the AI is unreachable or unconfigured, the call returns the deterministic offline result rather than throwing.

## Events

* Listens to `plant:stressed`, emits `stress:detected`.

### Different from Alerts

`alerts` fires on a single metric breaching its band. `stress` looks for the **combinations** that damage a plant even when no single reading looks alarming — high heat with low soil moisture, for instance.

### Chronic strain

```js
plant.plugin( 'stress' ).chronicScore()  // 0.42 = 42% of the last 48h spent below comfort
```

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
