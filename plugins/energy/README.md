# 🔋 @smartplant/energy

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Solar and battery budgeting: what runs, what sleeps, and how long the charge lasts.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/energy
```

## Use

```js
import { createPlant } from 'smartplant'
import energy from '@smartplant/energy'

const plant = await createPlant( {
  name    : 'Ivy',
  species : 'Ficus lyrata',
  sensor  : 'mock',
  ai      : { provider : 'ollama' },
  power   : {
    capacityWh : 100,
    solar      : { wattsPeak : 20 },
  },
} )

await plant.use( energy )
plant.plugin( 'energy' ).charge( 0.42 )

console.log( plant.plugin( 'energy' ).forecast().why )
```

On mains, none of this exists — leave `power` out and everything measures as
often as it likes.

## The decisions that are not about power

**The lamp goes off at night whatever the charge.** Irradiating through the dark
period destroys the circadian signal the rest of the library reads, and spare
charge does not make that a good trade.

**A CAM plant keeps its electrode on at low charge.** Its stomata open at night
and everything worth measuring happens then — the one plant it would be most
tempting to light up is the one where lighting it does the most harm.

**Travel is costed there and back.** A plant that spends its last charge
arriving somewhere is stranded there.

**Moving pauses measurement.** The motors take more than everything else
combined, and an electrode reading taken while the pot is rolling is measuring
the journey.

## Modes

`full`, `measuring`, `frugal`, `survival` — chosen by state of charge. Survival
still logs: enough to know what is happening and to write it down.

## The panel figure is arithmetic until it isn't

Without a current sensor, `harvest` is a rating multiplied by an efficiency and
a number of daylight hours, and it says so every single time. Real yield depends
on angle, temperature, dust and shade, and a light sensor pointed at a plant
cannot tell you any of them.

```js
plant.plugin( 'energy' ).produced( 4.2 )   // watts, from a current sensor
```

Twelve of those and the estimate becomes a measurement.

## API

### `charge( fraction )`

0 to 1. A percentage passed as `85` is refused — it would read as a battery
eighty-five times full and unlock everything forever.

### `plan( { night, moving } )`

`{ mode, running, asleep, drawW, why }`.

### `forecast( opts )`

`{ hours, sustainable, harvest, dailyNeedWh, why }`.

### `canTravel( metres )`

`{ afford, costWh, why }` — one way in, return leg included in the cost.

### `report( opts )`

A line for a panel.

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
