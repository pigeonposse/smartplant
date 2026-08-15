# Integrations

```js
import {
  InfluxExporter, HomeAssistantPublisher, generateFlow, prometheusMetrics,
} from 'smartplant/integrations'

new InfluxExporter( { bucket : 'plants' } ).attach( plant )   // time series (v1 & v2)
await new HomeAssistantPublisher().attach( plant )            // MQTT discovery, real entities
generateFlow( { plantName : 'Ivy' } )                        // importable Node-RED flow
prometheusMetrics( plant )                                    // Grafana, Alertmanager
```

**Home Assistant discovery** registers every metric as a proper entity under one device, with correct units and device classes, so it lands in dashboards, history and automations with no user configuration. Combined with the `homeassistant` sensor driver, the loop closes in both directions.

**Node-RED flow generation** emits a complete importable flow — MQTT inputs, threshold checks, gauges and an alert path — so a SmartPlant config becomes a working visual automation in one paste.
