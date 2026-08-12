---
"smartplant": minor
---

**Colony** (`smartplant/colony`) — a conversation channel between plants. Two plants on the same transport can talk: one asks, the other answers in its own voice from its own readings. `plant.joinColony({ transport })`, then `colony.say()`, `colony.ask()` and `colony.askAll()`.

Skills are the fast path through that conversation: a named request that returns the structured fact instead of a sentence. 71 of them across seven families (`sense`, `state`, `canopy`, `health`, `rhythm`, `rhizo`, `consensus`), and the catalogue is open via `registerSkill()`.

Two rules hold it together:

- **A plant only says what it can measure.** Each plant's vocabulary is derived from the drivers actually attached to it, so a plant with no electrode cannot say `sense.electrome-spike` — the skill is not in its vocabulary and the request is refused with the reason, which is itself informative. Skills nothing in the framework can measure yet (all of `rhizo.*`, CO₂, UV, sap flow, VOC) are declared and mute with a stated reason, so the vocabulary is complete and the gaps are visible instead of being filled in later with invention. The same doctrine as the spectral contraindications: missing data blocks, it does not permit.
- **A room is one witness, not five.** Plants in a room share a window, a radiator and a human, so their observations are correlated. The evidence ledger combines with noisy-OR and counts distinct sources toward corroboration; registering N neighbours as N sources would let one observation counted N times walk a high-risk action through that gate. Everything heard enters under the single source `colony`, with strength set by agreement and saturating with crowd size.

`LoopbackBus` is a real in-process transport, so a colony is fully testable with no radio. A Bluetooth transport is the same three methods over a characteristic.

Also fixes: `speak()` accepted an `extra` option in its signature but dropped it before building the system prompt, so a caller could never tell the plant who it was addressing. Colony needs it to say "you are answering another plant, not a person".
