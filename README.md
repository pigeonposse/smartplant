
# Smartplant by *PIGEONPOSSE*

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

**SmartPlant is a bridge between AI and plants.**

Not a plant monitor.  
Not a chatbot that “speaks for” the plant.  
But a system where the plant and the machine form a hybrid organism with:
* 👁 Shared perception → sensors + electrophysiology + vision  
* 💾 Shared memory → history + semantic memory + care log  
* 🧠 Shared reasoning → ontology + reasoner + AI  
* 🗣 Voice and action → the plant speaks, the system acts (or tells you what to do)  
* 🤝 Collective learning → federated learning across many plants

It lets a plant sense its own conditions, remember what it has been through, reason about it symbolically, consult the AI model of your choice, and tell you — in its own voice — what it needs.

It runs on a Raspberry Pi with real sensors and an electrode taped to a leaf. It also runs on a laptop with nothing at all.

```bash
npm install -g smartplant
smartplant
```

```js
import { createPlant } from 'smartplant'

const plant = await createPlant( {
  name    : 'Ivy',
  species : 'Monstera deliciosa',
  sensor  : 'mock',                  // no hardware needed
  ai      : { provider : 'ollama' }, // or gemini / openai / claude / grok / mock
  memory  : { path : './ivy.json' },
} )

await plant.read()
console.log( plant.status() )
// 😊 84% | Temperature: 🌡️ 21.6°C | Humidity: 💧 58.9% | Soil moisture: 💧 62.1% | Light: 🌞 326lux

console.log( await plant.speak( 'how are you today?' ) )
// "I'm comfortable — the light is good and my soil is still damp from Tuesday."
```

**No API key, no hardware and no network are required to start.** The `mock` sensor simulates a plant that genuinely dries out over time, and every AI path falls back to a deterministic offline voice that only ever states what the sensors actually measured.

Then it goes further than a monitor:

- 🧬 It reads the plant's **own electrical signals** — and can tell "something touched me" from "something is damaging me"
- 🧠 It reasons **symbolically**, so every conclusion carries the readings that produced it
- 🦿 It can be given a **body** that moves the plant, under limits no model can talk past — see [Symbiosis](#symbiosis)
- 🔬 It **interrogates** the plant with 🔵🟢🔴 light, separating thirst from malnutrition — see [Spectral](#-spectral-light-as-an-instrument)
- 🦞 It can be **run by an agent** through [OpenClaw](#-openclaw-the-plants-brain) — AI with no API key, gated by the safety layers

---

## Contents

- [The nineteen layers](#the-nineteen-layers) · [Requirements](#requirements)
- **Core** — [Sensors](#-sensors) · [AI](#-ai) · [Memory](#-memory) · [Voice](#-voice) · [Events](#-events)
- **Advanced** — [Electrophysiology](#-electrophysiology) · [**The plant on its own terms**](#-the-plant-on-its-own-terms) · [Vision](#-vision) · [Knowledge & reasoning](#-knowledge--reasoning) · [Semantic memory](#-semantic-memory)
- **Ecosystem** — [Plugins](#-plugins) · [Firmware generation](#-firmware-generation) · [Integrations](#-integrations) · [**Colony**](#-colony--plants-talking-to-plants) · [**Inheritance**](#-inheritance-between-plants) · [Federated learning](#-federated-learning)
- **[What worked last time](#-what-worked-last-time)** · **[System diagnosis](#-system-diagnosis)** · **[Looking at itself](#-looking-at-itself)** · [Maintenance](#-maintenance--the-health-of-the-instrument) · **[Learning it is wrong](#-learning-it-is-wrong)** · [Knowledge transfer](#-knowledge-transfer) · [Reading the electrome](#-reading-the-electrome)
- **[🫀 Internal states](#-internal-states--what-the-plant-is-doing)** — defence activation · internal water stress · accumulated load · stress memory · circadian integrity
- **[🖥 Dashboard](#-open-the-plant-in-a-browser)** · **[📇 Capability](#-what-a-plant-tells-the-others-it-has)** · **[🔦 Beacon mode](#-beacon-mode--talking-with-light)** · **[🛡 Security priming](#-security-priming--preparing-for-a-neighbours-threat)** · **[🚜 Navigation](#-moving-a-plant-without-being-clumsy)**
- **[Symbiosis](#symbiosis)** — [Fusion](#-multirate-fusion) · [Evidence](#-evidence) · [Safety](#-safety) · [Control](#-hierarchical-control) · [Personalization](#-personalization)
- **[🔬 Spectral](#-spectral-light-as-an-instrument)** — 🔵 blue reads hydration · 🔴 red reads photosynthesis · 🟢 green reads the lower canopy
- **[Hardware](#-hardware-autodetection)** · **[🦞 OpenClaw](#-openclaw-the-plants-brain)** — AI with no API key, and an agent that operates the plant
- [CLI](#-cli) · [Emoji scales](#-emoji-scales) · [Full API surface](#full-api-surface) · [Migrating from 1.x](#migrating-from-1x)

---

## The nineteen layers

| Layer | What it does | Why it matters |
| --- | --- | --- |
| 🌡 **Sensors** | Seven pluggable drivers behind one `read()` contract | Your hardware, or none at all |
| 🧬 **Signals** | Plant electrophysiology: action & variation potentials, circadian rhythm | The plant's own electrical voice |
| 🪞 **Self-reference** | Electrome fingerprint, internal clock, two-site coherence, VPD-aware blue | Judged against itself, not a population average |
| 🧬 **Inheritance** | Directed transfer of validated priors between individuals | A new plant starts with what the last one learned |
| 🗨 **Colony** | Conversation between plants, with 73 skills as the fast path | They talk to each other, and only about what they measure |
| 🔁 **Self-correction** | Prediction error, identity drift, decaying priors, response hysteresis | The system finds out when *it* is the thing that is wrong |
| 🔎 **Experience** | A ledger of what actually resolved each problem, against the base rate of doing nothing | It reuses what worked, without inventing what did not |
| 🩻 **Diagnosis** | One command that checks everything wired up and says what to fix | Know it works before walking away |
| 🩺 **Self-check** | Weekly and monthly reviews, plus a technical inspection of the instrument | It watches its own trajectory, and its own sensors |
| 👁 **Vision** | Classical phenotyping, ONNX models, PlantCV bridge | See wilting hours before you notice it |
| 💾 **Memory** | Persistent readings, care log, species profile | Advice builds on history, not a snapshot |
| 🧠 **Knowledge** | Ontology, forward-chaining reasoner, semantic recall | Conclusions you can audit, not just trust |
| 🤖 **AI** | Seven providers, structured output, offline fallback | Your model, your keys, your privacy |
| 🗣 **Voice** | Five first-person personas, emoji scales, ten languages | It talks to you, it doesn't report at you |
| 🦿 **Body** | Multirate fusion, reflexes, safety limits, personalization | Autonomy that cannot kill the plant — see [Symbiosis](#symbiosis) |
| 🔬 **Spectral** | 🔵🟢🔴 LED as a probe, not illumination | The plant is *interrogated*, not just listened to |
| 🫀 **Internal states** | Five qualitative estimates of what the plant is *doing*, not what surrounds it | The system stops seeing only sensor numbers |
| 🚜 **Navigation** | Constraints a robot stack cannot know, over a delegated ROS 2 planner | A pot is not a delivery robot |
| 🖥 **Dashboard** | The plant in a browser: vitals, states, and what has no sensor | All of the above, visible without writing code |

Every layer works alone. They compose.

## Requirements

**Node.js 18+ and nothing else.** `npm i smartplant` installs **zero dependencies** — the library imports nothing outside Node itself. `chalk` and `enquirer` are *optional* and only make the CLI prettier; without them it runs in plain text and says so. `serialport`, `mqtt` and `onnxruntime-node` are optional peers loaded on demand; Python and ffmpeg are needed only by the tiers that use them.

---

# Core

## 🌡 Sensors

| Driver | Needs | For |
| --- | --- | --- |
| `mock` | nothing | Trying it out — a simulated plant that dries out on a day/night cycle |
| `manual` | nothing | You measure with a €5 stick or a finger, and type it in |
| `serial` | `serialport` | Arduino / ESP32 over USB (CSV or JSON lines) |
| `mqtt` | `mqtt` | ESPHome, Tasmota, Zigbee2MQTT |
| `homeassistant` | a token | Any sensor you already expose in Home Assistant |
| `http` | nothing | Any device or service with a JSON endpoint |
| `electrode` | nothing (synthetic) or `serialport` | Plant biopotentials — see [Electrophysiology](#-electrophysiology) |

Ten recognized metrics: `temperature` · `humidity` · `soil` · `light` · `ph` · `conductivity` · `voltage` · `activity` · `co2` · `weight`.

Bring your own driver:

```js
import { SensorDriver } from 'smartplant'

class MyRig extends SensorDriver {
  static id = 'my-rig'

  async read() {
    // normalize() drops non-numeric values and stamps the timestamp
    return this.normalize( { soil : await readMyProbe(), ph : 6.4 } )
  }
}

plant.registerSensor( 'my-rig', MyRig )
await plant.attachSensor( 'my-rig' )
```

Several drivers can run at once; readings merge, with earlier drivers winning on conflicts. A failing sensor never costs you the others.

## 🤖 AI

| Provider | Key | Notes |
| --- | --- | --- |
| Gemini | `GEMINI_API_KEY` | |
| OpenAI | `OPENAI_API_KEY` | |
| Claude | `ANTHROPIC_API_KEY` | |
| Grok | `XAI_API_KEY` | |
| **Ollama** | none | Runs entirely on your machine — nothing leaves it |
| **OpenClaw** | none | A local Gateway supplies the model, the key *and* the embeddings — see [OpenClaw](#-openclaw-the-plants-brain) |
| **Mock** | none | Deterministic and offline, so the whole library is testable |

Retries with exponential backoff on transient failures, a response cache so ten plugins reacting to one sensor tick don't fire ten paid requests, and **structured output with schema coercion** — plugins receive objects with guaranteed keys, never prose to regex.

```js
const result = await plant.analyze( 'Does this plant need repotting?', {
  schema : { advice : '', urgency : 'low', potSizeCm : 0 },
} )
// result.advice, result.urgency and result.potSizeCm are always present
```

Register any other backend in three lines:

```js
plant.ai.registerProvider( 'my-llm', {
  generate : async ( { prompt, system } ) => callMyModel( system, prompt ),
} )
```

## 💾 Memory

```js
await plant.water( { amount : 200 } )
await plant.fertilize( { product : 'seaweed extract' } )
await plant.note( 'moved it next to the south window' )

plant.memory.daysSince( 'water' )   // 3
plant.memory.stats( 24 ).soil       // { n: 24, min: 41, max: 68, avg: 54.2, trend: -0.8 }
```

One readable JSON file you own, written atomically, with ring buffers so it never grows unbounded. A corrupt file is set aside rather than silently losing your history, and 1.x data migrates automatically.

```js
await plant.memory.forget()   // your data, your call
```

## 🗣 Voice

Five personas: `plant` (first person) · `botanist` (practical) · `poet` · `scientist` (data-first) · `child` (simple).

```js
plant.setPersona( 'poet' )
await plant.speak()
```

Ten languages: English, Español, Français, Deutsch, Italiano, Português, Nederlands, Русский, 中文, 日本語.

## ⚡ Events

The kernel turns readings into meaning, so your code reacts to conditions rather than polling numbers.

```js
plant.on( 'plant:thirsty', async e => {
  await openValve()
  await plant.water()
} )
```

`sensor:reading` · `sensor:error` · `plant:thirsty` · `plant:drowning` · `plant:too-hot` · `plant:too-cold` · `plant:too-dark` · `plant:too-bright` · `plant:stressed` · `plant:happy` · `plant:damaged` · `plant:spoke` · `vision:analysis` · `electro:analysis` · `spectral:sweep` · `alert` · `plugin:loaded` · `ai:request` · `ai:response` · `error`

Listeners may be async — `emit` awaits them. One listener throwing never stops the others or the monitoring loop, and an action taken inside a listener cannot feed back into the event that triggered it.

---

# Advanced

## 🧬 Electrophysiology

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

## 🪞 The plant on its own terms

Everything above compares the plant against a reference: a species profile, a wall clock, a table of healthy ranges. That is where most plant monitoring quietly goes wrong, because the reference is a population average and your plant is one individual, in one pot, in one room.

These four layers drop the reference and compare the plant against **itself**.

### 🧬 Electrome fingerprint — what is normal for *this* plant

A signature of the plant's baseline electrical state across several axes: complexity, entropy, variability, and the distribution of power across physiological bands. The library learns it over the first windows, then reports departures from it.

```js
const s = await plant.listen( { seconds : 600 } )

s.shift.verdict
// "Learning this plant's normal: 6/12 windows."
// then, later:
// "Signature has moved: complexity down 38%, band power shifted low.
//  This plant is not behaving like itself."

s.shift.delta[ 0 ]   // { axis: 'complexity', direction: 'down', weighted: 0.41 }
```

`plant:electrome-shift` fires when the signature genuinely moves.

Two design decisions carry most of the weight. The fingerprint is **DC-offset invariant** — an electrode drifting by 40 mV is a wiring fact, not a new plant, and must not read as one. And the baseline **refuses to judge before it has settled**: a "normal" derived from a single window is not a normal, so early calls say so rather than inventing a verdict.

### 🕐 Internal clock — what time it is *for the plant*

`circadianHealth` asks whether a rhythm exists. This asks the question that actually changes behaviour: where is the plant in its own day, and how far is that from the clock on the wall?

```js
s.clock
// { periodHours: 26.4, acrophaseHour: 15.2, subjectiveHour: 4.1,
//   offsetHours: 2.2, freeRunning: true, aligned: false,
//   verdict: 'Free-running at 26.4h rather than 24h. The plant is following its
//             internal clock because the light cycle is not strong or regular
//             enough to entrain it.' }

timingAdvice( s.clock, 'probe' )
// { good: false, betterInHours: 5.9,
//   reason: 'A stomatal probe at subjective night measures a plant that has
//            closed down. The response would read as "weak" for reasons that
//            have nothing to do with health.' }
```

A plant whose subjective dawn falls at 3pm is not "arrhythmic" — it is entrained to something you did not intend: a corridor light, a west-facing window, a lamp on a timer. Every decision made on wall time is landing at the wrong point in its day.

### 📡 Two-site coherence — is this the plant, or the electrode?

The electrode is the weakest link in the whole evidence chain. A dry contact or a callus forming produces a confident, well-shaped waveform that means nothing, and every layer downstream then reasons beautifully about an artefact.

Two electrodes fix what one never can, because plant signals **propagate** at speeds physiology constrains:

| Event | Speed | A 50 mm gap implies |
| --- | --- | --- |
| **Action potential** | 1–40 mm/s | 1.2 – 50 s |
| **Variation potential** | 0.5–5 mm/s | 10 – 100 s |
| **System potential** | 0.1–2 mm/s | 25 – 500 s |

```js
await plant.attachSensor( {
  driver : 'electrode', transport : 'synthetic',
  sites  : [ { id : 'stem', distanceMm : 50 } ],
} )

s.coherence.stem.verdict
// "Both electrodes saw the same event, 5.00s apart across 50mm. Implied speed
//  10.00mm/s is consistent with an action potential (1-40mm/s).
//  This is the plant, corroborated at two sites."
```

The failure modes are the point:

- **Zero delay is diagnostic.** Nothing biological reaches two separated points at the same instant — but mains pickup and ground loops do exactly that. A simultaneous event is rejected as interference, not accepted as a strong signal.
- **Overlapping speed ranges are reported honestly.** 2 mm/s fits all three event classes, so the library returns every candidate and names none. Claiming "variation potential" there would be false precision.
- **An ambiguous lag corroborates nothing.** A periodic signal correlates just as well at *lag* as at *lag + period*, so when rival peaks come close the result is flagged ambiguous and coherence is withheld — match discrete events instead.

That is corroboration grounded in physics rather than statistics, and it is very hard to fake.

### 🔵 VPD-aware blue — the same response, opposite meanings

Blue light opens stomata. So a strong blue response was read as a healthy, responsive plant. That reading is wrong roughly half the time, because it ignores the air.

**Vapour pressure deficit** — how hard the atmosphere is pulling water out of the leaf — is now computed from temperature and humidity and folded into every blue reading:

| Blue response | VPD | Soil | Reading |
| --- | --- | --- | --- |
| strong | high | dry | 🔴 **`demand_with_deficit`** — transpiring hard against a supply it does not have. This precedes sudden wilting. |
| strong | high | wet | **`high_demand`** — demand, not comfort |
| weak | low | — | **`no_demand`** — still humid air, not water stress |
| weak | high | — | **`closed_under_demand`** — refusing to open under strong pull is a clear ABA signal: stress |

```js
plant.context().vpd       // 2.14
plant.context().vpdBand   // 'severe'
```

The same closed stoma means "nothing to do" in still humid air and "the plant is defending itself" in dry air. Reading it without the atmosphere is how a monitoring system talks itself into watering a plant that is fine, or reassuring you about one that is not.

## 👁 Vision

Three tiers behind one API. Use whichever you have.

| Tier | Needs | Gives |
| --- | --- | --- |
| **Classical** | nothing | Vegetation index, canopy geometry, wilting, chlorosis/necrosis, growth deltas |
| **ONNX** | `onnxruntime-node` | YOLO-family detection & segmentation on the edge, no Python at inference |
| **Python bridge** | Python + your toolkit | PlantCV, Ultralytics, detectron2, mmdetection |

```js
await plant.useVision( { source : { source : 'ffmpeg', input : '/dev/video0' } } )

const seen = await plant.see()

seen.description
// "canopy covers 12.4% of frame, visual health 78/100, 9% yellowing, canopy density 0.61"

seen.change.findings
// [ 'canopy shrank 8.2%', 'canopy has dropped — possible wilting' ]
```

**ffmpeg is the universal input**: V4L2 webcams including the PS3 Eye, AVFoundation on macOS, DirectShow on Windows, RTSP IP cameras, MJPEG streams, or a plain video file — emitted as raw `rgb24`, so no image decoder is needed on our side and no native dependency enters the install.

The classical tier is deliberately first. A neural detector tells you *"leaf, 0.94"*. A vegetation index tells you the canopy lost 8% since Tuesday, and you can check the arithmetic. It measures Excess Green segmentation (brightness-invariant, so it tracks the plant and not the room lights), bounding box, centroid, density, aspect ratio, and the **vertical centroid** whose rise is wilting.

```js
import { PythonBridge } from 'smartplant/vision'

const bridge = new PythonBridge()
await bridge.ping()                          // which backends are installed
await bridge.plantcv( frame )                // skeleton, leaf count, convex hull, solidity
await bridge.yolo( frame, { model : 'yolov8n.pt' } )
await bridge.run( frame, myPythonScript )    // detectron2, custom torch, anything
```

One long-lived Python process, JSON over stdio — loading a YOLO model costs seconds, and per-call spawning would make continuous monitoring unusable.

## 🧠 Knowledge & reasoning

An LLM hallucinating that a Monstera wants full sun is a bug you cannot see. A rule with its evidence attached is one you can.

```js
const d = plant.diagnose()
console.log( d.explanation )
// drought stress (95% confidence)
//     · soil at 4%, below the ideal 35-70%
// spider mites (45% confidence)
//     · humidity 28% with temperature 24°C — conditions spider mites favour

d.treatments
// [ { treatment: 'water_thoroughly', for: 'drought_stress', confidence: 0.95 } ]
```

An **RDF-style triple store** with a 76-triple plant-care ontology, and an **11-rule forward-chaining reasoner** that reads sensors, vision and electrophysiology together. Every conclusion carries the observations that produced it.

**Treatment conflict resolution** — the system cannot advise you to water thoroughly *and* let the soil dry out in the same breath. That is how automated advice loses trust.

```js
plant.knowledge.diagnose( 'wilting' )
// → drought_stress (treat: water_thoroughly)
// → root_rot       (treat: repot_fresh_substrate, trim_affected_roots)
//   wilting is not always thirst
```

Add your own rules:

```js
plant.knowledge.reasoner.addRule( {
  id       : 'my-species-quirk',
  when     : ( facts, ctx ) => ctx.current.ph < 5,
  conclude : () => ( {
    conclusion : 'acidic_substrate',
    confidence : 0.8,
    because    : [ 'pH below 5' ],
  } ),
} )
```

## 🔍 Semantic memory

```js
await plant.remember( 'the radiator went on and the leaf tips browned' )

await plant.recall( 'the air is very dry' )
// [ { text: 'the radiator went on...', score: 0.71, at: '2026-01-14' } ]
```

A dependency-free hashing embedder and a flat index, so a plant on a Raspberry Pi has a memory without a vector database. Adapters for **Qdrant, Weaviate and Milvus** when the corpus outgrows it, and `ApiEmbedder` for a real embedding model.

**Every `analyze()` call is grounded with both layers**: the model receives the rule-derived findings and this plant's own precedents as premises, not just a snapshot. Disable per call with `{ ground : false }`, or the whole layer with `{ knowledge : false }`.

---

# Ecosystem

## 🔌 Plugins

Eleven official plugins, each installable on any plant:

```js
import watering from '@smartplant/watering'

await plant.use( watering )
const { advice, daysUntilWater } = await plant.plugin( 'watering' ).predictWatering()
```

| Plugin | Method | Also does locally, with no AI |
| --- | --- | --- |
| 💧 `@smartplant/watering` | `predictWatering()` | Reacts to `plant:thirsty` |
| ⚠️ `@smartplant/alerts` | `checkAlerts()` | Stays silent — and free — when nothing is wrong |
| 📈 `@smartplant/history` | `analyzeTrends()` | `stats()`, `series()`; reports "unknown" rather than inventing a trend |
| ☀️ `@smartplant/lighting` | `optimizeLight()` | `dailyLightHours()` |
| 💨 `@smartplant/ventilation` | `adjustVentilation()` | `vpd()` — vapour pressure deficit via the Tetens equation |
| 😟 `@smartplant/stress` | `detectStress()` | `chronicScore()` — fraction of 48h spent below comfort |
| 🐛 `@smartplant/pests` | `monitorPests()` | `identify( symptoms )`, logged to care history |
| 🌱 `@smartplant/fertilizer` | `guideFertilization()` | Errs toward underfeeding — burn is harder to undo than deficiency |
| 📔 `@smartplant/diary` | `logAndSummarize()` | The plant writes its own journal, stored in memory |
| 🔮 `@smartplant/simulator` | `simulateConditions()` | `score()`, `sweep()` — find where tolerance breaks, instantly |
| 🔬 `@smartplant/spectrum` | `diagnose()` | `probe()`, `treat()`, `doses()` — 🔵🟢🔴 interrogation with hard interlocks |
| 🧬 `@smartplant/migration` | `bequeath()` | `receive()`, `wouldSuit()`, `outcome()` — inheritance between plants of one species |
| 🗨 `@smartplant/colony` | `askPeer()` | `askAll()`, `report()`, `corroborate()` — a channel between plants a person can watch but not enter |

Writing your own takes one function:

```js
import { definePlugin } from 'smartplant'

export default definePlugin( {
  name    : 'repotting',
  persona : 'botanist',
  schema  : { advice : '', urgency : 'low' },

  on : {
    async 'plant:stressed'( event ) {
      console.log( await this.whenToRepot() )
    },
  },

  methods : {
    async whenToRepot( input = {} ) {
      return this.ask( 'Is this plant root-bound?', { extra : input } )
    },
  },
} )
```

Inside a plugin, `this.plant` is the kernel, `this.ask()` runs a context-injected structured AI call, and listeners detach automatically on `destroy()`.

## 🛠 Firmware generation

The hardest step is usually not the AI. It is getting a board to read a sensor and put the number somewhere useful.

```js
import { generateProject } from 'smartplant/firmware'

const files = generateProject( {
  target    : 'platformio',                        // or 'arduino' | 'esp-idf'
  sensors   : [ 'dht22', { type : 'capacitive_soil', pin : 34 } ],
  transport : 'mqtt',
  mqttHost  : '192.168.1.10',
} )
// { 'src/main.cpp': …, 'platformio.ini': …, 'README.md': … }
```

Complete compiling projects, with a wiring table and honest calibration notes. Seven sensors supported: **DHT22, DHT11, capacitive soil, BH1750, LDR, DS18B20, and plant electrodes** (with ADC oversampling to lift the tiny biopotential out of the noise floor).

The **ESP-IDF** target deep-sleeps between readings — microamps between samples is what makes a battery node last a season. The generated JSON payload is consumed directly by the matching SmartPlant driver, with no translation layer.

## 📡 Integrations

```js
import {
  InfluxExporter, HomeAssistantPublisher, generateFlow, prometheusMetrics,
} from 'smartplant/integrations'

new InfluxExporter( { bucket : 'plants' } ).attach( plant )   // time series (v1 & v2)
await new HomeAssistantPublisher().attach( plant )            // MQTT discovery, real entities
generateFlow( { plantName : 'Ivy' } )                        // importable Node-RED flow
prometheusMetrics( plant )                                    // Grafana, Alertmanager
```

**Home Assistant discovery** registers every metric as a proper entity under one device, with correct units and device classes, so it lands in dashboards, history and automations with no user configuration. Combined with the `homeassistant` sensor driver, the loop closes in both directions.

**Node-RED flow generation** emits a complete importable flow — MQTT inputs, threshold checks, gauges and an alert path — so a SmartPlant config becomes a working visual automation in one paste.

## 🔎 What worked last time

The library recorded that a problem happened, and recorded that something was done. It never joined them up — so every time a familiar problem came back, the system met it as though for the first time, with no access to the fact that this plant has been here four times before and one particular thing helped.

```js
await plant.whatWorkedBefore( 'plant:thirsty' )
```

Episodes open and close on their own from the condition events, and care given while a problem is open is attributed to it. Care given while nothing is wrong is deliberately **not** recorded as treatment: routine watering on a healthy plant cures nothing, and counting it is exactly how *"watering fixes everything"* gets learned.

### The control is the design, not an option

Almost every plant problem resolves on its own. Soil dries and gets watered on the usual schedule; a hot afternoon passes; a droop recovers overnight. Record "problem → I did X → problem went away" and you will learn with total confidence that X works. So will everything else you happened to do that week.

And because a ledger like this is used to *choose* the next action, **it confirms itself**. It recommends X, X gets credit again, X becomes doctrine. A resolution ledger without a control is a machine for manufacturing superstition, and it is worse than no ledger at all, because it is confident.

So every problem carries a **base rate**: how often, and how fast, it cleared when nothing was done. An action is credited only with what it achieved *above* that.

```
🚫  "water" cleared it 100% of the time against 100% for doing nothing — a
    difference of 0, which is inside the noise for 5 episodes. This plant has
    probably been recovering on its own.

✅  "water" resolved "thirsty" in 5 episodes where it was the only thing done —
    100% against 20% for waiting, and about 52h sooner.
```

Two more ways it would otherwise lie, both refused:

- **Everything at once.** Water, feed and move a plant on the same afternoon and no arithmetic recovers which one helped. Credit comes only from episodes where an action appeared alone; the rest are reported as unattributable, with *"change one thing at a time if you want this to learn."*
- **Tiny n.** A houseplant produces perhaps three or four episodes of a given problem in a year. Four are required before anything is claimed, and confidence is capped at 0.7 however many there are.


### The same problem is not the same problem

"Thirsty" in dry air at 31°C and "thirsty" in still humid air at 17°C share a name and very little else: different cause, different urgency, quite possibly a different fix. Pooling them produces an average treatment for a situation nobody is in.

So episodes carry the conditions they began in, and the lookup narrows to the ones that actually resemble now:

```
pooled, ignoring conditions   →  water works       (lift 0.5)
today it is hot and dry       →  water works       (lift 1.0)
today it is cool and humid    →  water adds nothing — it was recovering anyway
```

When too few past episodes match, the wider answer is given **with that fact attached** rather than silently — because "what works for this problem" and "what works for this problem in weather like today" are different questions.

### Asking the colony

A plant that has met a problem twice, next to a neighbour that has met it twenty times, should be able to ask.

```js
await plant.colony.askColonyWhatWorked( 'plant:thirsty' )
```

Three things separate this from a rumour mill:

- **Same species only.** What resolves drought in a succulent is not what resolves it in a fern, and a confident answer from the wrong species is worse than none.
- **The base rate travels with the answer.** *"Watering worked every time"* is not information. *"Watering worked every time, and it cleared on its own nine times in ten anyway"* is the same sentence meaning the opposite. Without the second half, a neighbour's routine gets adopted as a cure.
- **The room is one witness.** Neighbours are pooled into a single finding, never counted as independent replication — they share a window, a watering can and a human.

A neighbour's experience is capped at **0.45 confidence**, below anything this plant's own record can earn, and `whatWorkedBefore()` only reaches for it when the plant has nothing of its own to go on. It is another pot, in another spot: worth trying, not worth trusting over what happened here.

### Hysteresis finally does something

The library already measured whether a plant answers the same stimulus differently since a stress episode. It then did nothing with it — measured in one module, reported in another, never acted on. `doseModifier()` closes that loop, and the mapping is deliberately **asymmetric**:

| Response now | What happens |
| --- | --- |
| **stronger / faster** | Cut the dose to 60–75%. The amount that used to be right now overshoots. |
| **weaker / slower** | **Hold, and look.** Do *not* give more. |

That second row is the important one. A reduced response is at least as often damage as tolerance, and root rot answers a bigger drink by getting worse. The tempting move there is the harmful one, so the system refuses to make it and asks why the response fell instead.

## 🩻 System diagnosis

You have just wired a plant: a probe in the soil, maybe an electrode, a key in a file, a lamp on a relay. Everything *looks* connected. Before walking away for a month, one command tells you whether it is — and if not, which wire.

```bash
smartplant diagnose
```

```
System diagnosis

  🟢  sensor:serial    Connected, providing temperature, humidity, soil, light.
  🟢  reading          Read temperature 21.4, humidity 55.2, soil 38.1, light 820.
  🔴  electrode        The trace is flat (spread 0.00000mV). Living tissue is never
                       electrically silent — this electrode is not in contact with a plant.
  🟢  memory           Persisting to ./ivy.json (412 readings stored).
  🟡  ai               The mock provider returns canned text rather than reasoning.
  ⚪  vision           No camera. Visible symptoms will not be seen.

  3 working · 1 to look at · 1 broken · 1 not set up

  1 thing(s) are not working: electrode. Nothing downstream of them can be
  trusted until they are fixed.

What to change

  1. [electrode] A flat trace means the lead is not making contact with living
     tissue. Reseat the electrode against damp stem or leaf tissue and run this again.
  2. [ai] Fine for trying things out. For real answers, set a provider and key.
```

Also available as `plant.systemDiagnosis()`. It exits non-zero when something is broken, so it works in a startup script or a cron job.

Two rules decide whether a check like this is useful or just noise:

**Not configured is not broken.** ⚪ means you never asked for it. Telling somebody their vision system is down when they never wanted a camera is how people learn to ignore warnings. Only what you configured can fail.

**Every red line ends in something to do.** "Electrode: degraded" is a fact with no next step. The same fact with the walk to the windowsill included is a fix. Every 🔴 and 🟡 carries one, and a test enforces it.

It catches, among others: a probe reading values outside physical possibility (a wiring fault, not a plant in distress), a sensor that has latched onto one number, a lead not touching the plant, a sample rate too low to filter mains hum, memory that will vanish when the process ends, a provider that is configured but unreachable, a lamp with no electrode to record what it provokes, and a single electrode — which works, but can never tell a changing plant from a tiring contact.

### How it differs from the other two

| | Asks |
| --- | --- |
| 🩻 **`systemDiagnosis()`** | *Does any of this work yet?* — answerable on a plant with no history at all |
| 🩺 [`checkup()`](#-looking-at-itself) | *How has the plant been changing?* — needs weeks of readings |
| 🔧 [`maintenance()`](#-maintenance--the-health-of-the-instrument) | *Can the instrument still be believed?* — for a rig that has been running a while |

## 🩺 Looking at itself

Two reviews that run themselves. One asks how the plant has been changing; the other asks whether the things measuring it can still be believed. Neither is much use alone: a plant that looks stable through a stuck sensor is not stable, it is **unmeasured**.

```js
await plant.checkup( { period : 'weekly' } )   // or 'monthly'
await plant.maintenance()
await plant.runDueReviews()                     // whatever is due, nothing else
```

Both run from the monitoring loop, so a long-lived plant reviews itself without anyone remembering to ask.

### The comparison has to be fair

Everything else in the library lives in the present or a short window. Nothing ever sat down and compared this week with last week on purpose — and the changes worth catching are exactly the ones no single reading is remarkable enough to trigger.

But the naive version of that comparison is mostly a measurement of the calendar. Days lengthen, the heating comes on, the sun moves off the windowsill. **A checkup that reports "soil is down 8%" without noticing the room is four degrees warmer has found the weather and labelled it the plant.**

So every comparison carries what the conditions did over the same span, and a finding whose likely driver moved with it is marked confounded:

```
conditions moved: temperature, soil
wellbeing: 95.8 → 76.2

  ⚠️  confounded · wellbeing
     Wellbeing fell 19.6 points over the week, but temperature and soil moved
     too, which is enough to explain it.
```

The system is looking for what it **cannot** explain by the room, because those are the findings worth acting on. It also refuses to compare spans that are not comparable — a full week against three days would report the difference in sampling as a difference in the plant.

Reviews are narrated deterministically, with no model involved, so they work offline and cannot embellish: *"Looking back over the week, I am much as I was."*

## 🔧 Maintenance — the health of the instrument

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
| **Tiring contact** | Reuses the [continuity](#-continuity-and-the-electrode-problem) verdict rather than inventing a second opinion |
| **Driver failures** | Consecutive and proportional failure rates per driver |
| **Memory** | Readings out of chronological order break every window and trend computed from them |
| **Colony link** | Neighbours that were reachable and no longer are |
| **Body** | Safety limits refused repeatedly — the layer above keeps asking for what it cannot have |

Nothing is quietly discarded. A component judged unreliable is **marked** unreliable, its suggested evidence weight drops, and the reason is stated — because silently dropping a sensor is its own way of being wrong without saying so. Faults are filed as claims about the *instrument* (`instrument_unreliable`), so a conclusion can be discounted when the thing that produced it is broken.

## 🔁 Learning it is wrong

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

## 🎓 Knowledge transfer

A plant that has been in a room long enough to know it notices a newcomer that has not, and offers what it has learned about **this place**.

```js
await elder.colony.newcomers()      // who has not been here long
await elder.colony.teach( 'newcomer' ) // offer what the room does
await newcomer.colony.learnFromColony()
```

This replaced an earlier idea — succession, where a plant's knowledge is distributed when it dies. That framing had a fatal flaw: **the trigger is undecidable.** A dormant plant, a dead plant and a disconnected electrode look very similar electrically, and a false positive means distributing the estate of a plant that is merely asleep. "Has little local experience" is directly measurable, and being wrong about it is harmless — teach a plant that already knew, and its own evidence outweighs the lesson anyway.

What transfers is **knowledge of the room** (ranges, cadence, rhythm), not learned action policies, which are about the individual and its pot.

And several teachers become **one** lesson:

```
'3 neighbours contributed, but they share a room and are not independent
 witnesses to it. Merged into one lesson (agreement 0.934) rather than
 counted 3 times.'
```

## 🧪 Reading the electrome

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

## 🫀 Internal states — what the plant is *doing*

Every other layer here reads the environment and reasons about it. These read the **plant**: five qualitative estimates of physiological state, each built only from measured signals, each carrying the evidence that raised it.

```js
const states = plant.states()
// {
//   defense_activation    : { level: 'high',    confidence: 'high',   acts: true,  … },
//   water_stress_internal : { level: 'high',    confidence: 'medium', acts: true,  … },
//   stress_load           : { level: 'medium',  confidence: 'medium', acts: true,  … },
//   stress_memory         : { level: 'unknown', confidence: 'low',    acts: false, … },
//   circadian_integrity   : { level: 'low',     confidence: 'medium', acts: false, … },
// }
```

### The rule that decided what exists

**A state is only worth creating if it changes a decision.** Not if it is interesting, not if it sounds sophisticated. If the system would behave identically with and without it, it is decoration — and decoration in a system people trust with a living thing is worse than nothing, because it buys credibility it did not earn.

So every state declares a `decides` field naming what changes, and **a test fails if one ships without it**.

### Confidence is not an annotation. It bites.

Low confidence does not merely label a state — it removes its authority:

```js
state.acts   // false whenever confidence is low, the level is unknown, or the level is low
```

Every gate in this library checks `acts`, never `level`. A weak signal can inform a person; it cannot change what the system does.

### The five

| State | Anchored in | What it decides |
| --- | --- | --- |
| `defense_activation` | Variation potentials, electrome shift, visible damage, logged wounding | Elective actions — probes, experiments, aid, relocation |
| `water_stress_internal` | Disagreement between the soil probe and the plant | Whether watering happens |
| `stress_load` | Event rate, physiology-attributed drift, repeated episodes | Intervention size |
| `stress_memory` | Measured hysteresis either side of an episode | Which response profile to predict from |
| `circadian_integrity` | Electrome rhythm against the light cycle | Whether the system trusts its own timing advice |

### 🛡 Defence activation — and what it refuses to claim

Wound a plant and a well-described cascade follows: a variation potential spreads from the damage, jasmonic acid accumulates, methyl jasmonate goes volatile, and neighbours taking it up through their stomata raise their own defences before anything has touched them.

**This does not measure methyl jasmonate.** That needs mass spectrometry; this library has an electrode, a camera and some environmental sensors. Any number presented here as a hormone concentration would be invented.

What *is* available is the electrical half of the same cascade — and the distinction is not pedantry:

> `"MeJA is high"` is a claim about chemistry that would be false.
> `"This plant is behaving as if it has been wounded, and the weather does not explain it"` is a claim the instruments support.

Two rules carry the weight.

**Absent is not low.** The variation potential is the primary evidence. Without an electrode, a plant being eaten right now looks identical to a calm one — so a missing instrument returns `unknown`, and `low` is returned *only* when the thing that would have shown activation was watching and saw none.

**The negative control can lower the answer**, and it is the only thing here that can. Cold shock, a light change and a knock all produce variation potentials, so a system that counted them would spend its life announcing attacks on a plant nobody has touched:

| Evidence | Room | Result |
| --- | --- | --- |
| VP + electrome shift | steady | `medium` |
| VP + electrome shift | temperature dropped 6 °C | **`low`** ← lowered from medium |
| VP + electrome shift + visible chewing | temperature dropped 6 °C | `high` — a draught does not chew holes in a leaf |

Level and confidence move independently. Two electrical signals are **one instrument agreeing with itself** and cannot reach `high` alone; that needs a second modality.

`posture()` is deliberately about *restraint* rather than action — there is nothing useful to do to a plant mounting a defence, and the value is in not adding to it:

```js
await plant.interrogate()
// { refused: true, defense: 'high',
//   why: 'Not probing. Estimated activation of the defence pathway (jasmonate
//         signalling likely): high. … Pass { force: true } to override, which is
//         reasonable if you need the reading more than the plant needs to be
//         left alone.' }
```

A defending plant also will not be volunteered to help a neighbour. Ordinary care continues throughout.

### 💧 Internal water stress — when watering is the wrong answer

The soil probe answers a question about **the pot**. Whether the plant is getting water is a different question, and the two come apart in exactly the cases that matter most: rotted roots cannot drink from wet soil, a root-bound plant runs dry hours after the probe says it is fine, and a plant in high VPD loses water faster than roots can supply it however wet the pot.

Every one of those looks like thirst. None is fixed by watering. The worst is made **worse** by it.

```js
await plant.water()
// { refused: true, state: 'water_stress_internal', level: 'high',
//   evidence: [ { signal: 'soil', detail: 'Soil is at 85, which is not short of water.' },
//               { signal: 'stomatal-closure', … },
//               { signal: 'electrome-shift', … } ],
//   why: 'The pot is wet and the plant is behaving as though it is not getting
//         water. … Pass { force: true } to water anyway.' }
```

It fires **only on disagreement**. Soil dry and plant stressed is ordinary thirst — agreement is not a state, it is a reading. And one plant-side signal is not enough to withhold water: the state exists, and `acts` is false.

### 🪫 Accumulated load — and the drift that does not count

A single episode is an event. Several in a row, without the plant returning to its own baseline between them, is a different situation: the capacity to absorb the next one is lower.

The important refusal is in the middle. Baseline drift is the most common artefact in plant electrophysiology — an electrode dries out or loses contact and produces a slow wander that looks exactly like a plant declining. So drift counts **only** when the [continuity tracker](#-continuity-and-the-electrode-problem) attributed it to physiology across multiple sites:

```js
{ signal : 'drift-discounted',
  detail : 'Baseline drift was found and attributed to electrode, so it is not
            counted as accumulated stress. An ageing electrode produces exactly
            this pattern and it is not a fact about the plant.' }
```

Discounted out loud, not silently dropped. High load scales interventions to `0.6` rather than blocking them.

### 🧠 Stress memory — capped at medium forever

Delegated entirely to [`hysteresis()`](#-hysteresis--does-the-same-question-still-get-the-same-answer), which already refuses on mismatched conditions. It can never exceed `medium`, and the reason travels *with* the state instead of being left behind:

> A plant is older and larger at the second measurement than the first. Growth changes the response too, and no reading in this record can separate that from memory.

A negative result is reported as a real finding, not an absence of one — the old response profile can still be trusted.

### 🕐 Circadian integrity — the useful inversion

Everywhere else in this library a degraded signal means the plant needs attention. Here it *also* means **the system should trust itself less**.

Timing advice ("wait four hours, the plant is in its rest phase") is derived from the rhythm estimate. When the rhythm is weak, that advice is noise presented as insight — so `goodMoment()` declines to give an opinion rather than handing back a confident hour from a clock that is not keeping one:

```js
await plant.goodMoment( 'probe' )
// { good: true, trusted: false,
//   reason: 'No timing opinion offered. The rhythm has weakened to 0.15. …
//            Proceeding on the caller's schedule rather than on a clock that is
//            not keeping one.' }
```

It also separates two very different problems: a **weak** rhythm is the plant, a **strong but off-period** one is the timer. One is fixed by hardware nobody has to worry about; the other is not.

### What is deliberately absent

Abscisic acid, ethylene, salicylic acid, cytokinins. All real, all central to plant physiology, **none anchored to anything this library measures**. Estimating them would mean inventing the link, and an invented link is precisely the failure these rules exist to prevent.

## 🗨 Colony — plants talking to plants

A conversation channel between plants over a network socket, an in-process bus, or any transport you implement. Two plants on the same colony can simply talk: one asks, the other answers in its own voice, from its own readings.

```js
import { LoopbackBus, ColonyServer, ColonyClient } from 'smartplant/colony'

// Same process — two plants on one Raspberry Pi.
const bus = new LoopbackBus()
await ivy.joinColony( { transport : bus.endpoint( 'ivy' ) } )
await hazel.joinColony( { transport : bus.endpoint( 'hazel' ) } )

// Different machines — plain TCP, no broker, no dependencies.
const server = new ColonyServer( { id : 'ivy' } )           // binds loopback by default
await ivy.joinColony( { transport : server } )
await hazel.joinColony( { transport : new ColonyClient( { id : 'hazel', port : server.port } ) } )

// `report()` takes no message: Ivy says how Ivy is, from Ivy's own readings.
await ivy.colony.report( { to : 'hazel' } )
```

### The channel is closed to people

A human can watch every line — `transcript()` returns a copy, and each exchange raises `colony:message` — but **there is no way to write into it**. No method takes a sentence from a person and sends it as a plant. What a plant says is composed from its own readings.

```js
ivy.on( 'colony:message', line => console.log( line.from, '→', line.to, line.text ) )
```

That is also why nothing here has a **persona**. Personas are the register a plant uses to address its owner — poet, botanist, child — and `speak()` is the human-facing channel, raising `plant:spoke`, which means *the plant said something to you*. A plant answering another plant is not doing that. Routing colony talk through it would file plant-to-plant speech as speech to the owner, and dress it in a voice chosen for a human reader.

**Skills are the fast path.** Instead of asking in prose and waiting for a model, a plant fires a named request and gets the fact straight back:

```js
await ivy.colony.ask( 'hazel', 'sense.vpd-perception' )
// { ok: true, says: 'My air is this dry — is anyone else feeling this pull?',
//   data: { vpd: 0.944, band: 'comfortable' } }
```

**73 skills in seven families**, and the catalogue is open — `registerSkill()` adds your own.

| Family | What it is for |
| --- | --- |
| `sense.*` | What I am feeling right now — light, VPD, electrical spikes, spectral quality |
| `state.*` | How I am — turgor, stomata, photosynthetic rate, salinity |
| `canopy.*` | Space, shade, growth direction, crown shyness |
| `health.*` | Pests, wounds, recovery, checking on a quiet neighbour |
| `rhythm.*` | Internal clock, sleep phase, stomatal orchestration, seasonal shift |
| `rhizo.*` | The conversation underground — mycelium, exudates, root territory |
| `consensus.*` | The colony talking about itself — identity, presence, trust, topology |

### A plant only says what it can measure

This is the rule the layer rests on, and it is the same one the [spectral contraindications](#safety-the-interlocks) use: **missing data blocks, it does not permit.**

Each plant's vocabulary is derived from the drivers actually attached to it. A plant with no electrode does not say `sense.electrome-spike` quietly or with low confidence — the skill is not in its vocabulary, and the request comes back refused:

```
Ivy → Hazel  asks for an electrical spike
Hazel → Ivy  "I have no electrode sensor, so I cannot tell you that."

Ivy → Hazel  asks about the mycelial network
Hazel → Ivy  "I have no mycorrhizal-probe sensor, so I cannot tell you that."
```

The refusal is itself an answer: the asker learns what this neighbour is blind to. And the vocabulary grows on its own when hardware appears — attach an electrode and three more skills become speakable.

Skills nothing in the framework can measure yet (all of `rhizo.*`, CO₂, UV, sap flow, VOC emission) are **declared and mute**, with the reason stated. The vocabulary is complete and the silence is explained, rather than the gap being hidden or filled in later with invention.

### A room is one witness, not five

Plants in a room share a window, a radiator, a watering can and a human. Their observations are strongly correlated, so they are **not** independent sources.

The [evidence ledger](#-evidence) combines cues with noisy-OR and counts distinct sources toward its corroboration threshold. Registering five neighbours as five sources would let one observation, counted five times, walk a high-risk action straight through that gate. So everything heard enters under the single source `colony`, with its strength set by how much the neighbours agree — and saturating, because the fortieth plant on the shelf adds nothing the second did not:

```js
ColonyMember.cuesFrom( answers, 'air_too_dry' )
// [ { claim: 'air_too_dry', source: 'colony', strength: 0.35,
//     detail: '2 neighbours agree, but they share a room — counted once, not 2 times' } ]
```

### 🤝 Doing something, not just saying something

Everything above is talk. This is the layer where a plant on wheels moves aside so a neighbour gets the window, or stands between it and a draught.

It is also the layer with the most ways to do harm, so most of the code is refusal.

**Light turned out to be the least representative kind of help** — it is the only one that *accumulates*. Shade, shelter, warmth and getting out of the way deliver no total at all; they hold a condition for as long as it is needed. A session that counted "lux-seconds of shade" would stop at an arbitrary moment having learned nothing.

So each kind declares what it changes and how:

| Aid | Metric | Mode | Direction |
| --- | --- | --- | --- |
| `light` | light | **accumulate** | ↑ |
| `shade` | light | sustain | ↓ |
| `move-aside` / `yield-spot` | light | sustain | ↑ |
| `warmth` | temperature | sustain | ↑ |
| `shelter` / `windbreak` | airflow | sustain | ↓ |
| `huddle` | humidity | sustain | ↑ |

The session integrates only in accumulate mode; in sustain mode it tracks presence and duration, and **drops the held clock when the effect lapses** rather than keeping credit for it.

### The check that generalises furthest

A plant being helped **has its own sensors**. So the helper's claim is never taken on trust:

```js
const session = await plant.colony.openAidSession( 'willow', { kind: AID.SHADE } )
await plant.colony.streamAid( session.id )
// { stop: true, because: 'no-delivery',
//   why: "The helper reports acting and this plant's light has not moved down in
//         25s. Whatever is being done is not reaching this plant — wrong position,
//         something in between, or it never started. Stopping: a session that
//         delivers nothing is worse than none, because it looks like help." }
```

An earlier version of this booked light in a ledger so a shared dose could not be delivered twice. That was the wrong shape: bookkeeping was a workaround for a measurement that was available all along.

### Approaching is how disease travels

Mites walk. Spores fall. Every form of aid involving proximity is also the transmission route, so it is gated hardest — in **both** directions, because either plant can be the source. And "no sign" is not "clear": a plant with no camera cannot rule out an infestation it has no way to see. Unknown blocks.

## 🫧 Two plants close together stop being two plants

The aid layer *creates* proximity, and then said nothing about it. A plant that rolls over to shelter a neighbour has also raised the humidity in the gap, cut the other's red:far-red, and started drawing on the same CO₂.

Within 0.4 m, boundary layers overlap and the pair becomes one coupled system with two sets of instruments in it.

```js
const state = await plant.colony.coupling(
  { reading: neighbour, metres: 0.25 },
  roomSensor,  // ← the part that matters
)
```

### Some of it helps and some of it costs

In still, dry, warm air the pairing is genuinely good for both: shared transpiration lifts humidity in the gap, VPD falls, stomata stay open longer, and evaporative cooling is shared. It is why grouped houseplants do better than scattered ones.

In **stagnant** air at peak light it inverts. Two plants photosynthesising into air nobody is stirring pull the local CO₂ down faster than it is replaced, and both fix less than either would alone.

Same arrangement, opposite sign, decided by airflow. So proximity is never scored as good or bad here — only against the conditions, and not at all when the conditions are not instrumented. The conclusion is never "separate them":

> *Being this close is measurably costing these two: co2-depletion. That is not an argument for separating them on its own — it is an argument for moving the air.*

### The reference problem

Most of the care in this module went here. **Two neighbours both reading 68% humidity is not evidence of a shared humid pocket.** It is equally consistent with a humid room.

To claim the pocket exists you need a reading from *outside* it. Without one, every benefit returns `observed: null` — unverifiable, not absent:

```js
// no room sensor
{ observed: null,
  why: 'Both plants can be read, but there is no reading from outside the pair.
        Two plants reporting the same humidity is exactly what a humid room looks
        like…' }
```

And the whole-picture verdict distinguishes the two cases that are easy to confuse:

> *Nothing about this pairing is measurable with what is instrumented. 5 effects could not be assessed, **which is not the same as the pairing doing nothing**.*

### 🫂 Huddling — the only aid where nobody spends anything

Every other kind has a giver and a receiver. Standing close enough to share a humid pocket is not like that: the humidity each adds is breathed by both. It is also the only kind that can leave **both** worse off, so it is the only one gated on conditions rather than on plants:

```
MIDDAY, STILL AIR : Not now. Airflow is 0.04 m/s and light is 15000 […]
                    the arrangement is fine, the timing is not.
AFTER DARK        : Able to offer huddle.
```

One deliberate exception to this library's usual doctrine: **unknown airflow does not block.** Everywhere else a missing reading hides a hazard; here it hides a mild, reversible inefficiency fixed by opening a window, and refusing every huddle in rooms without an anemometer would refuse nearly all of them. It is flagged, not blocked.

### 🚨 Priming — and what it honestly is

Plants really do prime each other with volatiles: methyl jasmonate from a plant under attack, taken up through a neighbour's stomata, raising its defences before anything touches it. It is well established.

**Nothing here can smell it.** That needs gas chromatography, not a DHT22. So the colony channel carries the warning instead — labelled a substitute, never dressed as the real thing:

```js
await sick.colony.warnNeighbours( { near: { willow: 0.25 } } )
// well.colony.primed
// { prime: true, inspectWithin: 6, from: 'ivy',
//   why: 'Raising inspection to within 6h. Nothing has been found on this plant —
//         that is the point of priming, and it is why the response is to look
//         sooner rather than to treat. Treating on a neighbour's finding would be
//         dosing a plant for a problem it may not have.' }
```

It goes out on **suspicion**, not confirmation — the opposite of how the rest of this library treats uncertain findings. The asymmetry is deliberate: a false alarm costs a few unnecessary inspections; a missed one costs a room. And a plant with no camera will not warn anyone about something it cannot see, because a warning it cannot substantiate trains everyone to ignore the next one.

### The shared pot

Allelopathy and mycorrhizal transfer are real, need a shared substrate, and are invisible to every sensor here — so they appear only as configuration-time notes, never as a runtime claim. The one consequence of a shared pot that *is* measurable:

> One soil probe now speaks for two root systems drawing on it at different rates, and watering to one plant's reading waters both.

## 🖥 Open the plant in a browser

```js
const server = await plant.serve()
// open http://127.0.0.1:7777
```

No build step, no framework, and nothing fetched from anywhere — one file of HTML with the styles and script inline, served from `node:http`. Most of these run on a Raspberry Pi with no internet connection, and a CDN link would make the page blank exactly when the network is the thing that broke.

It is a **terminal**, not a dashboard: three regions pinned to the viewport, nothing scrolls the page. A short banner with the logo, plant name and address; a console down the left; the instrument inventory down the right.

### Why the vitals are a console

A panel of gauges that overwrites itself shows you the present and destroys the past. You cannot tell a plant that has been at 5% humidity for an hour from one that dropped there a minute ago — and that difference is most of what matters. So the vitals line is **appended once a minute** and the previous lines stay:

```
19:51:53  smartplant · read-only monitor
19:52:00  😐 53% | Temperature: 🌡️ 19.9°C | Humidity: 🏜️ 5.3% | Soil: 🏜️ 0% | Light: 🌑 9lux
19:53:00  😐 51% | Temperature: 🌡️ 20.1°C | Humidity: 🏜️ 5.1% | Soil: 🏜️ 0% | Light: 🌑 11lux
```

The right column is the inventory and it deliberately never moves — a list that flickers invites you to watch it, and there is nothing there to watch.

| Route | |
| --- | --- |
| `/` | The page |
| `/vitals.json` | The same thing as JSON — add `?deep` for the full system diagnosis |
| `/live` | Server-sent events, pushed every few seconds |
| `/health` | Is it up |

### The gaps are the content

A dashboard with four handsome gauges and no mention of the electrode that is not connected is lying by omission, and it is the exact opposite of how the rest of this library behaves. So `unknown` is a first-class value, `missing` is a top-level section, and a metric with no sensor is drawn greyed with its reason rather than left out:

```
  conductivity          —   no sensor
  humidity           44.1   ok
  light                 0   low
  ph                    —   no sensor
  soil               32.9   ok
  temperature        20.1   ok

2 metrics have no sensor. They are listed rather than hidden because a screen
showing only what is measured cannot be told apart from a plant with nothing wrong.
```

A person should be able to tell at a glance the difference between *"this plant is fine"* and *"nothing here can see whether this plant is fine"*. On most dashboards those look identical, and they are not remotely the same situation.

Internal states carry their `acts` flag through to the screen, so a state that is **not allowed to change anything** — because its evidence is too weak — does not look like one that is.

### Loopback, and read-only

The colony server binds to `127.0.0.1` unless told otherwise, and this does the same for a stronger reason. A colony port carries plant chatter; **this port carries a live feed of somebody's home** — when the lights go on, when the temperature drops because a window opened, and in the clearest possible terms whether anyone is in.

```js
await plant.serve( { host: '0.0.0.0' } )
// warnings: [ 'Listening on 0.0.0.0 rather than loopback. […] There is no
//   authentication here, because adding a password field would suggest this was
//   built to be exposed. If this is deliberate, it is fine; if it was copied
//   from an example, change it back.' ]
```

And it answers nothing but `GET`:

```json
{ "error": "read-only",
  "why": "This server only answers GET. Watering, probing and moving stay in code
          where the safety layers already gate them, and no HTTP verb reaches
          them. A page that can water a plant is a page where a stray request
          waters a plant." }
```

There is no `allowActions` option. Adding one later would be a deliberate act with its own authentication story, not a flag.

Two smaller things that matter more than they look: a **staleness banner** appears the moment the event stream drops, because a dashboard that keeps showing the last numbers after the connection dies is the most misleading thing it can do — the plant may have been dark for hours. And `destroy()` closes the server, so a dashboard is never left holding a port after the plant it describes has gone.

## 📇 What a plant tells the others it has

Until now a plant learned what a neighbour could do by asking and being refused. That works — the skill layer already answers *"I have no electrode"* rather than inventing a number — but every capability was discovered by a failed request, and no plant could **plan** around another's hardware.

On joining, a plant now publishes a manifest:

```js
plant.colony.manifest
// { id: 'ivy', species: 'Ficus', metrics: [ 'humidity', 'light', 'soil', 'temperature' ],
//   faculties: [ 'see', 'electrode', 'spectral' ], photodiodeHz: null, declared: true }

plant.colony.whoCanRead( 'airflow' )
// { who: [], why: 'No neighbour reads airflow. A silence about airflow from this
//   colony means the instrument is missing, not that the value is steady — which
//   are entirely different facts.' }
```

That last distinction is the point. It is also what makes optical signalling possible at all, and what lets a colony with one camera route every pest question to the plant that can see instead of collecting five refusals.

**It is a claim, not a measurement.** A plant saying it has a camera is self-reported and nothing verifies it; a stale manifest keeps asserting hardware that was unplugged an hour ago. So capability is **permission to ask**, never a promise of an answer, and every consumer still handles the refusal it was trying to avoid.

## 🔦 Beacon mode — talking with light

The spectral module drives LEDs *at* a plant to measure what comes back. The same hardware switches fast enough to carry data, which turns a diagnostic instrument into a transmitter: on-off keying in amber, decoded by a neighbour's photodiode.

### The energy argument, stated correctly

It is tempting to say an LED pulse costs a hundredth of a radio packet. **It does not.** A BLE advertisement is one of the cheapest things a battery-powered device can do, and per bit delivered, blinking an LED is *worse*.

The real argument is narrower and it holds:

- Keeping a **Wi-Fi association** alive is expensive in a way an advertisement is not, and a node with minutes of charge cannot afford to associate.
- A radio that has **failed** transmits nothing at any price.
- In darkness the optical channel gets an enormous SNR for free.

So this is a fallback and a night channel — not a better radio.

| System state | Main channel | Optical | Why |
| --- | --- | --- | --- |
| Daylight, healthy | Wi-Fi / BLE / TCP | **off** | Radio is faster, cheaper per bit, and puts no light on a neighbour |
| Charge < 5%, or radio failed | *radios down* | **critical** | Not dying silently |
| Dark, healthy | *radio idle* | **quiet** | Same message, fewer and dimmer pulses |

### The half everyone forgets

An ambient light sensor integrates over hundreds of milliseconds and reports about once a second — correct for daylight, hopeless for anything modulated. Sampling at 1 Hz cannot recover a signal switching faster than 0.5 Hz, and no cleverness at the sending end changes that.

**So nothing transmits until a neighbour has declared a photodiode fast enough to decode it:**

```js
plant.colony.canSignal( 'fern' )
// { can: false, reason: 'slow-receiver',
//   why: '"fern" reads light with an ambient light sensor, which is far too slow
//         to decode a pulsed message. […] This link needs a photodiode on a fast
//         ADC at 1000 Hz or better on the receiving side.' }
```

A plant spending its last charge blinking at a lux sensor has not called for help. It has thrown the charge away and, worse, believes it was heard.

Amber at 590 nm is the carrier for the same reason it is the spectral **control** channel — minimal perturbation. Green at 530 nm is the fallback for a sender buried in a canopy, because green penetrates leaf tissue instead of being absorbed at the surface. And a message is still light landing on a plant, so **every transmission is booked against the receiver's dose ledger** like any other emission.

## 🛡 Security priming — preparing for a neighbour's threat

Priming is well established: expose a plant to a low dose of a stress, or to a neighbour's alarm, and it does not mount a defence — it becomes *ready* to. Defence transcripts sit poised, and when the attack arrives the response is faster and larger. The plant pays very little until the threat is real.

The colony channel already carries the warning. This is what a warned plant can **do** with it.

### Three things it deliberately does not do

**It does not lower red:far-red.** The instinct is that low R:FR signals threat and should push toward defence. It is precisely backwards — inactivating phytochrome B *suppresses* jasmonate and salicylate responsiveness. It is the canonical growth-defence trade-off: a plant that believes it is being shaded out spends on stem elongation and **disinvests from defence**. Pairing a UV-B pulse with low R:FR would induce defence with one hand and switch it off with the other. Here R:FR is held **high**.

**It does not drive the electrode.** That micro-currents alter membrane potential is real. That there is a dosable, reproducible protocol for closing stomata to a chosen percentage with 0.5–2 µA is not, and a system that injects current into living tissue on the strength of a plausible mechanism has stopped being an instrument. The electrode stays a **witness** — it reports whether the priming is landing.

**It does not accept a warning from anywhere.** A pest outbreak two thousand kilometres away, on the same species, says almost nothing about this room — and a global alert ring would contradict this library's own doctrine on transferability. Proximity is the whole signal, because the thing being warned about physically travels.

| Ring | Range | Weight | Why |
| --- | --- | --- | --- |
| contact | ≤ 0.4 m | 1.0 | Mites walk this; there is no gap to cross |
| room | ≤ 8 m | 0.6 | Same air, same watering can, same hands |
| building | ≤ 60 m | 0.25 | Worth knowing, not worth spending on alone |
| beyond | — | **0** | *"A pest on the same species in another city is a fact about that city."* |

Multiplied by host relevance: same species `×1`, same archetype `×0.5`, unrelated `×0.25` — discounted, not dismissed, because a spider mite eats almost anything.

### Priming is a cost, so it can be refused

```js
considerAlert( plant, alert )
// { prime: false, blocked: 'stress_load',
//   why: '… Priming costs a plant real resources — phenolics and flavonoids are
//         built out of carbon that would otherwise be growth — and asking that of
//         a plant already running on reduced capacity trades a possible threat
//         for a certain cost. Watching instead.' }
```

### The protocol, ordered by cost

`airflow → uvb → watch → stand-down`

**Airflow** runs first and always: it breaks the leaf boundary layer, drier surfaces are worse for spore germination, and it costs the plant almost nothing.

**UV-B** is real — it activates UVR8, driving phenolics and flavonoids that toughen leaf tissue, and it is used commercially in glasshouses. It is also the most dangerous thing this library can emit, so it is **off by default** and passes five interlocks:

| Interlock | Refusal |
| --- | --- |
| Not enabled per-installation | It can injure the person in the room, so it is opt-in, never inherited |
| Fixture has no UV-B channel | Nothing in the visible spectrum substitutes — UVR8 does not absorb it |
| **Room is occupied** | Burns skin and eyes, and a plant on a shelf is at eye height |
| Alert weight < 0.5 | The strongest intervention is held for a close, host-relevant threat |
| 90 s/day cap | *"cannot be raised by a caller"* — the response **is** a response to DNA damage |

**Stand-down is mandatory** after six hours unless the warning is renewed. A primed state nobody stands down is the growth-defence trade-off paid forever for a threat that passed.

## 🚜 Moving a plant without being clumsy

### What this is not

It is **not** a SLAM implementation, path planner or costmap. ROS 2 and Nav2 have spent a decade on those and do them properly; a version written here would be worse in every way that matters while looking, from the outside, like it worked — the most dangerous kind of code to put underneath a pot.

So mapping, localisation and planning are delegated behind a three-method `Surveyor` contract, with a `ros2Surveyor()` adapter. The **base implementation knows nothing on purpose**, so a plant with no navigation stack refuses to move rather than moving badly.

### What a robot stack does not know about a plant

```js
canCross( { heightM: 2, baseM: 0.35, wheelbaseM: 0.4 }, { stepM: 0.04 } )
// { safe: false,
//   why: 'Refused. 2m tall on a 0.35m base tips at 10° and this imposes 6°.
//         A delivery robot would cross this without noticing; it is a tipping
//         moment for a plant with its mass this high.' }
```

```js
worthMoving( here, brightWindowsill, { metric: 'light' } )
// { better: false, gain: 8600,
//   why: 'light improves by 8600.0, and temperature moves 21 → 14, airflow moves
//         0.1 → 0.9. That is a trade rather than an improvement, and it is the
//         trade that makes "move toward the light" dangerous — the brightest spot
//         in a flat is very often the coldest and draughtiest one.' }
```

`planMove()` runs every check in the order that fails cheapest first, and each refusal is one only this library can make:

| Refusal | Because |
| --- | --- |
| `defending` | An [internal state](#-internal-states--what-the-plant-is-doing) says the plant is already spending on something |
| `biotic` | The destination puts it beside an infested neighbour — and a plant that cannot see cannot clear itself |
| `tipping` | Geometry. Undeclared height and base **refuses**: *"two numbers with a tape measure"* |
| `charge` | The **round trip**, not the trip — a plant that arrives stranded cannot get back |
| `worse-destination` | Nobody measured it, or the gain costs more than it gives |
| `no-map` | *"Everything above was checked and passed; only the navigation is missing."* |

## 🧬 Inheritance between plants

[Federated learning](#-federated-learning) pools statistics from many homes into an anonymous species profile. This is the other shape of the same idea: a **directed transfer from one mature plant to one new one**, rich and contextual, where the source is known and the receiver keeps its own identity.

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

## 🤝 Federated learning

```js
import { computeLocalUpdate, FederatedRegistry, applyProfile } from 'smartplant/federated'

registry.submit( computeLocalUpdate( plant ) )   // statistics only, never readings
registry.profile( 'Monstera deliciosa' )         // published once 3+ contributors exist
```

The useful thing to learn across many plants is what a species actually wants — the ranges that produced *healthy* plants, not what a model guessed once. But sensor histories reveal when a home is occupied, and nobody should have to upload them.

So only **percentile summaries and a sample count** leave the device, aggregated by weighted averaging (FedAvg). Raw histories never move. The registry **rejects any update carrying them**, and a test asserts it.

Community profiles are **blended** into local ranges, not substituted for them: an average is evidence, not authority, and a plant in an unusual spot should not be dragged to the mean.

---

# Symbiosis

Everything above works on a windowsill. This section is about what happens when the plant and the machine stop being *monitor and subject* and start being one organism with two halves.

That is not a metaphor about the code. It is a specific claim about what each half contributes, and it is the thing this layer is built to make true:

| | The plant brings | The machine brings |
| --- | --- | --- |
| **Senses** | Electrical signalling, turgor, growth, colour — a body that already knows when it is hurt | Sonar, cameras, clocks, a thermometer that never gets bored |
| **Memory** | Species-scale adaptation, circadian rhythm | A perfect log of every reading and every action, forever |
| **Reasoning** | Millions of years of tuned response | Symbolic rules, an ontology, an LLM |
| **Agency** | None. A plant cannot move away from a radiator | Wheels, a pump, a valve |

The plant has everything except the ability to act on it. The machine has everything except a reason to. **Symbiosis is the loop that closes that gap** — and the reason it needs four dedicated layers is that closing it naively is dangerous.

## The loop

```
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   ▼                                                              │
sense ──▶ fuse ──▶ corroborate ──▶ reason ──▶ decide ──▶ act ──────┘
                                                          │
 sensors    fast/slow    ≥2 independent   ontology +    safety     learn
 vision     kept apart   sources, held    rules +       limits     what
 electrode               over time        LLM           first      worked
```

Every stage exists because the one before it can lie:

- **Sense** — a capacitive probe drifts, a camera sees a passing cloud.
- **Fuse** — so fast and slow signals are summarized separately, never mixed raw, each stamped with a monotonic clock.
- **Corroborate** — so no single modality can trigger an action on its own.
- **Reason** — so a conclusion carries the observations that produced it, and can be checked.
- **Decide** — so the safe option wins by arithmetic, not by a model's confidence.
- **Act, then learn** — so the outcome is measured against a control, not remembered as a story.

## What this looks like in practice

A worked case — the one that motivates the whole layer:

> It is February. The radiator under the south window is on. The plant is in the best light in the flat and slowly cooking.

1. **Sense.** Soil drops 3% a day instead of 1%. The electrode's circadian rhythm weakens and drifts off 24h. The camera sees the canopy centroid fall 3% of frame height.
2. **Fuse.** Soil and rhythm are *slow* channels — summarized as trends, not reacted to sample by sample. The sonar on the base is *fast*. They never touch each other in raw form.
3. **Corroborate.** Three independent sources now support `drought_stress`: soil, vision, electro. The evidence score passes 0.75 and it has held for six hours, so a **high-risk** action is finally justified. One of them alone would not have been enough — that is the point.
4. **Reason.** The rule engine concludes `heat_stress` *and* `drought_stress`, with `soil at 14%, below the ideal 35-70%` and `temperature 28°C, above the ideal 18-26°C` attached. The ontology refuses to recommend "water thoroughly" and "let the soil dry" together.
5. **Decide.** The planner proposes relocating to the bookshelf. Safety checks: the bookshelf is inside the geofence, not in the stairwell keep-out zone, and the battery has 14Wh spare **after** paying for the trip back. Approved. Halfway there, the sonar sees a chair leg: the reflex preempts the plan and stops. It resumes when the path is clear.
6. **Learn.** Wellbeing goes from 52 to 74 over the next three days. The bandit records +0.22 for `bookshelf` in this context. Next February it will not need six hours of evidence to know where to go.

Nothing in that chain required a model to be trusted. Every step is inspectable, and the dangerous ones are decided by arithmetic.

## Why four layers and not one model

You could hand all of this to an LLM. It would work most of the time, and the failures would be unrecoverable and invisible: a hallucinated threshold, a confident recommendation to water a plant that is already drowning, a drive command with no notion of how much battery the return leg costs.

So the responsibilities are split by *how bad it is to get them wrong*:

| Problem | Layer | Decided by |
| --- | --- | --- |
| Plant signals move over hours, a body decides in milliseconds | [Fusion](#-multirate-fusion) | Arithmetic |
| The body must not over-read *or* ignore the plant | [Evidence](#-evidence) | Arithmetic |
| A navigation or energy error must not kill the plant | [Safety](#-safety) | Arithmetic |
| Which proposal wins right now | [Control](#-hierarchical-control) | Priority rules |
| What works for *this* plant, not a species average | [Personalization](#-personalization) | Measurement |
| What to say, and what to try next | AI + [Knowledge](#-knowledge--reasoning) | Model, grounded |

**The model is never the last word on anything that can hurt the plant.** It proposes; arithmetic disposes.

## Getting a body

```js
const body = await plant.embody( {
  safety : {
    energy   : { capacityWh: 40, moveDrawW: 12, speedMs: 0.15 },
    geofence : {
      bounds  : [ [0,0], [6,0], [6,5], [0,5] ],          // the room, in metres
      keepOut : [ { name: 'stairs', polygon: [ [5,4], [6,4], [6,5], [5,5] ] } ],
      home    : [ 1, 1 ],
    },
  },
  personalization : { actions : [ 'south_window', 'bookshelf', 'bathroom' ] },
} )
```

One call wires all five layers, and every sensor reading starts flowing into fusion automatically. Nothing here loads unless you call it — a plant on a windowsill has no use for a geofence.

See [`lib/examples/05-embodied-plant.js`](lib/examples/05-embodied-plant.js) for the whole thing running with no hardware.


## 🔀 Multirate fusion

Fusing hours and milliseconds naively gives you a robot that either jerks at sensor noise or drives into a table while it averages soil moisture. So they are never mixed raw: **fast channels keep a short ring buffer, slow channels keep running summaries**, and a decision consumes fast raw plus slow summarized.

```js
body.state.register( 'sonar', { rate: 'fast' } )
// plant readings feed the slow channels automatically

const snap = body.state.snapshot()
snap.fast.sonar          // { value: 0.45, slope: -0.95, ageMs: 12, stale: false }
snap.slow.soil           // { value: 17.2, average: 18.4, trendPerHour: -1.2 }
snap.coherence.usableForControl   // false if any fast channel went quiet
```

Every sample carries **two clocks**: wall time for correlating with the plant's history, and a monotonic clock for measuring intervals — because NTP can move wall time backwards, and a rate computed from a clock that jumps is nonsense.

Also here: time-aware EMA (correct for irregular sampling), a scalar Kalman filter that reports its own variance, and CUSUM change-point detection that answers "did something actually change, or is this noise?"

## 🧾 Evidence

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

## 🛡 Safety

Hard limits that no planner, model or plugin can talk past — decided by arithmetic, not by a model.

```js
body.safety.validate( { type: 'move', from: [1,1], target: [5.5,4.5] } )
// DENY: Target is inside keep-out zone "stairs".

body.safety.validate( { type: 'water', amountMl: 3000 } )
// MODIFY: Watering capped to 500ml (requested 3000ml).

body.safety.validate( { type: 'move', from: [1,1], target: [4,2] } )   // on 12% battery
// DENY: Needs 0.141Wh including the return leg, but only -1.2Wh is available
//       above the 6Wh reserve.
```

The energy manager **always costs the return leg**, because "20% left" means nothing if home is 40% of a battery away. Below the critical threshold only survival actions pass, and `safeMode()` — stay put, conserve — is always available.

The geofence refuses to move at all when localization is lost. The watchdog trips to an emergency stop if the control loop stops feeding it; in a real build the same signal should gate a hardware relay, because a watchdog inside the process that died cannot save you.

## 🎚 Hierarchical control

Slow planners propose, fast reflexes preempt, an arbitrator decides.

```js
body.control.registerReflex( 'collision', collisionReflex( { channel: 'sonar', stopM: 0.5 } ) )

body.control.registerPlanner( 'relocate', {
  periodMs : 30 * 60_000,
  plan     : ( snapshot, ctx ) => ctx.happiness < 60 ? { mission: { type: 'move', target: [4,2] } } : null,
} )

body.control.decide()
// collision → stop because obstacle at 0.45m   (preempted the relocation)
```

Priority bands: `PLAN` → `COMFORT` → `CARE` → `REFLEX` → `SAFETY`. Evidence gates deliberate actions but **never a reflex** — avoiding a collision must not wait for a second opinion.

## 🎯 Personalization

A generic model says a Monstera wants 200-800 lux. *This* Monstera, behind *this* blind, has a spot by the bookshelf where it visibly does better, and no species knowledge will find it.

```js
const choice = await body.personalization.suggest( plant.context() )
// { action: 'bookshelf', reason: '"bookshelf" has the best expected outcome
//   (+0.219) from 10 similar situation(s)' }

// …later, after the plant has responded
await body.personalization.outcome( plant.context() )
```

Episodic memory with similarity retrieval, a contextual bandit with deliberately small exploration, and **controlled experiments with a stopping rule** — so "moving it helped" is a measurement, not a story told after the fact:

```js
const exp = body.personalization.experiment( 'move_window', { periodMs: 24*3600_000 } )
exp.observe( plant.happiness() )   // control phase, then treatment phase
exp.status().result.verdict
// '"move_window" made no clear difference (1.2 points, within noise). Keep the simpler option.'
```

Reward is asymmetric: **harm counts double**. A system that experiments on a living thing should be more afraid of hurting it than eager to improve it.

---

---

# 🔬 Spectral: light as an instrument

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

Spectral findings enter the [evidence ledger](#-evidence) as an **independent source**, because they come from controlled excitation rather than from the same passive channel everything else reads. That is what lets a high-risk action clear its corroboration requirement honestly:

```js
await plant.embody()
await plant.interrogate()

plant.justifies( 'water_stress', RISK.HIGH )
// now backed by soil, vision *and* spectral — three independent sources
```

Full example: [`lib/examples/06-spectral-probe.js`](lib/examples/06-spectral-probe.js), and the [`@smartplant/spectrum`](#-plugins) plugin wraps all of it.


# Hardware

## 🔎 Hardware autodetection

```bash
smartplant diagnose
```

```
Board:     Raspberry Pi 4 (Raspberry Pi 4 Model B Rev 1.4)
Platform:  linux/arm64, 4 core(s), 8GB
Serial:    /dev/ttyUSB0 — ESP32 / ESP8266 (CP210x)
I2C:       0x23 BH1750, 0x76 BME280 / BMP280
Camera:    /dev/video0
Packages:  missing onnxruntime-node

Suggested: sensor "serial" (confidence 0.9)
  · Found ESP32 / ESP8266 (CP210x) on /dev/ttyUSB0. Flash it with the generated
    firmware and read over USB.
  · Camera available at /dev/video0 — the vision layer can use it.
  · No GPU: prefer the classical vision tier, or a small quantized ONNX model.
```

Identifies the board from the device tree, serial devices by USB vendor id, I2C sensors by address, and which optional packages are installed — then recommends a config and a firmware target with its reasoning and a confidence. Read-only throughout: it lists and reads, never writes or disturbs a bus.

# 🦞 OpenClaw: the plant's brain

[OpenClaw](https://github.com/openclaw/openclaw) runs a local Gateway that holds your models, your keys and your routing, and speaks OpenAI-compatible HTTP on port `18789`.

For SmartPlant that is **the third way to have AI** — and the only one that costs you nothing to set up:

| | Needs |
| --- | --- |
| Cloud provider | An API key, and a bill |
| Ollama | A local model install and the disk for it |
| **OpenClaw** | **Neither.** The Gateway you already run supplies the model, the key and the embeddings. |

But it goes further than being a model source. Because the Gateway does tool calling, OpenClaw can be the **brain**: it gets the plant's entire control surface and decides for itself what to look at and what to do.

```js
const brain = await plant.useBrain()

await brain.run( 'Check on the plant and fix anything that needs fixing.' )
```

```
  → plant_status           ok
  → plant_diagnose         ok
  → plant_spectral_scan    ok
  → plant_water            REFUSED (evidence)

reply: My soil is at 6% and I can feel it, but you have only just started
       watching me — give it half an hour and check again before pouring.
```

That refusal is the design working, not failing.

## The brain proposes. The safety layers dispose.

An LLM with a water pump is exactly the situation the [safety layers](#-safety) were built for. So the brain never acts directly — every acting tool passes three gates:

| Gate | Asks |
| --- | --- |
| **Evidence** | Is there enough independent corroboration, held long enough, for an action this hard to undo? |
| **Human** | Optional `confirm` hook — a person can veto any acting tool. |
| **Subsystem** | The safety supervisor caps the amount, the spectral interlocks refuse the wavelength, the geofence refuses the destination. |

A refusal is **fed back to the model as a tool result**, not thrown. The brain learns inside the run why it cannot do the thing and reasons about what else to try:

```json
{
  "ok": false,
  "refused": "Not enough independent evidence for this action yet.",
  "missing": [ "only 1 independent source(s), needs 2",
               "condition has held 0min, needs 30min" ],
  "advice": "Gather more evidence with other tools, or explain to the human what is missing. Do not retry this call."
}
```

And when it *is* justified, the subsystem still decides the magnitude:

```
It asked for 3000ml. The supervisor gave it 500ml.
The brain decides *whether*. The supervisor decides *how much*.
```

## The control surface

**12 reading tools** — always free:

`plant_status` · `plant_ask` · `plant_history` · `plant_diagnose` · `plant_recall` · `plant_explain` · `plant_electro` · `plant_vision` · `plant_spectral_scan` · `plant_body_state` · `plant_check_evidence` · `plant_hardware`

**7 acting tools** — gated:

`plant_water` · `plant_fertilize` · `plant_light_treat` · `plant_move` · `plant_diary` · `plant_remember` · `plant_emergency_stop`

`plant_emergency_stop` is always available and never refused — it kills motion, pumps and lights at once.

Withhold acting entirely when you just want an observer:

```js
const observer = await plant.useBrain( { readOnly : true } )
// acting tools are not merely blocked — they are never offered to the model
```

Or require a human for every action:

```js
await plant.useBrain( {
  confirm : async ( tool, params ) => askTheHuman( `${tool.name}: ${JSON.stringify( params )}` ),
} )
```

## Standing watch

```js
const stop = brain.supervise( {
  intervalMs : 6 * 3600_000,
  goal       : 'Check on the plant. Investigate anything wrong, act only if the evidence supports it.',
} )
```

Every run is recorded — which tools were called, which were refused and by which gate:

```js
brain.stats()
// { runs: 12, toolCalls: 47, refused: 6,
//   byGate: { evidence: 4, subsystem: 2 },
//   mostUsed: [ ['plant_status', 12], ['plant_diagnose', 9], … ] }
```

## Just the model, if that is all you want

The brain is optional. Registering the Gateway as a plain AI provider is enough to stop needing an API key at all:

```js
import { openclawProvider, openclawEmbedder } from 'smartplant/integrations/openclaw'

plant.ai.registerProvider( 'openclaw', openclawProvider() )
plant.ai.use( 'openclaw' )
```

The same Gateway can supply embeddings, so [semantic memory](#-semantic-memory) also works with no key:

```js
const plant = await createPlant( {
  knowledge : { vectors : { embedder : openclawEmbedder() } },
} )
```

`useBrain()` does both by default — attaches the brain *and* switches the plant's ordinary AI to the Gateway. Pass `{ provider: false }` to keep them separate.

## The other direction: your plant inside OpenClaw

The same control surface, exported as an OpenClaw plugin, so the Gateway's own agent can operate the plant from whatever channel it is connected to — WhatsApp, Telegram, Slack, Discord.

```bash
smartplant openclaw ./my-plant-plugin
```

Generates the full package: `package.json` with the `openclaw` block, an `openclaw.plugin.json` manifest declaring the tool contracts, and an entry point using `definePluginEntry` + `api.registerTool`. Same tools, same gates.

```bash
smartplant openclaw ./my-plugin --read-only   # observers only
```

> **You:** Something's wrong with Ivy, investigate
> **Assistant:** *(runs plant_status, plant_diagnose, plant_spectral_scan)*
> Blue probe blunted at 1.6× control, red normal at 5.1×. That pattern is water stress, not malnutrition. Soil is at 8% and has been falling since Tuesday. She needs water — about 300ml.

## Configuration

| | |
| --- | --- |
| URL | `OPENCLAW_URL`, default `http://127.0.0.1:18789` |
| Token | `OPENCLAW_GATEWAY_TOKEN` — the Gateway requires auth by default |

```bash
smartplant brain "check on the plant"
smartplant brain "investigate" --read-only
```

If the Gateway is unreachable the error says so plainly, with the fix:

```
❌ Cannot reach the OpenClaw Gateway at http://127.0.0.1:18789. Is it running?
   The Gateway requires auth by default — set OPENCLAW_GATEWAY_TOKEN.
```

## One honest limit

OpenClaw is a Node application. It runs on a laptop, a server or a Raspberry Pi — **not on an Arduino or an ESP32**. That is fine, because it is not the layer that touches hardware:

```
  ESP32 / Arduino  ──serial/MQTT──▶  Raspberry Pi  ──▶  you
  (sensors, LEDs, pump)              (SmartPlant + OpenClaw Gateway)
```

The microcontroller senses and actuates. SmartPlant measures and enforces. OpenClaw reasons. See [Firmware generation](#-firmware-generation) for the first box, and [`smartplant hardware`](#-hardware-autodetection) if you are not sure what you have.

Full example: [`lib/examples/07-openclaw-brain.js`](lib/examples/07-openclaw-brain.js) — it runs against a scripted gateway, so you can see the whole thing without installing OpenClaw.


---

## 🖥 CLI

```bash
smartplant                      # interactive setup + live monitoring
smartplant status               # one status line
smartplant ask "how are you?"   # talk to your plant
smartplant diary                # today's journal entry
smartplant water --amount 200   # record a watering
smartplant history --hours 72   # stored trends
smartplant providers            # which AI backends are ready
smartplant sensors              # which drivers are available
smartplant hardware             # scan this machine for boards and sensors
smartplant openclaw [dir]       # generate an OpenClaw plugin for your plant
smartplant brain "<goal>"       # let an OpenClaw brain operate the plant
```

Flags: `--memory` `--sensor` `--provider` `--model` `--language` `--persona` `--interval`.

In the live view: `[t]` talk · `[w]` water · `[h]` history · `[q]` quit.

## 😊 Emoji scales

Deterministic — no AI, no network, no API key — so the plant is always legible at a glance.

**Wellbeing** 🤩 thriving · 😊 happy · 🙂 fine · 😐 acceptable · 😟 struggling · 😣 critical · 😵 no data

**Water** 🏜️ dry · 💧 ideal · 🌊 saturated **Light** 🌑 too dark · 🌞 ideal · 🔆 too bright 

**Temperature** 🥶 too cold · 🌡️ ideal · 🔥 too hot

Wellbeing is scored per metric and averaged. A metric scores 100 inside its comfort band and falls off on **both** sides — soaked soil is as wrong as parched soil.

## Full API surface

```js
// Sensing
plant.read( opts )                    plant.attachSensor( spec )
plant.getSensor( id )                 plant.registerSensor( id, driver )
plant.status()                        plant.happiness()
plant.context()                       plant.perceive()

// Multimodal
plant.useVision( config )             plant.see( opts )
plant.listen( opts )
plant.useSpectral( config )           plant.interrogate( opts )
plant.useBrain( config )              plant.brain.run( goal )

// The plant on its own terms   (all returned by plant.listen)
signal.fingerprint · signal.shift     signal.clock · signal.coherence
plant.electrome                       plant.context().vpd / .vpdBand

// AI & reasoning
plant.analyze( question, opts )       plant.speak( message, opts )
plant.learnSpecies()                  plant.diagnose( opts )
plant.remember( note )                plant.recall( query, opts )

// Colony
plant.joinColony( { transport } )     plant.leaveColony()
plant.colony.enabled                  // false until you join
plant.colony.report( { to } )         plant.colony.ask( peer, skill )
plant.colony.askAll( skill )          plant.colony.lexicon
plant.colony.newcomers()              plant.colony.teach( peer )
plant.colony.learnFromColony()

// Colony: doing something, not just saying it
plant.colony.openAidSession( peer, { kind, target } )
plant.colony.streamAid( id, { target, satisfied } )
plant.colony.coupling( { reading, metres }, reference )
plant.colony.warnNeighbours( { near } )
plant.colony.primed                   canOffer( plant, AID.HUDDLE )

// Colony: capability, light and priming
plant.colony.manifest                 plant.colony.whoCanRead( metric )
plant.colony.canSignal( peer )        plant.colony.opticalPeers()
beaconMode( { charge, radioFailed, ambientLux } )
prepareBeacon( sender, receiver, msg, { mode } )
considerAlert( plant, alert )         protocol( decision )

// Navigation — the constraints, not the planner
canCross( chassis, obstacle )         worthMoving( here, there, want )
planMove( plant, move, { surveyor } ) ros2Surveyor( bridge )

// The plant in a browser
plant.serve( { port, host, everyMs } )
snapshot( plant, { deep } )           vitals( plant )

// Internal states — what the plant is doing
plant.states()                        plant.defense()
// → { level, confidence, acts, evidence[], decides, why }

// Experience
plant.whatWorkedBefore( problem )     plant.resolutions.report()

// Looking at itself
plant.systemDiagnosis( opts )         plant.checkup( { period } )
plant.maintenance()
plant.runDueReviews()

// Learning it is wrong
plant.body.personalization.predictions.report()
new ContinuityTracker().attribute()   hysteresis( history, episode )
plant.learnInterventions( opts )      plant.interventions.identify( samples, rate )
regimeChange( history )               collectiveState( members )
collectiveShift( before, after )      infectionWatch( signals )

// Inheritance
plant.exportInheritance( opts )       plant.inherit( bundle, opts )
plant.inheritance.blend( action )     plant.inheritance.report()

// Care
plant.water()   plant.fertilize()   plant.log( type )   plant.note( text )

// Embodiment
plant.embody( config )                plant.justifies( claim, risk )
plant.body.state   plant.body.safety   plant.body.control
plant.body.evidence                   plant.body.personalization

// Lifecycle
plant.init()    plant.startMonitoring()   plant.stopMonitoring()   plant.destroy()
plant.use( plugin )   plant.plugin( name )   plant.on( event, fn )
```

**Subpath exports:** `smartplant/signals` · `/vision` · `/knowledge` · `/integrations` · `/integrations/openclaw` · `/firmware` · `/federated` · `/migration` · `/colony` · `/prediction` · `/checkup` · `/maintenance` · `/diagnosis` · `/resolutions` · `/fusion` · `/control` · `/safety` · `/confidence` · `/personalization` · `/hardware` · `/spectral` · `/sensors` · `/memory` · `/voice` · `/plugin`

Runnable examples live in [`lib/examples/`](lib/examples) — all twelve work with no hardware and no API key.

## Migrating from 1.x

**3.0.0 is the first release where the plugin system actually works.**

1.x exported a single class from `src/main.js` that started the interactive CLI on import, so the package could not be used as a library. Its plugins called `getSensor()`, `analyze()` and `registerPlugin()` — none of which existed.

- The CLI moved to `src/cli.js`; importing the package no longer starts it. `src/main.js` remains as a compatibility re-export.
- Those three methods now exist and are tested. All ten plugins run.
- Stored `historicalData` migrates automatically on first load.
- Plugins are ESM and take the kernel: `await plant.use( plugin )`.

## ☕ Donate

Help us to develop more interesting things.

[![Donate](https://img.shields.io/badge/Donate-grey?style=for-the-badge)](https://pigeonposse.com/?popup=donate)

## 📜 License

This software is licensed with **[MIT](/LICENSE)**.

[![Read more](https://img.shields.io/badge/Read-more-grey?style=for-the-badge)](/LICENSE)

## 🐦 About us

*PigeonPosse* is a ✨ **code development collective** ✨ focused on creating practical and interesting tools that help developers and users enjoy a more agile and comfortable experience. Our projects cover various programming sectors and we do not have a thematic limitation in terms of projects.

[![More](https://img.shields.io/badge/Read-more-grey?style=for-the-badge)](https://github.com/pigeonposse)

### Collaborators

|                                                                                    | Name        | Role         | GitHub                                         |
| ---------------------------------------------------------------------------------- | ----------- | ------------ | ---------------------------------------------- |
| <img src="https://github.com/alejomalia.png?size=72" alt="Angelo" style="border-radius:100%"/> | Alejo |   Author & Development   | [@alejomalia](https://github.com/alejomalia) |
| <img src="https://github.com/PigeonPosse.png?size=72" alt="PigeonPosse" style="border-radius:100%"/> | PigeonPosse | Collective | [@PigeonPosse](https://github.com/PigeonPosse) |

<br>
<p align="center">

[![Web](https://img.shields.io/badge/Web-grey?style=for-the-badge&logoColor=white)](https://pigeonposse.com)
[![About Us](https://img.shields.io/badge/About%20Us-grey?style=for-the-badge&logoColor=white)](https://pigeonposse.com?popup=about)
[![Donate](https://img.shields.io/badge/Donate-pink?style=for-the-badge&logoColor=white)](https://pigeonposse.com/?popup=donate)
[![Github](https://img.shields.io/badge/Github-black?style=for-the-badge&logo=github&logoColor=white)](https://github.com/pigeonposse)
[![Twitter](https://img.shields.io/badge/Twitter-black?style=for-the-badge&logo=twitter&logoColor=white)](https://twitter.com/pigeonposse_)
[![Instagram](https://img.shields.io/badge/Instagram-black?style=for-the-badge&logo=instagram&logoColor=white)](https://www.instagram.com/pigeon.posse/)
[![Medium](https://img.shields.io/badge/Medium-black?style=for-the-badge&logo=medium&logoColor=white)](https://medium.com/@pigeonposse)

</p>
