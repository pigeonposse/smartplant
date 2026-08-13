
# 🔬 @smartplant/spectrum

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

Turns an RGB / multi-channel LED into a **diagnostic instrument**. Instead of waiting for the plant to emit an ambiguous signal, it interrogates one photoreceptor pathway at a time and reads the electrical response to each.

A plugin for [**smartplant**](https://github.com/pigeonposse/smartplant) — a bridge between AI and plants.

## What it solves

The central problem in plant electrophysiology is **equifinality**: different causes produce the same waveform. A single passive electrode cannot tell a thirsty plant from a malnourished one.

Two colours can.

| Probe | Reaches | Reads |
| --- | --- | --- |
| 🔵 **Blue** 450nm | Phototropins, cryptochromes in guard cells | Stomatal competence → **hydration and turgor** |
| 🔴 **Red** 660nm | Chlorophyll a/b, Photosystem II | Electron transport → **photosynthetic capacity** |
| 🟢 **Green** 530nm | Deep mesophyll (poorly absorbed at the surface) | **Lower canopy** nothing else reaches |

**🔵 weak + 🔴 strong** → the stomata are shut while photosynthesis is fine. That is ABA-mediated closure: **water stress**.
**🔵 strong + 🔴 weak** → water is fine but electron transport is impaired: **nutrient deficiency**.

## Install

```bash
npm install smartplant @smartplant/spectrum
```

## Use

```js
import { createPlant } from 'smartplant'
import spectrum from '@smartplant/spectrum'

const plant = await createPlant( {
  name    : 'Ivy',
  species : 'Monstera deliciosa',
  sensor  : { driver : 'electrode', transport : 'synthetic' },  // no hardware needed
  ai      : { provider : 'ollama' },
} )

await plant.use( spectrum, {
  spectral : { light : { driver : 'mock' } },   // or serial / mqtt / callback
} )

const result = await plant.plugin( 'spectrum' ).diagnose()
console.log( result.findings )
```

```
🟠 Amber (590nm) → baseline: control channel
🔵 Blue (450nm) → stomatal_response: weak (1.6× control, SNR 6.2).
   Blunted or delayed response: ABA is holding the stomata shut, which means water stress.
🔴 Red (660nm) → photosynthetic_response: strong (5.1× control, SNR 21.4).
   Electron transport is efficient; the photosynthetic apparatus is intact.

Cross-band diagnosis:
  water stress (80%)
    · blue probe blunted (amplitude 2, 1.6× control) — stomata are not opening
    · red probe normal (10) — the photosynthetic apparatus is intact
```

## API

### `diagnose( input? )`

Runs a full sweep — control band first, then each pathway — and interprets it. Returns `{ condition, confidence, advice, findings, sweep }`.

With no cross-band pattern it answers from the measurement and spends **no AI request**.

### `probe( band, opts? )`

Probe a single band: `blue` · `red` · `green` · `amber` · `farRed`.

### `treat( band, opts )`

Apply a wavelength therapeutically. Gated hard — see below.

### `authorize( band )` · `doses()` · `channels()` · `allOff()`

Authorize a wavelength that requires a human, inspect today's exposure against each budget, list what the fixture can emit, and kill every channel.

## Timescales matter

**Plant photoresponses are minutes-scale, not seconds-scale.** Stomatal opening takes 5-30 minutes, so the blue probe runs on a **16-minute period**, not a flicker.

A probe faster than its pathway measures the noise floor and nothing else. `probePeriodSanity()` refuses such a request rather than returning a confident-looking zero:

```js
await plant.plugin( 'spectrum' ).probe( 'blue', { periodMinutes : 0.008 } )
// Error: A 0.008min period gives a 0.0min pulse, but the blue pathway needs
//        at least 5min to respond. The probe would read noise, not the plant.
```

## Safety

Light can damage a plant *while looking like care*, so treatment is gated by arithmetic, not by a model's confidence:

- **🔵 Blue is refused when the soil is dry.** The plant closed its stomata via ABA to conserve water; forcing them open accelerates dehydration. This is the interlock that matters most.
- **Missing data blocks.** Without a soil reading the treatment is refused, because `undefined < 30` is false and an absent sensor must never silently permit a treatment.
- **🟣 UV-B and 🟥 far-red need explicit human authorization** — UV-B is DNA-damaging and an eye hazard; far-red induces shade-avoidance elongation that weakens an indoor plant.
- **Daily dose budgets** per band, reset at midnight.
- **The dark period is protected**, because the circadian rhythm is a health signal the rest of the library reads.

Probes are held to the dose budget but not to the treatment interlocks: a four-minute blue pulse reads the stomata, it does not force them.

## Test

```bash
npm test
```

Runs against the mock lamp, the synthetic electrode and the mock AI provider — no hardware, no API key, no network.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
