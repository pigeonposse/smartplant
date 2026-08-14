---
"smartplant": minor
---

**A colony that does not go quiet, and a plant that can measure the room.**

**A second way through.** A colony had exactly one transport. If it failed, messages went nowhere — and six call sites swallowed the failure with an empty `catch`, so a colony could be entirely broken and look like it was working. A plant could warn its neighbours about a pest, be told nothing had gone wrong, and have warned nobody.

The design is [Maskpert](https://github.com/AlejoMalia/lecc), the delivery layer of LECC, and it follows its five steps almost exactly: choose candidates, order by priority, fan out, confirm, spool what nobody took. Circuit breakers, hop trails and bounded queues are kept as they are.

Three things are different, and all three come from having a living thing at the other end rather than a service.

*Messages go off.* A general layer replays a spooled message when the link returns; here that lies. "I am thirsty" delivered two hours late waters a plant that was watered ninety minutes ago, and an aid-session frame arriving after the session closed describes light that is no longer falling on anything. Every kind declares a shelf life, the spool drops what has expired, and what survives arrives carrying when it was written and flagged as late.

*Fan-out duplicates, and here a duplicate acts* — a second copy of a request opens a second aid session, a second pest warning shortens an already shortened inspection interval again. The receiving side drops ids it has seen.

*Some links bill the plant at the other end.* Talking by light at night puts light on a resting plant, metered against that plant's own dose ledger, paid by somebody who did not ask for the message. A link carries two prices and the receiver's dominates. Only `sos` and `priming` are worth spending it, and beacon mode stops being a hardcoded special case and becomes an ordinary link.

And an emulated link may hold a message but never claims it arrived, because a stand-in that reported success would recreate exactly what the beacon layer exists to prevent: a plant that believes it called for help.

**Reading the space.** WiFi presence from the radio already in the room — a body between two radios changes the signal, and the variance of that separates an empty room from an occupied one, in the dark, through a wall, with nothing worn.

Presence and motion, and deliberately nothing else. Pose, identity, breathing and counting people need an array of receivers and a model trained on the specific room; a single radio reporting a skeleton as fact would be inventing the link this library spends most of its refusals avoiding. `sensing` has no default, because RSSI is one number for the whole signal and CSI is a value per subcarrier, and what can honestly be reported differs between them.

Everything is judged against the room's own quiet rather than a threshold, since two rooms with identical occupancy read completely different RSSI. It refuses to answer until it has a quiet to depart from, and it catches a radio returning a constant as a stuck sensor rather than as a very still house.

Two things change as a result: the UV-B interlock stops depending on being told the room is occupied, and motion becomes a negative control on defence activation — brushing past a plant produces an action potential that looks exactly like the opening of a wound response, and indoors that is a commoner explanation than the weather.

**Lidar without SLAM.** Mapping is solved, hard, and already delegated to Nav2 — and Cartographer's own README now says it is no longer actively maintained. So this answers what a single scan answers, which needs no map, no loop closure and no pose graph: clearance around the pot, something newly blocking the window, and the distance to a neighbour.

The last is the point. Every shared-humidity and CO₂ conclusion rests on how far apart two plants are, and that number was typed in by a person — every conclusion carried a footnote saying so. A rangefinder removes it. Bearings stay declared and ranges are measured, and the two are kept apart, because a lidar cannot tell a plant from a chair leg. A scan older than ten seconds is not answered from at all, because a stale moisture reading is roughly still true and a stale scan describes a room somebody may have moved a chair through.

**Also.** `test/robustness.test.js` walks every exported function with the junk that turns up in real code, after an adversarial pass found 35 places where the library broke in the caller's hands instead of refusing with a reason. The MQTT driver dropped retained messages published before it subscribed and discarded every message on a wildcard topic, both now proved against a real broker rather than a stub; the serial driver is tested against a real pseudo-terminal. `uptakeBalance` was dead at a realistic sampling rate and reported missing sensors that were connected. And the mock and fully-wired harnesses moved into `scripts/`, so `node --run check` runs all of it.
