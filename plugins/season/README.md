# 🍂 @smartplant/season

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Bends the comfortable bands toward the time of year, and fades out as the plant learns its own.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/season
```

## Use

```js
import { createPlant } from 'smartplant'
import season from '@smartplant/season'

const plant = await createPlant( {
  name       : 'Ivy',
  species    : 'Ficus lyrata',
  sensor     : 'mock',
  ai         : { provider : 'ollama' },
  hemisphere : 'north',   // 'north' | 'south' | 'tropical'
} )

await plant.use( season )
console.log( ( await plant.plugin( 'season' ).ranges() ).why )
```

## The hemisphere is not guessed

Half the guesses would be exactly six months wrong, and that produces advice to
cut watering back in somebody's spring — which looks like a plant doing badly
rather than like a mistake. It is not inferred from a clock or a timezone. No
hemisphere, no seasonal adjustment.

`tropical` is an honest answer rather than a third season table: near the equator
there is a wet season and a dry one, and which months those are depends on the
specific place. The plant's own record is the only useful guide there, and it is
a better one than any table.

## The table fades

It exists so a plant with two months of history is not silent, and it is blended
by weight rather than applied whole — a plant halfway through its second year
gets half the table and half itself. After two years it is gone: this plant's
own record describes its own flat, its own window and its own radiator better
than any archetype average.

## API

### `now()`

`{ season, known, why }`.

### `ranges()`

`{ ranges, applied, season, weight, why }` — the archetype's comfortable bands,
bent toward the season and scaled by how much history the plant has.

### `lastYear( metric = 'soil' )`

What this plant itself did at this point in the year, once it has been through
one. Not an average of the whole history — an average of *this month last year*,
which is the only part of the record that describes this part of the year.

### `weight()`

`{ weight, why }` — how much the table still counts for.

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
