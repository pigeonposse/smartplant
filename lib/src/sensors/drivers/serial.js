/**
 * Serial sensor (Arduino / ESP32 / any board printing CSV or JSON lines).
 *
 * `serialport` is loaded dynamically: it carries a native binding, and a user on
 * the mock or Home Assistant path should never be forced to compile it.
 */

import { SensorError } from '../../core/errors.js'
import { SensorDriver } from '../driver.js'

export class SerialSensor extends SensorDriver {

	static id       = 'serial'
	static provides = [ 'temperature', 'humidity', 'soil', 'light' ]

	/**
	 * @param {object}   [config]           - Options.
	 * @param {string}   [config.path]      - Device path, e.g. `/dev/ttyACM0` or `COM3`.
	 * @param {number}   [config.baudRate]  - Baud rate.
	 * @param {string[]} [config.fields]    - Field order for CSV lines.
	 * @param {number}   [config.staleAfter]- Reject readings older than this (ms).
	 */
	constructor( config = {} ) {

		super( {
			id : SerialSensor.id,
			...config,
		} )

		this.path       = config.path || '/dev/ttyACM0'
		this.baudRate   = config.baudRate || 9600
		this.fields     = config.fields || [ 'temperature', 'humidity', 'light' ]
		this.staleAfter = config.staleAfter ?? 120_000
		this.port       = null
		this._latest    = null
		this._latestAt  = 0

	}

	async connect() {

		if ( this.connected ) return this

		let SerialPort, ReadlineParser
		try {

			( { SerialPort } = await import( 'serialport' ) );
			( { ReadlineParser } = await import( '@serialport/parser-readline' ) )

		}
		catch ( err ) {

			throw new SensorError(
				'The serial driver needs the "serialport" package. Install it with: npm install serialport @serialport/parser-readline',
				{ cause : err.message },
			)

		}

		await new Promise( ( resolve, reject ) => {

			this.port = new SerialPort( {
				path     : this.path,
				baudRate : this.baudRate,
			}, err => err ? reject( new SensorError( `Cannot open serial port ${this.path}: ${err.message}` ) ) : resolve() )

		} )

		this.port.pipe( new ReadlineParser( { delimiter : '\r\n' } ) ).on( 'data', line => this._ingest( line ) )
		this.connected = true
		return this

	}

	/** Parse a line as JSON first, then as ordered CSV. */
	_ingest( line ) {

		const text = String( line ).trim()
		if ( !text ) return

		let raw = null
		if ( text.startsWith( '{' ) ) {

			try {

				raw = JSON.parse( text )

			}
			catch { /* not JSON, try CSV */ }

		}

		if ( !raw ) {

			const parts = text.split( ',' ).map( p => p.trim() )
			if ( parts.some( p => p === '' || Number.isNaN( Number( p ) ) ) ) return
			raw = {}
			this.fields.forEach( ( f, i ) => {

				if ( parts[ i ] !== undefined ) raw[ f ] = Number( parts[ i ] )

			} )

		}

		this._latest   = this.normalize( raw )
		this._latestAt = Date.now()

	}

	async read() {

		if ( !this.connected ) await this.connect()
		if ( !this._latest ) throw new SensorError( `No data received yet from ${this.path}. Is the board sending lines?` )
		if ( Date.now() - this._latestAt > this.staleAfter ) {

			throw new SensorError( `Serial data is stale (last line ${Math.round( ( Date.now() - this._latestAt ) / 1000 )}s ago).` )

		}
		return this._latest

	}

	async disconnect() {

		if ( this.port?.isOpen ) await new Promise( r => this.port.close( r ) )
		this.connected = false
		return this

	}

}
