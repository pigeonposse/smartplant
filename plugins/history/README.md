
# 📈 @smartplant/history

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Analyzes stored readings for trends, cycles and slow decline.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/history
```

## Use

```js
import { createPlant } from 'smartplant'
import history from '@smartplant/history'

const plant = await createPlant( {
  name    : 'Rosa',
  species : 'Monstera deliciosa',
  sensor  : 'mock',                  // no hardware needed
  ai      : { provider : 'ollama' }, // or gemini / openai / claude / grok
} )

await plant.use( history )
await plant.read()

const result = await plant.plugin( 'history' ).analyzeTrends( { hours : 72 } )
console.log( result.advice, result.emoji )
```

## API

### `analyzeTrends( input? )`

Returns `{ advice, emoji, direction, findings }`.

`input` is optional; anything you pass is handed to the AI as extra context alongside the plant's readings, trends and care history.

If the AI is unreachable or unconfigured, the call returns the deterministic offline result rather than throwing.

### Honest about insufficient data

With fewer than three readings in the window it reports `direction: 'unknown'` instead of inventing a trend.

### Raw numbers, no AI

```js
plant.plugin( 'history' ).stats( 72 )    // { soil: { min, max, avg, trend, n }, ... }
plant.plugin( 'history' ).series( 168 )  // the full stored series, for charting
```

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
