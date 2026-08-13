---
"smartplant": patch
---

A deep audit of every path that touches the outside world, and the fixes it turned up.

**A real network transport for Colony.** The docs said "over Bluetooth" and no Bluetooth transport existed — only the in-process `LoopbackBus`. Anyone installing `@smartplant/colony` to pair two pots over a radio would have found nothing to do it with. Rather than ship an untestable native dependency, `ColonyServer` / `ColonyClient` now provide plain TCP with newline-delimited JSON: no broker, no dependencies, one node listens and relays between peers that cannot see each other directly. It binds loopback by default, because a colony is a private conversation between someone's own plants. The documentation now says what ships and states plainly that a Bluetooth transport does not.

Bugs found and fixed:

- **No deadline on any AI call.** The service passed the caller's `signal` and nothing else, so with no signal supplied — the normal case — a provider that accepted the connection and then stopped talking left `speak()` pending forever. Inside the monitoring loop that is a plant that silently stops being monitored. Every attempt now carries its own deadline, and a retry gets a fresh one.
- **No deadline on the Home Assistant driver**, with the same consequence. Also, the aggregate error discarded *why* each entity failed — "entity not found", "token rejected" and "the server stopped answering" need completely different fixes.
- **Three more `fetch` calls with no deadline** (InfluxDB writes, both embedding endpoints, Ollama model discovery).
- **Clients in a networked colony discovered nobody.** They only learned of a peer that happened to speak to them first, so `askAll`, `newcomers`, `learnFromColony` and `corroborate` silently did nothing on any client node. The listener now broadcasts the roster on every membership change.
- **`destroy()` never left the colony.** The socket stayed open and every neighbour kept a plant that no longer existed on its roster — including the maintenance report on link health. It also now turns off any spectral lamp, which must never be left on because a process ended.
- **One malformed frame dropped a working link.** The frame reader was written to tolerate it and the caller destroyed the socket anyway. Flooding without a frame boundary still drops the peer, which is the case that actually needs it.
