---
"smartplant": patch
---

Migration and Colony are now installable plugins: `@smartplant/migration` and `@smartplant/colony`.

**Colony is a channel between plants that a person cannot enter.** A human watches it — `transcript()` returns a copy and every line raises the new `colony:message` event — but no method takes a sentence from someone and sends it as a plant. `report()` takes no message at all; the line is composed from that plant's own readings.

That also removed the persona from the colony layer, which was a mistake. Personas are the register a plant uses to address its **owner**, and `speak()` is the human-facing channel — it raises `plant:spoke`, meaning "the plant said something to you". Colony replies were being routed through it, which filed plant-to-plant speech as speech to the owner and dressed it in a voice chosen for a human reader. Plant-to-plant talk now has its own register and never raises `plant:spoke`.

Fixes a real bug in the plugin system, found while building these two:

- **`plant.use()` installed the shared plugin definition rather than a per-plant instance**, so `init` overwrote its `plant` field. Installing one plugin on two plants in the same process silently rebound the first plant's plugin to the second, and every later call then read and acted on the wrong plant. Destroying one plant also removed the other's event listeners. Two plants in one process is the normal case for a colony or an inheritance, so this was reachable in ordinary use, and it affected all thirteen plugins. Each install now gets its own instance over the shared definition: methods inherited, state per-plant.
