/**
 * Firmware generation.
 *
 * The hardest step for most people is not the AI — it is getting a board to read
 * a sensor and put the number somewhere useful. This emits complete, compiling
 * projects for the common targets from the same config the library already uses,
 * so a sensor list becomes working firmware without writing any C++.
 *
 * Targets: Arduino/ESP32 sketch, ESP-IDF project, and a PlatformIO project that
 * builds either.
 */

/** Sensors this generator knows how to wire and read. */
export const SUPPORTED_SENSORS = {
	dht22 : {
		label   : 'DHT22 temperature + humidity',
		metrics : [ 'temperature', 'humidity' ],
		library : 'adafruit/DHT sensor library@^1.4.6',
		includes: [ '#include <DHT.h>' ],
		globals : pin => `DHT dht(${pin}, DHT22);`,
		setup   : () => 'dht.begin();',
		read    : () => [
			'float temperature = dht.readTemperature();',
			'float humidity = dht.readHumidity();',
		],
		fields  : [ 'temperature', 'humidity' ],
		defaultPin : 4,
	},
	dht11 : {
		label   : 'DHT11 temperature + humidity',
		metrics : [ 'temperature', 'humidity' ],
		library : 'adafruit/DHT sensor library@^1.4.6',
		includes: [ '#include <DHT.h>' ],
		globals : pin => `DHT dht(${pin}, DHT11);`,
		setup   : () => 'dht.begin();',
		read    : () => [
			'float temperature = dht.readTemperature();',
			'float humidity = dht.readHumidity();',
		],
		fields  : [ 'temperature', 'humidity' ],
		defaultPin : 4,
	},
	capacitive_soil : {
		label   : 'Capacitive soil moisture (analog)',
		metrics : [ 'soil' ],
		library : null,
		includes: [],
		globals : pin => `const int SOIL_PIN = ${pin};\nconst int SOIL_DRY = 3200;  // calibrate: raw value in air\nconst int SOIL_WET = 1300;  // calibrate: raw value in water`,
		setup   : () => '',
		read    : () => [
			'int soilRaw = analogRead(SOIL_PIN);',
			'// Capacitive probes read HIGH when dry, so the mapping is inverted.',
			'float soil = constrain(map(soilRaw, SOIL_DRY, SOIL_WET, 0, 100), 0, 100);',
		],
		fields  : [ 'soil' ],
		defaultPin : 34,
	},
	bh1750 : {
		label   : 'BH1750 light (I2C)',
		metrics : [ 'light' ],
		library : 'claws/BH1750@^1.3.0',
		includes: [ '#include <Wire.h>', '#include <BH1750.h>' ],
		globals : () => 'BH1750 lightMeter;',
		setup   : () => 'Wire.begin();\n  lightMeter.begin();',
		read    : () => [ 'float light = lightMeter.readLightLevel();' ],
		fields  : [ 'light' ],
		defaultPin : null,
	},
	ldr : {
		label   : 'LDR photoresistor (analog)',
		metrics : [ 'light' ],
		library : null,
		includes: [],
		globals : pin => `const int LDR_PIN = ${pin};`,
		setup   : () => '',
		read    : () => [
			'int ldrRaw = analogRead(LDR_PIN);',
			'// Rough lux approximation; an LDR is not a calibrated instrument.',
			'float light = ldrRaw * (1000.0 / 4095.0);',
		],
		fields  : [ 'light' ],
		defaultPin : 35,
	},
	ds18b20 : {
		label   : 'DS18B20 temperature (1-Wire)',
		metrics : [ 'temperature' ],
		library : 'milesburton/DallasTemperature@^3.11.0',
		includes: [ '#include <OneWire.h>', '#include <DallasTemperature.h>' ],
		globals : pin => `OneWire oneWire(${pin});\nDallasTemperature ds18b20(&oneWire);`,
		setup   : () => 'ds18b20.begin();',
		read    : () => [
			'ds18b20.requestTemperatures();',
			'float temperature = ds18b20.getTempCByIndex(0);',
		],
		fields  : [ 'temperature' ],
		defaultPin : 5,
	},
	electrode : {
		label   : 'Plant electrode / biopotential (analog)',
		metrics : [ 'voltage' ],
		library : null,
		includes: [],
		globals : pin => `const int ELECTRODE_PIN = ${pin};\nconst float ADC_REF_MV = 3300.0;\nconst int ADC_MAX = 4095;`,
		setup   : () => '// Highest attenuation: plant potentials are small and can swing negative\n  // relative to the reference electrode.\n  analogSetPinAttenuation(ELECTRODE_PIN, ADC_11db);',
		read    : () => [
			'// Oversample to lift the tiny biopotential out of the ADC noise floor.',
			'long electrodeSum = 0;',
			'for (int i = 0; i < 64; i++) { electrodeSum += analogRead(ELECTRODE_PIN); delayMicroseconds(200); }',
			'float voltage = (electrodeSum / 64.0) * (ADC_REF_MV / ADC_MAX);',
		],
		fields  : [ 'voltage' ],
		defaultPin : 36,
	},
}

/**
 * Generate an Arduino/ESP32 sketch.
 *
 * @param   {object}   [config]              - Options.
 * @param   {string[]|object[]} [config.sensors] - Sensor ids, or `{type, pin}`.
 * @param   {string}   [config.transport]    - `'mqtt'` | `'serial'` | `'http'`.
 * @param   {string}   [config.wifiSsid]     - Wi-Fi SSID.
 * @param   {string}   [config.wifiPassword] - Wi-Fi password.
 * @param   {string}   [config.mqttHost]     - Broker host.
 * @param   {number}   [config.mqttPort]     - Broker port.
 * @param   {string}   [config.topic]        - MQTT topic.
 * @param   {string}   [config.httpUrl]      - POST endpoint, for the http transport.
 * @param   {number}   [config.intervalMs]   - Publish interval.
 * @param   {string}   [config.board]        - `'esp32'` | `'arduino'`.
 * @returns {string}                         Sketch source.
 */
export function generateArduinoSketch( config = {} ) {

	const {
		transport = 'mqtt',
		wifiSsid = 'YOUR_WIFI_SSID',
		wifiPassword = 'YOUR_WIFI_PASSWORD',
		mqttHost = '192.168.1.100',
		mqttPort = 1883,
		topic = 'smartplant/plant/state',
		httpUrl = 'http://192.168.1.100:3000/reading',
		intervalMs = 60_000,
		board = 'esp32',
	} = config

	const sensors = normalizeSensors( config.sensors )
	const needsWifi = board === 'esp32' && transport !== 'serial'

	const includes = new Set()
	if ( needsWifi ) includes.add( '#include <WiFi.h>' )
	if ( needsWifi && transport === 'mqtt' ) includes.add( '#include <PubSubClient.h>' )
	if ( needsWifi && transport === 'http' ) includes.add( '#include <HTTPClient.h>' )
	for ( const s of sensors ) for ( const inc of s.spec.includes ) includes.add( inc )

	const globals = sensors.map( s => s.spec.globals( s.pin ) ).filter( Boolean )
	const setups  = sensors.map( s => s.spec.setup( s.pin ) ).filter( Boolean )
	const reads   = sensors.flatMap( s => s.spec.read( s.pin ) )
	const fields  = sensors.flatMap( s => s.spec.fields )

	return `/*
 * SmartPlant firmware — generated.
 *
 * Board:     ${board}
 * Sensors:   ${sensors.map( s => `${s.spec.label}${s.pin !== null ? ` (pin ${s.pin})` : ''}` ).join( ', ' ) || 'none' }
 * Transport: ${transport}
 *
 * Publishes a JSON reading that the SmartPlant "${transport}" sensor driver
 * consumes directly — no translation layer needed.
 *
 * Calibrate any analog sensor before trusting its numbers: the constants below
 * are sensible starting points, not measurements of your probe.
 */

${[ ...includes ].join( '\n' )}

${needsWifi ? `const char* WIFI_SSID = "${wifiSsid}";
const char* WIFI_PASSWORD = "${wifiPassword}";` : ''}
${needsWifi && transport === 'mqtt' ? `const char* MQTT_HOST = "${mqttHost}";
const int MQTT_PORT = ${mqttPort};
const char* MQTT_TOPIC = "${topic}";` : ''}
${needsWifi && transport === 'http' ? `const char* POST_URL = "${httpUrl}";` : ''}
const unsigned long INTERVAL_MS = ${intervalMs};

${globals.join( '\n' )}

${needsWifi && transport === 'mqtt' ? `WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);` : ''}

${needsWifi ? `void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}` : ''}

${needsWifi && transport === 'mqtt' ? `void connectMqtt() {
  while (!mqtt.connected()) {
    String clientId = "smartplant-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqtt.connect(clientId.c_str())) {
      Serial.println("MQTT connected");
    } else {
      Serial.print("MQTT failed, rc=");
      Serial.println(mqtt.state());
      delay(3000);
    }
  }
}` : ''}

void setup() {
  Serial.begin(115200);
  delay(100);
${setups.map( s => `  ${s}` ).join( '\n' )}
${needsWifi ? '  connectWifi();' : ''}
${needsWifi && transport === 'mqtt' ? '  mqtt.setServer(MQTT_HOST, MQTT_PORT);' : ''}
  Serial.println("SmartPlant firmware ready");
}

void loop() {
${needsWifi ? '  connectWifi();' : ''}
${needsWifi && transport === 'mqtt' ? '  connectMqtt();\n  mqtt.loop();' : ''}

${reads.map( r => `  ${r}` ).join( '\n' )}

  // Build the payload by hand: ArduinoJson is an extra dependency and the shape
  // here is fixed and small.
  String payload = "{";
${fields.map( ( f, i ) => `  payload += "${i ? ',' : ''}\\"${f}\\":" + String(${f}, 2);` ).join( '\n' )}
  payload += "}";

  Serial.println(payload);
${needsWifi && transport === 'mqtt' ? `  if (mqtt.connected()) {
    mqtt.publish(MQTT_TOPIC, payload.c_str());
  }` : ''}
${needsWifi && transport === 'http' ? `  {
    HTTPClient http;
    http.begin(POST_URL);
    http.addHeader("Content-Type", "application/json");
    int code = http.POST(payload);
    if (code <= 0) {
      Serial.print("POST failed: ");
      Serial.println(http.errorToString(code));
    }
    http.end();
  }` : ''}

  delay(INTERVAL_MS);
}
`.replace( /\n{3,}/g, '\n\n' )

}

/**
 * Generate a `platformio.ini` matching the sketch.
 *
 * @param   {object} [config] - Same options as `generateArduinoSketch`.
 * @returns {string}          File contents.
 */
export function generatePlatformIO( config = {} ) {

	const board     = config.board === 'arduino' ? 'uno' : 'esp32dev'
	const platform  = config.board === 'arduino' ? 'atmelavr' : 'espressif32'
	const sensors   = normalizeSensors( config.sensors )

	const libs = new Set()
	for ( const s of sensors ) if ( s.spec.library ) libs.add( s.spec.library )
	if ( config.board !== 'arduino' && ( config.transport ?? 'mqtt' ) === 'mqtt' ) libs.add( 'knolleary/PubSubClient@^2.8' )

	return `; SmartPlant — generated PlatformIO project
;
;   pio run -t upload    build and flash
;   pio device monitor   watch the serial output

[env:${board}]
platform = ${platform}
board = ${board}
framework = arduino
monitor_speed = 115200
${libs.size ? `lib_deps =\n${[ ...libs ].map( l => `    ${l}` ).join( '\n' )}` : ''}
`

}

/**
 * Generate an ESP-IDF `main.c`.
 *
 * ESP-IDF is the right target when the node must run for months on a battery:
 * it gives real control over deep sleep and power, which the Arduino layer hides.
 *
 * @param   {object} [config] - Options.
 * @returns {string}          Source.
 */
export function generateEspIdf( config = {} ) {

	const {
		wifiSsid = 'YOUR_WIFI_SSID',
		wifiPassword = 'YOUR_WIFI_PASSWORD',
		httpUrl = 'http://192.168.1.100:3000/reading',
		intervalMs = 300_000,
	} = config

	const sensors = normalizeSensors( config.sensors ).filter( s => s.pin !== null )

	return `/*
 * SmartPlant ESP-IDF firmware — generated.
 *
 * Reads the configured analog sensors, POSTs a JSON reading, then deep-sleeps.
 * Deep sleep is the point of using ESP-IDF here: between readings the board
 * draws microamps, which is what makes a battery-powered node last a season.
 *
 * Build:  idf.py set-target esp32 && idf.py build flash monitor
 */

#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_sleep.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "nvs_flash.h"
#include "driver/adc.h"

static const char *TAG = "smartplant";

#define WIFI_SSID     "${wifiSsid}"
#define WIFI_PASSWORD "${wifiPassword}"
#define POST_URL      "${httpUrl}"
#define SLEEP_US      (${Math.round( intervalMs / 1000 )}ULL * 1000000ULL)

static void wifi_init(void)
{
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASSWORD,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(esp_wifi_connect());

    /* Give the association a bounded window; on failure we sleep and retry
       next cycle rather than burning battery in a connect loop. */
    vTaskDelay(pdMS_TO_TICKS(8000));
}

static int read_adc_averaged(adc1_channel_t channel)
{
    long sum = 0;
    for (int i = 0; i < 32; i++) {
        sum += adc1_get_raw(channel);
        vTaskDelay(pdMS_TO_TICKS(2));
    }
    return (int)(sum / 32);
}

static void post_reading(const char *json)
{
    esp_http_client_config_t config = {
        .url = POST_URL,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 10000,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, json, strlen(json));

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "posted, status %d", esp_http_client_get_status_code(client));
    } else {
        ESP_LOGE(TAG, "post failed: %s", esp_err_to_name(err));
    }
    esp_http_client_cleanup(client);
}

void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    adc1_config_width(ADC_WIDTH_BIT_12);
${sensors.map( s => `    adc1_config_channel_atten(ADC1_CHANNEL_${adcChannel( s.pin )}, ADC_ATTEN_DB_11);  /* ${s.spec.label} */` ).join( '\n' )}

${sensors.map( s => `    int raw_${s.spec.fields[ 0 ]} = read_adc_averaged(ADC1_CHANNEL_${adcChannel( s.pin )});` ).join( '\n' )}

    char json[256];
    snprintf(json, sizeof(json), "{${sensors.map( s => `\\"${s.spec.fields[ 0 ]}\\":%d` ).join( ',' )}}"${sensors.length ? ',\n             ' + sensors.map( s => `raw_${s.spec.fields[ 0 ]}` ).join( ', ' ) : ''});
    ESP_LOGI(TAG, "reading: %s", json);

    wifi_init();
    post_reading(json);

    ESP_LOGI(TAG, "sleeping for %llu seconds", SLEEP_US / 1000000ULL);
    esp_deep_sleep(SLEEP_US);
}
`

}

/** Map an ESP32 GPIO to its ADC1 channel. */
function adcChannel( pin ) {

	const MAP = {
		36 : 0,
		37 : 1,
		38 : 2,
		39 : 3,
		32 : 4,
		33 : 5,
		34 : 6,
		35 : 7,
	}
	return MAP[ pin ] ?? 6

}

/** Accept `['dht22']` or `[{type:'dht22', pin:4}]` and fill in defaults. */
function normalizeSensors( sensors ) {

	const list = sensors?.length ? sensors : [ 'dht22', 'capacitive_soil' ]

	return list.map( entry => {

		const type = typeof entry === 'string' ? entry : entry.type
		const spec = SUPPORTED_SENSORS[ type ]
		if ( !spec ) {

			throw new Error( `Unknown sensor "${type}". Supported: ${Object.keys( SUPPORTED_SENSORS ).join( ', ' )}` )

		}
		return {
			type,
			spec,
			pin : typeof entry === 'object' && entry.pin !== undefined ? entry.pin : spec.defaultPin,
		}

	} )

}

/**
 * Generate a complete project: every file, keyed by relative path.
 *
 * @param   {object} [config]         - Options.
 * @param   {string} [config.target]  - `'arduino'` | `'platformio'` | `'esp-idf'`.
 * @returns {object}                  Path → file contents.
 */
export function generateProject( config = {} ) {

	const target = config.target || 'platformio'
	const sensors = normalizeSensors( config.sensors )

	const wiring = wiringGuide( sensors, config )

	if ( target === 'esp-idf' ) {

		return {
			'main/main.c'          : generateEspIdf( config ),
			'main/CMakeLists.txt'  : 'idf_component_register(SRCS "main.c" INCLUDE_DIRS "")\n',
			'CMakeLists.txt'       : 'cmake_minimum_required(VERSION 3.16)\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(smartplant)\n',
			'README.md'            : wiring,
		}

	}

	if ( target === 'arduino' ) {

		return {
			'smartplant/smartplant.ino' : generateArduinoSketch( config ),
			'README.md'                 : wiring,
		}

	}

	return {
		'src/main.cpp'   : generateArduinoSketch( config ),
		'platformio.ini' : generatePlatformIO( config ),
		'README.md'      : wiring,
	}

}

/** Wiring and setup notes, written alongside the code. */
function wiringGuide( sensors, config ) {

	const transport = config.transport || 'mqtt'

	return `# SmartPlant firmware

Generated for **${config.board || 'esp32'}**, publishing over **${transport}**.

## Wiring

| Sensor | Connection |
| --- | --- |
${sensors.map( s => `| ${s.spec.label} | ${s.pin === null ? 'I2C: SDA→GPIO21, SCL→GPIO22' : `signal → GPIO${s.pin}`}, VCC → 3V3, GND → GND |` ).join( '\n' )}

## Build

${config.target === 'esp-idf'
		? '```bash\nidf.py set-target esp32\nidf.py build flash monitor\n```'
		: config.target === 'arduino'
			? 'Open `smartplant/smartplant.ino` in the Arduino IDE, select your board, and upload.'
			: '```bash\npio run -t upload\npio device monitor\n```'}

## Connecting it to SmartPlant

${transport === 'mqtt'
		? `\`\`\`js
const plant = await createPlant( {
  sensor : { driver: 'mqtt', url: 'mqtt://localhost:1883', topic: '${config.topic || 'smartplant/plant/state'}' },
} )
\`\`\``
		: transport === 'serial'
			? `\`\`\`js
const plant = await createPlant( {
  sensor : { driver: 'serial', path: '/dev/ttyUSB0', baudRate: 115200 },
} )
\`\`\``
			: `Point the \`http\` driver at whatever endpoint receives the POST, or run a small
server that stores the last body and serves it as JSON.`}

## Calibration

Analog sensors are uncalibrated out of the box. For a capacitive soil probe,
read the raw value in dry air and in a glass of water, then set \`SOIL_DRY\` and
\`SOIL_WET\` to those two numbers. Until you do, the percentage is a guess.
`

}
