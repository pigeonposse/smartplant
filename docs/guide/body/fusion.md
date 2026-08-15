# Multirate fusion

Fusing hours and milliseconds naively gives you a robot that either jerks at sensor noise or drives into a table while it averages soil moisture. So they are never mixed raw: **fast channels keep a short ring buffer, slow channels keep running summaries**, and a decision consumes fast raw plus slow summarized.

```js
body.state.register( 'sonar', { rate: 'fast' } )
// plant readings feed the slow channels automatically

const snap = body.state.snapshot()
snap.fast.sonar          // { value: 0.45, slope: -0.95, ageMs: 12, stale: false }
snap.slow.soil           // { value: 17.2, average: 18.4, trendPerHour: -1.2 }
snap.coherence.usableForControl   // false if any fast channel went quiet
```

Every sample carries **two clocks**: wall time for correlating with the plant's history, and a monotonic clock for measuring intervals — because NTP can move wall time backwards, and a rate computed from a clock that jumps is nonsense.

Also here: time-aware EMA (correct for irregular sampling), a scalar Kalman filter that reports its own variance, and CUSUM change-point detection that answers "did something actually change, or is this noise?"
