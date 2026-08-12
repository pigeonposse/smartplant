/**
 * Minimal async-aware event bus.
 *
 * Node's EventEmitter is sync-only for listener completion, and the kernel needs
 * to await plugin reactions (a plugin that waters the plant must finish before
 * the next sensor tick). `emit` therefore returns a promise that settles once
 * every listener has settled.
 */

export class EventBus {

	constructor() {

		/** @type {Map<string, Set<Function>>} */
		this._listeners = new Map()
		/** @type {Set<Function>} */
		this._any       = new Set()

	}

	/**
	 * Subscribe to an event.
	 *
	 * @param   {string}   event - Event name, or `'*'` for every event.
	 * @param   {Function} fn    - Listener. May be async.
	 * @returns {Function}       Unsubscribe function.
	 */
	on( event, fn ) {

		if ( typeof fn !== 'function' ) throw new TypeError( 'Listener must be a function' )

		if ( event === '*' ) {

			this._any.add( fn )
			return () => this._any.delete( fn )

		}

		if ( !this._listeners.has( event ) ) this._listeners.set( event, new Set() )
		this._listeners.get( event ).add( fn )
		return () => this.off( event, fn )

	}

	/** Subscribe to an event, auto-unsubscribing after the first call. */
	once( event, fn ) {

		const off = this.on( event, async ( ...args ) => {

			off()
			return fn( ...args )

		} )
		return off

	}

	off( event, fn ) {

		if ( event === '*' ) return this._any.delete( fn )
		const set = this._listeners.get( event )
		if ( !set ) return false
		const removed = set.delete( fn )
		if ( set.size === 0 ) this._listeners.delete( event )
		return removed

	}

	/**
	 * Emit an event and await every listener.
	 *
	 * Listener errors are collected rather than thrown: one broken plugin must
	 * never take down the monitoring loop. They are surfaced on `'error'`.
	 *
	 * @param   {string}                   event   - Event name.
	 * @param   {*}                        payload - Event payload.
	 * @returns {Promise<{errors: Error[]}>}       Settled result.
	 */
	async emit( event, payload ) {

		const fns = [ ...( this._listeners.get( event ) || [] ), ...this._any ]
		// Wrapped in Promise.resolve().then so a *synchronous* throw is captured by
		// allSettled too — a plain fn() call would escape before it is ever awaited.
		const results = await Promise.allSettled(
			fns.map( fn => Promise.resolve().then( () => fn( payload, event ) ) ),
		)

		const errors = results.filter( r => r.status === 'rejected' ).map( r => r.reason )

		// Guard against recursion: an error inside an 'error' listener is dropped.
		if ( errors.length && event !== 'error' ) {

			for ( const err of errors ) await this.emit( 'error', {
				event,
				error : err,
			} )

		}

		return { errors }

	}

	listenerCount( event ) {

		return ( this._listeners.get( event )?.size || 0 ) + this._any.size

	}

	removeAll() {

		this._listeners.clear()
		this._any.clear()

	}

}

/**
 * Canonical event names. Plugins should use these constants rather than string
 * literals so a rename stays a compile-time-ish concern.
 */
export const EVENTS = {
	READING       : 'sensor:reading',
	SENSOR_ERROR  : 'sensor:error',
	THIRSTY       : 'plant:thirsty',
	DROWNING      : 'plant:drowning',
	TOO_HOT       : 'plant:too-hot',
	TOO_COLD      : 'plant:too-cold',
	TOO_DARK      : 'plant:too-dark',
	TOO_BRIGHT    : 'plant:too-bright',
	STRESSED      : 'plant:stressed',
	HAPPY         : 'plant:happy',
	SPOKE         : 'plant:spoke',
	VISION        : 'vision:analysis',
	ELECTRO       : 'electro:analysis',
	SPECTRAL      : 'spectral:sweep',
	ELECTROME_SHIFT : 'plant:electrome-shift',
	DAMAGE        : 'plant:damaged',
	ALERT         : 'alert',
	PLUGIN_LOADED : 'plugin:loaded',
	AI_REQUEST    : 'ai:request',
	AI_RESPONSE   : 'ai:response',
	ERROR         : 'error',
}
