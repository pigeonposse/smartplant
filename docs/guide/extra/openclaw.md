# OpenClaw

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

An LLM with a water pump is exactly the situation the [safety layers](/guide/body/safety) were built for. So the brain never acts directly — every acting tool passes three gates:

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

The same Gateway can supply embeddings, so [semantic memory](/guide/extra/semantic) also works with no key:

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

The microcontroller senses and actuates. SmartPlant measures and enforces. OpenClaw reasons. See [Firmware generation](/guide/ecosystem/firmware) for the first box, and [`smartplant hardware`](/guide/extra/hardware) if you are not sure what you have.

Full example: [`lib/examples/07-openclaw-brain.js`](https://github.com/pigeonposse/smartplant/blob/main/lib/examples/07-openclaw-brain.js) — it runs against a scripted gateway, so you can see the whole thing without installing OpenClaw.


---
