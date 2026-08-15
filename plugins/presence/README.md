# 📡 @smartplant/presence

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Occupancy from a WiFi radio: the UV-B interlock, and motion as a control on electrical events.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## Install

```bash
npm install smartplant @smartplant/presence
```

## Use

```js
import { createPlant } from 'smartplant'
import presence from '@smartplant/presence'

const plant = await createPlant( { name : 'Ivy', species : 'Ficus', sensor : 'mock', ai : { provider : 'ollama' } } )
await plant.use( presence )

await plant.attachSensor( {
  driver  : 'presence',
  sensing : 'rssi',              // or 'csi'
  sample  : async () => readRadio(),
} )

if ( plant.plugin( 'presence' ).uvbAllowed().allowed ) await lamp.uvb()
```

## This is not here to watch people

The radio reports one number: how disturbed the channel is compared to this
room's own quietest. No identity, no count, no position. Two things about a
plant depend on it.

**The UV-B interlock.** UV-B burns skin and eyes, a plant on a shelf sits at eye
height, and until now the library could only know the room was empty if somebody
told it.

**Motion as a negative control.** Brushing past a plant produces an action
potential; so does the draught from a door. Both look like the opening of a
wound response for the first few minutes. The defence estimate already discounts
an event the weather explains, and "somebody walked past at that exact moment"
belongs in the same column.

## Unknown is a refusal

`uvbAllowed()` returns false while the radio is settling, while it is stuck, and
whenever occupancy is unknown. An interlock that opens when it cannot see is not
an interlock: the cost of refusing is a plant missing an optional dose, and the
cost of allowing is somebody at eye height getting one.

And "empty" means *nobody moving*. A person sitting perfectly still is the case
a WiFi radio cannot see, so this belongs alongside a physical guard rather than
instead of one.

## API

### `room()`

`{ occupancy, motion, settled, ratio, why }`.

### `uvbAllowed()`

`{ allowed, why }`.

### `explains( at )`

`{ explains, why }` — did anything move within ±30 s of an electrical event.

### `capability()`

What this radio honestly supports. CSI gives motion fine enough to notice
somebody reaching past the plant; RSSI gives gross motion. Neither gives
direction or pose, whatever a datasheet claims.

## Hardware

No radio is talked to directly — there is no portable way, and the hardware that
exposes CSI does so through its own firmware. `sample` returns a number (RSSI)
or an array of numbers (CSI subcarriers). An ESP32-S3 with CSI firmware feeds
this happily.

Presence is judged against this room's own quiet baseline rather than a
threshold from a table: two rooms with identical occupancy read completely
different RSSI.

## Test

```bash
npm test
```

Runs against the mock sensor and mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
