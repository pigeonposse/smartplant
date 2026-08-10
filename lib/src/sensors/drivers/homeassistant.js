/**
 * Home Assistant sensor.
 *
 * The single highest-leverage driver: anyone already running Home Assistant has
 * plant sensors exposed as entities, so SmartPlant works with their existing
 * hardware over plain HTTP with no extra dependency.
 */

import { SensorError } from '../../core/errors.js'
import { SensorDriver } from '../driver.js'

export class HomeAssistantSensor extends SensorDriver {

	static id       = 'homeassistant'
	static provides = [ 'temperature', 'humidity', 'soil', 'light', 'conductivity' ]

	/**
	 * @param {object} [config]          - Options.
	 * @param {string} [config.url]      - Base URL, e.g. `http://homeassistant.local:8123`.
	 * @param {string} [config.token]    - Long-lived access token.
	 * @param {object} [config.entities] - Metric → entity_id map.
	 */
	constructor( config = {} ) {

		super( {
			id : HomeAssistantSensor.id,
			...config,
		} )

		this.url      = ( config.url || process.env.HASS_URL || 'http://homeassistant.local:8123' ).replace( /\/+$/, '' )
		this.token    = config.token || process.env.HASS_TOKEN
		this.entities = config.entities || {}

	}

	async connect() {

		if ( !this.token ) throw new SensorError( 'Home Assistant needs a long-lived access token (config.token or HASS_TOKEN).' )
		if ( !Object.keys( this.entities ).length ) {

			throw new SensorError( 'Home Assistant needs an entities map, e.g. { soil: "sensor.monstera_moisture" }.' )

		}
		this.connected = true
		return this

	}

	async _entityState( entityId ) {

		const res = await fetch( `${this.url}/api/states/${encodeURIComponent( entityId )}`, {
			headers : {
				Authorization  : `Bearer ${this.token}`,
				'Content-Type' : 'application/json',
			},
		} )
		if ( res.status === 401 ) throw new SensorError( 'Home Assistant rejected the token (401).' )
		if ( res.status === 404 ) throw new SensorError( `Entity "${entityId}" not found in Home Assistant.` )
		if ( !res.ok ) throw new SensorError( `Home Assistant returned HTTP ${res.status} for ${entityId}.` )
		const data = await res.json()
		return data?.state

	}

	async read() {

		if ( !this.connected ) await this.connect()

		const entries = Object.entries( this.entities )
		const states  = await Promise.allSettled( entries.map( ( [ , id ] ) => this._entityState( id ) ) )

		const raw = {}
		const failed = []
		states.forEach( ( r, i ) => {

			const [ metric, id ] = entries[ i ]
			// 'unavailable'/'unknown' are normal HA states for a sleeping sensor —
			// skip them rather than poisoning the reading with NaN.
			if ( r.status === 'fulfilled' && r.value !== 'unavailable' && r.value !== 'unknown' ) raw[ metric ] = r.value
			else failed.push( id )

		} )

		const reading = this.normalize( raw )
		if ( !SensorDriver.hasData( reading ) ) {

			throw new SensorError( `No usable values from Home Assistant (checked: ${failed.join( ', ' )}).` )

		}
		return reading

	}

}
