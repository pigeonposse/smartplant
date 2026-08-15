# Symbiosis

Everything above works on a windowsill. This section is about what happens when the plant and the machine stop being *monitor and subject* and start being one organism with two halves.

That is not a metaphor about the code. It is a specific claim about what each half contributes, and it is the thing this layer is built to make true:

| | The plant brings | The machine brings |
| --- | --- | --- |
| **Senses** | Electrical signalling, turgor, growth, colour — a body that already knows when it is hurt | Sonar, cameras, clocks, a thermometer that never gets bored |
| **Memory** | Species-scale adaptation, circadian rhythm | A perfect log of every reading and every action, forever |
| **Reasoning** | Millions of years of tuned response | Symbolic rules, an ontology, an LLM |
| **Agency** | None. A plant cannot move away from a radiator | Wheels, a pump, a valve |

The plant has everything except the ability to act on it. The machine has everything except a reason to. **Symbiosis is the loop that closes that gap** — and the reason it needs four dedicated layers is that closing it naively is dangerous.

## The loop

```
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   ▼                                                              │
sense ──▶ fuse ──▶ corroborate ──▶ reason ──▶ decide ──▶ act ──────┘
                                                          │
 sensors    fast/slow    ≥2 independent   ontology +    safety     learn
 vision     kept apart   sources, held    rules +       limits     what
 electrode               over time        LLM           first      worked
```

Every stage exists because the one before it can lie:

- **Sense** — a capacitive probe drifts, a camera sees a passing cloud.
- **Fuse** — so fast and slow signals are summarized separately, never mixed raw, each stamped with a monotonic clock.
- **Corroborate** — so no single modality can trigger an action on its own.
- **Reason** — so a conclusion carries the observations that produced it, and can be checked.
- **Decide** — so the safe option wins by arithmetic, not by a model's confidence.
- **Act, then learn** — so the outcome is measured against a control, not remembered as a story.

## What this looks like in practice

A worked case — the one that motivates the whole layer:

> It is February. The radiator under the south window is on. The plant is in the best light in the flat and slowly cooking.

1. **Sense.** Soil drops 3% a day instead of 1%. The electrode's circadian rhythm weakens and drifts off 24h. The camera sees the canopy centroid fall 3% of frame height.
2. **Fuse.** Soil and rhythm are *slow* channels — summarized as trends, not reacted to sample by sample. The sonar on the base is *fast*. They never touch each other in raw form.
3. **Corroborate.** Three independent sources now support `drought_stress`: soil, vision, electro. The evidence score passes 0.75 and it has held for six hours, so a **high-risk** action is finally justified. One of them alone would not have been enough — that is the point.
4. **Reason.** The rule engine concludes `heat_stress` *and* `drought_stress`, with `soil at 14%, below the ideal 35-70%` and `temperature 28°C, above the ideal 18-26°C` attached. The ontology refuses to recommend "water thoroughly" and "let the soil dry" together.
5. **Decide.** The planner proposes relocating to the bookshelf. Safety checks: the bookshelf is inside the geofence, not in the stairwell keep-out zone, and the battery has 14Wh spare **after** paying for the trip back. Approved. Halfway there, the sonar sees a chair leg: the reflex preempts the plan and stops. It resumes when the path is clear.
6. **Learn.** Wellbeing goes from 52 to 74 over the next three days. The bandit records +0.22 for `bookshelf` in this context. Next February it will not need six hours of evidence to know where to go.

Nothing in that chain required a model to be trusted. Every step is inspectable, and the dangerous ones are decided by arithmetic.

## Why four layers and not one model

You could hand all of this to an LLM. It would work most of the time, and the failures would be unrecoverable and invisible: a hallucinated threshold, a confident recommendation to water a plant that is already drowning, a drive command with no notion of how much battery the return leg costs.

So the responsibilities are split by *how bad it is to get them wrong*:

| Problem | Layer | Decided by |
| --- | --- | --- |
| Plant signals move over hours, a body decides in milliseconds | [Fusion](/guide/body/fusion) | Arithmetic |
| The body must not over-read *or* ignore the plant | [Evidence](/guide/body/evidence) | Arithmetic |
| A navigation or energy error must not kill the plant | [Safety](/guide/body/safety) | Arithmetic |
| Which proposal wins right now | [Control](/guide/body/control) | Priority rules |
| What works for *this* plant, not a species average | [Personalization](/guide/body/personalization) | Measurement |
| What to say, and what to try next | AI + [Knowledge](/guide/extra/knowledge) | Model, grounded |

**The model is never the last word on anything that can hurt the plant.** It proposes; arithmetic disposes.

## Getting a body

```js
const body = await plant.embody( {
  safety : {
    energy   : { capacityWh: 40, moveDrawW: 12, speedMs: 0.15 },
    geofence : {
      bounds  : [ [0,0], [6,0], [6,5], [0,5] ],          // the room, in metres
      keepOut : [ { name: 'stairs', polygon: [ [5,4], [6,4], [6,5], [5,5] ] } ],
      home    : [ 1, 1 ],
    },
  },
  personalization : { actions : [ 'south_window', 'bookshelf', 'bathroom' ] },
} )
```

One call wires all five layers, and every sensor reading starts flowing into fusion automatically. Nothing here loads unless you call it — a plant on a windowsill has no use for a geofence.

See [`lib/examples/05-embodied-plant.js`](https://github.com/pigeonposse/smartplant/blob/main/lib/examples/05-embodied-plant.js) for the whole thing running with no hardware.
