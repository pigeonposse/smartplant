# Looking at itself

Two reviews that run themselves. One asks how the plant has been changing; the other asks whether the things measuring it can still be believed. Neither is much use alone: a plant that looks stable through a stuck sensor is not stable, it is **unmeasured**.

```js
await plant.checkup( { period : 'weekly' } )   // or 'monthly'
await plant.maintenance()
await plant.runDueReviews()                     // whatever is due, nothing else
```

Both run from the monitoring loop, so a long-lived plant reviews itself without anyone remembering to ask.

### The comparison has to be fair

Everything else in the library lives in the present or a short window. Nothing ever sat down and compared this week with last week on purpose — and the changes worth catching are exactly the ones no single reading is remarkable enough to trigger.

But the naive version of that comparison is mostly a measurement of the calendar. Days lengthen, the heating comes on, the sun moves off the windowsill. **A checkup that reports "soil is down 8%" without noticing the room is four degrees warmer has found the weather and labelled it the plant.**

So every comparison carries what the conditions did over the same span, and a finding whose likely driver moved with it is marked confounded:

```
conditions moved: temperature, soil
wellbeing: 95.8 → 76.2

  ⚠️  confounded · wellbeing
     Wellbeing fell 19.6 points over the week, but temperature and soil moved
     too, which is enough to explain it.
```

The system is looking for what it **cannot** explain by the room, because those are the findings worth acting on. It also refuses to compare spans that are not comparable — a full week against three days would report the difference in sampling as a difference in the plant.

Reviews are narrated deterministically, with no model involved, so they work offline and cannot embellish: *"Looking back over the week, I am much as I was."*
