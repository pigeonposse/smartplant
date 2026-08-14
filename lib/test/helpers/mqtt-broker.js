/**
 * A minimal MQTT 3.1.1 broker, so the success path can be executed.
 *
 * Lives in the test tree, not in `src`. It is a fixture.
 *
 * The `mqtt` client this library uses has never had a broker to talk to here,
 * which means everything past `connect()` — subscribing, receiving a retained
 * publish, parsing a payload, updating a reading — has never run. Mocking the
 * client would prove nothing about that; it would only prove that a stub calls
 * a stub.
 *
 * This is not a broker anybody should deploy. It handles CONNECT, SUBSCRIBE,
 * PUBLISH at QoS 0 and PINGREQ, and nothing else. That is exactly the subset the
 * driver uses, and it is enough to run the real client library end to end over a
 * real socket.
 */

import { createServer } from 'node:net'

const CONNECT = 1, CONNACK = 2, PUBLISH = 3, SUBSCRIBE = 8, SUBACK = 9,
	PINGREQ = 12, PINGRESP = 13, DISCONNECT = 14

/** Remaining-length is a base-128 varint, low byte first. */
function readVarint( buf, at ) {

	let mul = 1, value = 0, i = at, byte

	do {

		if ( i >= buf.length ) return null
		byte = buf[ i++ ]
		value += ( byte & 127 ) * mul
		mul *= 128

	} while ( byte & 128 )

	return {
		value,
		at : i,
	}

}

function writeVarint( n ) {

	const out = []

	do {

		let byte = n % 128
		n = Math.floor( n / 128 )
		if ( n > 0 ) byte |= 128
		out.push( byte )

	} while ( n > 0 )

	return Buffer.from( out )

}

const readString = ( buf, at ) => {

	const len = buf.readUInt16BE( at )
	return {
		value : buf.toString( 'utf8', at + 2, at + 2 + len ),
		at : at + 2 + len,
	}

}

const packet = ( type, flags, payload ) => Buffer.concat( [
	Buffer.from( [ ( type << 4 ) | flags ] ),
	writeVarint( payload.length ),
	payload,
] )

/**
 * Start the broker.
 *
 * @param   {object} [opts] - `{ port }`. 0 for whatever is free.
 * @returns {Promise<object>} `{ port, publish, close, seen }`.
 */
export async function startBroker( opts = {} ) {

	/** socket → Set of topic filters */
	const subs = new Map()
	/** Everything the broker was told, so a test can assert what was published. */
	const seen = []
	/** Last message per topic, replayed to a late subscriber. */
	const retained = new Map()

	const matches = ( filter, topic ) => {

		if ( filter === topic || filter === '#' ) return true

		const f = filter.split( '/' ), t = topic.split( '/' )

		for ( let i = 0; i < f.length; i++ ) {

			if ( f[ i ] === '#' ) return true
			if ( f[ i ] === '+' ) continue
			if ( f[ i ] !== t[ i ] ) return false

		}

		return f.length === t.length

	}

	const deliver = ( topic, payload ) => {

		const body = Buffer.concat( [
			Buffer.from( [ topic.length >> 8, topic.length & 255 ] ),
			Buffer.from( topic ),
			Buffer.from( payload ),
		] )

		for ( const [ sock, filters ] of subs ) {

			if ( [ ...filters ].some( f => matches( f, topic ) ) ) sock.write( packet( PUBLISH, 0, body ) )

		}

	}

	const server = createServer( sock => {

		subs.set( sock, new Set() )
		let buf = Buffer.alloc( 0 )

		sock.on( 'data', chunk => {

			buf = Buffer.concat( [ buf, chunk ] )

			for ( ;; ) {

				if ( buf.length < 2 ) return

				const type = buf[ 0 ] >> 4
				const len = readVarint( buf, 1 )
				if ( !len || buf.length < len.at + len.value ) return

				const body = buf.subarray( len.at, len.at + len.value )
				buf = buf.subarray( len.at + len.value )

				if ( type === CONNECT ) {

					sock.write( packet( CONNACK, 0, Buffer.from( [ 0, 0 ] ) ) )

				}
				else if ( type === SUBSCRIBE ) {

					const id = body.readUInt16BE( 0 )
					let at = 2
					const granted = []

					while ( at < body.length ) {

						const topic = readString( body, at )
						at = topic.at + 1
						subs.get( sock ).add( topic.value )
						granted.push( 0 )

						// A device that published before this subscriber arrived is
						// the normal case, and the driver relies on it.
						for ( const [ t, p ] of retained ) {

							if ( matches( topic.value, t ) ) {

								setImmediate( () => deliver( t, p ) )

							}

						}

					}

					sock.write( packet( SUBACK, 0, Buffer.concat( [
						Buffer.from( [ id >> 8, id & 255 ] ),
						Buffer.from( granted ),
					] ) ) )

				}
				else if ( type === PUBLISH ) {

					const topic = readString( body, 0 )
					const payload = body.subarray( topic.at )
					seen.push( {
						topic : topic.value,
						payload : payload.toString(),
					} )
					retained.set( topic.value, payload )
					deliver( topic.value, payload )

				}
				else if ( type === PINGREQ ) sock.write( packet( PINGRESP, 0, Buffer.alloc( 0 ) ) )
				else if ( type === DISCONNECT ) sock.end()

			}

		} )

		sock.on( 'error', () => {} )
		sock.on( 'close', () => subs.delete( sock ) )

	} )

	await new Promise( r => server.listen( opts.port ?? 0, '127.0.0.1', r ) )

	return {
		port : server.address().port,
		seen,

		/** Publish as though a device had. */
		publish( topic, payload ) {

			const body = Buffer.from( typeof payload === 'string' ? payload : JSON.stringify( payload ) )
			retained.set( topic, body )
			deliver( topic, body )

		},

		async close() {

			for ( const sock of subs.keys() ) sock.destroy()
			await new Promise( r => server.close( r ) )

		},
	}

}
