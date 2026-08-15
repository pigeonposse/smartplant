# Colony

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

This is the rule the layer rests on, and it is the same one the [spectral contraindications](/guide/plant/spectral#safety-the-interlocks) use: **missing data blocks, it does not permit.**

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

The [evidence ledger](/guide/body/evidence) combines cues with noisy-OR and counts distinct sources toward its corroboration threshold. Registering five neighbours as five sources would let one observation, counted five times, walk a high-risk action straight through that gate. So everything heard enters under the single source `colony`, with its strength set by how much the neighbours agree — and saturating, because the fortieth plant on the shelf adds nothing the second did not:

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
