# What worked last time

The library recorded that a problem happened, and recorded that something was done. It never joined them up — so every time a familiar problem came back, the system met it as though for the first time, with no access to the fact that this plant has been here four times before and one particular thing helped.

```js
await plant.whatWorkedBefore( 'plant:thirsty' )
```

Episodes open and close on their own from the condition events, and care given while a problem is open is attributed to it. Care given while nothing is wrong is deliberately **not** recorded as treatment: routine watering on a healthy plant cures nothing, and counting it is exactly how *"watering fixes everything"* gets learned.

### The control is the design, not an option

Almost every plant problem resolves on its own. Soil dries and gets watered on the usual schedule; a hot afternoon passes; a droop recovers overnight. Record "problem → I did X → problem went away" and you will learn with total confidence that X works. So will everything else you happened to do that week.

And because a ledger like this is used to *choose* the next action, **it confirms itself**. It recommends X, X gets credit again, X becomes doctrine. A resolution ledger without a control is a machine for manufacturing superstition, and it is worse than no ledger at all, because it is confident.

So every problem carries a **base rate**: how often, and how fast, it cleared when nothing was done. An action is credited only with what it achieved *above* that.

```
🚫  "water" cleared it 100% of the time against 100% for doing nothing — a
    difference of 0, which is inside the noise for 5 episodes. This plant has
    probably been recovering on its own.

✅  "water" resolved "thirsty" in 5 episodes where it was the only thing done —
    100% against 20% for waiting, and about 52h sooner.
```

Two more ways it would otherwise lie, both refused:

- **Everything at once.** Water, feed and move a plant on the same afternoon and no arithmetic recovers which one helped. Credit comes only from episodes where an action appeared alone; the rest are reported as unattributable, with *"change one thing at a time if you want this to learn."*
- **Tiny n.** A houseplant produces perhaps three or four episodes of a given problem in a year. Four are required before anything is claimed, and confidence is capped at 0.7 however many there are.


### The same problem is not the same problem

"Thirsty" in dry air at 31°C and "thirsty" in still humid air at 17°C share a name and very little else: different cause, different urgency, quite possibly a different fix. Pooling them produces an average treatment for a situation nobody is in.

So episodes carry the conditions they began in, and the lookup narrows to the ones that actually resemble now:

```
pooled, ignoring conditions   →  water works       (lift 0.5)
today it is hot and dry       →  water works       (lift 1.0)
today it is cool and humid    →  water adds nothing — it was recovering anyway
```

When too few past episodes match, the wider answer is given **with that fact attached** rather than silently — because "what works for this problem" and "what works for this problem in weather like today" are different questions.

### Asking the colony

A plant that has met a problem twice, next to a neighbour that has met it twenty times, should be able to ask.

```js
await plant.colony.askColonyWhatWorked( 'plant:thirsty' )
```

Three things separate this from a rumour mill:

- **Same species only.** What resolves drought in a succulent is not what resolves it in a fern, and a confident answer from the wrong species is worse than none.
- **The base rate travels with the answer.** *"Watering worked every time"* is not information. *"Watering worked every time, and it cleared on its own nine times in ten anyway"* is the same sentence meaning the opposite. Without the second half, a neighbour's routine gets adopted as a cure.
- **The room is one witness.** Neighbours are pooled into a single finding, never counted as independent replication — they share a window, a watering can and a human.

A neighbour's experience is capped at **0.45 confidence**, below anything this plant's own record can earn, and `whatWorkedBefore()` only reaches for it when the plant has nothing of its own to go on. It is another pot, in another spot: worth trying, not worth trusting over what happened here.

### Hysteresis finally does something

The library already measured whether a plant answers the same stimulus differently since a stress episode. It then did nothing with it — measured in one module, reported in another, never acted on. `doseModifier()` closes that loop, and the mapping is deliberately **asymmetric**:

| Response now | What happens |
| --- | --- |
| **stronger / faster** | Cut the dose to 60–75%. The amount that used to be right now overshoots. |
| **weaker / slower** | **Hold, and look.** Do *not* give more. |

That second row is the important one. A reduced response is at least as often damage as tolerance, and root rot answers a bigger drink by getting worse. The tempting move there is the harmful one, so the system refuses to make it and asks why the response fell instead.
