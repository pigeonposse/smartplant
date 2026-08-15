# Maintenance

Every conclusion here rests on hardware that degrades. An electrode calluses over, a soil probe corrodes, a serial link drops.

**The failure that matters is not the loud one.** A driver that throws gets caught and reported. The dangerous case is a component that keeps answering while being wrong — a stuck humidity sensor reads 55% all week, the plant looks stable, the VPD calculation is confident, and every layer downstream reasons beautifully about a number that stopped being a measurement days ago.

```
stuck sensor → degraded

  mock [degraded]
     humidity: The last 28 readings are all exactly 55. A real measurement moves
     in its last digit even in a still room; this sensor has latched.

what to do about it:
  · Sensor "mock" is unreliable; readings from it should be treated as suspect.

suggested evidence weights: { "mock": 0.25 }
```

| Checked | How it is caught |
| --- | --- |
| **Stuck sensor** | Exact equality, repeated. A stable room still moves the last digit; a latched sensor does not |
| **Impossible readings** | Values outside what the metric can physically be |
| **Flat electrode** | Living tissue is never electrically silent, so silence is the wire, not a calm plant |
| **Mains hum** | Power still at 50/60 Hz after filtering — grounding, not physiology |
| **Aliased sampling** | A rate at or below 2× mains folds the hum *down into* the plant's own band, wearing a plausible frequency |
| **Saturation** | An amplifier pinned at its rail reports numbers without measuring |
| **Tiring contact** | Reuses the [continuity](/guide/care/learning#📉-continuity-and-the-electrode-problem) verdict rather than inventing a second opinion |
| **Driver failures** | Consecutive and proportional failure rates per driver |
| **Memory** | Readings out of chronological order break every window and trend computed from them |
| **Colony link** | Neighbours that were reachable and no longer are |
| **Body** | Safety limits refused repeatedly — the layer above keeps asking for what it cannot have |

Nothing is quietly discarded. A component judged unreliable is **marked** unreliable, its suggested evidence weight drops, and the reason is stated — because silently dropping a sensor is its own way of being wrong without saying so. Faults are filed as claims about the *instrument* (`instrument_unreliable`), so a conclusion can be discounted when the thing that produced it is broken.
