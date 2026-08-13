---
"smartplant": minor
---

**Periodic self-review** (`smartplant/checkup`) and **technical maintenance** (`smartplant/maintenance`). `plant.checkup({ period })`, `plant.maintenance()` and `plant.runDueReviews()`, the last of which the monitoring loop now calls so a long-lived plant reviews itself without anyone remembering to ask.

Nothing in the library previously looked at its own trajectory. A reading is now, a shift is against the last few windows, and drift was only consulted when asked — so the changes worth catching, the ones no single reading is remarkable enough to trigger, had nothing looking for them.

The discipline is in the comparison. Comparing this week's averages against last month's is mostly a measurement of the calendar: days lengthen, heating comes on, the sun moves off the windowsill. A review reporting "soil is down 8%" without noticing the room is four degrees warmer has found the weather and labelled it the plant. So every comparison carries what the conditions did over the same span, findings whose likely driver moved with them are marked confounded, and spans that are not comparable are refused rather than averaged. Reviews narrate deterministically, with no model involved.

Maintenance checks the instrument rather than the organism. The failure it exists for is not the loud one — a driver that throws gets caught already. The dangerous case is a component that keeps answering while being wrong: a stuck humidity sensor reads 55% all week, the plant looks stable, and every layer downstream reasons confidently about a number that stopped being a measurement days ago. It catches stuck sensors (by exact repetition — a stable room still moves the last digit), physically impossible readings, flat electrodes (living tissue is never electrically silent, so silence is the wire), residual mains hum, amplifier saturation, per-driver failure rates, out-of-order memory, lost colony peers, and repeated safety refusals. Tiring contacts reuse the continuity verdict rather than inventing a second opinion.

Nothing is quietly discarded: a component judged unreliable is marked unreliable with a stated reason and a suggested evidence weight, and faults are filed as claims about the instrument so conclusions can be discounted when the thing that produced them is broken.

Two real problems found while building it:

- **The stuck-sensor check would have been dead at any realistic sampling interval.** It looked at a 24-hour window, which holds four readings on a plant read every six hours — fewer than it takes to accuse a sensor of anything. It now works by reading count, since "the last twelve readings are identical" means the same thing whether they took a day or a fortnight.
- **Nothing tracked per-driver reliability.** A driver that stopped answering simply stopped contributing to the merged reading, silently. `read()` now records reads, failures, consecutive failures and the last error per driver.

Also adds an aliasing check: a sample rate at or below twice the mains frequency does not filter the hum, it folds it down into the band where plant signals live, wearing a frequency that looks physiological.
