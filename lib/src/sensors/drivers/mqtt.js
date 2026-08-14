/**
 * MQTT sensor — the lingua franca of DIY plant hardware (ESPHome, Tasmota,
 * Zigbee2MQTT). `mqtt` is an optional peer: loaded dynamically so it stays out
 * of the install path for everyone else.
 */

import { SensorError } from '../../core/errors.js'
import { SensorDriver } from '../driver.js'

/**
 * Does a concrete topic match a subscription filter?
 *
 * `+` is exactly one level, `#` is the rest of them, and both are ordinary in
 * the hardware this driver exists to talk to.
 *
 * @param   {string} filter - The subscription, possibly with wildcards.
 * @param   {string} topic  - The topic a message actually arrived on.
 * @returns {boolean}       Whether it matches.
 */
export function topicMatches( filter, topic ) {

	if ( filter === topic ) return true

	const f = String( filter ).split( '/' )
	const t = String( topic ).split( '/' )

	for ( let i = 0; i < f.length; i++ ) {

		if ( f[ i ] === '#' ) return true
		if ( f[ i ] === '+' ) {

			// `+` matches one level, and there has to be a level there to match.
			if ( t[ i ] === undefined ) return false
			continue

		}

		if ( f[ i ] !== t[ i ] ) return false

	}

	return f.length === t.length

}

export class MqttSensor extends SensorDriver {

	static id       = 'mqtt'
	static provides = [ 'temperature', 'humidity', 'soil', 'light', 'conductivity' ]

	/**
	 * @param {object} [config]           - Options.
	 * @param {string} [config.url]       - Broker URL, e.g. `mqtt://192.168.1.10:1883`.
	 * @param {object} [config.topics]    - Metric → topic map, or a single `topic` for a JSON payload.
	 * @param {string} [config.topic]     - Single topic publishing a JSON object.
	 * @param {string} [config.username]  - Broker username.
	 * @param {string} [config.password]  - Broker password.
	 * @param {number} [config.staleAfter]- Reject readings older than this (ms).
	 */
	constructor( config = {} ) {

		super( {
			id : MqttSensor.id,
			...config,
		} )

		this.url        = config.url || process.env.MQTT_URL || 'mqtt://localhost:1883'
		this.topics     = config.topics || null
		this.topic      = config.topic || null
		this.staleAfter = config.staleAfter ?? 300_000
		this.client     = null
		this._values    = {}
		this._latestAt  = 0

		if ( !this.topics && !this.topic ) {

			throw new SensorError( 'MQTT driver needs either { topic } (JSON payload) or { topics } (metric → topic map).' )

		}

	}

	async connect() {

		if ( this.connected ) return this

		let mqtt
		try {

			mqtt = ( await import( 'mqtt' ) ).default

		}
		catch ( err ) {

			throw new SensorError( 'The MQTT driver needs the "mqtt" package. Install it with: npm install mqtt', { cause : err.message } )

		}

		this.client = mqtt.connect( this.url, {
			username           : this.config.username,
			password           : this.config.password,
			reconnectPeriod    : 5000,
			connectTimeout     : 10_000,
		} )

		await new Promise( ( resolve, reject ) => {

			const onError = err => reject( new SensorError( `Cannot connect to MQTT broker ${this.url}: ${err.message}` ) )
			this.client.once( 'error', onError )
			this.client.once( 'connect', () => {

				this.client.removeListener( 'error', onError )
				resolve()

			} )

		} )

		// Listening before subscribing, not after. A broker replays retained
		// messages the moment it acknowledges a subscription, so a handler
		// attached afterwards misses them — and publishing retained state is what
		// ESPHome, Tasmota and Zigbee2MQTT all do by default. The symptom was a
		// driver that connected, subscribed, and then reported no messages ever
		// arriving from a device that had already sent one.
		this.client.on( 'message', ( topic, payload ) => this._ingest( topic, payload.toString() ) )

		const subs = this.topic ? [ this.topic ] : Object.values( this.topics )
		await Promise.all( subs.map( t => new Promise( ( res, rej ) =>
			this.client.subscribe( t, err => err ? rej( new SensorError( `Cannot subscribe to ${t}: ${err.message}` ) ) : res() ) ) ) )
		// Keep serving the last good reading across broker blips rather than throwing.
		this.client.on( 'error', () => {} )

		this.connected = true
		return this

	}

	_ingest( topic, payload ) {

		if ( this.topic ) {

			try {

				const obj = JSON.parse( payload )
				Object.assign( this._values, obj )
				this._latestAt = Date.now()

			}
			catch { /* non-JSON payload on the JSON topic — ignore */ }
			return

		}

		// A subscription is a *filter*; what arrives is a concrete topic. Comparing
		// them as strings means `home/+/temp` matches nothing at all — the
		// subscription succeeds, the messages arrive, and every one is discarded.
		const metric = Object.keys( this.topics ).find( k => topicMatches( this.topics[ k ], topic ) )
		if ( !metric ) return
		const n = Number( payload )
		if ( Number.isFinite( n ) ) {

			this._values[ metric ] = n
			this._latestAt = Date.now()

		}

	}

	async read() {

		if ( !this.connected ) await this.connect()
		if ( !this._latestAt ) throw new SensorError( `No MQTT messages received yet from ${this.url}.` )
		if ( Date.now() - this._latestAt > this.staleAfter ) {

			throw new SensorError( `MQTT data is stale (last message ${Math.round( ( Date.now() - this._latestAt ) / 1000 )}s ago).` )

		}
		return this.normalize( this._values )

	}

	async disconnect() {

		if ( this.client ) await new Promise( r => this.client.end( false, {}, r ) )
		this.connected = false
		return this

	}

}
