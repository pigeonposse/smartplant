# Sensors

| Driver | Needs | For |
| --- | --- | --- |
| `mock` | nothing | Trying it out — a simulated plant that dries out on a day/night cycle |
| `manual` | nothing | You measure with a €5 stick or a finger, and type it in |
| `serial` | `serialport` | Arduino / ESP32 over USB (CSV or JSON lines) |
| `mqtt` | `mqtt` | ESPHome, Tasmota, Zigbee2MQTT |
| `homeassistant` | a token | Any sensor you already expose in Home Assistant |
| `http` | nothing | Any device or service with a JSON endpoint |
| `electrode` | nothing (synthetic) or `serialport` | Plant biopotentials — see [Electrophysiology](/guide/plant/electrophysiology) |
| `thermal` | a frame callback | The whole canopy at once — see [Vision](/guide/plant/vision) |
| `presence` | a sample callback | Occupancy from a WiFi radio: the UV-B interlock, and motion as a control |
| `lidar` | a scan callback | Distances to what is actually around the pot |

Twenty-four recognized metrics, in four layers:

| Layer | Metrics |
| --- | --- |
| Around the plant | `temperature` · `humidity` · `soil` · `light` · `ph` · `conductivity` · `voltage` · `activity` · `co2` · `weight` |
| The plant itself | `leafTemperature` · `stemDiameter` · `sapFlow` · `stomatalConductance` · `chlorophyll` · `fvfm` · `impedance` |
| The root zone | `soilTemperature` · `matricPotential` · `soilOxygen` · `reservoir` |
| The air | `par` · `redFarRed` · `airflow` |

Nothing requires the last three groups. Every layer that can use them degrades cleanly without them and says which inference it could not make.

Bring your own driver:

```js
import { SensorDriver } from 'smartplant'

class MyRig extends SensorDriver {
  static id = 'my-rig'

  async read() {
    // normalize() drops non-numeric values and stamps the timestamp
    return this.normalize( { soil : await readMyProbe(), ph : 6.4 } )
  }
}

plant.registerSensor( 'my-rig', MyRig )
await plant.attachSensor( 'my-rig' )
```

Several drivers can run at once; readings merge, with earlier drivers winning on conflicts. A failing sensor never costs you the others.

### Celsius or Fahrenheit

`units: 'imperial'` prints Fahrenheit everywhere a person reads a number — the status line, the dashboard cards, the comfortable bands. Metric is the default and it is **not** guessed from your locale: a Canadian laptop set to `en-US` would flip every temperature on the screen, and the only symptom would be numbers that still look like plausible temperatures.

It is a display setting and nothing below the display knows about it. Every threshold, every archetype band, the Tetens equation behind VPD and the thermal stress index are in Celsius and stay there; the unit is applied at the last possible moment. A number that changes unit as it travels between layers eventually arrives somewhere still carrying the wrong one, and that failure is silent — **70 is a comfortable room in Fahrenheit and lethal in Celsius**, and both pass every range check in the library.

Which is why a probe declares its own unit separately, at the wire:

```js
sensor : { driver : 'serial', port : '/dev/ttyUSB0', unit : 'F' }
```

Plenty of probes sold in the US report Fahrenheit. That is a fact about the hardware, not a preference about the screen, and conflating the two is how somebody who picked Fahrenheit *because they think in it* ends up double-converting a probe that was already Celsius. Declared here, the reading is converted once on the way in and everything downstream may assume Celsius without checking.

And a probe that lies about its unit is named rather than quietly fixed:

```
🔴  units   72°C is hotter than any room a plant survives in, and it is almost exactly
            what a Fahrenheit probe declared as Celsius looks like — 72°F is 22.2°C,
            which is an ordinary room.
```

Rescaling it at the display would hide the mislabelling for the life of the plant while every threshold underneath carried on reading the wrong number.
