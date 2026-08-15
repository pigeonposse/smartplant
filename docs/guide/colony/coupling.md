# Two plants close together

The aid layer *creates* proximity, and then said nothing about it. A plant that rolls over to shelter a neighbour has also raised the humidity in the gap, cut the other's red:far-red, and started drawing on the same CO₂.

Within 0.4 m, boundary layers overlap and the pair becomes one coupled system with two sets of instruments in it.

```js
const state = await plant.colony.coupling(
  { reading: neighbour, metres: 0.25 },
  roomSensor,  // ← the part that matters
)
```

### Some of it helps and some of it costs

In still, dry, warm air the pairing is genuinely good for both: shared transpiration lifts humidity in the gap, VPD falls, stomata stay open longer, and evaporative cooling is shared. It is why grouped houseplants do better than scattered ones.

In **stagnant** air at peak light it inverts. Two plants photosynthesising into air nobody is stirring pull the local CO₂ down faster than it is replaced, and both fix less than either would alone.

Same arrangement, opposite sign, decided by airflow. So proximity is never scored as good or bad here — only against the conditions, and not at all when the conditions are not instrumented. The conclusion is never "separate them":

> *Being this close is measurably costing these two: co2-depletion. That is not an argument for separating them on its own — it is an argument for moving the air.*

### The reference problem

Most of the care in this module went here. **Two neighbours both reading 68% humidity is not evidence of a shared humid pocket.** It is equally consistent with a humid room.

To claim the pocket exists you need a reading from *outside* it. Without one, every benefit returns `observed: null` — unverifiable, not absent:

```js
// no room sensor
{ observed: null,
  why: 'Both plants can be read, but there is no reading from outside the pair.
        Two plants reporting the same humidity is exactly what a humid room looks
        like…' }
```

And the whole-picture verdict distinguishes the two cases that are easy to confuse:

> *Nothing about this pairing is measurable with what is instrumented. 5 effects could not be assessed, **which is not the same as the pairing doing nothing**.*

### 🫂 Huddling — the only aid where nobody spends anything

Every other kind has a giver and a receiver. Standing close enough to share a humid pocket is not like that: the humidity each adds is breathed by both. It is also the only kind that can leave **both** worse off, so it is the only one gated on conditions rather than on plants:

```
MIDDAY, STILL AIR : Not now. Airflow is 0.04 m/s and light is 15000 […]
                    the arrangement is fine, the timing is not.
AFTER DARK        : Able to offer huddle.
```

One deliberate exception to this library's usual doctrine: **unknown airflow does not block.** Everywhere else a missing reading hides a hazard; here it hides a mild, reversible inefficiency fixed by opening a window, and refusing every huddle in rooms without an anemometer would refuse nearly all of them. It is flagged, not blocked.

### 🚨 Priming — and what it honestly is

Plants really do prime each other with volatiles: methyl jasmonate from a plant under attack, taken up through a neighbour's stomata, raising its defences before anything touches it. It is well established.

**Nothing here can smell it.** That needs gas chromatography, not a DHT22. So the colony channel carries the warning instead — labelled a substitute, never dressed as the real thing:

```js
await sick.colony.warnNeighbours( { near: { willow: 0.25 } } )
// well.colony.primed
// { prime: true, inspectWithin: 6, from: 'ivy',
//   why: 'Raising inspection to within 6h. Nothing has been found on this plant —
//         that is the point of priming, and it is why the response is to look
//         sooner rather than to treat. Treating on a neighbour's finding would be
//         dosing a plant for a problem it may not have.' }
```

It goes out on **suspicion**, not confirmation — the opposite of how the rest of this library treats uncertain findings. The asymmetry is deliberate: a false alarm costs a few unnecessary inspections; a missed one costs a room. And a plant with no camera will not warn anyone about something it cannot see, because a warning it cannot substantiate trains everyone to ignore the next one.

### The shared pot

Allelopathy and mycorrhizal transfer are real, need a shared substrate, and are invisible to every sensor here — so they appear only as configuration-time notes, never as a runtime claim. The one consequence of a shared pot that *is* measurable:

> One soil probe now speaks for two root systems drawing on it at different rates, and watering to one plant's reading waters both.
