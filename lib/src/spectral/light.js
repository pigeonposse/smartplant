/**
 * Light actuator contract and drivers.
 *
 * A light driver's only job is: given a set of channel intensities, make the
 * lamp emit them, and report honestly what it actually did. Everything above —
 * probe sequencing, dose limits, interpretation — lives elsewhere.
 *
 * Intensities are 0-1 per channel. Absolute irradiance depends on the fixture,
 * its distance and its optics, none of which the software can know; a driver
 * that has been calibrated can declare `irradiance` in µmol·m⁻²·s⁻¹ per channel
 * at full scale, and the dose accounting will use it. Without calibration the
 * system tracks *time* rather than pretending to know photon flux.
 */

import { SmartPlantError } from '../core/errors.js'
import { BAND_IDS } from './wavelengths.js'

/**
 * @typedef {Record<string, number>} Emission
 * Band id → intensity 0-1. Absent bands are off.
 */

export class LightDriver {

	/**
	 * @param {object}   [config]              - Options.
	 * @param {string[]} [config.channels]     - Band ids this fixture can emit.
	 * @param {object}   [config.irradiance]   - Band → µmol·m⁻²·s⁻¹ at full scale.
	 * @param {number}   [config.maxTotal]     - Cap on the sum of intensities.
	 */
	constructor( config = {} ) {

		this.config     = config
		this.id         = config.id || this.constructor.id || 'light'
		this.channels   = config.channels || this.constructor.channels || [ 'blue', 'green', 'red' ]
		this.irradiance = config.irradiance || null
		// Many fixtures brown out or overheat if every channel runs flat out.
		this.maxTotal   = config.maxTotal ?? 2
		this.connected  = false

		/** @type {Emission} */
		this.current    = {}

		const unknown = this.channels.filter( c => !BAND_IDS.includes( c ) )
		if ( unknown.length ) {

			throw new SmartPlantError( `Unknown light channel(s): ${unknown.join( ', ' )}.`, 'CONFIG_ERROR' )

		}

	}

	async connect() {

		this.connected = true
		return this

	}

	async disconnect() {

		await this.off()
		this.connected = false
		return this

	}

	/** Can this fixture emit a band at all? */
	supports( bandId ) {

		return this.channels.includes( bandId )

	}

	/**
	 * Clamp a requested emission to what the fixture can actually do.
	 *
	 * Returns what will be emitted plus what was dropped, so a caller is never
	 * misled into thinking a channel fired when the lamp has no such LED.
	 *
	 * @param   {Emission} emission - Requested.
	 * @returns {{emission: Emission, unsupported: string[], scaled: boolean}} Resolved.
	 */
	resolve( emission ) {

		const out = {}
		const unsupported = []

		for ( const [ bandId, level ] of Object.entries( emission || {} ) ) {

			if ( !this.supports( bandId ) ) {

				unsupported.push( bandId )
				continue

			}
			out[ bandId ] = Math.min( 1, Math.max( 0, Number( level ) || 0 ) )

		}

		const total = Object.values( out ).reduce( ( a, b ) => a + b, 0 )
		let scaled = false

		if ( total > this.maxTotal && total > 0 ) {

			const factor = this.maxTotal / total
			for ( const k of Object.keys( out ) ) out[ k ] = Number( ( out[ k ] * factor ).toFixed( 4 ) )
			scaled = true

		}

		return {
			emission : out,
			unsupported,
			scaled,
		}

	}

	/**
	 * Emit. Subclasses implement `_apply`.
	 *
	 * @param   {Emission}        emission - Band → 0-1.
	 * @returns {Promise<object>}          What was actually emitted.
	 */
	async emit( emission ) {

		if ( !this.connected ) await this.connect()

		const resolved = this.resolve( emission )
		await this._apply( resolved.emission )
		this.current = resolved.emission

		return {
			...resolved,
			at : Date.now(),
		}

	}

	/** All channels off. Always available, and the state the system fails into. */
	async off() {

		return this.emit( {} )

	}

	async _apply() {

		throw new Error( `${this.constructor.name} must implement _apply()` )

	}

	/**
	 * Photon flux for an emission, when the fixture has been calibrated.
	 *
	 * @param   {Emission}     emission - Emission.
	 * @returns {number|null}           µmol·m⁻²·s⁻¹, or null if uncalibrated.
	 */
	flux( emission = this.current ) {

		if ( !this.irradiance ) return null

		let total = 0
		for ( const [ bandId, level ] of Object.entries( emission ) ) {

			total += ( this.irradiance[ bandId ] || 0 ) * level

		}
		return Number( total.toFixed( 3 ) )

	}

}

/**
 * Simulated lamp.
 *
 * Records every emission with its timestamp, so the whole probe/analysis stack
 * is testable — and demonstrable in a workshop — with no LED attached.
 */
export class MockLight extends LightDriver {

	static id       = 'mock'
	static channels = [ 'uva', 'blue', 'green', 'amber', 'red', 'farRed' ]

	constructor( config = {} ) {

		super( {
			id : MockLight.id,
			channels : config.channels || MockLight.channels,
			...config,
		} )

		/** @type {{at: number, emission: Emission}[]} */
		this.log = []

	}

	async _apply( emission ) {

		this.log.push( {
			at : Date.now(),
			emission : { ...emission },
		} )
		if ( this.log.length > 5000 ) this.log.shift()

	}

	/** Seconds each band has been on, from the log. */
	onSeconds() {

		const totals = {}
		for ( let i = 1; i < this.log.length; i++ ) {

			const dt = ( this.log[ i ].at - this.log[ i - 1 ].at ) / 1000
			for ( const [ b, level ] of Object.entries( this.log[ i - 1 ].emission ) ) {

				if ( level > 0 ) totals[ b ] = ( totals[ b ] || 0 ) + dt

			}

		}
		return totals

	}

}

/**
 * Serial lamp — an ESP32 or Arduino driving LED channels.
 *
 * Speaks one JSON line per command, which is what the generated firmware
 * expects: `{"blue":0.8,"red":0}`.
 */
export class SerialLight extends LightDriver {

	static id       = 'serial'
	static channels = [ 'blue', 'green', 'red', 'farRed' ]

	constructor( config = {} ) {

		super( {
			id : SerialLight.id,
			...config,
		} )

		this.path     = config.path || '/dev/ttyUSB0'
		this.baudRate = config.baudRate || 115200
		this.port     = null

	}

	async connect() {

		if ( this.connected ) return this

		let SerialPort
		try {

			( { SerialPort } = await import( 'serialport' ) )

		}
		catch ( err ) {

			throw new SmartPlantError(
				'The serial light driver needs "serialport". Install it with: npm install serialport',
				'CONFIG_ERROR',
				{ cause : err.message },
			)

		}

		await new Promise( ( resolve, reject ) => {

			this.port = new SerialPort( {
				path     : this.path,
				baudRate : this.baudRate,
			}, err => err ? reject( new SmartPlantError( `Cannot open light port ${this.path}: ${err.message}`, 'CONFIG_ERROR' ) ) : resolve() )

		} )

		this.connected = true
		return this

	}

	async _apply( emission ) {

		// Send every channel explicitly, including zeros: a partial command would
		// leave a channel latched on from a previous emission.
		const payload = {}
		for ( const c of this.channels ) payload[ c ] = emission[ c ] ?? 0

		await new Promise( ( resolve, reject ) => {

			this.port.write( JSON.stringify( payload ) + '\n', err => ( err ? reject( err ) : resolve() ) )

		} )

	}

	async disconnect() {

		await this.off().catch( () => {} )
		if ( this.port?.isOpen ) await new Promise( r => this.port.close( r ) )
		this.connected = false
		return this

	}

}

/**
 * MQTT lamp — for fixtures behind ESPHome, Tasmota or Zigbee2MQTT.
 */
export class MqttLight extends LightDriver {

	static id       = 'mqtt'
	static channels = [ 'blue', 'green', 'red' ]

	constructor( config = {} ) {

		super( {
			id : MqttLight.id,
			...config,
		} )

		this.url    = config.url || process.env.MQTT_URL || 'mqtt://localhost:1883'
		this.topic  = config.topic || 'smartplant/light/set'
		this.client = null

	}

	async connect() {

		if ( this.connected ) return this

		let mqtt
		try {

			mqtt = ( await import( 'mqtt' ) ).default

		}
		catch ( err ) {

			throw new SmartPlantError( 'The MQTT light driver needs the "mqtt" package.', 'CONFIG_ERROR', { cause : err.message } )

		}

		this.client = mqtt.connect( this.url, {
			username : this.config.username,
			password : this.config.password,
		} )

		await new Promise( ( resolve, reject ) => {

			const onError = e => reject( new SmartPlantError( `Cannot reach broker ${this.url}: ${e.message}`, 'CONFIG_ERROR' ) )
			this.client.once( 'error', onError )
			this.client.once( 'connect', () => {

				this.client.removeListener( 'error', onError )
				resolve()

			} )

		} )

		this.connected = true
		return this

	}

	async _apply( emission ) {

		const payload = {}
		for ( const c of this.channels ) payload[ c ] = emission[ c ] ?? 0

		await new Promise( ( resolve, reject ) => {

			this.client.publish( this.topic, JSON.stringify( payload ), err => ( err ? reject( err ) : resolve() ) )

		} )

	}

	async disconnect() {

		await this.off().catch( () => {} )
		if ( this.client ) await new Promise( r => this.client.end( false, {}, r ) )
		this.connected = false
		return this

	}

}

/**
 * Callback lamp — the escape hatch for any fixture with its own SDK: Philips
 * Hue, DMX, a GPIO PWM library, a WLED controller.
 */
export class CallbackLight extends LightDriver {

	static id = 'callback'

	constructor( config = {} ) {

		super( {
			id : CallbackLight.id,
			...config,
		} )

		if ( typeof config.apply !== 'function' ) {

			throw new SmartPlantError( 'CallbackLight needs an { apply } function.', 'CONFIG_ERROR' )

		}
		this._applyFn = config.apply

	}

	async _apply( emission ) {

		return this._applyFn( emission )

	}

}

/**
 * Build a driver from a short config.
 *
 * @param   {object|LightDriver} spec - `{ driver: 'mock', ... }` or an instance.
 * @returns {LightDriver}             The driver.
 */
export function createLight( spec ) {

	if ( spec instanceof LightDriver ) return spec

	const { driver = 'mock', ...config } = spec || {}

	switch ( driver ) {

		case 'mock'     : return new MockLight( config )
		case 'serial'   : return new SerialLight( config )
		case 'mqtt'     : return new MqttLight( config )
		case 'callback' : return new CallbackLight( config )
		default:
			throw new SmartPlantError( `Unknown light driver "${driver}". Use mock, serial, mqtt or callback.`, 'CONFIG_ERROR' )

	}

}
