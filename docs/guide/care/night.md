# Night consolidation

A plant in its subjective night is not doing much, and neither is the system watching it. Those hours are the natural place for the one kind of work that needs no sensor and no actuator: going back over the record and asking what would have happened if something had been done differently.

```js
const night = await plant.consolidate()

night.findings[ 0 ]
// { problem : 'soil-dry',
//   arms    : [ { action: 'water-200ml', n: 4, resolved: 4, rate: 1 },
//               { action: 'top-up-50ml', n: 3, resolved: 1, rate: 0.33 } ],
//   best    : 'water-200ml',
//   gap     : 0.67,
//   why     : '"soil-dry" resolved 1 of the time with water-200ml (4 occasions) against
//              0.33 with top-up-50ml (3). Real occasions compared against real outcomes,
//              not a simulation — but 4 and 3 are small numbers and whoever chose between
//              them at the time may have been choosing on something this record does
//              not hold.' }

night.emitted   // false. Always.
```

Only episodes where **exactly one thing was done** can attribute anything. Water, feed and move a plant on the same afternoon and no arithmetic recovers which one helped, so those are counted as ambiguous and set aside rather than credited to whichever action is listed first.

**Nothing is emitted, and that is not a limitation.** The obvious version of this replays past electrical patterns back at the plant with the amber channel — a light show of its own history. There is no mechanism by which that does anything: showing a plant a light resembling its own electrome from last month is not a stimulus it can interpret, it is a lamp on at night, which is the exact thing the dark-hours interlock exists to prevent, dressed as insight.

So it runs entirely on stored data. It would work identically at midday; it runs at night because that is when nothing else wants the processor and when acting on the plant would be least welcome anyway.

**A counterfactual over a record is still a counterfactual.** "What if I had watered 30 ml less" cannot be answered by rerunning anything — there is no simulator of a plant here, and building one would be inventing the physiology the rest of this library spends its refusals avoiding.

What *can* be answered is narrower and honest: **has this ever happened differently, and did it go better?** The resolution ledger holds occasions where the same problem was met with different responses, and comparing those is a real comparison over real outcomes. So a "what if" always resolves to *"there were N times this happened, M of them handled the other way, and here is how those went"* — or to nothing at all, which is the usual answer and the correct one.

**And it cannot move anything on its own.** Consolidation that reweights priors from replay is adaptation without new evidence, which is the exact circle [co-adaptation](/guide/care/learning) is built to avoid: a night of thinking about old data produces no new information about the world. Findings become proposals, proposals need the calibration record to exist before they can move a threshold, and until then they are things to tell a person.

| It does | It does not |
| --- | --- |
| Compare occasions the ledger actually holds | Simulate a plant, or a response that never happened |
| Report a gap between two approaches | Change a threshold on its own |
| Run on stored data, at any hour | Emit, illuminate, or touch the plant |
