# Beacon mode

The spectral module drives LEDs *at* a plant to measure what comes back. The same hardware switches fast enough to carry data, which turns a diagnostic instrument into a transmitter: on-off keying in amber, decoded by a neighbour's photodiode.

### The energy argument, stated correctly

It is tempting to say an LED pulse costs a hundredth of a radio packet. **It does not.** A BLE advertisement is one of the cheapest things a battery-powered device can do, and per bit delivered, blinking an LED is *worse*.

The real argument is narrower and it holds:

- Keeping a **Wi-Fi association** alive is expensive in a way an advertisement is not, and a node with minutes of charge cannot afford to associate.
- A radio that has **failed** transmits nothing at any price.
- In darkness the optical channel gets an enormous SNR for free.

So this is a fallback and a night channel — not a better radio.

| System state | Main channel | Optical | Why |
| --- | --- | --- | --- |
| Daylight, healthy | Wi-Fi / BLE / TCP | **off** | Radio is faster, cheaper per bit, and puts no light on a neighbour |
| Charge < 5%, or radio failed | *radios down* | **critical** | Not dying silently |
| Dark, healthy | *radio idle* | **quiet** | Same message, fewer and dimmer pulses |

### The half everyone forgets

An ambient light sensor integrates over hundreds of milliseconds and reports about once a second — correct for daylight, hopeless for anything modulated. Sampling at 1 Hz cannot recover a signal switching faster than 0.5 Hz, and no cleverness at the sending end changes that.

**So nothing transmits until a neighbour has declared a photodiode fast enough to decode it:**

```js
plant.colony.canSignal( 'fern' )
// { can: false, reason: 'slow-receiver',
//   why: '"fern" reads light with an ambient light sensor, which is far too slow
//         to decode a pulsed message. […] This link needs a photodiode on a fast
//         ADC at 1000 Hz or better on the receiving side.' }
```

A plant spending its last charge blinking at a lux sensor has not called for help. It has thrown the charge away and, worse, believes it was heard.

Amber at 590 nm is the carrier for the same reason it is the spectral **control** channel — minimal perturbation. Green at 530 nm is the fallback for a sender buried in a canopy, because green penetrates leaf tissue instead of being absorbed at the surface. And a message is still light landing on a plant, so **every transmission is booked against the receiver's dose ledger** like any other emission.
