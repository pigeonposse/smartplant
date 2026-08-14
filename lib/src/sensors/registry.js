/**
 * Sensor registry.
 *
 * Holds driver classes by id and instantiates them on demand, so `sensor: 'mock'`
 * in config and `plant.registerSensor('my-rig', MyDriver)` are the same path.
 * Drivers with heavy or native dependencies are imported lazily.
 */

import { ConfigError, SensorError } from '../core/errors.js'
import { SensorDriver, METRIC_KEYS } from './driver.js'
import { ManualSensor } from './drivers/manual.js'
import { MockSensor } from './drivers/mock.js'

/** Lazily-imported drivers, keyed by id. */
const LAZY = {
	serial        : async () => ( await import( './drivers/serial.js' ) ).SerialSensor,
	homeassistant : async () => ( await import( './drivers/homeassistant.js' ) ).HomeAssistantSensor,
	mqtt          : async () => ( await import( './drivers/mqtt.js' ) ).MqttSensor,
	http          : async () => ( await import( './drivers/http.js' ) ).HttpSensor,
	electrode     : async () => ( await import( './drivers/electrode.js' ) ).ElectrodeSensor,
	presence      : async () => ( await import( './drivers/presence.js' ) ).PresenceSensor,
	lidar         : async () => ( await import( './drivers/lidar.js' ) ).LidarSensor,
}

/** Ids the old 1.x API used, mapped onto the new drivers. */
const ALIASES = {
	dht22    : 'serial',
	arduino  : 'serial',
	raspberry: 'serial',
	simulated: 'mock',
	sim      : 'mock',
	hass     : 'homeassistant',
}

export class SensorRegistry {

	constructor() {

		/** @type {Map<string, Function>} id → driver class */
		this._classes   = new Map( [ [ 'mock', MockSensor ], [ 'manual', ManualSensor ] ] )
		/** @type {Map<string, SensorDriver>} id → live instance */
		this._instances = new Map()

	}

	/**
	 * Register a driver class or a ready-made instance.
	 *
	 * @param   {string}                 id     - Driver id.
	 * @param   {Function|SensorDriver}  driver - Class or instance.
	 * @returns {SensorRegistry}                this
	 */
	register( id, driver ) {

		if ( driver instanceof SensorDriver ) {

			driver.id = id
			this._instances.set( id, driver )

		}
		else if ( typeof driver === 'function' ) this._classes.set( id, driver )
		else throw new ConfigError( `Sensor "${id}" must be a SensorDriver subclass or instance.` )

		return this

	}

	resolveId( id ) {

		return ALIASES[ id ] || id

	}

	/**
	 * Get (creating if needed) a driver instance.
	 *
	 * @param   {string}                [id]     - Driver id.
	 * @param   {object}                [config] - Config passed to the constructor on first use.
	 * @returns {Promise<SensorDriver>}          The driver.
	 */
	async get( id = 'mock', config = {} ) {

		const key = this.resolveId( id )

		if ( this._instances.has( key ) ) return this._instances.get( key )

		let Cls = this._classes.get( key )
		if ( !Cls && LAZY[ key ] ) {

			Cls = await LAZY[ key ]()
			this._classes.set( key, Cls )

		}

		if ( !Cls ) {

			throw new SensorError(
				`Unknown sensor driver "${id}". Available: ${this.list().join( ', ' )}.`,
				{ requested : id },
			)

		}

		const instance = new Cls( {
			id : key,
			...config,
		} )
		this._instances.set( key, instance )
		return instance

	}

	/** Synchronous lookup of an already-created driver. */
	peek( id ) {

		return this._instances.get( this.resolveId( id ) ) || null

	}

	list() {

		return [ ...new Set( [ ...this._classes.keys(), ...Object.keys( LAZY ), ...this._instances.keys() ] ) ].sort()

	}

	async disconnectAll() {

		await Promise.allSettled( [ ...this._instances.values() ].map( d => d.disconnect?.() ) )

	}

}

/**
 * Merge readings from several drivers into one.
 * Earlier drivers win on conflicting metrics, so a real sensor can be layered
 * over a simulated baseline.
 *
 * @param   {import('./driver.js').Reading[]} readings - Readings to merge.
 * @returns {import('./driver.js').Reading}            Merged reading.
 */
export function mergeReadings( readings ) {

	const out = {
		timestamp : new Date(),
		source    : readings.map( r => r?.source ).filter( Boolean ).join( '+' ) || 'merged',
	}
	for ( const key of METRIC_KEYS ) {

		for ( const r of readings ) {

			if ( Number.isFinite( r?.[ key ] ) ) {

				out[ key ] = r[ key ]
				break

			}

		}

	}
	return out

}

export { SensorDriver, MockSensor, ManualSensor }
