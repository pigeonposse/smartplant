# Security priming

Priming is well established: expose a plant to a low dose of a stress, or to a neighbour's alarm, and it does not mount a defence — it becomes *ready* to. Defence transcripts sit poised, and when the attack arrives the response is faster and larger. The plant pays very little until the threat is real.

The colony channel already carries the warning. This is what a warned plant can **do** with it.

### Three things it deliberately does not do

**It does not lower red:far-red.** The instinct is that low R:FR signals threat and should push toward defence. It is precisely backwards — inactivating phytochrome B *suppresses* jasmonate and salicylate responsiveness. It is the canonical growth-defence trade-off: a plant that believes it is being shaded out spends on stem elongation and **disinvests from defence**. Pairing a UV-B pulse with low R:FR would induce defence with one hand and switch it off with the other. Here R:FR is held **high**.

**It does not drive the electrode.** That micro-currents alter membrane potential is real. That there is a dosable, reproducible protocol for closing stomata to a chosen percentage with 0.5–2 µA is not, and a system that injects current into living tissue on the strength of a plausible mechanism has stopped being an instrument. The electrode stays a **witness** — it reports whether the priming is landing.

**It does not accept a warning from anywhere.** A pest outbreak two thousand kilometres away, on the same species, says almost nothing about this room — and a global alert ring would contradict this library's own doctrine on transferability. Proximity is the whole signal, because the thing being warned about physically travels.

| Ring | Range | Weight | Why |
| --- | --- | --- | --- |
| contact | ≤ 0.4 m | 1.0 | Mites walk this; there is no gap to cross |
| room | ≤ 8 m | 0.6 | Same air, same watering can, same hands |
| building | ≤ 60 m | 0.25 | Worth knowing, not worth spending on alone |
| beyond | — | **0** | *"A pest on the same species in another city is a fact about that city."* |

Multiplied by host relevance: same species `×1`, same archetype `×0.5`, unrelated `×0.25` — discounted, not dismissed, because a spider mite eats almost anything.

### Priming is a cost, so it can be refused

```js
considerAlert( plant, alert )
// { prime: false, blocked: 'stress_load',
//   why: '… Priming costs a plant real resources — phenolics and flavonoids are
//         built out of carbon that would otherwise be growth — and asking that of
//         a plant already running on reduced capacity trades a possible threat
//         for a certain cost. Watching instead.' }
```

### The protocol, ordered by cost

`airflow → uvb → watch → stand-down`

**Airflow** runs first and always: it breaks the leaf boundary layer, drier surfaces are worse for spore germination, and it costs the plant almost nothing.

**UV-B** is real — it activates UVR8, driving phenolics and flavonoids that toughen leaf tissue, and it is used commercially in glasshouses. It is also the most dangerous thing this library can emit, so it is **off by default** and passes five interlocks:

| Interlock | Refusal |
| --- | --- |
| Not enabled per-installation | It can injure the person in the room, so it is opt-in, never inherited |
| Fixture has no UV-B channel | Nothing in the visible spectrum substitutes — UVR8 does not absorb it |
| **Room is occupied** | Burns skin and eyes, and a plant on a shelf is at eye height |
| Alert weight < 0.5 | The strongest intervention is held for a close, host-relevant threat |
| 90 s/day cap | *"cannot be raised by a caller"* — the response **is** a response to DNA damage |

**Stand-down is mandatory** after six hours unless the warning is renewed. A primed state nobody stands down is the growth-defence trade-off paid forever for a threat that passed.
