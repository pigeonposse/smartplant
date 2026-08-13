---
"smartplant": minor
---

Five mechanics that measure the system's grip on the plant rather than the plant's state, plus four drawn from the electrome literature.

**Prediction error** (`smartplant/prediction`). `suggest()` produced an `expected` and `outcome()` produced a `reward`; they existed twenty lines apart and nothing ever compared them. The loop measured whether an action *worked*, never whether the result was the one it expected — so an action could keep producing good outcomes for reasons the model had backwards, and nothing noticed. Predictions are now written down before acting and compared afterwards, with bias separated from noise because the fixes differ. Deliberately framed as the model being wrong rather than the plant resisting: a plant has no model of the system to resist, and calling it resistance would make suppressing the signal the natural response.

**Continuity and drift** (`ContinuityTracker`). `ElectromeBaseline` holds a rolling median, so a signature could walk a long way over months with every step inside recent normal and nothing ever firing. Continuity is now measured against an anchor fixed at settling. The hard part is that a slowly failing electrode — impedance shift, callus, drying gel — produces exactly the same slow coherent drift as a plant reorganising, and over these timescales it is the more likely cause. The discriminator is physical: the plant is shared between electrodes and a contact is not. One site drifting is the electrode; every site drifting together is the plant; a single electrode cannot tell, and says so rather than guessing.

**Inheritance decay and selective migration.** An inherited prior only shrank as local outcomes accumulated, so a prior nobody ever tested kept full weight forever, outranking policies the plant had confirmed for itself. Priors now also decay on a half-life. `exportInheritance()` takes `only` / `except` so ranges, policies, cadence and rhythm travel independently.

**Response hysteresis.** Whether the same stimulus now produces a different response than it used to — stress memory and priming. Not called an epigenetic readout, because nothing here touches methylation and no electrode can infer it. Occurrences are only compared when they started from comparable conditions, and the confound that cannot be excluded (the plant is older and larger the second time) is stated in the result.

**Knowledge transfer.** A plant that knows the room notices a newcomer and offers what it has learned about the place. Replaces succession-on-death, whose trigger was undecidable — a dormant plant, a dead plant and a disconnected electrode look alike electrically, and a false positive distributes the estate of a sleeping plant. Several teachers merge into one lesson, since neighbours sharing a room are not independent witnesses to it.

From the electrome literature:

- **Intervention signatures.** Published stress classifiers need labelled data from deliberately stressed plants; nobody at home can supply that, and a pre-trained model would be confidently wrong about someone else's plant. But every watering and feeding is already in the care log with a timestamp, so this learns the signature of things known to have been done. Inconsistent occurrences are reported as unreliable rather than averaged; ties between two candidates are reported as ties.
- **Regime change.** Finds the point in a record on either side of which the plant behaves like two different systems. Reports that it changed and when, and promises no lead time, because the published figures come from instrumentation nobody has at home.
- **Collective state.** Several independent plants shifting at once is evidence of a shared environmental event, caught more sensitively than one plant could manage. Explicitly not evidence that plants influence each other — they share a room, which explains nearly every correlation, and that reading is unfalsifiable without a sensor for the supposed channel.
- **Early infection.** Electrical complexity and visible chlorosis have no shared failure mode, so together they genuinely corroborate. Reports only; isolation stays behind the risk gates. Refused outright when the electrical half is a single drifting electrode.
- **Fresh-data gating.** Blue light forces stomata open, and the contraindications already refused absent data — but a three-hour-old reading is worse than absent because it looks like knowledge. Treatments now require current readings; probes are unaffected.

Also adds `windowAround()` to the electrode driver, with per-push time marks so a past moment can be located in the buffer. The synthetic transport stamps samples with the time it is simulating rather than wall time, which would otherwise put every past event in the wrong place.
