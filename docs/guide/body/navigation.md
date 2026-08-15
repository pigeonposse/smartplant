# Moving a plant

### What this is not

It is **not** a SLAM implementation, path planner or costmap. ROS 2 and Nav2 have spent a decade on those and do them properly; a version written here would be worse in every way that matters while looking, from the outside, like it worked — the most dangerous kind of code to put underneath a pot.

So mapping, localisation and planning are delegated behind a three-method `Surveyor` contract, with a `ros2Surveyor()` adapter. The **base implementation knows nothing on purpose**, so a plant with no navigation stack refuses to move rather than moving badly.

### What a robot stack does not know about a plant

```js
canCross( { heightM: 2, baseM: 0.35, wheelbaseM: 0.4 }, { stepM: 0.04 } )
// { safe: false,
//   why: 'Refused. 2m tall on a 0.35m base tips at 10° and this imposes 6°.
//         A delivery robot would cross this without noticing; it is a tipping
//         moment for a plant with its mass this high.' }
```

```js
worthMoving( here, brightWindowsill, { metric: 'light' } )
// { better: false, gain: 8600,
//   why: 'light improves by 8600.0, and temperature moves 21 → 14, airflow moves
//         0.1 → 0.9. That is a trade rather than an improvement, and it is the
//         trade that makes "move toward the light" dangerous — the brightest spot
//         in a flat is very often the coldest and draughtiest one.' }
```

`planMove()` runs every check in the order that fails cheapest first, and each refusal is one only this library can make:

| Refusal | Because |
| --- | --- |
| `defending` | An [internal state](/guide/plant/states) says the plant is already spending on something |
| `biotic` | The destination puts it beside an infested neighbour — and a plant that cannot see cannot clear itself |
| `tipping` | Geometry. Undeclared height and base **refuses**: *"two numbers with a tape measure"* |
| `charge` | The **round trip**, not the trip — a plant that arrives stranded cannot get back |
| `worse-destination` | Nobody measured it, or the gain costs more than it gives |
| `no-map` | *"Everything above was checked and passed; only the navigation is missing."* |
