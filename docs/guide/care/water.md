# How much water

A pump on a relay needs two numbers nobody was giving it. `water()` recorded that a watering happened and said nothing about its size — fine for a person with a watering can, useless for a pump.

### The species is not the number that matters

The obvious design is a table of millilitres per archetype. It is wrong by an **order of magnitude**, not by a little:

```js
dose( { archetype: 'tropical', pot: { diameterCm: 12 } } )   //   80 ml
dose( { archetype: 'tropical', pot: { diameterCm: 40 } } )   // 2986 ml
```

Same plant, same archetype, thirty times the water. What the archetype decides is the **fraction** of substrate to wet and how far it may dry back; the **pot** decides the volume. Both are required, and no pot size is assumed:

> *That fraction is the part the plant decides; the volume is the part the pot decides […] a default would be wrong by that same factor.*

So `{ pot: { diameterCm } }` belongs in the plant's configuration, and the diagnosis asks for it when it is missing.

| | fraction | dry back to |
| --- | --- | --- |
| cactus | 0.20 | 0.08 — *almost every dead houseplant cactus was overwatered* |
| aroid | 0.30 | 0.45 |
| fern | 0.45 | 0.70 — *the one group where letting it dry once is a real setback* |
| woody | 0.40 | 0.35 — *a shallow watering wets the top and leaves the roots that matter dry* |

### Seconds are measured, not looked up

Flow rate depends on this pump, this tube and this head height, and it drifts as the tube ages. Without a calibration the system gives the volume and **refuses the duration**, which is the honest half rather than a plausible whole.

### And it is open-loop, which is the dangerous part

A blocked line, an empty tank and a tube that has fallen out of the pot are identical from the relay, and each records a watering that did not happen:

```js
plant.confirmWatering( soilBefore )
// { arrived: false, fault: true,
//   why: 'The pump ran and soil moved 1.0 points, which is not a watering. […]
//         a second dose on a blocked line does nothing except record a second
//         watering that did not happen.' }
```
