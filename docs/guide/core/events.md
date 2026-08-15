# Events

The kernel turns readings into meaning, so your code reacts to conditions rather than polling numbers.

```js
plant.on( 'plant:thirsty', async e => {
  await openValve()
  await plant.water()
} )
```

`sensor:reading` · `sensor:error` · `plant:thirsty` · `plant:drowning` · `plant:too-hot` · `plant:too-cold` · `plant:too-dark` · `plant:too-bright` · `plant:stressed` · `plant:happy` · `plant:damaged` · `plant:spoke` · `vision:analysis` · `electro:analysis` · `spectral:sweep` · `alert` · `plugin:loaded` · `ai:request` · `ai:response` · `error`

Listeners may be async — `emit` awaits them. One listener throwing never stops the others or the monitoring loop, and an action taken inside a listener cannot feed back into the event that triggered it.

---
