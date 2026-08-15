# Reading the electrome

Three mechanics from the electrome literature, each shipped at the size the evidence actually supports.

### 🏷 Intervention signatures — labels nobody had to be asked for

The published stress classifiers reach high accuracy on **labelled data**, inside one experiment, on plants somebody deliberately stressed in a known way. That is the part that does not survive contact with a houseplant: nobody at home can say "this window was salinity", and a model pre-trained on someone else's greenhouse would be confidently wrong about your ficus.

But the labels are not missing. **Every watering and feeding is already in the care log with a timestamp.** So instead of classifying stress the plant might be under, this learns the signature of things known to have been done to it:

```js
await plant.learnInterventions()
// 'Characterised 4 of 4 logged interventions from the electrode buffer.'

plant.interventions.identify( samples, rate )
// { match: 'water', confidence: 0.82 }
```

An intervention whose own occurrences look nothing alike has no signature, and is reported as unreliable rather than averaged into a shape none of them has. Two equally close candidates are reported as a tie, not resolved by picking one.

### 📊 Regime change

Not "does this window depart from normal" but "is there a **point in the record** on either side of which the plant behaves like two different systems".

The temptation is to promise lead time — *detects drought three days before wilting*. Nobody can promise that here; the published lead times come from deliberately stressed plants under instrumentation nobody has at home. This reports that the regime changed and when. Whether it precedes anything in **your** plant is something only your plant can eventually tell you.

### 🏘 Collective state

A colony-level signature is **not** evidence that plants influence each other — they share a window, a radiator and a watering can, and that explains nearly every correlation you will see. Reading coordinated change as communication is the easiest mistake here, and it is unfalsifiable without a sensor for the supposed channel.

The opposite inference is sound: several independent plants shifting at once is strong evidence of a **shared environmental event**, caught more sensitively than any one of them could manage. *One plant changing is a plant. Every plant changing is the room.*

### 🦠 Early infection — the one inference that earns two modalities

A drop in electrical complexity and the first yellowing seen by a camera **do not share a failure mode**: a bad electrode causes no chlorosis, and a white-balance error lowers no entropy. When both move together they really are two witnesses.

It reports; it does not act. Isolation and treatment are physical and expensive to get wrong, so they stay behind the risk gates — an automatic quarantine on a false positive is worse than a late true one. And if the electrical half is a single drifting electrode, the whole thing is refused.

### ⏱ Fresh data for anything that acts

Blue light forces stomata open, so the point of gating it on VPD and soil is knowing what the plant faces **now**. The contraindications already refused *absent* data; a three-hour-old reading is worse than absent, because it looks like knowledge. Stale readings are now treated as no readings.

```
  1 min → allows
 45 min → 'The readings gating this treatment are 45 minutes old, and a
           treatment that forces a physiological response has to be decided
           on current conditions. Take a reading first.'
```

Probes are unaffected: reading the stomata does not force them.
