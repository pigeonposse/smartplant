---
"smartplant": minor
---

**3.0.5 — how much water, what the leaves are doing, and what just happened.**

**Watering.** A pump needed two numbers nobody was giving it. The table is not keyed on the species: a Monstera in a 12 cm pot holds 700 ml of substrate and the same Monstera in a 40 cm pot holds 25 litres, so a table of millilitres per archetype is wrong by an order of magnitude for one of them. The archetype decides the fraction to wet and how far it may dry back; the pot decides the volume, and no pot size is assumed. Seconds come from a measured flow rate or not at all. And every dose says what to check afterwards, because a blocked line, an empty tank and a tube that fell out of the pot are identical from the relay.

**Thermal.** Leaf temperature for every pixel of the canopy, and it does not publish `leafTemperature` unless the sensor is declared calibrated — an uncalibrated camera is accurate to a few degrees, and feeding VPD that is worse than feeding it nothing, because everything downstream then looks complete. What it publishes is the canopy's internal spread, which is a difference and survives the offset. It sees half a canopy transpiring and half not, which no contact probe can.

**Recent activity.** What the symbiont just did or noticed, in one place for the first time. It subscribes to the event bus and diffs the states rather than being told, so anything added later shows up without a `log()` call having been remembered. Readings are not activity; refusals are the most useful lines in it; an identical line inside half an hour is counted rather than repeated, and care actions keep their size in the key because two waterings are two waterings.

**The terminal** gets three pages, a light theme with dark one control away, the mark inverted so it is visible on white, and the plant's own line centred and larger — it was the smallest thing on a page about it.

The system diagnosis covers 32 areas.

**The pot is part of the body.** The container was a number used to size a watering, and nothing here knew that a plant outgrows one. `rootSpace()` estimates whether it is filling up — not by seeing roots, which it cannot, but by noticing that the same plant in the same pot dries faster and wants water sooner than it did. That comparison is the plant against itself in one container, so it needs no table of expected sizes. One signal is a hot week; several moving together over months is a pot running out. It recommends and never acts, because repotting is a physical act with real risk and the evidence here is indirect by construction.

`transplant({ volumeL })` asks for one thing, because somebody repotting a plant has soil on their hands and what they know that the system cannot is the physical fact. Everything else follows: doses rescale, the soil baseline closes and reopens empty, the root-space estimate suspends, elective things wait and care does not. The calibration record, the ledger and the trajectory survive — the same plant was moved, not replaced. Settling ends when the soil series stops lurching rather than when a number of days has passed.
