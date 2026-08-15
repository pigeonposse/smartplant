---
"smartplant": patch
"@smartplant/transplant": minor
"@smartplant/thermal": minor
"@smartplant/presence": minor
"@smartplant/season": minor
"@smartplant/energy": minor
---

**Five plugins over machinery that was already in the library.**

Each of these wraps something the core has been able to do for a while and nobody could reach without knowing which module to import. None of them adds a new estimate; they add a way to ask.

**`@smartplant/transplant`** notices the pot filling up. A pot with more root in it empties faster, so the same plant in the same pot starts wanting water sooner than it did — recent against early *in this pot*, which is why no table of expected sizes is needed. It never repots anything and never asks the system to: the evidence is indirect by construction, and its advice is about tipping the plant out and looking rather than about doing.

**`@smartplant/thermal`** reads the whole canopy at once. A leaf clip reports whichever leaf it was clipped to, and half a plant in trouble looks identical to all of it through one. Nothing here is published as an absolute temperature — an uncalibrated sensor knows differences within a frame far better than it knows any of them — so the air reading has to come from a real thermometer, and without one the stress index refuses.

**`@smartplant/presence`** is the UV-B interlock and a negative control. Unknown occupancy refuses: an interlock that opens when it cannot see is not an interlock, and "empty" on a WiFi radio means nobody *moving*, which the refusal says out loud. The second use is quieter and just as useful — somebody walking past a plant produces an action potential, and the defence estimate can now discount that the same way it discounts the weather.

**`@smartplant/season`** bends the comfortable bands toward the time of year, and will not guess the hemisphere: half the guesses would be exactly six months wrong, which produces advice to cut watering back in somebody's spring. The table is blended by weight and gone after two years, by which point the plant's own record describes its own flat better than any archetype average.

**`@smartplant/energy`** budgets a panel and a battery. The interesting decisions are the ones that are not about power: the lamp goes off at night at any charge because irradiating through the dark period destroys the circadian signal the rest of the library reads, a CAM plant keeps its electrode on at low charge because its night is when anything happens, and travel is costed there *and back* — a plant that spends its last charge arriving somewhere is stranded there. The panel figure says it is arithmetic every time until a current sensor makes it a measurement.

The integration test now installs all eighteen on one kernel, colony included, and checks that the new five answer without hardware by refusing.
