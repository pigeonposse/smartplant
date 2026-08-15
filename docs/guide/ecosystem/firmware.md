# Firmware generation

The hardest step is usually not the AI. It is getting a board to read a sensor and put the number somewhere useful.

```js
import { generateProject } from 'smartplant/firmware'

const files = generateProject( {
  target    : 'platformio',                        // or 'arduino' | 'esp-idf'
  sensors   : [ 'dht22', { type : 'capacitive_soil', pin : 34 } ],
  transport : 'mqtt',
  mqttHost  : '192.168.1.10',
} )
// { 'src/main.cpp': …, 'platformio.ini': …, 'README.md': … }
```

Complete compiling projects, with a wiring table and honest calibration notes. Seven sensors supported: **DHT22, DHT11, capacitive soil, BH1750, LDR, DS18B20, and plant electrodes** (with ADC oversampling to lift the tiny biopotential out of the noise floor).

The **ESP-IDF** target deep-sleeps between readings — microamps between samples is what makes a battery node last a season. The generated JSON payload is consumed directly by the matching SmartPlant driver, with no translation layer.
