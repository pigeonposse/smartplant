# What is SmartPlant?

SmartPlant is a Node.js library that treats a plant as something to be **measured and asked**, rather than something to be guessed about. It reads ordinary environmental sensors, the plant's own electrical signals, and — with an LED used as a probe rather than as a lamp — the answers it gives back.

It is not a plant monitor. It joins a plant and a computer into a functional symbiont — a [**cyborgplant**](/guide/cyborgplant) — with shared perception, memory, reasoning, voice and the ability to act.

Its organising rule is a refusal: **nothing is inferred from data that is not there.** A missing sensor blocks a conclusion instead of being replaced by a default, a low-confidence estimate loses its authority to change anything, and every refusal names both the reason and the instrument that would lift it.

```bash
npm install smartplant
```

```js
import { createPlant } from 'smartplant'

const plant = await createPlant( {
  name    : 'Ivy',
  species : 'Monstera deliciosa',
  sensor  : 'mock',                  // no hardware needed
  ai      : { provider : 'ollama' }, // or gemini / openai / claude / grok
  memory  : { path : './ivy.json' },
  units   : 'metric',                // or 'imperial'
} )

await plant.read()
console.log( plant.status() )
// 😊 84% | Temperature: 🌡️ 21.6°C | Humidity: 💧 58.9% | Soil moisture: 💧 62.1% | Light: 🌞 326lux
```

## The twenty-three layers

### **The spine — nothing runs without these**

| Layer | What it does | Why it matters |
| --- | --- | --- |
| 🌡 **Sensors** | Ten pluggable drivers behind one `read()` contract | Your hardware, or none at all |
| 💾 **Memory** | Persistent readings, care log, species profile, and what the system worked out about itself | Advice builds on history, and the history survives a restart |
| 🫀 **Internal states** | Five qualitative estimates of what the plant is *doing*, not what surrounds it | The system stops seeing only sensor numbers |
| 🔁 **Co-adaptation** | One door every action goes through, and a record of when its own refusals were wrong | The system can be wrong about *itself* and find out |
| 🦿 **Body** | Multirate fusion, reflexes, safety limits, personalization | Autonomy that cannot kill the plant — see [Symbiosis](/guide/body/) |

### **Reading the plant**

| Layer | What it does | Why it matters |
| --- | --- | --- |
| 🧬 **Signals** | Electrophysiology: action and variation potentials, circadian rhythm | The plant's own electrical voice |
| 🪞 **Self-reference** | Electrome fingerprint, internal clock, two-site coherence, VPD-aware blue | Judged against itself, not a population average |
| 🔬 **Spectral** | 🔵🟢🔴 LED as a probe, not illumination | The plant is *interrogated*, not just listened to |
| 👁 **Vision** | Classical phenotyping, ONNX models, PlantCV bridge, thermal canopy | See wilting hours before you notice it |

### **Looking after it**

| Layer | What it does | Why it matters |
| --- | --- | --- |
| 💧 **Watering** | Volume from the pot, fraction from the archetype, duration from a measured pump | A dose it can defend, and a check that the water arrived |
| 🪴 **The pot** | Whether the container is running out, and moving to a bigger one | The pot is part of the body, and it stops fitting |
| 🔎 **Experience** | A ledger of what resolved each problem, against the base rate of doing nothing | It reuses what worked, without inventing what did not |
| 🔁 **Self-correction** | Prediction error, identity drift, decaying priors, response hysteresis | It finds out when *it* is the thing that is wrong |

### **Knowing whether it works**

| Layer | What it does | Why it matters |
| --- | --- | --- |
| 🩻 **Diagnosis** | 40 checks over everything wired up, each ending in something to do | Know it works before walking away |
| 🩺 **Self-check** | Weekly and monthly reviews, plus a technical inspection of the instrument | It watches its own trajectory, and its own sensors |
| 🖥 **Dashboard** | The plant in a browser: vitals, activity, and what has no sensor | All of the above, visible without writing code |

### **Talking, and to whom**

| Layer | What it does | Why it matters |
| --- | --- | --- |
| 🧠 **Knowledge** | Ontology, forward-chaining reasoner, semantic recall | Conclusions you can audit, not just trust |
| 🤖 **AI** | Seven providers, structured output, offline fallback | Your model, your keys, your privacy |
| 🗣 **Voice** | Five first-person personas, emoji scales, ten languages | It talks to you, it doesn't report at you |
| 🗨 **Colony** | Conversation between plants, 73 skills, and delivery that survives a link failing | They talk to each other, and only about what they measure |
| 🧬 **Inheritance** | Directed transfer of validated priors between individuals | A new plant starts with what the last one learned |

### **Once it can move**

| Layer | What it does | Why it matters |
| --- | --- | --- |
| 📡 **Space** | WiFi presence and a lidar scan, without a camera and without a map | It knows if you are in the room, and how far the neighbour really is |
| 🚜 **Navigation** | Constraints a robot stack cannot know, over a delegated ROS 2 planner | A pot is not a delivery robot |

Every layer works alone. They compose.

## Requirements

**Node.js 18+ and nothing else.** `npm i smartplant` installs **zero dependencies** — the library imports nothing outside Node itself. `chalk` and `enquirer` are *optional* and only make the CLI prettier; without them it runs in plain text and says so. `serialport`, `mqtt` and `onnxruntime-node` are optional peers loaded on demand; Python and ffmpeg are needed only by the tiers that use them.

---
