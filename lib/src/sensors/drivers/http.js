/**
 * Generic HTTP/JSON sensor.
 *
 * The escape hatch: any device or service that can expose a JSON endpoint works
 * without writing a driver. A `map` translates that JSON's field names into
 * SmartPlant metrics, with dot-paths for nested payloads.
 */

import { SensorError } from '../../core/errors.js'
import { SensorDriver } from '../driver.js'

export class HttpSensor extends SensorDriver {

	static id       = 'http'
	static provides = [ 'temperature', 'humidity', 'soil', 'light', 'ph', 'conductivity' ]

	/**
	 * @param {object} [config]         - Options.
	 * @param {string} [config.url]     - Endpoint returning JSON.
	 * @param {object} [config.headers] - Extra request headers.
	 * @param {object} [config.map]     - Metric → dot-path in the response.
	 * @param {number} [config.timeout] - Request timeout (ms).
	 */
	constructor( config = {} ) {

		super( {
			id : HttpSensor.id,
			...config,
		} )

		if ( !config.url ) throw new SensorError( 'HTTP driver needs a { url }.' )
		this.url     = config.url
		this.headers = config.headers || {}
		this.map     = config.map || null
		this.timeout = config.timeout ?? 10_000

	}

	async read() {

		const ctrl  = new AbortController()
		const timer = setTimeout( () => ctrl.abort(), this.timeout )

		try {

			const res = await fetch( this.url, {
				headers : this.headers,
				signal  : ctrl.signal,
			} )
			if ( !res.ok ) throw new SensorError( `Sensor endpoint returned HTTP ${res.status}.`, { url : this.url } )
			const data = await res.json()

			const raw = this.map
				? Object.fromEntries( Object.entries( this.map ).map( ( [ metric, path ] ) => [ metric, dig( data, path ) ] ) )
				: data

			const reading = this.normalize( raw )
			if ( !SensorDriver.hasData( reading ) ) {

				throw new SensorError( 'HTTP endpoint returned no recognizable metrics. Provide a { map } to translate field names.', { received : Object.keys( data || {} ) } )

			}
			return reading

		}
		catch ( err ) {

			if ( err instanceof SensorError ) throw err
			if ( err.name === 'AbortError' ) throw new SensorError( `Sensor endpoint timed out after ${this.timeout}ms.`, { url : this.url } )
			throw new SensorError( `Cannot reach sensor endpoint: ${err.message}`, { url : this.url } )

		}
		finally {

			clearTimeout( timer )

		}

	}

}

/** Resolve `'a.b.0.c'` against an object. */
function dig( obj, path ) {

	return String( path ).split( '.' ).reduce( ( acc, k ) => ( acc == null ? undefined : acc[ k ] ), obj )

}
