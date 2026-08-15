# Hierarchical control

Slow planners propose, fast reflexes preempt, an arbitrator decides.

```js
body.control.registerReflex( 'collision', collisionReflex( { channel: 'sonar', stopM: 0.5 } ) )

body.control.registerPlanner( 'relocate', {
  periodMs : 30 * 60_000,
  plan     : ( snapshot, ctx ) => ctx.happiness < 60 ? { mission: { type: 'move', target: [4,2] } } : null,
} )

body.control.decide()
// collision → stop because obstacle at 0.45m   (preempted the relocation)
```

Priority bands: `PLAN` → `COMFORT` → `CARE` → `REFLEX` → `SAFETY`. Evidence gates deliberate actions but **never a reflex** — avoiding a collision must not wait for a second opinion.
