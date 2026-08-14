/**
 * A catalogue of what you can plug in, and what it gives you.
 *
 * The work of wiring a plant is rarely the code. It is finding out that a
 * capacitive probe needs calibrating in air and in water before its percentage
 * means anything, that a DS18B20 wants a 4.7kΩ pull-up, that a lux meter is
 * measuring the wrong thing entirely if what you want is photosynthesis. That
 * research is the same for everybody and nobody should do it twice.
 *
 * So this is a catalogue: for each device, what it actually measures, in what
 * units, over which interface, with the wiring and calibration notes that decide
 * whether the number means anything — and a ready configuration for the generic
 * driver that talks to it.
 *
 * ## What this is not
 *
 * It is not a claim that any of these has been tested. **None of them has**, and
 * none can be from inside a library: verifying a DS18B20 profile requires a
 * DS18B20. Every entry carries how far its support actually goes, and the three
 * levels mean different things:
 *
 *   `driver`   — the transport is implemented and tested. Anything speaking
 *                serial, MQTT or HTTP in the documented shape works today.
 *   `profile`  — the device's units, ranges and wiring are catalogued, and it
 *                talks over a transport that is implemented. Untested against
 *                the physical part.
 *   `declared` — known, described, and not supported. It needs an interface the
 *                library does not have, and says so rather than pretending.
 *
 * A profile that turns out to be wrong is a bug worth reporting. A profile
 * presented as verified would be a lie.
 */

/** How far support for a device actually goes. */
export const SUPPORT = {
	DRIVER   : 'driver',
	PROFILE  : 'profile',
	DECLARED : 'declared',
}

const d = spec => ( {
	support : SUPPORT.PROFILE,
	...spec,
} )

/** Devices, by the layer they measure. */
export const DEVICES = {

	// ── on the plant itself ─────────────────────────────────────────────────

	'electrode-ads1115' : d( {
		label     : 'Bioelectric electrode via ADS1115',
		layer     : 'plant',
		provides  : [ 'voltage', 'activity' ],
		interface : 'i2c → serial bridge',
		support   : SUPPORT.DRIVER,
		config    : {
			driver : 'electrode',
			transport : 'serial',
			sampleRate : 100,
		},
		notes : 'A 16-bit ADC is the minimum: plant potentials are millivolts riding on a large offset. Sample above 100Hz if there is mains nearby, or the hum folds down into the physiological band and cannot be filtered out afterwards.',
	} ),

	'leaf-ir-mlx90614' : d( {
		label     : 'MLX90614 infrared leaf thermometer',
		layer     : 'plant',
		provides  : [ 'leafTemperature' ],
		interface : 'i2c',
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Aim it at a leaf filling the whole field of view — it averages everything it sees, so a partial view reads the pot too. This one sensor unlocks real VPD and inferred stomatal opening, which is more than any other single addition.',
	} ),

	'dendrometer' : d( {
		label     : 'Stem dendrometer',
		layer     : 'plant',
		provides  : [ 'stemDiameter' ],
		interface : 'analog / LVDT',
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Micrometre-scale stem shrink and swell through the day is the most direct turgor signal there is. Mount it so thermal expansion of the bracket does not show up as growth.',
	} ),

	'sap-flow' : d( {
		label     : 'Sap flow sensor (heat pulse)',
		layer     : 'plant',
		provides  : [ 'sapFlow' ],
		interface : 'serial',
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Invasive — the needles go into the xylem. Meaningful on a woody stem, not on a seedling.',
	} ),

	'porometer' : d( {
		label     : 'Leaf porometer',
		layer     : 'plant',
		provides  : [ 'stomatalConductance' ],
		interface : 'handheld',
		config    : { driver : 'manual' },
		notes : 'Usually a handheld instrument rather than a fixed one, so `manual` is the honest driver: read it and enter the number.',
	} ),

	'chlorophyll-spad' : d( {
		label     : 'SPAD chlorophyll meter',
		layer     : 'plant',
		provides  : [ 'chlorophyll' ],
		interface : 'handheld',
		config    : { driver : 'manual' },
		notes : 'SPAD units are relative, not absolute chlorophyll. Useful as a trend for one plant; not for comparing two.',
	} ),

	'fluorometer-pam' : d( {
		label     : 'PAM fluorometer (Fv/Fm)',
		layer     : 'plant',
		provides  : [ 'fvfm' ],
		interface : 'handheld',
		support   : SUPPORT.DECLARED,
		notes : 'Needs dark adaptation before each measurement and specialist hardware. Catalogued so the metric exists; there is no automated path.',
	} ),

	// ── the root zone ───────────────────────────────────────────────────────

	'soil-capacitive' : d( {
		label     : 'Capacitive soil moisture probe',
		layer     : 'root',
		provides  : [ 'soil' ],
		interface : 'analog',
		support   : SUPPORT.DRIVER,
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Capacitive, not resistive: resistive probes corrode within weeks and drift the whole time. Calibrate in dry air and in water before the percentage means anything — uncalibrated, every threshold in this library is being applied to an arbitrary number.',
	} ),

	'soil-tdr' : d( {
		label     : 'TDR / volumetric water content probe',
		layer     : 'root',
		provides  : [ 'soil', 'conductivity', 'soilTemperature' ],
		interface : 'serial (SDI-12 / Modbus)',
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'The serious option: true volumetric water content, bulk EC and soil temperature from one probe, which between them unlock the uptake-balance and thermal-inertia readings.',
	} ),

	'tensiometer' : d( {
		label     : 'Tensiometer / matric potential sensor',
		layer     : 'root',
		provides  : [ 'matricPotential' ],
		interface : 'analog / serial',
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Measures the force a root must generate to drink, which is what the plant experiences. 30% moisture means entirely different things in coir and in clay; kPa means the same in both.',
	} ),

	'ec-probe' : d( {
		label     : 'Electrical conductivity probe',
		layer     : 'root',
		provides  : [ 'conductivity' ],
		interface : 'analog / i2c',
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Temperature-compensate it or the reading swings with the room. Paired with soil moisture it catches salt concentrating around the roots, which looks exactly like a plant drinking normally until it burns.',
	} ),

	'ph-probe' : d( {
		label     : 'Soil / solution pH probe',
		layer     : 'root',
		provides  : [ 'ph' ],
		interface : 'analog / i2c',
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Two-point calibration, and recalibrate periodically — the electrode ages. Nutrient availability is a function of pH, so a drifting probe silently misreports feeding.',
	} ),

	'ds18b20' : d( {
		label     : 'DS18B20 soil temperature probe',
		layer     : 'root',
		provides  : [ 'soilTemperature' ],
		interface : '1-wire',
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Wants a 4.7kΩ pull-up on the data line. Cheap, waterproof, and it gives the substrate thermal inertia reading — a moisture signal that does not depend on the moisture probe.',
	} ),

	'soil-oxygen' : d( {
		label     : 'Substrate oxygen sensor',
		layer     : 'root',
		provides  : [ 'soilOxygen' ],
		interface : 'analog / serial',
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'The direct measurement of root suffocation, which is otherwise inferred far too late from a plant already failing.',
	} ),

	'reservoir-float' : d( {
		label     : 'Reservoir level sensor',
		layer     : 'root',
		provides  : [ 'reservoir' ],
		interface : 'analog / digital',
		support   : SUPPORT.DRIVER,
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Automation that waters from an empty tank is worse than no automation, because it reports success.',
	} ),

	// ── the air ─────────────────────────────────────────────────────────────

	'par-quantum' : d( {
		label     : 'PAR / quantum sensor',
		layer     : 'air',
		provides  : [ 'par' ],
		interface : 'analog / i2c',
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Measures 400–700nm in µmol/m²/s: what a leaf can photosynthesise with. A lux meter is weighted for the human eye, which peaks in the green a plant reflects. They are not convertible except by a rough per-source factor.',
	} ),

	'spectrometer-as7341' : d( {
		label     : 'AS7341 multispectral sensor',
		layer     : 'air',
		provides  : [ 'redFarRed', 'par' ],
		interface : 'i2c',
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Gives the red to far-red ratio, which is how a plant detects shade and decides whether to stretch or flower.',
	} ),

	'co2-ndir' : d( {
		label     : 'NDIR CO₂ sensor (SCD30 / SCD41 / MH-Z19)',
		layer     : 'air',
		provides  : [ 'co2', 'temperature', 'humidity' ],
		interface : 'i2c / uart',
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'NDIR, not the cheap MOS "eCO2" parts — those infer CO₂ from unrelated volatiles and are not measuring carbon at all. Needs periodic fresh-air calibration.',
	} ),

	'dht22' : d( {
		label     : 'DHT22 temperature and humidity',
		layer     : 'air',
		provides  : [ 'temperature', 'humidity' ],
		interface : 'digital 1-wire',
		support   : SUPPORT.DRIVER,
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Adequate and slow. Both metrics feed VPD, which is the most useful derived number a cheap rig can produce.',
	} ),

	'sht31' : d( {
		label     : 'SHT31 / BME280 temperature and humidity',
		layer     : 'air',
		provides  : [ 'temperature', 'humidity' ],
		interface : 'i2c',
		support   : SUPPORT.DRIVER,
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Faster and more accurate than a DHT22, and worth the small extra cost because everything VPD-related inherits its error.',
	} ),

	'anemometer' : d( {
		label     : 'Airflow sensor',
		layer     : 'air',
		provides  : [ 'airflow' ],
		interface : 'analog / pulse',
		config    : {
			driver : 'serial',
			parse : 'json',
		},
		notes : 'Still air leaves a saturated boundary layer against the leaf, which stalls transpiration however good the VPD looks on paper.',
	} ),

	// ── seeing ──────────────────────────────────────────────────────────────

	'camera-rgb' : d( {
		label     : 'RGB camera',
		layer     : 'vision',
		provides  : [],
		interface : 'ffmpeg / file',
		support   : SUPPORT.DRIVER,
		config    : { source : {
			source : 'ffmpeg',
			device : '0',
		} },
		notes : 'Drives wilting detection, colour analysis and the visual half of the infection watch. Fix the exposure: auto white balance turns a lighting change into a health change.',
	} ),

	'camera-ndvi' : d( {
		label     : 'NDVI / multispectral camera',
		layer     : 'vision',
		provides  : [],
		interface : 'ffmpeg / file',
		support   : SUPPORT.DECLARED,
		notes : 'Near-infrared reflectance shows canopy stress before it is visible. Needs a NIR-converted sensor and a calibration target; no automated path here yet.',
	} ),

	// ── acting ──────────────────────────────────────────────────────────────

	'pump-peristaltic' : d( {
		label     : 'Peristaltic pump',
		layer     : 'actuator',
		provides  : [],
		interface : 'gpio / relay',
		support   : SUPPORT.DRIVER,
		config    : { driver : 'callback' },
		notes : 'Dose by time against a measured flow rate, and never open-loop: confirm the effect on soil moisture afterwards, or a blocked line reports success forever.',
	} ),

	'led-spectrum' : d( {
		label     : 'Tunable LED fixture',
		layer     : 'actuator',
		provides  : [],
		interface : 'pwm / serial / mqtt',
		support   : SUPPORT.DRIVER,
		config    : { light : {
			driver : 'serial',
			channels : [ 'blue', 'red', 'green', 'farRed' ],
		} },
		notes : 'Per-channel control is what makes the spectral system a probe rather than a lamp. The safety interlocks assume the lamp can always be turned off — wire the relay so a failure is dark, not on.',
	} ),

	'humidifier' : d( {
		label     : 'Ultrasonic humidifier / dehumidifier',
		layer     : 'actuator',
		provides  : [],
		interface : 'relay / mqtt',
		support   : SUPPORT.DRIVER,
		config    : { driver : 'callback' },
		notes : 'Act on VPD rather than on relative humidity: 60% RH is comfortable at 20°C and punishing at 30°C.',
	} ),

	// ── talking to a person ─────────────────────────────────────────────────
	// Nothing here senses the plant. These exist so a person can address it and
	// be answered out loud, which is a different thing from the plant having a
	// voice: `speak()` composes the words, and this is only how they leave the
	// machine.

	'speaker-i2s' : d( {
		label     : 'I2S amplifier and speaker',
		layer     : 'interface',
		provides  : [],
		interface : 'i2s',
		support   : SUPPORT.DECLARED,
		config    : { audio : { speaker : true } },
		notes : 'A way for the plant to be heard rather than read. Worth remembering that anything spoken aloud is spoken to whoever is in the room — this library is happy to say a plant is struggling, and a speaker publishes that to visitors.',
	} ),

	'mic-inmp441' : d( {
		label     : 'INMP441 MEMS microphone',
		layer     : 'interface',
		provides  : [],
		interface : 'i2s',
		support   : SUPPORT.DECLARED,
		config    : { audio : { microphone : true } },
		notes : 'For speaking *to* the plant — wake word, a spoken question, an answer through the speaker. It does not hear the plant: the acoustic emissions of a water-stressed plant are ultrasonic, 20-100kHz, and this microphone stops well below that. Anything claiming otherwise from an audible-range mic is hearing the room.',
	} ),

	'mic-ultrasonic' : d( {
		label     : 'Ultrasonic microphone (20-100kHz)',
		layer     : 'plant',
		provides  : [],
		interface : 'analogue → fast ADC',
		support   : SUPPORT.DECLARED,
		notes : 'The one that could genuinely listen to the plant. Drought-stressed and cut plants emit ultrasonic clicks from xylem cavitation, and the rate tracks water status. Declared rather than supported: separating those clicks from every other ultrasonic source in a house is the hard part, and this library will not pretend to have solved it.',
	} ),

	'proximity-vl53l0x' : d( {
		label     : 'VL53L0X time-of-flight rangefinder',
		layer     : 'air',
		provides  : [ 'range' ],
		interface : 'i2c',
		support   : SUPPORT.DECLARED,
		config    : { rangefinder : { driver : 'serial' } },
		notes : 'Two euros, and it fixes the weakest assumption in the coupling layer: how far apart two plants are is currently something a person typed, and everything about shared humidity and CO2 competition rests on it being true. This measures it. It also detects someone approaching, which is what the UV-B interlock needs.',
	} ),

	'photodiode-fast' : d( {
		label     : 'Photodiode on a fast ADC',
		layer     : 'air',
		provides  : [ 'light' ],
		interface : 'analogue → ADC ≥1kHz',
		support   : SUPPORT.DECLARED,
		config    : { optical : { sampleRateHz : 20_000 } },
		notes : 'Not a better lux sensor — a different instrument. An ambient light sensor integrates over hundreds of milliseconds and reports about once a second, which is right for daylight and useless for anything modulated. This is the only thing that can receive an optical beacon, and without one on the receiving side a plant blinking for help is talking to a wall.',
	} ),

	'wifi-csi-esp32s3' : d( {
		label     : 'ESP32-S3 with CSI firmware',
		layer     : 'air',
		provides  : [],
		interface : 'wifi → serial / mqtt',
		support   : SUPPORT.DRIVER,
		config    : { driver : 'presence', sensing : 'csi' },
		notes : 'Reads the room from the WiFi already in it — a body between two radios changes the signal, and the per-subcarrier detail is enough for presence and gross motion. It answers two things this library was short of: whether somebody is in the room, which is what the UV-B interlock needs, and whether anybody walked past at the moment of an electrical event, which is the commonest cause of an action potential that is not a wound. Not pose, not breathing, not counting people: those need an array of receivers and a model trained on your room.',
	} ),

	'wifi-rssi' : d( {
		label     : 'Any WiFi radio (RSSI only)',
		layer     : 'air',
		provides  : [],
		interface : 'wifi',
		support   : SUPPORT.DRIVER,
		config    : { driver : 'presence', sensing : 'rssi' },
		notes : 'One number for the whole signal rather than a value per subcarrier. It still moves when a body crosses the path, so presence and gross motion are legible and nothing finer is. Free if there is already a radio, and the honest half of what CSI hardware does.',
	} ),

	'lidar-360' : d( {
		label     : '360° scanning lidar (RPLIDAR class)',
		layer     : 'air',
		provides  : [],
		interface : 'serial / usb',
		support   : SUPPORT.DECLARED,
		config    : { spatial : true },
		notes : 'Two jobs, and the smaller one is the more useful. Mapping belongs with ROS2 and Nav2, which have spent a decade on it — this library defines what a map must guarantee before a pot crosses it and delegates the rest. But a *single* scan needs no map at all, and it measures the distance between two plants, which is the number every shared-humidity and CO2 conclusion has been resting on and which a person has been typing in.',
	} ),

	'co2-injector' : d( {
		label     : 'CO₂ injection valve',
		layer     : 'actuator',
		provides  : [],
		interface : 'relay',
		support   : SUPPORT.DECLARED,
		notes : 'CO₂ is dangerous to people in an enclosed room. Deliberately given no automated path: this belongs behind hardware interlocks the library has no way to verify.',
	} ),

}

/**
 * Look one up.
 *
 * @param   {string} id - Device id.
 * @returns {object|null} The profile.
 */
export function device( id ) {

	const found = DEVICES[ id ]
	return found ? {
		id,
		...found,
	} : null

}

/**
 * Everything, optionally filtered.
 *
 * @param   {object} [opts] - `{ layer, provides, support }`.
 * @returns {object[]}      Profiles.
 */
export function devices( opts = {} ) {

	return Object.entries( DEVICES )
		.map( ( [ id, v ] ) => ( {
			id,
			...v,
		} ) )
		.filter( x => !opts.layer || x.layer === opts.layer )
		.filter( x => !opts.support || x.support === opts.support )
		.filter( x => !opts.provides || ( x.provides || [] ).includes( opts.provides ) )

}

/**
 * Which devices would give you a metric you do not already have.
 *
 * Answers the question somebody deciding what to buy next actually has, ordered
 * by how much each one unlocks.
 *
 * @param   {string[]} have - Metrics already available.
 * @returns {object[]}      Suggestions, best first.
 */
export function suggest( have = [] ) {

	const has = new Set( have )

	return devices()
		.filter( x => x.support !== SUPPORT.DECLARED )
		.filter( x => ( x.provides || [] ).some( m => !has.has( m ) ) )
		.map( x => ( {
			id : x.id,
			label : x.label,
			layer : x.layer,
			adds : ( x.provides || [] ).filter( m => !has.has( m ) ),
			support : x.support,
			notes : x.notes,
		} ) )
		.sort( ( a, b ) => b.adds.length - a.adds.length )

}
