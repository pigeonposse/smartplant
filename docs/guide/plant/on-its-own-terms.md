# The plant on its own terms

Everything above compares the plant against a reference: a species profile, a wall clock, a table of healthy ranges. That is where most plant monitoring quietly goes wrong, because the reference is a population average and your plant is one individual, in one pot, in one room.

These four layers drop the reference and compare the plant against **itself**.

### 🧬 Electrome fingerprint — what is normal for *this* plant

A signature of the plant's baseline electrical state across several axes: complexity, entropy, variability, and the distribution of power across physiological bands. The library learns it over the first windows, then reports departures from it.

```js
const s = await plant.listen( { seconds : 600 } )

s.shift.verdict
// "Learning this plant's normal: 6/12 windows."
// then, later:
// "Signature has moved: complexity down 38%, band power shifted low.
//  This plant is not behaving like itself."

s.shift.delta[ 0 ]   // { axis: 'complexity', direction: 'down', weighted: 0.41 }
```

`plant:electrome-shift` fires when the signature genuinely moves.

Two design decisions carry most of the weight. The fingerprint is **DC-offset invariant** — an electrode drifting by 40 mV is a wiring fact, not a new plant, and must not read as one. And the baseline **refuses to judge before it has settled**: a "normal" derived from a single window is not a normal, so early calls say so rather than inventing a verdict.

### 🕐 Internal clock — what time it is *for the plant*

`circadianHealth` asks whether a rhythm exists. This asks the question that actually changes behaviour: where is the plant in its own day, and how far is that from the clock on the wall?

```js
s.clock
// { periodHours: 26.4, acrophaseHour: 15.2, subjectiveHour: 4.1,
//   offsetHours: 2.2, freeRunning: true, aligned: false,
//   verdict: 'Free-running at 26.4h rather than 24h. The plant is following its
//             internal clock because the light cycle is not strong or regular
//             enough to entrain it.' }

timingAdvice( s.clock, 'probe' )
// { good: false, betterInHours: 5.9,
//   reason: 'A stomatal probe at subjective night measures a plant that has
//            closed down. The response would read as "weak" for reasons that
//            have nothing to do with health.' }
```

A plant whose subjective dawn falls at 3pm is not "arrhythmic" — it is entrained to something you did not intend: a corridor light, a west-facing window, a lamp on a timer. Every decision made on wall time is landing at the wrong point in its day.

### 📡 Two-site coherence — is this the plant, or the electrode?

The electrode is the weakest link in the whole evidence chain. A dry contact or a callus forming produces a confident, well-shaped waveform that means nothing, and every layer downstream then reasons beautifully about an artefact.

Two electrodes fix what one never can, because plant signals **propagate** at speeds physiology constrains:

| Event | Speed | A 50 mm gap implies |
| --- | --- | --- |
| **Action potential** | 1–40 mm/s | 1.2 – 50 s |
| **Variation potential** | 0.5–5 mm/s | 10 – 100 s |
| **System potential** | 0.1–2 mm/s | 25 – 500 s |

```js
await plant.attachSensor( {
  driver : 'electrode', transport : 'synthetic',
  sites  : [ { id : 'stem', distanceMm : 50 } ],
} )

s.coherence.stem.verdict
// "Both electrodes saw the same event, 5.00s apart across 50mm. Implied speed
//  10.00mm/s is consistent with an action potential (1-40mm/s).
//  This is the plant, corroborated at two sites."
```

The failure modes are the point:

- **Zero delay is diagnostic.** Nothing biological reaches two separated points at the same instant — but mains pickup and ground loops do exactly that. A simultaneous event is rejected as interference, not accepted as a strong signal.
- **Overlapping speed ranges are reported honestly.** 2 mm/s fits all three event classes, so the library returns every candidate and names none. Claiming "variation potential" there would be false precision.
- **An ambiguous lag corroborates nothing.** A periodic signal correlates just as well at *lag* as at *lag + period*, so when rival peaks come close the result is flagged ambiguous and coherence is withheld — match discrete events instead.

That is corroboration grounded in physics rather than statistics, and it is very hard to fake.

### 🔵 VPD-aware blue — the same response, opposite meanings

Blue light opens stomata. So a strong blue response was read as a healthy, responsive plant. That reading is wrong roughly half the time, because it ignores the air.

**Vapour pressure deficit** — how hard the atmosphere is pulling water out of the leaf — is now computed from temperature and humidity and folded into every blue reading:

| Blue response | VPD | Soil | Reading |
| --- | --- | --- | --- |
| strong | high | dry | 🔴 **`demand_with_deficit`** — transpiring hard against a supply it does not have. This precedes sudden wilting. |
| strong | high | wet | **`high_demand`** — demand, not comfort |
| weak | low | — | **`no_demand`** — still humid air, not water stress |
| weak | high | — | **`closed_under_demand`** — refusing to open under strong pull is a clear ABA signal: stress |

```js
plant.context().vpd       // 2.14
plant.context().vpdBand   // 'severe'
```

The same closed stoma means "nothing to do" in still humid air and "the plant is defending itself" in dry air. Reading it without the atmosphere is how a monitoring system talks itself into watering a plant that is fine, or reassuring you about one that is not.
