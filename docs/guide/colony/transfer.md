# Knowledge transfer

A plant that has been in a room long enough to know it notices a newcomer that has not, and offers what it has learned about **this place**.

```js
await elder.colony.newcomers()      // who has not been here long
await elder.colony.teach( 'newcomer' ) // offer what the room does
await newcomer.colony.learnFromColony()
```

This replaced an earlier idea — succession, where a plant's knowledge is distributed when it dies. That framing had a fatal flaw: **the trigger is undecidable.** A dormant plant, a dead plant and a disconnected electrode look very similar electrically, and a false positive means distributing the estate of a plant that is merely asleep. "Has little local experience" is directly measurable, and being wrong about it is harmless — teach a plant that already knew, and its own evidence outweighs the lesson anyway.

What transfers is **knowledge of the room** (ranges, cadence, rhythm), not learned action policies, which are about the individual and its pot.

And several teachers become **one** lesson:

```
'3 neighbours contributed, but they share a room and are not independent
 witnesses to it. Merged into one lesson (agreement 0.934) rather than
 counted 3 times.'
```
