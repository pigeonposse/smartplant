# Reading the space

Two sensors that answer the same question from opposite ends — is anything there — and neither claims more than it can support.

### WiFi, without a camera

A body between two radios changes the signal that arrives. Channel State Information carries that change, and its variance over a few seconds separates an empty room from an occupied one. It works in the dark, through a wall, with nothing worn.

```js
await plant.attachSensor( {
  driver : 'presence',
  sensing: 'csi',              // or 'rssi' — it has to be stated
  sample : async () => readCsiFromEsp32(),
} )
```

**Presence and motion. Not pose, not identity, not breathing, not counting people.** Those need an array of receivers, a trained model and a calibration for your specific room; a single radio gives coarse presence, and the projects working on more say so themselves. Estimating a skeleton from one radio and reporting it as a fact would be inventing exactly the link this library spends most of its refusals avoiding.

`sensing` has no default, on purpose. RSSI is one number for the whole signal; CSI is a value per subcarrier. What can honestly be reported differs between them, and stating which you have is what stops this claiming more than the radio supports.

Everything is judged against **this room's own quiet** rather than a threshold from a table — two rooms with identical occupancy read completely different RSSI. So it refuses to answer until it has a quiet to depart from:

> *5 of 40 samples. Presence here is a departure from this room's own quiet […] An absolute threshold would be a number from somebody else's room.*

And a radio returning the same number every time is caught as a **stuck sensor**, not reported as a very still house — detected by exact repetition rather than a small threshold, because what counts as small depends entirely on whether these are decibels or amplitudes.

### Why a plant cares

Neither reason is about watching people.

**The UV-B interlock stops depending on being told.** It refuses to emit while the room is occupied — UV-B burns skin and eyes and a plant on a shelf is at eye height — and until now the library could only know that if somebody said so.

**Motion becomes a negative control.** Brushing past a plant produces an action potential that looks exactly like the opening of a wound response. The [defence estimate](/guide/plant/states) already discounts an event the weather explains; somebody walking past belongs in the same column, and indoors it is the commoner of the two.

```js
defenseActivation( { events: [ VP ], shift, motion: { explains: true } } )
// level: 'low', downgradedFrom: 'medium'
```

### One lidar scan, and no map

Cartographer and the SLAM stacks that followed it turn thousands of scans into a consistent map of a building. That is a hard problem, solved, and not this one — the [navigation layer](/guide/body/navigation) delegates it to Nav2 for exactly that reason, and Cartographer's own README now says it is no longer actively maintained.

So this stops well short and answers what a **single scan** answers, which needs no map, no loop closure and no pose graph:

```js
readSpace( scan, { neighbours: [ { id: 'willow', bearing: Math.PI / 2 } ] } )
// { returns: 360,
//   clearance: { clear: true, tightest: { metres: 0.3 }, openings: [ … ] },
//   neighbours: [ { id: 'willow', metres: 0.3, measured: true,
//                   bearingDeclared: true } ] }
```

It is a driver like any other, and it refuses to answer from a scan older than ten seconds:

```js
await plant.attachSensor( { driver: 'lidar', scan: async () => rplidar.scan() } )

// and then, without being asked again:
await plant.colony.coupling( { reading, metres: 0.25, bearing: Math.PI / 2 } )
// { metres: 0.31, measured: true }   ← the typed 0.25 is replaced

await planMove( plant, { … } )
// refusals: [ { reason: 'blocked',
//   why: 'Boxed in: something is 0.18m away and this pot is 0.30m across.
//         Nothing here can move until that clears, and a plan that says
//         otherwise is planning through a wall.' } ]
```

> *A stale moisture reading is roughly still true. A stale scan describes a room somebody may have moved a chair through, and planning a route from it means routing through furniture that is no longer there.*

**The first of those is the point.** The [coupling layer](/guide/colony/coupling) — shared humidity, competing for the same CO₂, whether a pest can walk across — rests entirely on how far apart two plants are, and until now that number was typed in by a person. Every conclusion carried the footnote:

> *Declared, not measured — if a pot was moved and nobody said so, this is wrong.*

A rangefinder removes it, and needs none of the machinery that makes SLAM hard.

A scan returns distance and angle. It does not know that the return at 0.3 m is a plant rather than a chair leg, so **bearings stay declared and ranges are measured**, and the two are kept apart everywhere — the same split this library keeps between what was stated and what was observed.

It also notices something appearing between the plant and the window, which matters because *a box on the windowsill and a cloudy week look identical in the light record* and call for completely different responses.

### What each one changes

Neither sensor is decoration, and neither is folded in where it does not belong — a scan is not a vital sign and presence is not plant physiology.

| Sensor | Changes |
| --- | --- |
| lidar | The distance in every coupling conclusion · `planMove` refuses when the pot is boxed in · the panel's inventory · the colony manifest advertises ranging |
| wifi | The UV-B interlock, which stops depending on being told · defence activation, where motion is a negative control · `stress_load`, because being handled is a real cost · **watering** |

That last one is the sharpest of them. Somebody watered it is the ordinary explanation for a jump in soil moisture, and it is the only one that requires somebody to have been there:

```js
await plant.water()
// { refused: true, state: 'water_stress_internal',
//   why: 'The pot got wetter and nobody was here to water it. That leaves a
//         leak, rain through an open window, or a probe drifting up as it
//         loses contact — and all three want looking at rather than being
//         folded into the watering record as a drink the plant was given.' }
```
