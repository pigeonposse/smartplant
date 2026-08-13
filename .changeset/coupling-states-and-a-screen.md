---
"smartplant": minor
---

**3.0.4 — the plant stops being a set of sensor readings.**

**Internal states.** Five qualitative estimates of what the plant is *doing*, rather than what surrounds it: defence activation, internal water stress, accumulated load, stress memory, circadian integrity. Each is built only from measured signals, carries the evidence that raised it, and declares what decision it changes — a test fails if one ships without that, because a state that changed nothing would be decoration, and decoration in a system people trust with a living thing is worse than nothing.

Low confidence removes a state's authority rather than annotating it. `acts` is false whenever confidence is low, and every gate checks `acts` rather than `level`. A weak signal can inform a person; it cannot change what the system does.

Two rules carry most of the weight. **Absent is not low** — a variation potential is the primary evidence for defence, so a plant with no electrode returns `unknown`, because a plant being eaten right now would look identical to a calm one. And **the negative control can lower the answer**: cold shock and light changes produce variation potentials too, so when the room accounts for the event the level comes down — unless something visible actually caused it, because a draught does not chew holes in a leaf.

None of it claims to measure methyl jasmonate. That needs mass spectrometry.

**The aid channel is no longer about light.** Light turned out to be the least representative kind of help: it is the only one that accumulates. Shade, shelter, warmth and getting out of the way hold a condition for as long as it is needed. Each kind now declares which metric it changes, in which direction, and whether it accumulates or is sustained — and the check that generalises furthest is that the helper reports acting while the receiver's own instrument sees no change, which stops the session. A session that delivers nothing is worse than none, because it looks like help.

**Two plants close together stop being two plants.** Overlapping boundary layers, shared transpiration, competing for the same CO₂. In still dry air that helps both; in stagnant air at midday it inverts, and airflow decides which. The conclusion is never "separate them" — it is "move the air". Most of the care went into the reference problem: two neighbours both reading 68% humidity is not a shared pocket, it is equally consistent with a humid room, so every benefit returns `observed: null` without a reading from outside the pair.

`AID.HUDDLE` is the first aid where nobody spends anything, and the only one gated on conditions rather than on plants.

**Capability manifests.** A plant publishes what it is equipped with when it joins, instead of every capability being discovered by a failed request. It separates a neighbour with steady air from one with no anemometer.

**Beacon mode.** Visible light communication over the spectral LEDs, with the energy argument stated correctly rather than flatteringly: per bit, an LED pulse is worse than a BLE advertisement. What holds is that a Wi-Fi association is expensive, a failed radio transmits at no price, and darkness gives enormous SNR for free. Nothing transmits until a neighbour has declared a photodiode fast enough to decode it — a plant blinking at a lux sensor has not called for help.

**Security priming**, with three things removed from the obvious design. It holds red:far-red *high*, because lowering it inactivates phytochrome B and suppresses the jasmonate response the protocol is trying to prepare. It does not drive the electrode, which stays a witness. And it accepts no warning from beyond the building, because a pest in another city is a fact about that city. UV-B sits behind five interlocks including an occupied room and a daily cap no caller can raise.

**Navigation** defines the constraints and delegates the planning to Nav2. What a robot stack cannot know: that a 2m ficus on a 0.35m base tips at a threshold a delivery robot crosses without noticing, that the round trip matters rather than the trip, and that the brightest spot in a flat is very often the coldest and draughtiest.

**A dashboard.** `await plant.serve()` puts all of it in a browser — a dark terminal, three regions, nothing scrolling. The vitals line is appended once a minute rather than overwriting itself, because a plant that has been at 5% humidity for an hour and one that dropped there a minute ago are the same picture on a gauge. Metrics with no sensor are drawn greyed with their reason rather than left out. Loopback and read-only, both deliberately.

`systemDiagnosis()` now covers all of it, and `plant.colony.enabled` is a real property — it was only ever tested for `=== false`, so reading it as a boolean quietly reported a connected plant as being on its own.

Also fixes the CAM inversion guard, which decided whether it was daytime from the host's wall clock hardcoded to 08:00–18:00. The protection switched off silently after six in the evening.
