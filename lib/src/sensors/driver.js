/**
 * Sensor driver contract.
 *
 * A driver's only job is to produce a `Reading`. Everything else (comfort
 * ranges, alerting, history, AI) lives above it, so adding hardware support
 * never means touching the kernel.
 *
 * @typedef {object} Reading
 * @property {number}      [temperature] - Celsius.
 * @property {number}      [humidity]    - Air humidity, %.
 * @property {number}      [soil]        - Soil moisture, %.
 * @property {number}      [light]       - Lux.
 * @property {number}      [ph]          - Soil pH.
 * @property {number}      [conductivity]- Soil EC, µS/cm.
 * @property {Date|string} [timestamp]   - When it was taken.
 * @property {string}      [source]      - Driver id that produced it.
 */

/** Metric keys a reading may carry, with display metadata. */
export const METRICS = {
	temperature  : {
		unit : '°C',
		label : 'Temperature',
	},
	humidity     : {
		unit : '%',
		label : 'Humidity',
	},
	soil         : {
		unit : '%',
		label : 'Soil moisture',
	},
	light        : {
		unit : 'lux',
		label : 'Light',
	},
	ph           : {
		unit : '',
		label : 'Soil pH',
	},
	conductivity : {
		unit : 'µS/cm',
		label : 'Conductivity',
	},
	// Electrophysiology. `voltage` is the membrane/surface potential; `activity`
	// is a 0-100 index of how electrically busy the plant is.
	voltage      : {
		unit : 'mV',
		label : 'Potential',
	},
	activity     : {
		unit : '',
		label : 'Electrical activity',
	},
	co2          : {
		unit : 'ppm',
		label : 'CO₂',
	},
	weight       : {
		unit : 'g',
		label : 'Weight',
	},
}

export const METRIC_KEYS = Object.keys( METRICS )

/**
 * Base driver. Subclass and implement `read()`; override `connect`/`disconnect`
 * only when the transport needs setup.
 */
export class SensorDriver {

	/**
	 * @param {object} [config] - Driver configuration.
	 */
	constructor( config = {} ) {

		this.config    = config
		this.id        = config.id || this.constructor.id || 'sensor'
		this.connected = false
		/** Metrics this driver can actually produce. */
		this.provides  = config.provides || this.constructor.provides || METRIC_KEYS

	}

	/** Open the transport. Idempotent. */
	async connect() {

		this.connected = true
		return this

	}

	/** Close the transport. Idempotent. */
	async disconnect() {

		this.connected = false
		return this

	}

	/**
	 * Produce one reading.
	 *
	 * @returns {Promise<Reading>} The reading.
	 */
	async read() {

		throw new Error( `${this.constructor.name} must implement read()` )

	}

	/** Normalize whatever `read()` returned into a well-formed Reading. */
	normalize( raw = {} ) {

		/** @type {Reading} */
		const out = {
			timestamp : new Date(),
			source    : this.id,
		}
		for ( const key of METRIC_KEYS ) {

			const v = raw[ key ]
			if ( v === null || v === undefined || v === '' ) continue
			const n = Number( v )
			if ( Number.isFinite( n ) ) out[ key ] = n

		}
		return out

	}

	/** Whether the last read produced at least one usable metric. */
	static hasData( reading ) {

		return METRIC_KEYS.some( k => Number.isFinite( reading?.[ k ] ) )

	}

}
