# Smartplant by *PIGEONPOSSE*

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![npm](https://img.shields.io/badge/npm-smartplant%203.0.5-cb3837.svg)](https://www.npmjs.com/package/smartplant)
![Node](https://img.shields.io/badge/node-18%2B-5FA04E.svg)
![Runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)

![Tests](https://img.shields.io/badge/tests-1124%20passing-brightgreen.svg)
![Plugin tests](https://img.shields.io/badge/plugin%20tests-60%20passing-brightgreen.svg)
![Mock](https://img.shields.io/badge/mock-318%20checks%20passing-brightgreen.svg)
![Wired](https://img.shields.io/badge/fully%20wired-76%20checks%20passing-brightgreen.svg)
![Lint](https://img.shields.io/badge/lint-0%20errors-brightgreen.svg)
![Diagnosis](https://img.shields.io/badge/self%20diagnosis-40%20areas-2b6d94.svg)

![Sensors](https://img.shields.io/badge/sensor%20drivers-10-2b6d94.svg)
![Devices](https://img.shields.io/badge/device%20profiles-37-2b6d94.svg)
![Metrics](https://img.shields.io/badge/metrics-24-2b6d94.svg)
![Plugins](https://img.shields.io/badge/plugins-18-2b6d94.svg)
![Examples](https://img.shields.io/badge/examples-13%20runnable-2b6d94.svg)

![ROS 2](https://img.shields.io/badge/ROS%202-delegated%20to%20Nav2-22314E.svg)
![Hardware](https://img.shields.io/badge/hardware-serial%20%2B%20MQTT%20verified-a8571f.svg)

> Every number above is produced by `node --run check` and is checked in CI-style before each release. The hardware badge is deliberately narrow: serial and MQTT are exercised against a real pseudo-terminal and a real broker; everything else has only ever met a mock. [What has and has not touched hardware](https://smartplant.pigeonposse.com/guide/checks/hardware-truth).

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
  units   : 'metric',                // or 'imperial' — see below
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
- 🦿 It can be given a **body** that moves the plant, under limits no model can talk past — see [Symbiosis](https://smartplant.pigeonposse.com/guide/body/)
- 🔬 It **interrogates** the plant with 🔵🟢🔴 light, separating thirst from malnutrition — see [Spectral](https://smartplant.pigeonposse.com/guide/plant/spectral)
- 🦞 It can be **run by an agent** through [OpenClaw](https://smartplant.pigeonposse.com/guide/extra/openclaw) — AI with no API key, gated by the safety layers

---

## 📚 Documentation

The full documentation lives at **[smartplant.pigeonposse.com](https://smartplant.pigeonposse.com)** — every layer, every refusal and every example, with search.

| | |
| --- | --- |
| 🏁 **[Get started](https://smartplant.pigeonposse.com/guide/)** | What it is, and the twenty-three layers |
| 🌿 **[Cyborgplant](https://smartplant.pigeonposse.com/guide/cyborgplant)** | The concept: one organism, five shared faculties |
| 🌡 **[Sensors](https://smartplant.pigeonposse.com/guide/core/sensors)** | Ten drivers, Celsius or Fahrenheit, bring your own |
| 🧬 **[Electrophysiology](https://smartplant.pigeonposse.com/guide/plant/electrophysiology)** | The plant's own electrical voice |
| 🫀 **[Internal states](https://smartplant.pigeonposse.com/guide/plant/states)** | What the plant is *doing*, not what surrounds it |
| 🔬 **[Spectral](https://smartplant.pigeonposse.com/guide/plant/spectral)** | An LED as a probe rather than illumination |
| 🗨 **[Colony](https://smartplant.pigeonposse.com/guide/colony/)** | Plants talking to plants |
| 🩻 **[System diagnosis](https://smartplant.pigeonposse.com/guide/checks/diagnosis)** | Forty checks, each ending in something to do |
| 🔌 **[Plugins](https://smartplant.pigeonposse.com/guide/ecosystem/plugins)** | Eighteen official plugins |
| 🦿 **[Symbiosis](https://smartplant.pigeonposse.com/guide/body/)** | Fusion, evidence, safety, control |
| 📖 **[Full API surface](https://smartplant.pigeonposse.com/guide/extra/api)** | Everything, in one table |

The site is built from the Markdown in [`docs/`](docs) — add a page there and it appears.


## The twenty-three layers

### **The spine — nothing runs without these**

| Layer | What it does | Why it matters |
| --- | --- | --- |
| 🌡 **Sensors** | Ten pluggable drivers behind one `read()` contract | Your hardware, or none at all |
| 💾 **Memory** | Persistent readings, care log, species profile, and what the system worked out about itself | Advice builds on history, and the history survives a restart |
| 🫀 **Internal states** | Five qualitative estimates of what the plant is *doing*, not what surrounds it | The system stops seeing only sensor numbers |
| 🔁 **Co-adaptation** | One door every action goes through, and a record of when its own refusals were wrong | The system can be wrong about *itself* and find out |
| 🦿 **Body** | Multirate fusion, reflexes, safety limits, personalization | Autonomy that cannot kill the plant — see [Symbiosis](https://smartplant.pigeonposse.com/guide/body/) |

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
