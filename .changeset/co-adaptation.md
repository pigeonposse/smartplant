---
"smartplant": minor
---

**The system can now be wrong about itself, and find out.**

Seven improvements, built in the order they depend on each other rather than the order they were proposed — rewriting thresholds from experience comes last, because a system that retunes itself without knowing when it was wrong adapts toward whatever it already believed.

**Calibration.** An internal state with `acts: true` refuses things, and every refusal is a claim that the action would have been worse. Nothing had ever checked one. Grading a refusal is a counterfactual — "we did not water it and it was fine" does not mean the refusal was right — and there is exactly one place the other arm of the experiment exists: **an override is a natural experiment.** Somebody who takes the `force` escape has run the trial the system declined to run. Twelve usable trials before it changes anything, and it moves in one direction only: a state that has been too *permissive* cannot be found this way, because nobody overrides a permission.

**One door.** States already stopped watering, probing, lending and moving — five hand-written checks, which meant the sixth action anybody added had none and nothing noticed, because there was no list to be missing from. Care is never blocked, and where an action has a size, a loaded plant gets a smaller one rather than none.

**Experiments** get a second stopping rule that is not statistical. One producing beautiful data on a plant that is declining has not failed as an experiment; it has stopped being one that should be running.

**Trajectory** measures the pairing rather than the plant, and earns its place by telling an ageing electrode from a declining plant — indistinguishable in any snapshot, completely different over a season.

**Cross-evidence.** The evidence ledger caps a colony at one source because neighbours share a room, and that is right for claims about a *plant*. For a claim about the **room** it is backwards: four separate electrodes on four separate plants agreeing is four instruments, and their sharing a room is exactly what is being claimed. The inverse is more useful day to day — one plant moving alone is evidence about that plant, and the first thing to suspect is its instrument.

**Identity.** Inheritance moves what one plant learned to a *different* plant and fades it on the way. This is the same plant after a failed electrode or a replaced Pi, so nothing fades — except what was never about the plant. An electrome fingerprint belongs to *this plant through this electrode at this contact point*, and installing an old one would report a plant changing when what changed was the wire.

**Adaptation**, gated on the calibration record existing. A threshold moves on systematic bias, never on error — wrong by a lot in different directions is a noisy plant and a fine threshold. A fifth of the way at a time, capped at 25% total drift, and every change reversible, because the failure mode is slow and by the time it is visible nobody remembers what the number used to be.

`systemDiagnosis()` covers 32 areas.
