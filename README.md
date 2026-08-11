
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
  name    : 'Rosa',
  species : 'Monstera deliciosa',
  sensor  : 'mock',                  // no hardware needed
  ai      : { provider : 'ollama' }, // or gemini / openai / claude / grok / mock
  memory  : { path : './rosa.json' },
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

- [The nine layers](#the-nine-layers) · [Requirements](#requirements)
- **Core** — [Sensors](#-sensors) · [AI](#-ai) · [Memory](#-memory) · [Voice](#-voice) · [Events](#-events)
- **Advanced** — [Electrophysiology](#-electrophysiology) · [Vision](#-vision) · [Knowledge & reasoning](#-knowledge--reasoning) · [Semantic memory](#-semantic-memory)
- **Ecosystem** — [Plugins](#-plugins) · [Firmware generation](#-firmware-generation) · [Integrations](#-integrations) · [Federated learning](#-federated-learning)
- **[Symbiosis](#symbiosis)** — [Fusion](#-multirate-fusion) · [Evidence](#-evidence) · [Safety](#-safety) · [Control](#-hierarchical-control) · [Personalization](#-personalization)
- **[🔬 Spectral](#-spectral-light-as-an-instrument)** — 🔵 blue reads hydration · 🔴 red reads photosynthesis · 🟢 green reads the lower canopy
- **[Hardware](#-hardware-autodetection)** · **[🦞 OpenClaw](#-openclaw-the-plants-brain)** — AI with no API key, and an agent that operates the plant
- [CLI](#-cli) · [Emoji scales](#-emoji-scales) · [Full API surface](#full-api-surface) · [Migrating from 1.x](#migrating-from-1x)

---

## The nine layers

| Layer | What it does | Why it matters |
| --- | --- | --- |
| 🌡 **Sensors** | Seven pluggable drivers behind one `read()` contract | Your hardware, or none at all |
| 🧬 **Signals** | Plant electrophysiology: action & variation potentials, circadian rhythm | The plant's own electrical voice |
| 👁 **Vision** | Classical phenotyping, ONNX models, PlantCV bridge | See wilting hours before you notice it |
| 💾 **Memory** | Persistent readings, care log, species profile | Advice builds on history, not a snapshot |
| 🧠 **Knowledge** | Ontology, forward-chaining reasoner, semantic recall | Conclusions you can audit, not just trust |
| 🤖 **AI** | Seven providers, structured output, offline fallback | Your model, your keys, your privacy |
| 🗣 **Voice** | Five first-person personas, emoji scales, ten languages | It talks to you, it doesn't report at you |
| 🦿 **Body** | Multirate fusion, reflexes, safety limits, personalization | Autonomy that cannot kill the plant — see [Symbiosis](#symbiosis) |
| 🔬 **Spectral** | 🔵🟢🔴 LED as a probe, not illumination | The plant is *interrogated*, not just listened to |

Every layer works alone. They compose.

## Requirements

**Node.js 18+.** The core library has **zero runtime dependencies.** `chalk` and `enquirer` are used only by the CLI; `serialport`, `mqtt` and `onnxruntime-node` are optional peers loaded on demand; Python and ffmpeg are needed only by the tiers that use them.

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
generateFlow( { plantName : 'Rosa' } )                        // importable Node-RED flow
prometheusMetrics( plant )                                    // Grafana, Alertmanager
```

**Home Assistant discovery** registers every metric as a proper entity under one device, with correct units and device classes, so it lands in dashboards, history and automations with no user configuration. Combined with the `homeassistant` sensor driver, the loop closes in both directions.

**Node-RED flow generation** emits a complete importable flow — MQTT inputs, threshold checks, gauges and an alert path — so a SmartPlant config becomes a working visual automation in one paste.

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
smartplant hardware
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

> **You:** Something's wrong with Rosa, investigate
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

// AI & reasoning
plant.analyze( question, opts )       plant.speak( message, opts )
plant.learnSpecies()                  plant.diagnose( opts )
plant.remember( note )                plant.recall( query, opts )

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

**Subpath exports:** `smartplant/signals` · `/vision` · `/knowledge` · `/integrations` · `/integrations/openclaw` · `/firmware` · `/federated` · `/fusion` · `/control` · `/safety` · `/confidence` · `/personalization` · `/hardware` · `/spectral` · `/sensors` · `/memory` · `/voice` · `/plugin`

Runnable examples live in [`lib/examples/`](lib/examples) — all seven work with no hardware and no API key.

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
