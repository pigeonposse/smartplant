# Inheritance between plants

[Federated learning](/guide/colony/federated) pools statistics from many homes into an anonymous species profile. This is the other shape of the same idea: a **directed transfer from one mature plant to one new one**, rich and contextual, where the source is known and the receiver keeps its own identity.

```js
const bundle = await mature.exportInheritance()
const { inheritance, compatibility } = await seedling.inherit( bundle )
```

The transfer is the easy part. The value is in the two refusals.

### Evidence is not transferability

The obvious way to rank a learned policy for export is by how much evidence stands behind it. That ranking is close to backwards.

A policy with four hundred outcomes, every one recorded on the same windowsill, has enormous evidential weight and almost no transferable content. What it encodes is *that windowsill*. A policy tried thirty times across cold mornings and warm afternoons, damp substrate and dry, has less evidence and far more of what you actually want: a regularity that survived a change of conditions.

So context diversity is not one term among several. **It is the gate**, and no amount of evidence buys past it:

```
shipped:
  ✓ shift_toward_window
      Transferable (0.931): held across 4 distinct situations over 32 outcomes.

withheld:
  ✗ water_at_low_soil
      Not transferable: learned in a single set of conditions — this describes
      that spot, not the plant; 100% of the evidence comes from one situation.
```

The withheld policy had **twelve times more evidence** than the one that shipped.

### Inherited pathology is caught on arrival

The bundle carries the conditions its priors were learned under, so the receiving plant can compare them against where it has landed.

This matters because a plant that learned "water at 15% soil" did so in a pot that drained badly. Ship that to a plant with a pot that holds water and you have shipped a fix for a problem it does not have. Waiting for the prior to dilute away is not good enough — the plant suffers for the whole length of the dilution, which is exactly when it is most fragile.

```
compatibility: The two spots differ where it matters: soil (40–50 vs 63–73),
               light (824–976 vs 224–370). Priors that depend on these will be
               held back.

held back on arrival:
  ✗ soil_early_water
      The environments differ on soil, which is exactly what this policy is
      about. Held back — it would be a fix for a problem this plant may not have.
```

### The new body always wins

An inherited prior is a starting guess with a finite weight. It is advisory until the plant has outcomes of its own, and it fades on a fixed schedule as those accumulate — Bayesian shrinkage, nothing discretionary:

```
inherited estimate: 0.7   ·   but this plant keeps finding it useless (0.0)

  after  0 local outcomes → estimate 0.163  (inherited weight 0.233)
  after  5 local outcomes → estimate 0.108  (inherited weight 0.155)
  after 20 local outcomes → estimate 0.055  (inherited weight 0.078)
  after 60 local outcomes → estimate 0.023  (inherited weight 0.033)
```

**What travels:** comfort ranges the source actually thrived in, policies that passed the gate, care cadence, the shape of the electrome baseline, and the origin conditions needed to check all of it.

**What does not:** the name, current wellbeing, raw readings, notes, timestamps of when a home was occupied, open wounds, keys. The new plant is born with an inheritance, not a borrowed biography. Its own record starts empty.
