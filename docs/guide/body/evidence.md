# Evidence

Over-reading looks like: one noisy soil sample dips, the robot crosses the room. Ignoring looks like: the plant wilts for two days and nothing acts because no single reading crossed a threshold. Both are failures of *evidence*.

```js
plant.justifies( 'soil_low', RISK.LOW )
// { allowed: true, score: 0.51 }

plant.justifies( 'soil_low', RISK.HIGH )
// { allowed: false, missing: [
//   'evidence 0.51 below the 0.75 needed for high-risk actions',
//   'only 1 independent source(s), needs 2',
//   'condition has held 0min, needs 30min' ] }
```

| Risk | Needs |
| --- | --- |
| `LOW` | 1 source, no persistence — reversible, cheap |
| `MEDIUM` | 2 independent sources, held 5min |
| `HIGH` | 2 sources at 0.75, held 30min — relocation, big watering |
| `CRITICAL` | 3 sources **and a human** |

Cues combine with noisy-OR and are weighted per source, so two independent 0.6 cues corroborate but no pile of weak evidence ever reaches certainty. **A chatty sensor cannot manufacture its own consensus** — re-asserting the same claim updates the cue rather than stacking it.

Human corrections retune the weights (a source that is wrong is discounted, never silenced), and `ShadowMode` runs a candidate policy alongside the live one without letting it act.
