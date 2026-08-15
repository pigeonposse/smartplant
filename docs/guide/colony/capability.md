# Capability

Until now a plant learned what a neighbour could do by asking and being refused. That works — the skill layer already answers *"I have no electrode"* rather than inventing a number — but every capability was discovered by a failed request, and no plant could **plan** around another's hardware.

On joining, a plant now publishes a manifest:

```js
plant.colony.manifest
// { id: 'ivy', species: 'Ficus', metrics: [ 'humidity', 'light', 'soil', 'temperature' ],
//   faculties: [ 'see', 'electrode', 'spectral' ], photodiodeHz: null, declared: true }

plant.colony.whoCanRead( 'airflow' )
// { who: [], why: 'No neighbour reads airflow. A silence about airflow from this
//   colony means the instrument is missing, not that the value is steady — which
//   are entirely different facts.' }
```

That last distinction is the point. It is also what makes optical signalling possible at all, and what lets a colony with one camera route every pest question to the plant that can see instead of collecting five refusals.

**It is a claim, not a measurement.** A plant saying it has a camera is self-reported and nothing verifies it; a stale manifest keeps asserting hardware that was unplugged an hour ago. So capability is **permission to ask**, never a promise of an answer, and every consumer still handles the refusal it was trying to avoid.
