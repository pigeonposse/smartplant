/**
 * A scanning rangefinder, as a driver like any other.
 *
 * The spatial layer knows what to do with a ring of distances. This is where the
 * ring comes from.
 *
 * There is no portable way to talk to an RPLIDAR from here — each one has its
 * own serial protocol, its own motor control, and its own idea of what a scan
 * begins and ends with. So this takes a `scan` callback, exactly as the presence
 * driver and the callback vision source do, and concerns itself with the part
 * that is the same whatever hardware produced it: keeping the last scan and the
 * one before it, and refusing to answer from a scan that is too old to describe
 * where anything currently is.
 *
 * ## A stale scan is worse than no scan
 *
 * The rest of this library treats a stale reading as a real hazard, and here it
 * is sharper than usual. A moisture reading from an hour ago is roughly still
 * true. A scan from an hour ago describes a room that may have had a chair moved
 * through it, and acting on it means planning a route through furniture that is
 * no longer where the plan thinks it is.
 *
 * So a scan has an age, the age is short by default, and past it the driver
 * reports nothing rather than the last thing it saw.
 */

import { SensorError } from '../../core/errors.js'
import { SensorDriver } from '../driver.js'

/**
 * A rangefinder that produces scans.
 */
export class LidarSensor extends SensorDriver {

	static id       = 'lidar'
	static provides = []

	/**
	 * @param {object}   [config]           - Options.
	 * @param {Function} [config.scan]      - `async () => ({ranges, angleMin, angleMax}) | [{angle, range}]`.
	 * @param {number}   [config.staleAfter] - Age past which a scan is not answered from. Default 10s.
	 * @param {number}   [config.minReturns] - Below this a scan is not a ring. Default 8.
	 */
	constructor( config = {} ) {

		super( {
			id : LidarSensor.id,
			...config,
		} )

		if ( typeof config.scan !== 'function' ) {

			throw new SensorError( 'The lidar driver needs a { scan } function returning either { ranges, angleMin, angleMax } or an array of { angle, range }. There is no portable way to drive a scanning rangefinder from here — every one has its own serial protocol and its own motor control, so the device library feeds this.' )

		}

		this.scan = config.scan
		this.staleAfter = config.staleAfter ?? 10_000
		this.minReturns = config.minReturns ?? 8

		this._latest = null
		this._previous = null
		this._at = 0

	}

	async connect() {

		this.connected = true
		return this

	}

	async disconnect() {

		this.connected = false
		this._latest = null
		this._previous = null
		return this

	}

	/**
	 * Take a scan and keep it.
	 *
	 * Returns nothing metric — a scan is not a reading, and folding it into one
	 * would put an angle where a temperature goes. What it produces is available
	 * through `latest` and `previous`, which the spatial layer consumes.
	 *
	 * @returns {Promise<object>} `{returns, at}`.
	 */
	async read() {

		const raw = await this.scan()
		const { points } = await import( '../../spatial/index.js' )
		const pts = points( raw )

		if ( pts.length < this.minReturns ) {

			throw new SensorError( `The scan came back with ${pts.length} usable returns and a ring needs at least ${this.minReturns}. A handful of returns is not a scan — either the motor is not spinning, or every surface in range is absorbing, and those are different faults.` )

		}

		this._previous = this._latest
		this._latest = raw
		this._at = Date.now()

		return {
			returns : pts.length,
			at : this._at,
		}

	}

	/** The most recent scan, or null if it is too old to describe anything. */
	get latest() {

		if ( !this._latest ) return null
		return Date.now() - this._at <= this.staleAfter ? this._latest : null

	}

	/** The one before it, for comparison. */
	get previous() {

		return this._previous

	}

	/**
	 * Why there is no current scan, when there is not one.
	 *
	 * @returns {object} `{fresh, why}`.
	 */
	freshness() {

		if ( !this._latest ) return {
			fresh : false,
			why : 'No scan has been taken yet.',
		}

		const age = Date.now() - this._at

		return {
			fresh : age <= this.staleAfter,
			ageMs : age,
			why : age <= this.staleAfter
				? `Scanned ${Math.round( age / 1000 )}s ago.`
				: `The last scan is ${Math.round( age / 1000 )}s old and this only answers from one under ${Math.round( this.staleAfter / 1000 )}s. A stale moisture reading is roughly still true; a stale scan describes a room somebody may have moved a chair through, and planning a route from it means routing through furniture that is no longer there.`,
		}

	}

}
