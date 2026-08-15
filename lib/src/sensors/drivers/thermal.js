/**
 * A thermal camera, as a driver.
 *
 * No hardware library is imported. `flir-lepton` and the rest are somebody
 * else's packages, several need a native build, and they change — so this takes
 * a callback that hands over a frame of temperatures, exactly as the presence
 * and lidar drivers do.
 *
 * What it contributes to a reading is deliberately not `leafTemperature`. An
 * uncalibrated sensor is accurate to a few degrees in absolute terms, and
 * publishing that as a leaf temperature would feed the VPD calculation a number
 * with five degrees of error in it — which is worse than having no leaf
 * temperature at all, because every inference downstream would look complete.
 *
 * What it does contribute is the canopy's internal spread, which is a
 * difference and survives the sensor's offset.
 */

import { SensorError } from '../../core/errors.js'
import { SensorDriver } from '../driver.js'

export class ThermalSensor extends SensorDriver {

	static id       = 'thermal'
	static provides = [ 'canopySpread' ]

	/**
	 * @param {object}   [config]           - Options.
	 * @param {Function} [config.frame]     - `async () => ({width, height, data})` in °C.
	 * @param {boolean}  [config.calibrated] - Whether absolute readings can be trusted.
	 * @param {number}   [config.staleAfter] - Age past which a frame is not used. Default 30s.
	 */
	constructor( config = {} ) {

		super( {
			id : ThermalSensor.id,
			...config,
		} )

		if ( typeof config.frame !== 'function' ) {

			throw new SensorError( 'The thermal driver needs a { frame } function returning { width, height, data } with one temperature in °C per pixel. No camera library is imported here — a Lepton, a MLX90640 or a file of saved frames all satisfy this the same way.' )

		}

		this.frame = config.frame
		// Almost never true, and saying so is the point: it decides whether the
		// absolute numbers may be used or only the differences between them.
		this.calibrated = config.calibrated === true
		this.staleAfter = config.staleAfter ?? 30_000

		this._latest = null
		this._at = 0

	}

	async connect() {

		this.connected = true
		return this

	}

	async disconnect() {

		this.connected = false
		this._latest = null
		return this

	}

	async read() {

		const { frameStats, segment } = await import( '../../vision/thermal.js' )
		const frame = await this.frame()
		const stats = frameStats( frame )

		if ( !stats.known ) throw new SensorError( stats.why )

		this._latest = frame
		this._at = Date.now()

		const canopy = segment( frame )

		return {
			// A difference, which survives an uncalibrated sensor. The absolute
			// mean is deliberately not published as leafTemperature.
			canopySpread : canopy.known ? canopy.spread : null,
			...( this.calibrated && canopy.known ? { leafTemperature : canopy.mean } : {} ),
		}

	}

	/** The most recent frame, or null if it is too old to describe anything. */
	get latest() {

		if ( !this._latest ) return null
		return Date.now() - this._at <= this.staleAfter ? this._latest : null

	}

}
