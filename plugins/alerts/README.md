
# ⚠️ @smartplant/alerts

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Turns raw threshold breaches into species-aware, prioritized alerts.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/alerts
```

## Use

```js
import { createPlant } from 'smartplant'
import alerts from '@smartplant/alerts'

const plant = await createPlant( {
  name    : 'Rosa',
  species : 'Monstera deliciosa',
  sensor  : 'mock',                  // no hardware needed
  ai      : { provider : 'ollama' }, // or gemini / openai / claude / grok
} )

await plant.use( alerts )
await plant.read()

const result = await plant.plugin( 'alerts' ).checkAlerts( {} )
console.log( result.advice, result.emoji )
```

## API

### `checkAlerts( input? )`

Returns `{ advice, emoji, severity, triggered, actions }`.

`input` is optional; anything you pass is handed to the AI as extra context alongside the plant's readings, trends and care history.

If the AI is unreachable or unconfigured, the call returns the deterministic offline result rather than throwing.

## Events

* Listens to `alert` (critical only), to avoid spending a request on mild drift.

### It stays quiet — and free — when nothing is wrong

If no metric is outside its comfort band, `checkAlerts()` returns `triggered: false` **without calling the AI at all**. The kernel already knows nothing is wrong; there is nothing to ask.

```js
plant.plugin( 'alerts' ).recent( 10 )   // alerts raised this session
```

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
