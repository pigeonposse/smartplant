---
"smartplant": minor
---

Four layers that judge the plant against itself rather than against a population average.

- **Electrome fingerprint** (`smartplant/signals`) — learns this plant's baseline electrical signature and reports departures from it. DC-offset invariant, so electrode drift does not read as a new plant, and it refuses to judge before the baseline has settled. New `plant:electrome-shift` event.
- **Internal clock** — estimates the acrophase by quadrature demodulation and reports the plant's subjective hour, its offset from the light cycle, and whether it is free-running. `timingAdvice()` turns that into a yes/no for probing, watering and lighting.
- **Two-site coherence** — corroborates an event across two electrodes by checking the propagation delay against physiological speed ranges. Zero delay is rejected as mains interference rather than accepted as a strong signal; overlapping speed ranges return every candidate instead of naming one; an ambiguous lag withholds coherence.
- **VPD-aware blue** — vapour pressure deficit is computed from temperature and humidity, exposed as `context().vpd` / `.vpdBand`, and folded into spectral interpretation. A strong blue response at high VPD with dry soil is now read as demand against an absent supply, not as a healthy responsive plant.

Fixes in the signal path found while building these:

- `crossCorrelate` searched lags with as few as two overlapping samples, and a mean over a handful of products is trivially large — two traces of pure noise could report a correlation above 0.9 and be accepted as a corroborated event. Lags now require at least half the trace to overlap.
- Rival correlation peaks were detected by distance from the best lag, which counted the shoulders of the same peak as competition. Rivals are now measured beyond the main peak's own width.
- `sweep()` and `interpret()` accept a context argument so spectral readings can be interpreted against the atmosphere.
