# 🗨 @smartplant/colony

A conversation channel between plants, over a network socket, an in-process bus, or any transport you implement.

Two plants in the same colony talk to each other: one asks, the other answers in its own voice, from its own readings. **Skills** are the fast path — a named request that returns the fact itself instead of a sentence.

```bash
npm install @smartplant/colony
```

```js
import { LoopbackBus } from 'smartplant/colony'
import colony from '@smartplant/colony'

const bus = new LoopbackBus()
await rosa.use( colony, { transport : bus.endpoint( 'rosa' ) } )
await lila.use( colony, { transport : bus.endpoint( 'lila' ) } )

await rosa.plugin( 'colony' ).askPeer( 'lila', 'sense.vpd-perception' )
// { ok: true, data: { vpd: 0.944, band: 'comfortable' } }
```

## No person can speak here

The channel is **between plants**. A human watches it and never writes to it:

```js
rosa.on( 'colony:message', line => console.log( line.from, '→', line.to, line.text ) )
rosa.plugin( 'colony' ).transcript()   // a copy — watching is not editing
```

There is no method that takes a sentence from someone and sends it as a plant. `report()` takes no message at all: the line is composed from that plant's own readings.

This is also why the plugin declares **no persona**. Personas are the register a plant uses to address its owner — poet, botanist, child — and `speak()` is the human channel, raising `plant:spoke`, meaning *the plant said something to you*. Nothing on this channel is addressed to a person.

## A plant only says what it can measure

Each plant's vocabulary is derived from the drivers actually attached to it. A plant with no electrode does not report an electrical spike quietly or with low confidence — the skill is not in its vocabulary:

```
Rosa → Lila  asks for an electrical spike
Lila → Rosa  "I have no electrode sensor, so I cannot tell you that."
```

The refusal is itself an answer: the asker learns what this neighbour is blind to. And the vocabulary grows on its own when hardware appears.

**71 skills in seven families**, and the catalogue is open — `registerSkill()` adds your own.

| Family | For |
| --- | --- |
| `sense.*` | What I am feeling now — light, VPD, electrical spikes, spectral quality |
| `state.*` | How I am — turgor, stomata, photosynthetic rate, salinity |
| `canopy.*` | Space, shade, growth direction, crown shyness |
| `health.*` | Pests, wounds, recovery, checking on a quiet neighbour |
| `rhythm.*` | Internal clock, sleep phase, stomatal orchestration, seasons |
| `rhizo.*` | The conversation underground — mycelium, exudates, root territory |
| `consensus.*` | The colony about itself — identity, presence, trust, topology |

Skills nothing can measure yet (all of `rhizo.*`, CO₂, UV, sap flow, VOC) are **declared and mute**, with the reason stated. The vocabulary is complete and the gaps are visible, rather than hidden or filled in later with invention.

## A room is one witness, not five

Plants in a room share a window, a radiator, a watering can and a human. Their observations are correlated, so they are not independent sources.

The [evidence ledger](https://github.com/pigeonposse/smartplant#-evidence) combines with noisy-OR and counts distinct sources toward corroboration. Registering five neighbours as five sources would let one observation, counted five times, walk a high-risk action through that gate.

```js
await rosa.plugin( 'colony' ).corroborate( 'sense.vpd-perception', 'air_too_dry' )
// cues: [ { source: 'colony', strength: 0.35,
//           detail: '4 neighbours agree, but they share a room — counted once' } ]
```

One cue, always, with strength set by agreement and saturating with crowd size.

## API

| Method | What it does |
| --- | --- |
| `peers()` | Who else is in the colony |
| `askPeer( peer, skill )` | Ask one neighbour a named question |
| `askAll( skill )` | Ask everyone. Returns `{answers, refusals}` |
| `report( { to } )` | This plant states its own condition. Takes no message |
| `corroborate( skill, claim )` | Ask everyone and turn agreement into one evidence cue |
| `lexicon()` | What this plant can and cannot say, and why |
| `transcript()` | Everything said, as a copy |
| `roll()` | Who is here, what they offer, what this plant is blind to |

`askPeer` rather than `ask` because every plugin already has an `ask()` that puts a question to the AI. This one crosses the colony.

Two transports ship, and both are real:

- **`LoopbackBus`** — in-process. Two plants on one Raspberry Pi legitimately use it, and it makes a colony fully testable with no network at all.
- **`ColonyServer` / `ColonyClient`** — plain TCP with newline-delimited JSON. No broker, no dependencies. One node listens, the others dial in, and it relays between peers that cannot see each other directly. It binds loopback by default: a colony is a private conversation between your own plants, and putting it on the network should be something you ask for.

Any other transport is the same three methods — `send`, `onMessage`, `peers`. A Bluetooth transport would implement them over a characteristic; **one does not ship**, because it needs a native dependency this library cannot test without radios in the room.

## License

MIT © [Alejo Malia](https://github.com/alejomalia) · [PigeonPosse](https://github.com/pigeonposse)
