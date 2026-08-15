# Knowledge & reasoning

An LLM hallucinating that a Monstera wants full sun is a bug you cannot see. A rule with its evidence attached is one you can.

```js
const d = plant.diagnose()
console.log( d.explanation )
// drought stress (95% confidence)
//     · soil at 4%, below the ideal 35-70%
// spider mites (45% confidence)
//     · humidity 28% with temperature 24°C — conditions spider mites favour

d.treatments
// [ { treatment: 'water_thoroughly', for: 'drought_stress', confidence: 0.95 } ]
```

An **RDF-style triple store** with a 76-triple plant-care ontology, and an **11-rule forward-chaining reasoner** that reads sensors, vision and electrophysiology together. Every conclusion carries the observations that produced it.

**Treatment conflict resolution** — the system cannot advise you to water thoroughly *and* let the soil dry out in the same breath. That is how automated advice loses trust.

```js
plant.knowledge.diagnose( 'wilting' )
// → drought_stress (treat: water_thoroughly)
// → root_rot       (treat: repot_fresh_substrate, trim_affected_roots)
//   wilting is not always thirst
```

Add your own rules:

```js
plant.knowledge.reasoner.addRule( {
  id       : 'my-species-quirk',
  when     : ( facts, ctx ) => ctx.current.ph < 5,
  conclude : () => ( {
    conclusion : 'acidic_substrate',
    confidence : 0.8,
    because    : [ 'pH below 5' ],
  } ),
} )
```
