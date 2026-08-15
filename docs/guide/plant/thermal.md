# Thermal

A contact probe gives one number from one leaf. A thermal camera gives it for every pixel of the canopy, with nothing touching the plant.

**An uncalibrated sensor does not know the temperature.** A Lepton is accurate to about ±5 °C absolutely and to hundredths *relative to itself within one frame*. So it does not publish `leafTemperature` unless you declare it calibrated — feeding VPD a number with five degrees of error in it is worse than having none, because every inference downstream then looks complete.

What it publishes is the canopy's **spread**, which is a difference and survives the offset. And every useful measurement here happens to be a difference:

```js
stressIndex( frame, airTemp )
// { index: 0.83,
//   why: 'The canopy is only 1.0°C above the air, which means it has largely
//         stopped cooling itself. A leaf that is not evaporating is a leaf that
//         has shut its stomata — hours before it looks wilted.' }
```

The air temperature has to come from a **separate thermometer**. Reading it off the same frame would cancel the error out of both numbers and make their difference look perfect while meaning nothing.

It sees one thing no contact probe can — half a canopy transpiring and half not, which is a blocked vessel or a branch in a draught long before it is visible, and a clip reports whichever leaf it was on. And a plant that has stopped transpiring altogether **vanishes into the wall behind it**, which is reported as a finding rather than as a failure to find one.

No camera library is imported: `flir-lepton` and the rest are third-party, several need a native build, and they change. The driver takes a callback, as presence and lidar do.
