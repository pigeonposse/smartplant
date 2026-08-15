# The pot

The container is the physical limit of everything the plant can do, and it was a number used to size a watering and nothing else. Nothing here knew that a plant outgrows its pot, that outgrowing it is gradual and invisible, or that a person usually notices only once the plant is suffering.

### It does not see the roots

There is no root sensor. This does not measure root mass, cannot see rot, knows nothing about root architecture, and does not replace tipping the plant out and looking. What it does is narrower:

> The system cannot see the roots, but it can tell whether this plant is behaving like one whose pot is running out — and it notices months before a person does, because a person notices when the plant starts suffering and this notices when the drying curve starts changing.

A pot with more root in it holds less water and empties faster, so **the same plant in the same pot needs watering sooner than it did**. That ratio — recent against early *in this container* — is the signal, and it needs no table of expected sizes because it compares the plant against itself.

```js
plant.rootSpace()
// { index: 'low', outlook: '4–10 weeks', confidence: 'medium', acts: false,
//   evidence: [ 'soil dries 1.4× faster than in the first 45 days in this pot',
//               'watering interval 5.2d → 2.6d in the same pot' ] }
```

One signal is a hot week, a probe that shifted or a change of room. Several moving together over months is a pot filling up. A degraded probe is discounted out loud, because **drift in the right direction looks exactly like a pot filling up**.

And `acts` is false and stays false. Repotting is a physical act with real risk, it costs somebody an afternoon, and the evidence here is indirect by construction.

### Moving it, where the person says one thing

```js
await plant.transplant( { volumeL: 5 } )
```

That is the whole interface. Somebody repotting a plant has soil on their hands and no interest in configuring settling windows — what they know that the system cannot is the physical fact.

Everything else follows on its own: the doses rescale, the drying expectations reset, the soil baseline closes and a new one starts empty, the root-space estimate suspends, and elective things wait.

| Resets | Survives |
| --- | --- |
| watering dose, drying expectation | calibration record — *twelve overrides is months, and a repotting does not invalidate one* |
| soil baseline — *the old band describes a pot that no longer exists* | resolution ledger, trajectory, adaptation log |
| weight baseline, root-space estimate | electrome baseline, unless the electrode moved too |

**Settling ends on the readings, not the calendar.** A plant that settles in four days should not be treated as fragile for a fortnight, and one still wobbling after three weeks should not be declared fine because the days ran out — so it watches whether the soil series has stopped lurching, against that plant's own first days in the new pot, and gives up waiting at three weeks rather than staying cautious forever.

Care is never withheld while it settles. A repotted plant still gets watered.
