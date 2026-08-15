# 🌡 @smartplant/thermal

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Reads the canopy with a thermal camera: where it is transpiring, and where it has stopped.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/thermal
```

## Use

```js
import { createPlant } from 'smartplant'
import thermal from '@smartplant/thermal'

const plant = await createPlant( { name : 'Ivy', species : 'Ficus', sensor : 'mock', ai : { provider : 'ollama' } } )
await plant.use( thermal )

await plant.attachSensor( {
  driver : 'thermal',
  frame  : async () => readLepton(), // { width, height, data } — °C per pixel
} )

console.log( await plant.plugin( 'thermal' ).stress() )
console.log( await plant.plugin( 'thermal' ).evenness() )
```

## Why a camera rather than a leaf clip

A leaf cools itself by evaporating, so a working leaf sits below air temperature
and one that has shut its stomata drifts up toward it. That gap is water stress,
hours before anything looks wilted.

A contact probe reports whichever leaf it was clipped to. A frame reports the
whole canopy — and half a plant in trouble looks identical to all of it through
a clip. A blocked vessel, a root problem on one side or a branch sitting in a
draught all show as unevenness long before they show as anything visible.

## An uncalibrated camera does not know the temperature

A Lepton-class sensor is accurate to roughly ±5 °C absolutely and to a few
hundredths *within one frame*. Emissivity, the reflected background, distance
and the sensor's own temperature all move the absolute reading, and a leaf is
not a blackbody.

So nothing here is published as `leafTemperature`, and every number is a
difference. It also means the air temperature has to come from an ordinary
thermometer: reading it off the background of the same frame would cancel the
sensor's error out of both numbers and make their difference look perfect while
meaning nothing. Without one, `stress()` refuses.

## API

### `stress()`

`{ known, index, gap, why }`. Zero is a plant cooling itself freely; one is a
plant that has closed up. Indoors the whole scale is compressed into about three
degrees, so half a degree moves it a long way.

### `evenness()`

`{ even, spread, why }`. The finding worth owning a camera for.

### `map()`

`{ rows, min, max, relative }`. False colour for a panel, scaled between the
coolest and warmest pixel in the frame — relative on purpose.

## Hardware

No hardware library is imported. `frame` is a callback returning
`{ width, height, data }`; whatever produced it is yours to choose.

One case worth knowing: a plant that has stopped transpiring altogether sits at
room temperature and disappears into the wall behind it. The segmentation
reports that as ambiguous rather than as a plant at room temperature — a plant
vanishing from a thermal image is a finding, not a failure to find one.

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
