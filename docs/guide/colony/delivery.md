# A second way through

A colony had exactly one transport. If it failed, messages went nowhere — and six call sites swallowed the failure with an empty `catch`, so a colony could be **entirely broken and look like it was working**. A plant could warn its neighbours about a pest, be told nothing had gone wrong, and have warned nobody.

The design is [**Maskpert**](https://github.com/AlejoMalia/lecc), the delivery layer of LECC, and it follows its five steps almost exactly: choose candidates, order by priority, fan out, confirm, spool what nobody took. Circuit breakers, hop trails and bounded queues are kept as they are.

```js
plant.colony.addLink( backupTransport, { name: 'backup', priority: 20 } )

await plant.colony.warnNeighbours( { near: { willow: 0.25 } } )
// { ok: true, delivered: [ 'backup' ], failed: { primary: 'socket closed' },
//   confirmedBy: null,
//   why: 'Delivered by backup, none of them a priority link — so it went, and
//         nothing here can promise it went by the route that matters.' }

plant.colony.deliveryHealth()
plant.colony.retryUndelivered()
```

Three things are different from a general delivery layer, and all three come from having a living thing at the other end rather than a service.

### Messages go off

A general layer replays a spooled message when the link returns. That is right for a service — a reading is a reading whenever it arrives. Here it lies: **"I am thirsty" delivered two hours late waters a plant that was watered ninety minutes ago**, and an aid-session frame arriving after the session closed describes light that is no longer falling on anything.

| Kind | Worth |
| --- | --- |
| `aid-frame` | 30 s — the session is live or it is over |
| `ask` / `reply` | 1 min |
| `chat` / `report` | 15 min |
| `priming` | 12 h — a warning is still a warning |
| `lesson`, `sos` | never expires |

What survives the wait arrives **carrying when it was written and flagged as late**. Late and current are different facts, and the receiver is told which one it has.

### Fan-out duplicates, and here a duplicate *acts*

Sending across every healthy link means a message can arrive twice. In ordinary messaging that is noise; in this colony a second copy of a request opens a **second aid session**, and a second pest warning shortens an already shortened inspection interval again. The receiving side drops ids it has seen, and that is not optional.

### Some links bill the plant at the other end

The part no general-purpose delivery layer can model, because no general-purpose link harms its recipient. Talking by light at night puts light on a resting plant — metered, booked against *that plant's* dose ledger, paid by somebody who did not ask for the message.

```
costs the receiving plant 1 and this message is not urgent enough to spend that
```

So a link carries two prices and the receiver's dominates. A selector weighing only latency would reach for the optical link the moment TCP got slow, and take a neighbour's circadian rhythm to save two hundred milliseconds. Only `sos` and `priming` are worth spending it.

This is also what turns [beacon mode](/guide/colony/beacon) from a hardcoded special case into an ordinary link.

### And an emulated link never confirms

Standing in for a transport that will not start keeps routing and metrics meaningful. But a stand-in that reported success would recreate exactly what the beacon layer exists to prevent — a plant that *believes* it called for help. An emulated link may hold a message. It may never claim it arrived.
