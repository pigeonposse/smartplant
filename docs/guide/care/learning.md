# Learning it is wrong

Everything above measures the plant. This measures the system's **grip** on the plant — the ways it can find out that what it believes is not holding up.

### The two numbers nobody was subtracting

The learning loop already asked whether an action *worked*. It never asked whether the result was the one it **expected**. Those are different questions, and only the second can tell the system its model is wrong: an action can keep producing good outcomes for reasons the model has completely backwards.

`suggest()` produced an `expected`. `outcome()` produced a `reward`. They existed twenty lines apart and nothing ever compared them.

```js
const { reward, prediction, calibration } = await learner.outcome( ctx )

calibration.verdict
// '"move_to_light" keeps doing less than the model expects — over 12 predictions
//  it overestimates by 0.650 on average. The estimate should come down;
//  the plant is not failing to cooperate.'
```

It is tempting to read a plant that keeps contradicting its model as **resisting** — sabotaging the system, having preferences of its own. That framing is wrong and it is dangerous. A plant has no model of the system and cannot form an intention to thwart it. Call it resistance and the natural response is to suppress it; call it prediction error and the natural response is to fix the model. Same measurement, opposite conclusions.

Bias is separated from noise, because the fixes differ: **optimistic** or **pessimistic** means shift the estimate, **noisy** means something that actually drives the outcome is missing from the context the model sees.

### 📉 Continuity, and the electrode problem

`ElectromeBaseline` asks "has something changed since recently?" — a rolling median. That is right for an event and wrong for slow change, because a baseline that follows the plant will follow it anywhere. A signature can walk a long way over three months while every step sits inside recent normal. The frog does not notice the water.

So continuity is measured against an **anchor** fixed once, at settling, that does not move.

**The confound that makes this hard:** an electrode ages. Contact impedance shifts, a callus forms over weeks, gel dries, oxide builds. Every one produces slow, coherent, monotonic change — indistinguishable from a plant reorganising itself, if you only look at one electrode. Over the months where drift is worth measuring, the electrode is the *more likely* explanation.

The discriminator is physical: **the plant is shared between electrodes and a contact is not.**

| Situation | Verdict |
| --- | --- |
| One electrode drifting | ⚠️ **unattributable** — and it says so instead of guessing |
| Two electrodes, one drifts | 🔌 **electrode** — the plant is common to both |
| Two electrodes, both drift the same way | 🌱 **physiology** — independent contacts do not fail in step |

Electrode drift is filed as a claim about the *hardware*, not the plant.

### ⏳ Inheritance that fades whether or not it is tested

An inherited prior used to shrink only as local outcomes accumulated. A prior nobody ever put to the question kept **full weight forever**, outranking policies the plant had actually confirmed for itself.

```
  0 days later → weight 0.6
 60 days later → weight 0.3
240 days later → weight 0.037
```

Belief that is never examined should get quieter, not louder. Migration is also **selective** now — `only: [ 'ranges' ]`, `except: [ 'policies' ]` — so watering habits and light response no longer travel together just because they shared an envelope.

### 🔄 Hysteresis — does the same question still get the same answer?

Stress memory, or priming: a plant that has been through a drought often shuts its stomata faster the next time, and one that has been shaded reaches differently for light. **The response function itself changes with history.**

```js
hysteresis( responseHistory( readings, events, 'water' ), episodeDate )
// { changed: true, direction: 'faster',
//   verdict: 'The plant answers the same stimulus differently since the episode…' }
```

This is deliberately **not** called an epigenetic readout. Nothing here touches methylation or chromatin, and no electrode can infer them. What is measured is behavioural and electrical, and it stands under its own name.

The confounds are the whole difficulty, so occurrences are only compared when they started from **comparable conditions**:

```
same conditions, faster uptake       → changed: true (faster)
same change, but the weather too     → known: false
   'The stimulus never recurred under comparable conditions after the episode,
    so any difference in response could just as easily be the difference in
    conditions. Nothing can be concluded.'
```

And the one confound that cannot be excluded is stated in the result rather than buried: *a plant is older and larger at the second measurement than the first.*

## 🔁 Being wrong about itself

The prediction ledger measures the system being wrong about the **plant**. This is the other half, and it is harder: measuring when it is wrong about its own internal states.

A state with `acts: true` refuses things — it withholds water, stops a probe, declines to lend a plant to a neighbour. Every refusal is a claim that the action would have been worse, and nothing had ever checked one. **A state that is too eager refuses good care forever and looks exactly like a state that is working.**

### The counterfactual, and the one way round it

Grading a refusal has no clean answer from observational data. *"We did not water it and it was fine"* does not mean the refusal was right — it may have been fine either way.

There is exactly one place the other arm of the experiment exists:

> **An override is a natural experiment.**

Every refusal carries a `{ force: true }` escape, and somebody who takes it has run the trial the system declined to run. If the state said this would make it worse, somebody did it anyway, and nothing got worse — that is a false positive **observed**, not inferred.

```js
const may = plant.mayI( 'probe' )
// { allowed: false, blockedBy: [ { state: 'defense_activation', level: 'high' } ] }

const forced = plant.mayI( 'probe', { force: true } )
plant.settleTrial( forced.trial )
// { outcome: 'false-positive',
//   why: 'The action the state refused was taken anyway and nothing got worse.
//         This is the one place a refusal can be checked at all…' }
```

Twelve usable trials before it changes anything, because a system that retunes its own safety gates from anecdotes is worse than one that never retunes them. And it moves in **one direction only** — a state that has been too *permissive* cannot be found this way, since nobody overrides a permission, and loosening a gate on evidence that structurally cannot exist would be inventing it.

### One door

States already stopped watering, probing, lending and moving — five hand-written checks at five call sites. Which meant the sixth action anybody added had none, and nothing noticed, **because there was no list to be missing from.**

```js
plant.posture()
// water       allowed  ×1     (care — never blocked)
// probe       REFUSED         defense_activation
// prime       allowed  ×0.5
```

`CARE` is the line: this withholds elective things and never what a plant needs to stay alive. A gate that blocked water because the plant was already struggling would be the worst possible reading of the whole idea. Where an action has a size, a loaded plant gets a **smaller one** rather than none.

### An experiment that stops for the subject

The existing stopping rule is statistical. This one is not:

> *An experiment producing beautiful data on a plant that is declining has not failed as an experiment — it has stopped being one that should be running, and no result is worth finishing it for.*

Measured against the state the plant was in when it **started**, so a plant that was already loaded is not held to a standard it never met. And it says out loud when no baseline was recorded, because then the kill switch is not armed.

### The trajectory of the pairing

Everything else measures the plant. This measures the coupling, and it earns its place by answering one question nothing else can:

```
verdict: 'instrument'
  The instrument axes are degrading and the plant's own are not. This is an
  electrode ageing rather than a plant declining — the two are indistinguishable
  in any single snapshot and completely different over a season.
```

### The same plant in a new body

Inheritance moves what one plant learned to a *different* plant, and fades it on the way. This is the same plant after a failed electrode, a replaced Pi or a restart — so **nothing fades**, because fading its own history would discard a year of its life over a swapped cable.

```js
const bundle = await plant.exportIdentity()
await fresh.restoreIdentity( bundle, { sameElectrode: false } )
```

Except the parts that were never about the plant. An electrome fingerprint belongs to *this plant through this electrode at this contact point*; installing an old one means every drift measurement afterwards runs against hardware that no longer exists.

| Tier | | |
| --- | --- | --- |
| **Survives** | resolutions, hysteresis, predictions, trajectory, calibration, care log | none of it refers to a wire |
| **Re-established** | fingerprint, electrome baseline, drift anchor | carried as history, deliberately not installed |
| **Depends** | ranges | survive a new electrode, not a repot — only you know which happened |

### Rewriting a threshold, and taking it back

Last, and gated hardest. A threshold moves on **systematic bias, never on error**: wrong by a lot in different directions is a noisy plant and a fine threshold; wrong by a little in the same direction is a threshold in the wrong place.

A fifth of the way at a time, capped at 25% total drift, every change reversible — the failure mode is slow, and by the time it is visible nobody remembers what the number used to be.

And it refuses entirely for a plant nothing has ever contradicted:

> *Nothing has ever told this system it was wrong. […] changing a threshold means moving toward its own conclusions. A plant nobody has ever overridden gets no adaptation, and that is the right answer rather than a limitation.*
