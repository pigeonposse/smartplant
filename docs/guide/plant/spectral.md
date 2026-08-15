# Spectral: light as an instrument

Every other layer in this library **listens**. This one **asks**.

The central problem in plant electrophysiology is *equifinality*: different causes produce the same waveform. A thirsty plant and a malnourished one can look identical on a single electrode, and no amount of passive sensing separates them.

So stop waiting for the plant to volunteer an ambiguous signal. **Excite one photoreceptor pathway at a time and read what comes back.** Blue reaches the guard cells, red reaches Photosystem II, green reaches the tissue neither of them touches — and the *pattern across colours* is diagnostic in a way no single channel can be.

```js
await plant.useSpectral( { light : { driver : 'mock' } } )   // or serial / mqtt / callback

const sweep = await plant.interrogate()
console.log( sweep.summary )
```

```
🟠 Amber  (590nm) → baseline: control channel
🔵 Blue   (450nm) → stomatal_response: weak (1.6× control, SNR 6.2)
   Blunted or delayed response: ABA is holding the stomata shut, which means water stress.
🔴 Red    (660nm) → photosynthetic_response: strong (5.1× control, SNR 21.4)
   Electron transport is efficient; the photosynthetic apparatus is intact.

Cross-band diagnosis:
  water stress (80%)
    · blue probe blunted (amplitude 2, 1.6× control) — stomata are not opening
    · red probe normal (10) — the photosynthetic apparatus is intact
```

## What each colour does to a plant

| | Band | Photoreceptor | 🔍 As a **probe**, it reads | 💊 As a **treatment**, it does | Risk |
| --- | --- | --- | --- | --- | --- |
| 🟣 | **UV-B** 300nm | UVR8 | *never probed — DNA-damaging* | Flavonoid synthesis, thicker cuticle, pathogen resistance | 🔴 critical |
| 🟪 | **UV-A** 380nm | Cryptochrome, phototropin | Cryptochrome response | Compacts leaf expansion, raises pigment density | 🟡 medium |
| 🔵 | **Blue** 450nm | Phototropin, cryptochrome | **Stomatal competence → hydration & turgor** | Forces stomata open, raising transpiration | 🟠 high |
| 🟢 | **Green** 530nm | Weakly absorbed → penetrates | **Deep mesophyll → the lower canopy** | Lights inner canopy nothing else reaches | 🟢 low |
| 🟠 | **Amber** 590nm | Minimal | **The control channel** — what "no stimulus" looks like | Working light for the camera, minimal perturbation | 🟢 low |
| 🔴 | **Red** 660nm | Chlorophyll a/b, Photosystem II | **Electron transport → photosynthetic capacity** | Drives ATP/NADPH synthesis and carbon fixation | 🟡 medium |
| 🟥 | **Far-red** 730nm | Phytochrome (Pfr→Pr) | Phytochrome state | Stem elongation, end-of-day signal, flowering | 🟠 high |
| ⬛ | **NIR** 940nm | *none — thermal only* | *never probed — no receptor* | Radiant warming without photosynthesis | 🟠 high |

## The diagnostic that needs two colours

This is the whole point:

| Blue probe | Red probe | Conclusion |
| --- | --- | --- |
| 🔵 weak | 🔴 strong | **Water stress.** Stomata shut while photosynthesis is fine — that is ABA-mediated closure, not damage. |
| 🔵 strong | 🔴 weak | **Nutrient deficiency.** Water is adequate but electron transport is impaired: N, Mg, Fe, or photosystem damage. |
| 🔵 weak | 🔴 weak | **Severe stress — or a bad electrode.** The system says so rather than guessing. |
| 🔵 strong | 🔴 strong | No cross-band pattern. The pathways agree. |

Add 🟢 green and you also see the lower canopy: a healthy top with a quiet interior means self-shading or senescing lower leaves.

Waveform *distortion* with amplitude preserved — a harmonic ratio above 0.5 — flags **ionic imbalance** (often salinity) before any visible symptom.

## Minutes, not milliseconds

The single fact that decides whether any of this works:

> **Stomatal opening takes 5 to 30 minutes.**

So the blue probe runs on a **16-minute period**, not a flicker. A probe faster than its pathway measures the noise floor and returns a confident-looking zero — which is worse than an error, because you would believe it.

The system refuses rather than letting that happen quietly:

```js
await plant.spectral.probe( 'blue', { periodMinutes : 0.008 } )   // 2 Hz
// Error: A 0.008min period gives a 0.0min pulse, but the blue pathway needs
//        at least 5min to respond. The probe would read noise, not the plant.
```

Each band carries the period its own physiology allows: 🔴 red 8min · 🟠 amber 10min · 🟪 UV-A 12min · 🔵 blue 16min · 🟢 green 20min · 🟥 far-red 30min.

## How the measurement works

Drive the plant with a periodic light/dark cycle and the surface potential locks to that period, forming a carrier. The plant's internal state then appears as **modulation of that carrier** — which is far easier to detect than a transient you have to catch.

- **Phase locking** — power concentrated at the stimulus frequency, with an SNR against the surrounding noise floor. This is what separates a real evoked response from drift that happened to coincide.
- **Cycle folding** — every cycle averaged onto one. Uncorrelated noise falls as 1/√N while the locked response survives, so twelve cycles recover a signal buried under twice its own amplitude in noise.
- **Harmonic content** — distortion rises when a pathway saturates or is stressed, carrying information the fundamental alone does not.
- **Everything relative to the 🟠 amber control**, because absolute millivolts depend on electrode placement and contact impedance and are not comparable across sessions, let alone across plants.

## Safety: the interlocks

Light is the one actuator here that can damage a plant *while looking like care*. A pump that overruns floods visibly; a lamp that forces stomata open on a drought-stressed plant kills it quietly while the log says "treatment applied".

So treatment is decided by arithmetic, never by a model's confidence:

```js
await plant.spectral.treat( 'blue', { seconds : 300, context : plant.context() } )
// REFUSED: The plant closed its stomata to conserve water. Forcing them open
//          with blue light overrides that defence and accelerates dehydration.
```

| Interlock | Rule |
| --- | --- |
| 🔵 **Blue on dry soil** | **Hard refusal.** Soil under 30%, humidity under 25%, or over 32°C. The plant closed its stomata to survive. |
| **Missing data** | **Blocks.** `undefined < 30` is false, so an absent soil sensor must never silently *permit* the treatment that most needs it. |
| 🟣 **UV-B** | Explicit human authorization, 15 min/day, capped intensity. Eye and skin hazard — the warning says so. |
| 🟥 **Far-red** | Blocked by default. It induces shade-avoidance elongation, which weakens an indoor plant. |
| **Dose budgets** | Per band, per day, reset at midnight. Authorizations expire with the day too. |
| **Dark period** | Protected. The circadian rhythm is a health signal the rest of the library reads; irradiating through the night destroys it. |

Probes are held to the dose budget but **not** to the treatment interlocks: a four-minute blue pulse reads the stomata, it does not force them.

## Hardware

Any multi-channel LED works. The driver's only job is to emit channel intensities and report honestly what it actually did.

```js
await plant.useSpectral( {
  light : { driver : 'serial', path : '/dev/ttyUSB0' },   // an ESP32 driving LED channels
} )
```

| Driver | For |
| --- | --- |
| `mock` | No hardware — the whole stack is testable and demonstrable |
| `serial` | ESP32 / Arduino, one JSON line per command |
| `mqtt` | ESPHome, Tasmota, Zigbee2MQTT |
| `callback` | Philips Hue, DMX, WLED, GPIO PWM — anything with its own SDK |

A fixture declares which bands it has; requesting a channel it lacks is an error, not a silent no-op. Calibrated fixtures can declare `irradiance` per channel and the dose ledger will use photon flux; without calibration the system tracks **time** rather than pretending to know µmol·m⁻²·s⁻¹.

## Feeding the rest of the system

Spectral findings enter the [evidence ledger](/guide/body/evidence) as an **independent source**, because they come from controlled excitation rather than from the same passive channel everything else reads. That is what lets a high-risk action clear its corroboration requirement honestly:

```js
await plant.embody()
await plant.interrogate()

plant.justifies( 'water_stress', RISK.HIGH )
// now backed by soil, vision *and* spectral — three independent sources
```

Full example: [`lib/examples/06-spectral-probe.js`](https://github.com/pigeonposse/smartplant/blob/main/lib/examples/06-spectral-probe.js), and the [`@smartplant/spectrum`](/guide/ecosystem/plugins) plugin wraps all of it.
