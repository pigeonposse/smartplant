# Personalization

A generic model says a Monstera wants 200-800 lux. *This* Monstera, behind *this* blind, has a spot by the bookshelf where it visibly does better, and no species knowledge will find it.

```js
const choice = await body.personalization.suggest( plant.context() )
// { action: 'bookshelf', reason: '"bookshelf" has the best expected outcome
//   (+0.219) from 10 similar situation(s)' }

// …later, after the plant has responded
await body.personalization.outcome( plant.context() )
```

Episodic memory with similarity retrieval, a contextual bandit with deliberately small exploration, and **controlled experiments with a stopping rule** — so "moving it helped" is a measurement, not a story told after the fact:

```js
const exp = body.personalization.experiment( 'move_window', { periodMs: 24*3600_000 } )
exp.observe( plant.happiness() )   // control phase, then treatment phase
exp.status().result.verdict
// '"move_window" made no clear difference (1.2 points, within noise). Keep the simpler option.'
```

Reward is asymmetric: **harm counts double**. A system that experiments on a living thing should be more afraid of hurting it than eager to improve it.

---

---
