# Internal states

Every other layer here reads the environment and reasons about it. These read the **plant**: five qualitative estimates of physiological state, each built only from measured signals, each carrying the evidence that raised it.

```js
const states = plant.states()
// {
//   defense_activation    : { level: 'high',    confidence: 'high',   acts: true,  … },
//   water_stress_internal : { level: 'high',    confidence: 'medium', acts: true,  … },
//   stress_load           : { level: 'medium',  confidence: 'medium', acts: true,  … },
//   stress_memory         : { level: 'unknown', confidence: 'low',    acts: false, … },
//   circadian_integrity   : { level: 'low',     confidence: 'medium', acts: false, … },
// }
```

### The rule that decided what exists

**A state is only worth creating if it changes a decision.** Not if it is interesting, not if it sounds sophisticated. If the system would behave identically with and without it, it is decoration — and decoration in a system people trust with a living thing is worse than nothing, because it buys credibility it did not earn.

So every state declares a `decides` field naming what changes, and **a test fails if one ships without it**.

### Confidence is not an annotation. It bites.

Low confidence does not merely label a state — it removes its authority:

```js
state.acts   // false whenever confidence is low, the level is unknown, or the level is low
```

Every gate in this library checks `acts`, never `level`. A weak signal can inform a person; it cannot change what the system does.

### The five

| State | Anchored in | What it decides |
| --- | --- | --- |
| `defense_activation` | Variation potentials, electrome shift, visible damage, logged wounding | Elective actions — probes, experiments, aid, relocation |
| `water_stress_internal` | Disagreement between the soil probe and the plant | Whether watering happens |
| `stress_load` | Event rate, physiology-attributed drift, repeated episodes | Intervention size |
| `stress_memory` | Measured hysteresis either side of an episode | Which response profile to predict from |
| `circadian_integrity` | Electrome rhythm against the light cycle | Whether the system trusts its own timing advice |

### 🛡 Defence activation — and what it refuses to claim

Wound a plant and a well-described cascade follows: a variation potential spreads from the damage, jasmonic acid accumulates, methyl jasmonate goes volatile, and neighbours taking it up through their stomata raise their own defences before anything has touched them.

**This does not measure methyl jasmonate.** That needs mass spectrometry; this library has an electrode, a camera and some environmental sensors. Any number presented here as a hormone concentration would be invented.

What *is* available is the electrical half of the same cascade — and the distinction is not pedantry:

> `"MeJA is high"` is a claim about chemistry that would be false.
> `"This plant is behaving as if it has been wounded, and the weather does not explain it"` is a claim the instruments support.

Two rules carry the weight.

**Absent is not low.** The variation potential is the primary evidence. Without an electrode, a plant being eaten right now looks identical to a calm one — so a missing instrument returns `unknown`, and `low` is returned *only* when the thing that would have shown activation was watching and saw none.

**The negative control can lower the answer**, and it is the only thing here that can. Cold shock, a light change and a knock all produce variation potentials, so a system that counted them would spend its life announcing attacks on a plant nobody has touched:

| Evidence | Room | Result |
| --- | --- | --- |
| VP + electrome shift | steady | `medium` |
| VP + electrome shift | temperature dropped 6 °C | **`low`** ← lowered from medium |
| VP + electrome shift + visible chewing | temperature dropped 6 °C | `high` — a draught does not chew holes in a leaf |

Level and confidence move independently. Two electrical signals are **one instrument agreeing with itself** and cannot reach `high` alone; that needs a second modality.

`posture()` is deliberately about *restraint* rather than action — there is nothing useful to do to a plant mounting a defence, and the value is in not adding to it:

```js
await plant.interrogate()
// { refused: true, defense: 'high',
//   why: 'Not probing. Estimated activation of the defence pathway (jasmonate
//         signalling likely): high. … Pass { force: true } to override, which is
//         reasonable if you need the reading more than the plant needs to be
//         left alone.' }
```

A defending plant also will not be volunteered to help a neighbour. Ordinary care continues throughout.

### 💧 Internal water stress — when watering is the wrong answer

The soil probe answers a question about **the pot**. Whether the plant is getting water is a different question, and the two come apart in exactly the cases that matter most: rotted roots cannot drink from wet soil, a root-bound plant runs dry hours after the probe says it is fine, and a plant in high VPD loses water faster than roots can supply it however wet the pot.

Every one of those looks like thirst. None is fixed by watering. The worst is made **worse** by it.

```js
await plant.water()
// { refused: true, state: 'water_stress_internal', level: 'high',
//   evidence: [ { signal: 'soil', detail: 'Soil is at 85, which is not short of water.' },
//               { signal: 'stomatal-closure', … },
//               { signal: 'electrome-shift', … } ],
//   why: 'The pot is wet and the plant is behaving as though it is not getting
//         water. … Pass { force: true } to water anyway.' }
```

It fires **only on disagreement**. Soil dry and plant stressed is ordinary thirst — agreement is not a state, it is a reading. And one plant-side signal is not enough to withhold water: the state exists, and `acts` is false.

### 🪫 Accumulated load — and the drift that does not count

A single episode is an event. Several in a row, without the plant returning to its own baseline between them, is a different situation: the capacity to absorb the next one is lower.

The important refusal is in the middle. Baseline drift is the most common artefact in plant electrophysiology — an electrode dries out or loses contact and produces a slow wander that looks exactly like a plant declining. So drift counts **only** when the [continuity tracker](/guide/care/learning#📉-continuity-and-the-electrode-problem) attributed it to physiology across multiple sites:

```js
{ signal : 'drift-discounted',
  detail : 'Baseline drift was found and attributed to electrode, so it is not
            counted as accumulated stress. An ageing electrode produces exactly
            this pattern and it is not a fact about the plant.' }
```

Discounted out loud, not silently dropped. High load scales interventions to `0.6` rather than blocking them.

### 🧠 Stress memory — capped at medium forever

Delegated entirely to [`hysteresis()`](/guide/care/learning), which already refuses on mismatched conditions. It can never exceed `medium`, and the reason travels *with* the state instead of being left behind:

> A plant is older and larger at the second measurement than the first. Growth changes the response too, and no reading in this record can separate that from memory.

A negative result is reported as a real finding, not an absence of one — the old response profile can still be trusted.

### 🕐 Circadian integrity — the useful inversion

Everywhere else in this library a degraded signal means the plant needs attention. Here it *also* means **the system should trust itself less**.

Timing advice ("wait four hours, the plant is in its rest phase") is derived from the rhythm estimate. When the rhythm is weak, that advice is noise presented as insight — so `goodMoment()` declines to give an opinion rather than handing back a confident hour from a clock that is not keeping one:

```js
await plant.goodMoment( 'probe' )
// { good: true, trusted: false,
//   reason: 'No timing opinion offered. The rhythm has weakened to 0.15. …
//            Proceeding on the caller's schedule rather than on a clock that is
//            not keeping one.' }
```

It also separates two very different problems: a **weak** rhythm is the plant, a **strong but off-period** one is the timer. One is fixed by hardware nobody has to worry about; the other is not.

### What is deliberately absent

Abscisic acid, ethylene, salicylic acid, cytokinins. All real, all central to plant physiology, **none anchored to anything this library measures**. Estimating them would mean inventing the link, and an invented link is precisely the failure these rules exist to prevent.
