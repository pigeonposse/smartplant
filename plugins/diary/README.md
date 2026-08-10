
# 📔 @smartplant/diary

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

The plant writes its own dated journal, grounded in real readings and care events.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/diary
```

## Use

```js
import { createPlant } from 'smartplant'
import diary from '@smartplant/diary'

const plant = await createPlant( {
  name    : 'Rosa',
  species : 'Monstera deliciosa',
  sensor  : 'mock',                  // no hardware needed
  ai      : { provider : 'ollama' }, // or gemini / openai / claude / grok
} )

await plant.use( diary )
await plant.read()

const result = await plant.plugin( 'diary' ).logAndSummarize( { hours : 24 } )
console.log( result.advice, result.emoji )
```

## API

### `logAndSummarize( input? )`

Returns `{ entry, mood, emoji }`.

`input` is optional; anything you pass is handed to the AI as extra context alongside the plant's readings, trends and care history.

If the AI is unreachable or unconfigured, the call returns the deterministic offline result rather than throwing.

### Entries are stored in the plant's memory

```js
plant.plugin( 'diary' ).entries( 10 )   // the last ten entries, newest first
```

Written in the `plant` persona, in first person, from what actually happened — not from a generic template.

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
