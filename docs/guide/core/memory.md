# Memory

```js
await plant.water( { amount : 200 } )
await plant.fertilize( { product : 'seaweed extract' } )
await plant.note( 'moved it next to the south window' )

plant.memory.daysSince( 'water' )   // 3
plant.memory.stats( 24 ).soil       // { n: 24, min: 41, max: 68, avg: 54.2, trend: -0.8 }
```

One readable JSON file you own, written atomically, with ring buffers so it never grows unbounded. A corrupt file is set aside rather than silently losing your history, and 1.x data migrates automatically.

```js
await plant.memory.forget()   // your data, your call
```
