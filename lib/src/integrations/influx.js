/**
 * InfluxDB time-series export.
 *
 * `PlantMemory` is a JSON file — right for one plant, wrong for a greenhouse of
 * two hundred sampled every ten seconds. This ships readings to InfluxDB over
 * its line protocol, using plain HTTP so there is no client dependency.
 *
 * Supports v2/v3 (`/api/v2/write`, token auth) and v1.8 (`/write`, user/pass).
 */

import { SmartPlantError } from '../core/errors.js'
import { METRIC_KEYS } from '../sensors/driver.js'

/**
 * `fetch` with a deadline.
 *
 * A request that is accepted and then never answered is worse than one that
 * fails: it never settles, so whatever awaited it waits forever.
 *
 * @param   {string} url    - Target.
 * @param   {object} [init] - Fetch init.
 * @param   {number} [ms]   - Deadline.
 * @returns {Promise<Response>} The response.
 */
async function withDeadline( url, init = {}, ms = 10000 ) {

	const ctrl = new AbortController()
	const timer = setTimeout( () => ctrl.abort(), ms )

	try {

		return await fetch( url, {
			...init,
			signal : ctrl.signal,
		} )

	}
	catch ( err ) {

		if ( err.name === 'AbortError' ) throw new Error( `InfluxDB did not answer within ${ms}ms.` )
		throw err

	}
	finally {

		clearTimeout( timer )

	}

}


export class InfluxExporter {

	/**
	 * @param {object} [config]              - Options.
	 * @param {string} [config.url]          - Base URL.
	 * @param {string} [config.token]        - v2 API token.
	 * @param {string} [config.org]          - v2 organization.
	 * @param {string} [config.bucket]       - v2 bucket, or v1 database.
	 * @param {string} [config.username]     - v1 username.
	 * @param {string} [config.password]     - v1 password.
	 * @param {number} [config.version]      - 1 or 2. Default 2.
	 * @param {string} [config.measurement]  - Measurement name. Default `plant`.
	 * @param {object} [config.tags]         - Tags applied to every point.
	 * @param {number} [config.batchSize]    - Points to buffer before flushing.
	 */
	constructor( config = {} ) {

		this.url         = ( config.url || process.env.INFLUX_URL || 'http://localhost:8086' ).replace( /\/+$/, '' )
		this.token       = config.token || process.env.INFLUX_TOKEN
		this.org         = config.org || process.env.INFLUX_ORG
		this.bucket      = config.bucket || process.env.INFLUX_BUCKET || 'smartplant'
		this.username    = config.username
		this.password    = config.password
		this.version     = config.version ?? 2
		this.measurement = config.measurement || 'plant'
		this.tags        = config.tags || {}
		this.batchSize   = config.batchSize ?? 1

		/** @type {string[]} */
		this._buffer = []

	}

	_endpoint() {

		if ( this.version === 1 ) {

			const params = new URLSearchParams( { db : this.bucket } )
			if ( this.username ) params.set( 'u', this.username )
			if ( this.password ) params.set( 'p', this.password )
			// Nanosecond precision is the line-protocol default; we emit ms.
			params.set( 'precision', 'ms' )
			return `${this.url}/write?${params}`

		}

		const params = new URLSearchParams( {
			bucket    : this.bucket,
			precision : 'ms',
		} )
		if ( this.org ) params.set( 'org', this.org )
		return `${this.url}/api/v2/write?${params}`

	}

	/**
	 * Queue a reading. Flushes automatically once `batchSize` is reached.
	 *
	 * @param   {object}          reading - Sensor reading.
	 * @param   {object}          [tags]  - Extra tags for this point.
	 * @returns {Promise<object>}         `{buffered}` or the flush result.
	 */
	async write( reading, tags = {} ) {

		const line = toLineProtocol( this.measurement, {
			...this.tags,
			...tags,
		}, reading )
		if ( !line ) return { buffered : this._buffer.length }

		this._buffer.push( line )
		if ( this._buffer.length >= this.batchSize ) return this.flush()
		return { buffered : this._buffer.length }

	}

	/**
	 * Send everything buffered.
	 *
	 * @returns {Promise<object>} `{written}`.
	 */
	async flush() {

		if ( !this._buffer.length ) return { written : 0 }

		const body = this._buffer.join( '\n' )
		const count = this._buffer.length
		// Clear before awaiting so a concurrent write starts a fresh batch rather
		// than being dropped by a failed flush.
		this._buffer = []

		const headers = { 'Content-Type' : 'text/plain; charset=utf-8' }
		if ( this.version === 2 && this.token ) headers.Authorization = `Token ${this.token}`

		const res = await withDeadline( this._endpoint(), {
			method : 'POST',
			headers,
			body,
		} )

		if ( !res.ok ) {

			const text = await res.text().catch( () => '' )
			throw new SmartPlantError( `InfluxDB write failed: HTTP ${res.status} ${text.slice( 0, 200 )}`, 'INTEGRATION_ERROR' )

		}

		return { written : count }

	}

	/**
	 * Attach to a plant so every reading is exported automatically.
	 *
	 * @param   {object}   plant - A `SmartPlant` instance.
	 * @returns {Function}       Unsubscribe function.
	 */
	attach( plant ) {

		return plant.on( 'sensor:reading', async reading => {

			await this.write( reading, {
				plant   : plant.memory.plant.name || 'unnamed',
				species : plant.memory.plant.species || 'unknown',
			} )

		} )

	}

}

/**
 * Render a reading as an InfluxDB line-protocol point.
 *
 * @param   {string} measurement - Measurement name.
 * @param   {object} tags        - Tag set.
 * @param   {object} reading     - Reading.
 * @returns {string|null}        The line, or null when there are no fields.
 */
export function toLineProtocol( measurement, tags, reading ) {

	const fields = []
	for ( const key of METRIC_KEYS ) {

		if ( Number.isFinite( reading?.[ key ] ) ) fields.push( `${key}=${reading[ key ]}` )

	}
	if ( !fields.length ) return null

	const tagPart = Object.entries( tags )
		.filter( ( [ , v ] ) => v !== undefined && v !== null && v !== '' )
		.map( ( [ k, v ] ) => `${escapeKey( k )}=${escapeKey( String( v ) )}` )
		.join( ',' )

	const ts = new Date( reading.timestamp || Date.now() ).getTime()

	return `${escapeKey( measurement )}${tagPart ? ',' + tagPart : ''} ${fields.join( ',' )} ${ts}`

}

/** Line protocol reserves comma, space and equals inside keys and tag values. */
function escapeKey( s ) {

	return String( s ).replace( /([,= ])/g, '\\$1' )

}
