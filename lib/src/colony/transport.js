/**
 * How the words actually get from one plant to another.
 *
 * The conversation layer above does not care whether it is running over a
 * Bluetooth link, an in-process bus or a socket. It cares that a message
 * addressed to a peer arrives at that peer, once, and that replies come back.
 *
 * `LoopbackBus` is the reference transport: everything works with no radio at
 * all, which is how the rest of this library is testable without hardware. A
 * Bluetooth transport is the same three methods over a characteristic.
 */

/**
 * Transport contract.
 *
 * Implement `send` and call `this._receive( envelope )` when something arrives.
 */
export class ColonyTransport {

	constructor( opts = {} ) {

		this.id = opts.id || `node_${Math.random().toString( 36 ).slice( 2, 8 )}`
		/** @type {Set<Function>} */
		this._handlers = new Set()
		this.connected = false

	}

	async connect() {

		this.connected = true
		return this

	}

	async disconnect() {

		this.connected = false
		this._handlers.clear()
		return this

	}

	/** Subscribe to inbound envelopes. */
	onMessage( fn ) {

		this._handlers.add( fn )
		return () => this._handlers.delete( fn )

	}

	/**
	 * Deliver an envelope. `to` of `'*'` is a broadcast.
	 *
	 * @param {object} envelope - `{ from, to, kind, body, id }`.
	 */
	async send( _envelope ) {

		throw new Error( `${this.constructor.name} must implement send().` )

	}

	/** Called by the implementation when something arrives. */
	async _receive( envelope ) {

		// One bad listener must not silence the rest of the conversation.
		const results = await Promise.allSettled(
			[ ...this._handlers ].map( fn => Promise.resolve().then( () => fn( envelope ) ) ),
		)

		return results.filter( r => r.status === 'rejected' ).map( r => r.reason )

	}

	/** Who else this node can currently reach. */
	async peers() {

		return []

	}

}

/**
 * An in-process bus. Every plant sharing one bus can hear the others.
 *
 * This is not a simulation of a radio — it is a real transport that happens to
 * have no distance. Two plants on one Raspberry Pi legitimately use it.
 */
export class LoopbackBus {

	constructor() {

		/** @type {Map<string, ColonyTransport>} */
		this.nodes = new Map()

	}

	/** A transport endpoint attached to this bus. */
	endpoint( id ) {

		const bus = this

		const transport = new class extends ColonyTransport {

			async connect() {

				bus.nodes.set( this.id, this )
				this.connected = true
				return this

			}

			async disconnect() {

				bus.nodes.delete( this.id )
				return super.disconnect()

			}

			async send( envelope ) {

				if ( !this.connected ) throw new Error( `${this.id} is not connected to the colony.` )

				const targets = envelope.to === '*'
					? [ ...bus.nodes.values() ].filter( n => n.id !== this.id )
					: [ bus.nodes.get( envelope.to ) ].filter( Boolean )

				if ( !targets.length && envelope.to !== '*' ) {

					throw new Error( `No peer "${envelope.to}" in this colony.` )

				}

				// Delivery is async so a reply can never resolve before the send
				// returns — the same ordering a real radio imposes.
				await Promise.all( targets.map( t => t._receive( envelope ) ) )
				return { delivered : targets.length }

			}

			async peers() {

				return [ ...bus.nodes.keys() ].filter( id => id !== this.id )

			}

		}( { id } )

		return transport

	}

}
