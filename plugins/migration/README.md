# 🧬 @smartplant/migration

Inheritance between plants. A mature plant leaves what it learned to a new plant of the same species.

[Federated learning](https://github.com/pigeonposse/smartplant#-federated-learning) pools anonymous statistics from many homes into a species profile. This is the other shape of it: a **directed transfer**, one known source to one known receiver, carrying the context needed to check itself on arrival.

```bash
npm install @smartplant/migration
```

```js
import { createPlant } from 'smartplant'
import migration from '@smartplant/migration'

await mature.use( migration )
const { bundle, shipped, withheld } = await mature.plugin( 'migration' ).bequeath()

await seedling.use( migration, { inherit : bundle } )
seedling.plugin( 'migration' ).status()
```

## Evidence is not transferability

The obvious way to rank a learned policy for export is by how much evidence stands behind it. That ranking is close to backwards.

A policy with four hundred outcomes, every one recorded on the same windowsill, has enormous evidential weight and almost no transferable content — what it encodes is *that windowsill*. A policy tried thirty times across cold mornings and warm afternoons, damp substrate and dry, has less evidence and far more of what you want: a regularity that survived a change of conditions.

Context diversity is therefore **the gate**, and no amount of evidence buys past it:

```
✓ shift_toward_window
    Transferable (0.931): held across 4 distinct situations over 32 outcomes.

✗ water_at_low_soil
    Not transferable: learned in a single set of conditions — this describes
    that spot, not the plant.
```

The withheld policy had twelve times more evidence than the one that shipped.

## Inherited pathology is caught on arrival

The bundle carries the conditions its priors were learned under, so the receiver can compare them against where it has landed.

A plant that learned "water at 15% soil" did so in a pot that drained badly. Ship that to a pot that holds water and you have shipped a fix for a problem it does not have. Waiting for the prior to dilute away is not enough — the plant suffers for the whole dilution, which is when it is most fragile.

```js
await seedling.plugin( 'migration' ).wouldSuit( bundle )
// { compatible: false,
//   verdict: 'The two spots differ where it matters: soil (40–50 vs 63–73)…' }
```

`wouldSuit()` answers before anything is changed.

## The new body always wins

An inherited prior is a starting guess with a finite weight. It is advisory until the plant has outcomes of its own, and fades by Bayesian shrinkage as those accumulate.

```js
const mig = seedling.plugin( 'migration' )
mig.outcome( 'move_to_light', 0 )   // this plant found it useless
// → { expected, weight, why }  — weight falls with every local outcome
```

## API

| Method | What it does |
| --- | --- |
| `bequeath( opts )` | Package this plant's inheritance. Returns `{bundle, shipped, withheld, summary}` |
| `receive( bundle, opts )` | Graft one on. Returns `{compatibility, admitted, held, report}` |
| `wouldSuit( bundle )` | Would it fit here? Changes nothing |
| `status()` | What is inherited and how much still applies |
| `outcome( action, reward )` | Record a local result so the prior dilutes |

Install with `{ inherit: bundle }` to make a plant the heir at setup time; it raises `migration:inherited`.

**What travels:** comfort ranges the source thrived in, policies that passed the gate, care cadence, the electrome baseline shape, and the origin conditions.

**What does not:** the name, current wellbeing, raw readings, notes, timestamps of when a home was occupied, open wounds, keys. The new plant is born with an inheritance, not a borrowed biography.

## License

MIT © [Alejo Malia](https://github.com/alejomalia) · [PigeonPosse](https://github.com/pigeonposse)
