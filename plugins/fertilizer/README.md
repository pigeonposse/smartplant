
# 🌱 @smartplant/fertilizer

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Recommends what to feed, how much and when, from conductivity and care history.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/fertilizer
```

## Use

```js
import { createPlant } from 'smartplant'
import fertilizer from '@smartplant/fertilizer'

const plant = await createPlant( {
  name    : 'Rosa',
  species : 'Monstera deliciosa',
  sensor  : 'mock',                  // no hardware needed
  ai      : { provider : 'ollama' }, // or gemini / openai / claude / grok
} )

await plant.use( fertilizer )
await plant.read()

const result = await plant.plugin( 'fertilizer' ).guideFertilization( { season : 'spring' } )
console.log( result.advice, result.emoji )
```

## API

### `guideFertilization( input? )`

Returns `{ advice, emoji, severity, npk, dilution, daysUntilFeed }`.

`input` is optional; anything you pass is handed to the AI as extra context alongside the plant's readings, trends and care history.

If the AI is unreachable or unconfigured, the call returns the deterministic offline result rather than throwing.

### Errs toward underfeeding

Nutrient burn is much harder to undo than a deficiency, so the guidance is deliberately conservative.

```js
await plant.plugin( 'fertilizer' ).recordFeeding( { product : 'seaweed extract' } )
```

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
