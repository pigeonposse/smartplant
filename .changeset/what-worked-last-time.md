---
"smartplant": minor
---

**`plant.whatWorkedBefore( problem )`** — a ledger of what actually resolved each problem on this plant, and the control that stops it being superstition.

The library recorded that a problem happened and recorded that something was done; it never joined them up. Episodes now open and close on their own from the condition events, and care given while a problem is open is attributed to it. Care given while nothing is wrong is deliberately not recorded as treatment — routine watering on a healthy plant cures nothing, and counting it is how "watering fixes everything" gets learned.

The control is the design, not an option. Almost every plant problem resolves on its own, so recording "problem → did X → problem cleared" teaches with total confidence that X works, and so does everything else you did that week. Worse, a ledger used to *choose* the next action confirms itself: it recommends X, X gets credit again, X becomes doctrine. So every problem carries a base rate — how often and how fast it cleared with nothing done — and an action is credited only with what it achieved above that. Episodes with several simultaneous actions credit nothing and say why. Four episodes are required before anything is claimed, and confidence is capped at 0.7.

**Hysteresis is finally connected to something.** It was measured in one module, reported in another, and never acted on. `doseModifier()` closes that loop, asymmetrically: a plant that has become more reactive gets 60–75% of the previous dose, because the amount that used to be right now overshoots. A plant that has become *less* reactive does **not** get more — a reduced response is at least as often damage as tolerance, and root rot answers a bigger drink by getting worse. It holds the dose and asks why the response fell.

`systemDiagnosis()` gains a `learning` check that notices when something was done in every single episode, which leaves nothing to measure treatments against, and says what to do about it.
