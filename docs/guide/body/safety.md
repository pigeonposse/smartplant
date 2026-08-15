# Safety

Hard limits that no planner, model or plugin can talk past — decided by arithmetic, not by a model.

```js
body.safety.validate( { type: 'move', from: [1,1], target: [5.5,4.5] } )
// DENY: Target is inside keep-out zone "stairs".

body.safety.validate( { type: 'water', amountMl: 3000 } )
// MODIFY: Watering capped to 500ml (requested 3000ml).

body.safety.validate( { type: 'move', from: [1,1], target: [4,2] } )   // on 12% battery
// DENY: Needs 0.141Wh including the return leg, but only -1.2Wh is available
//       above the 6Wh reserve.
```

The energy manager **always costs the return leg**, because "20% left" means nothing if home is 40% of a battery away. Below the critical threshold only survival actions pass, and `safeMode()` — stay put, conserve — is always available.

The geofence refuses to move at all when localization is lost. The watchdog trips to an emergency stop if the control loop stops feeding it; in a real build the same signal should gate a hardware relay, because a watchdog inside the process that died cannot save you.
