# Electrophysiology

Plants generate real, measurable electrical signals. The distinction that matters:

| Event | Timescale | Means |
| --- | --- | --- |
| **Action potential** | seconds | Something touched me — a touch, a cold draft, a light change |
| **Variation potential** | minutes | Something is **damaging** me — wounding, burning, herbivory |
| **System potential** | hours | A systemic state change |

```js
const plant = await createPlant( {
  sensor : { driver : 'electrode', transport : 'synthetic' },  // or serial, or push your own ADC
} )

const signal = await plant.listen( { seconds : 600 } )

signal.events[ 0 ]
// { type: { label: 'variation_potential', confidence: 0.7,
//           note: 'Slow graded event. Typically follows tissue damage.' },
//   durationS: 189.8, amplitude: -14.01, polarity: 'hyperpolarizing', snr: 17.5 }
```

`plant:damaged` fires when the plant signals it is being hurt.

**Pure-JavaScript DSP, no native build** — it runs on a Pi and in a browser:

- Zero-phase filters (low / high / band-pass), so an event never moves in time
- **Second-order biquad notch** for 50/60 Hz mains hum, which is louder than the plant and whose removal is the difference between a readable trace and a sine wave
- Radix-2 FFT, one-sided spectra, dominant frequency, band powers over physiological ranges
- Time-domain features including skewness and kurtosis — plant action potentials spike the kurtosis long before they move the mean
- MAD-based spike detection: a few large spikes inflate the standard deviation enough to hide themselves, the median absolute deviation does not
- **Circadian analysis by autocorrelation.** A weak or off-period rhythm is an early stress marker that appears before anything is visible.

```js
import { analyzeTrace, circadianHealth } from 'smartplant/signals'

circadianHealth( series ).verdict
// "Strong rhythm but off-period (14h vs 24h) — the light cycle may be inconsistent."
```

The `synthetic` transport generates physiologically shaped traces — circadian drift, background noise, mains hum, and correctly shaped APs and VPs — so the entire pipeline is testable and demonstrable with no electrode attached. `stimulate( 'variation_potential' )` simulates a wound in software.
