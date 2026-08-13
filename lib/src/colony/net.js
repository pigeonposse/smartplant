/**
 * A colony that spans machines.
 *
 * `LoopbackBus` is a real transport but it only reaches inside one process. A
 * colony of plants on separate Raspberry Pis, or a plant on a Pi and a dashboard
 * on a laptop, needs the messages to leave the process.
 *
 * This is plain TCP with newline-delimited JSON: no dependencies, no broker, and
 * nothing to install. One node listens, the others dial in, and the listener
 * relays between them so every member sees the same colony the loopback bus
 * would have given them.
 *
 * The message contract is identical to every other transport — `send`,
 * `onMessage`, `peers` — so nothing above this layer knows or cares which one it
 * is running on. A Bluetooth transport would be the same three methods over a
 * characteristic; this file is what that would look like, minus the radio.
 */

import net from 'node:net'

import { ColonyTransport } from './transport.js'

/** Frame size ceiling, so a malformed peer cannot exhaust memory. */
const MAX_FRAME = 1024 * 512

/** Read newline-delimited JSON off a socket, one object at a time. */
function readFrames( socket, onFrame, onError ) {

	let buffer = ''

	socket.on( 'data', chunk => {

		buffer += chunk.toString( 'utf8' )

		// A peer that never sends a newline would otherwise grow this forever.
		if ( buffer.length > MAX_FRAME ) {

			buffer = ''
			onError?.( new Error( `Colony peer sent more than ${MAX_FRAME} bytes without a frame boundary; dropping it.` ) )
			socket.destroy()
			return

		}

		let cut
		while ( ( cut = buffer.indexOf( '\n' ) ) >= 0 ) {

			const line = buffer.slice( 0, cut )
			buffer = buffer.slice( cut + 1 )
			if ( !line.trim() ) continue

			try {

				onFrame( JSON.parse( line ) )

			}
			catch {

				// One unparseable frame must not kill a working link.
				onError?.( new Error( 'Colony peer sent a frame that is not JSON; ignoring it.' ) )

			}

		}

	} )

}

const writeFrame = ( socket, obj ) => socket.write( `${JSON.stringify( obj )}\n` )

/**
 * The node that listens. Other plants dial in, and it relays between them.
 */
export class ColonyServer extends ColonyTransport {

	/**
	 * @param {object} opts        - Options.
	 * @param {string} opts.id     - This node's colony id.
	 * @param {number} [opts.port] - Port to listen on. 0 picks a free one.
	 * @param {string} [opts.host] - Interface. Defaults to loopback, deliberately.
	 */
	constructor( opts = {} ) {

		// An explicit null is a different mistake from omitting the argument, and
		// a default only covers the second. Both should land on the same message.
		opts = opts ?? {}


		super( opts )
		// Loopback by default: a colony is a private conversation between a
		// person's own plants, and binding every interface by default would put it
		// on the network without anybody asking for that.
		this.host = opts.host ?? '127.0.0.1'
		this.port = opts.port ?? 0
		this.server = null
		/** @type {Map<string, import('node:net').Socket>} */
		this.clients = new Map()

	}

	async connect() {

		if ( this.connected ) return this

		this.server = net.createServer( socket => {

			let peerId = null

			readFrames( socket, frame => {

				if ( frame.kind === '__hello' ) {

					peerId = frame.from
					this.clients.set( peerId, socket )
					// Without this, a client knows nobody: it only ever learns of a
					// peer that happens to speak to it first. Every colony operation
					// that starts by asking "who is here" — askAll, newcomers,
					// learnFromColony — would quietly do nothing on a client node.
					this._announceRoster()
					return

				}

				// Relay onward, then deliver locally if we are addressed.
				this._relay( frame, socket )
				if ( frame.to === '*' || frame.to === this.id ) this._receive( frame )

				// Deliberately not fatal: `readFrames` already drops a peer that
				// floods without a boundary, and one malformed frame from an
				// otherwise working neighbour is not a reason to hang up on it.
			}, () => {} )

			socket.on( 'error', () => socket.destroy() )
			socket.on( 'close', () => {

				if ( peerId ) {

					this.clients.delete( peerId )
					this._announceRoster()

				}

			} )

		} )

		await new Promise( ( resolve, reject ) => {

			this.server.once( 'error', reject )
			this.server.listen( this.port, this.host, () => {

				this.port = this.server.address().port
				this.server.removeListener( 'error', reject )
				resolve()

			} )

		} )

		this.server.unref?.()
		this.connected = true
		return this

	}

	/** Tell every member who else is in the colony. */
	_announceRoster() {

		const members = [ this.id, ...this.clients.keys() ]

		for ( const socket of this.clients.values() ) {

			writeFrame( socket, {
				kind : '__roster',
				from : this.id,
				to : '*',
				members,
			} )

		}

	}

	/** Pass a frame to everyone it is for, except whoever sent it. */
	_relay( frame, from ) {

		for ( const [ id, socket ] of this.clients ) {

			if ( socket === from ) continue
			if ( frame.to !== '*' && frame.to !== id ) continue
			writeFrame( socket, frame )

		}

	}

	async send( envelope ) {

		if ( !this.connected ) throw new Error( `${this.id} is not connected to the colony.` )

		this._relay( envelope, null )
		return { delivered : envelope.to === '*' ? this.clients.size : Number( this.clients.has( envelope.to ) ) }

	}

	async peers() {

		return [ ...this.clients.keys() ]

	}

	async disconnect() {

		for ( const socket of this.clients.values() ) socket.destroy()
		this.clients.clear()

		if ( this.server ) {

			await new Promise( resolve => this.server.close( resolve ) )
			this.server = null

		}

		return super.disconnect()

	}

}

/**
 * A node that dials into a listening colony.
 */
export class ColonyClient extends ColonyTransport {

	/**
	 * @param {object} opts        - Options.
	 * @param {string} opts.id     - This node's colony id.
	 * @param {number} opts.port   - Port of the listening node.
	 * @param {string} [opts.host] - Its host.
	 */
	constructor( opts = {} ) {

		// An explicit null is a different mistake from omitting the argument, and
		// a default only covers the second. Both should land on the same message.
		opts = opts ?? {}


		super( opts )
		this.host = opts.host ?? '127.0.0.1'
		this.port = opts.port
		this.socket = null
		this._knownPeers = new Set()

	}

	async connect() {

		if ( this.connected ) return this
		if ( !this.port ) throw new Error( 'A colony client needs the { port } of the listening node.' )

		this.socket = net.createConnection( {
			host : this.host,
			port : this.port,
		} )

		await new Promise( ( resolve, reject ) => {

			const onError = err => reject( new Error( `Cannot reach the colony at ${this.host}:${this.port} — ${err.message}` ) )
			this.socket.once( 'error', onError )
			this.socket.once( 'connect', () => {

				this.socket.removeListener( 'error', onError )
				resolve()

			} )

		} )

		// Announce which node this socket belongs to, so the listener can address
		// it by colony id rather than by socket.
		writeFrame( this.socket, {
			kind : '__hello',
			from : this.id,
		} )

		readFrames( this.socket, frame => {

			if ( frame.kind === '__roster' ) {

				this._knownPeers = new Set( frame.members.filter( m => m !== this.id ) )
				return

			}

			if ( frame.from && frame.from !== this.id ) this._knownPeers.add( frame.from )
			this._receive( frame )

		} )

		this.socket.on( 'error', () => {} )
		this.socket.unref?.()
		this.connected = true
		return this

	}

	async send( envelope ) {

		if ( !this.connected ) throw new Error( `${this.id} is not connected to the colony.` )
		writeFrame( this.socket, envelope )
		return { delivered : 1 }

	}

	async peers() {

		return [ ...this._knownPeers ]

	}

	async disconnect() {

		this.socket?.destroy()
		this.socket = null
		this._knownPeers.clear()
		return super.disconnect()

	}

}
