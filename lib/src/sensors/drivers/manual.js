/**
 * Manual sensor — the human is the sensor.
 *
 * Someone with a €5 moisture stick, or just a finger in the soil, can still use
 * every AI feature by pushing values in. This is the widest-reach driver in the
 * set: it requires nothing at all.
 */

import { SensorDriver } from '../driver.js'

export class ManualSensor extends SensorDriver {

	static id       = 'manual'
	static provides = [ 'temperature', 'humidity', 'soil', 'light', 'ph', 'conductivity' ]

	/**
	 * @param {object} [config]         - Options.
	 * @param {object} [config.initial] - Starting values.
	 */
	constructor( config = {} ) {

		super( {
			id : ManualSensor.id,
			...config,
		} )

		this._values = this.normalize( config.initial || {} )

	}

	/**
	 * Push new observations. Merges with previous values, so the user can update
	 * only what they measured today.
	 *
	 * @param   {object} values - Partial reading.
	 * @returns {object}        The merged reading.
	 */
	set( values = {} ) {

		this._values = this.normalize( {
			...this._values,
			...values,
		} )
		return this._values

	}

	async read() {

		return {
			...this._values,
			timestamp : new Date(),
			source    : this.id,
		}

	}

}
