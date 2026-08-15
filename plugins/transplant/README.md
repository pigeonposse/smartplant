# 🪴 @smartplant/transplant

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Watches whether the pot is running out, and guides the move to a bigger one.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/transplant
```

## Use

```js
import { createPlant } from 'smartplant'
import transplant from '@smartplant/transplant'

const plant = await createPlant( {
  name    : 'Ivy',
  species : 'Ficus lyrata',
  sensor  : 'mock',
  ai      : { provider : 'ollama' },
  pot     : { litres : 2, since : '2024-03-01' },
} )

await plant.use( transplant )

const plan = plant.plugin( 'transplant' ).plan()
console.log( plan.why, plan.checks )
```

## What it actually measures

Nothing here has seen a root. There is no root sensor, this cannot see rot, and
it does not replace tipping the plant out and looking at the rootball.

What it does is narrower and still worth having: a pot with more root in it
holds less water and empties faster, so the same plant in the same pot, watered
the same way, starts wanting water sooner than it did. That ratio — recent
against early *in this pot* — is the signal. It is the plant compared against
itself in one container, which is why no table of expected sizes is needed.

One signal moving is a hot week or a probe that shifted. Several moving together
over months is a pot filling up.

## API

### `space()`

`{ index, outlook, confidence, evidence, why }`. `index` is `high`, `medium`,
`low` or `unknown`.

### `plan()`

`{ ready, current, suggest, checks, why }`. The checks are about *looking*
rather than doing — the person is about to be holding the roots, which makes
them the better instrument for the next five minutes.

`suggest` is roughly 2.5× the current volume. Much more than that and the
substrate stays wet in the parts no root has reached, which drowns more plants
than a tight pot ever has.

### `settling()`

Where a move is, if one is in progress. During settling the estimate stands
aside: judging a new container on behaviour learned in the old one is the
mistake this exists to avoid.

## Events

Emits `transplant:outlook` when the level changes — once per change, not once
per reading.

## It never repots anything

`acts` is false and stays false. Repotting is a physical act with real risk to
the plant and an afternoon of somebody's time, and the evidence here is indirect
by construction. It says what it sees, with the evidence attached, and the
decision is somebody else's.

When the move happens, tell the system one thing:

```js
await plant.transplant( { volumeL : 6 } )
```

Volumes, baselines and caution are its job from there.

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
