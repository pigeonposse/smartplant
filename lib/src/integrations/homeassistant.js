/**
 * Home Assistant MQTT discovery.
 *
 * The `homeassistant` *sensor driver* reads from Home Assistant. This publishes
 * back into it: every metric appears as a proper entity, grouped under one
 * device, with correct units and device classes, so it lands in dashboards,
 * history and automations without the user configuring anything.
 *
 * That closes the loop — SmartPlant becomes a first-class citizen of a home
 * automation setup rather than a separate island.
 */

import { METRICS } from '../sensors/driver.js'

/** SmartPlant metric → Home Assistant device class and unit. */
const DEVICE_CLASSES = {
	temperature  : {
		device_class : 'temperature',
		unit : '°C',
	},
	humidity     : {
		device_class : 'humidity',
		unit : '%',
	},
	soil         : {
		device_class : 'moisture',
		unit : '%',
	},
	light        : {
		device_class : 'illuminance',
		unit : 'lx',
	},
	conductivity : {
		device_class : null,
		unit : 'µS/cm',
	},
	ph           : {
		device_class : 'ph',
		unit : null,
	},
	voltage      : {
		device_class : 'voltage',
		unit : 'mV',
	},
	activity     : {
		device_class : null,
		unit : null,
	},
	co2          : {
		device_class : 'carbon_dioxide',
		unit : 'ppm',
	},
	weight       : {
		device_class : 'weight',
		unit : 'g',
	},
}

export class HomeAssistantPublisher {

	/**
	 * @param {object} [config]                 - Options.
	 * @param {string} [config.url]             - MQTT broker URL.
	 * @param {string} [config.username]        - Broker username.
	 * @param {string} [config.password]        - Broker password.
	 * @param {string} [config.discoveryPrefix] - HA discovery prefix.
	 * @param {string} [config.nodeId]          - Unique id for this plant.
	 */
	constructor( config = {} ) {

		this.url             = config.url || process.env.MQTT_URL || 'mqtt://localhost:1883'
		this.username        = config.username
		this.password        = config.password
		this.discoveryPrefix = config.discoveryPrefix || 'homeassistant'
		this.nodeId          = config.nodeId || 'smartplant'
		this.client          = null

	}

	async connect() {

		if ( this.client ) return this

		let mqtt
		try {

			mqtt = ( await import( 'mqtt' ) ).default

		}
		catch {

			throw new Error( 'Home Assistant publishing needs the "mqtt" package. Install it with: npm install mqtt' )

		}

		this.client = mqtt.connect( this.url, {
			username : this.username,
			password : this.password,
		} )

		await new Promise( ( resolve, reject ) => {

			const onError = e => reject( new Error( `Cannot connect to MQTT broker ${this.url}: ${e.message}` ) )
			this.client.once( 'error', onError )
			this.client.once( 'connect', () => {

				this.client.removeListener( 'error', onError )
				resolve()

			} )

		} )

		return this

	}

	_slug( s ) {

		return String( s ).toLowerCase().replace( /[^a-z0-9]+/g, '_' ).replace( /^_|_$/g, '' ) || 'plant'

	}

	/**
	 * Announce every metric as a Home Assistant entity.
	 *
	 * @param   {object}   plant     - A `SmartPlant` instance.
	 * @param   {string[]} [metrics] - Metrics to publish. Defaults to all known.
	 * @returns {Promise<string[]>}  Published discovery topics.
	 */
	async publishDiscovery( plant, metrics ) {

		await this.connect()

		const name   = plant.memory.plant.name || 'Plant'
		const slug   = this._slug( name )
		const device = {
			identifiers  : [ `${this.nodeId}_${slug}` ],
			name,
			model        : plant.memory.plant.species || 'Unknown species',
			manufacturer : 'SmartPlant',
			sw_version   : '3.0.2',
		}

		const stateTopic = `${this.nodeId}/${slug}/state`
		const list = metrics || Object.keys( METRICS )
		const topics = []

		for ( const metric of list ) {

			const meta = DEVICE_CLASSES[ metric ] || {}
			const topic = `${this.discoveryPrefix}/sensor/${this.nodeId}_${slug}/${metric}/config`

			const payload = {
				name                : `${name} ${METRICS[ metric ]?.label || metric}`,
				unique_id           : `${this.nodeId}_${slug}_${metric}`,
				state_topic         : stateTopic,
				// One state topic with a JSON payload keeps the broker traffic to a
				// single message per reading regardless of how many metrics exist.
				value_template      : `{{ value_json.${metric} }}`,
				state_class         : 'measurement',
				device,
			}
			if ( meta.device_class ) payload.device_class = meta.device_class
			if ( meta.unit ) payload.unit_of_measurement = meta.unit

			await this._publish( topic, JSON.stringify( payload ), { retain : true } )
			topics.push( topic )

		}

		// Wellbeing is not a sensor metric but it is the number a user actually
		// wants on a dashboard.
		const wellbeingTopic = `${this.discoveryPrefix}/sensor/${this.nodeId}_${slug}/wellbeing/config`
		await this._publish( wellbeingTopic, JSON.stringify( {
			name                : `${name} Wellbeing`,
			unique_id           : `${this.nodeId}_${slug}_wellbeing`,
			state_topic         : stateTopic,
			value_template      : '{{ value_json.wellbeing }}',
			unit_of_measurement : '%',
			state_class         : 'measurement',
			icon                : 'mdi:flower',
			device,
		} ), { retain : true } )
		topics.push( wellbeingTopic )

		this.stateTopic = stateTopic
		return topics

	}

	/**
	 * Publish the current state.
	 *
	 * @param   {object}          plant     - A `SmartPlant` instance.
	 * @param   {object}          [reading] - Reading override.
	 * @returns {Promise<object>}           The published payload.
	 */
	async publishState( plant, reading ) {

		await this.connect()

		const slug = this._slug( plant.memory.plant.name || 'Plant' )
		const topic = this.stateTopic || `${this.nodeId}/${slug}/state`
		const current = reading || plant.memory.lastReading || {}

		const payload = {}
		for ( const key of Object.keys( METRICS ) ) {

			if ( Number.isFinite( current[ key ] ) ) payload[ key ] = current[ key ]

		}
		payload.wellbeing = plant.happiness( current )
		payload.status    = plant.status( current )

		await this._publish( topic, JSON.stringify( payload ) )
		return payload

	}

	/**
	 * Publish discovery once, then state on every reading.
	 *
	 * @param   {object}            plant - A `SmartPlant` instance.
	 * @returns {Promise<Function>}       Unsubscribe function.
	 */
	async attach( plant ) {

		await this.publishDiscovery( plant )
		return plant.on( 'sensor:reading', reading => this.publishState( plant, reading ) )

	}

	_publish( topic, payload, opts = {} ) {

		return new Promise( ( resolve, reject ) => {

			this.client.publish( topic, payload, opts, err => ( err ? reject( err ) : resolve() ) )

		} )

	}

	async disconnect() {

		if ( this.client ) await new Promise( r => this.client.end( false, {}, r ) )
		this.client = null
		return this

	}

}
