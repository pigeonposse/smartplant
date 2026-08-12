---
"smartplant": minor
---

**Migration** (`smartplant/migration`) — directed transfer of validated priors from a mature plant to a new one of the same species. Complements federated learning, which pools anonymous statistics from many homes; this is one known source to one known receiver, carrying context.

`plant.exportInheritance()` and `plant.inherit( bundle )`.

Two rules govern it:

- **Context diversity gates export, not evidence.** A policy with four hundred outcomes all recorded in one unchanging spot describes that spot, not the plant, and does not travel however much evidence stands behind it. A policy tried thirty times across genuinely different conditions does. The bundle reports what was withheld and why.
- **The receiving body always wins.** Priors arrive advisory, weighted by how well the two environments match, and fade by Bayesian shrinkage as the plant accumulates outcomes of its own. The bundle carries the conditions its priors were learned under, so a policy about something the two environments disagree on is held back on arrival rather than left to dilute away — the dilution period is exactly when a new plant is most fragile.

Nothing identifying travels: no name, wellbeing, raw readings, notes, or timestamps.

Fixes found while building it:

- **`phaseLocking` had a 5% false-positive rate per band, and `sweep()` compounded it to 23%.** `locked` was a bare `snr > 3`; under the null hypothesis, FFT bin power is exponentially distributed, so that threshold is exactly a 5% error rate, and a five-band sweep found a response on a plant that did nothing roughly a quarter of the time. Probes now report an exact `pValue` and accept a `tests` count, and `sweep()` passes the number of bands so the threshold is Šidák-corrected across the whole sweep. Measured sweep-wide false positives drop from 22.6% to 4.9%. A single-band probe keeps its previous threshold exactly.
- `compareConditions` scored two identical environments as *incompatible*: constant readings give zero-width bands and no union to divide by. Bands are now widened to the smallest span that carries horticultural meaning before comparison.
- A spectral test used unseeded `Math.random()` and was genuinely flaky at the rate the threshold implied. Seeded, and joined by a test that asserts the false-positive rate directly.
