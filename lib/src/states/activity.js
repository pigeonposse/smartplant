/**
 * What the symbiont just did, or just noticed.
 *
 * Everything in this library records something, and none of it is anywhere a
 * person can read in order. The care log knows about watering, the event bus
 * knows about alarms, the states know when they changed, the colony knows what
 * was said, the gate knows what it refused — and to find out what happened this
 * afternoon you would have to open five of them and merge by timestamp.
 *
 * ## It listens rather than being told
 *
 * The tempting implementation is a `log()` call at every interesting place. That
 * produces a feed that is complete on the day it is written and quietly
 * incomplete forever after, because the next thing somebody adds will not have
 * the call — the same failure the single gate exists to prevent, in a different
 * costume.
 *
 * So this subscribes to the event bus and diffs the internal states between
 * cycles. A new alarm, a new refusal or a state that moved shows up without
 * anybody remembering to announce it.
 *
 * ## What does not go in
 *
 * **Readings.** A sensor tick is not an activity, and a feed that includes every
 * one is a log rather than a story. Only a *significant* change earns a line —
 * enough movement to have meant something.
 *
 * **Anything not configured.** The same rule the diagnosis follows: a plant with
 * no camera is not failing to see, and a feed listing everything absent buries
 * what actually happened.
 *
 * **Refusals are in, and they are the most useful entries in it.** A person
 * looking at a plant that has not been watered wants to know that watering was
 * declined and why, far more than they want another line saying the soil was
 * read again.
 */

/** The families a line can belong to, which decide how it reads. */
export const ACTIVITY = {
	CARE        : 'care',
	ELECTRICAL  : 'electrical',
	STATE       : 'state',
	ENVIRONMENT : 'environment',
	VISION      : 'vision',
	COLONY      : 'colony',
	SYSTEM      : 'system',
	REFUSAL     : 'refusal',
}

/**
 * How much a metric has to move before it is an event rather than weather.
 *
 * These are the same judgements the negative control in the defence estimate
 * uses, for the same reason: a change this size is something that happened, and
 * anything smaller is the room breathing.
 */
export const SIGNIFICANT = {
	soil : 8,
	temperature : 3,
	humidity : 10,
	light : 3000,
	co2 : 150,
	airflow : 0.3,
}

/** Which event on the bus becomes which kind of line. */
const FROM_EVENT = {
	'plant:thirsty'          : [ ACTIVITY.STATE, 'Thirsty' ],
	'plant:drowning'         : [ ACTIVITY.STATE, 'Waterlogged' ],
	'plant:too-hot'          : [ ACTIVITY.ENVIRONMENT, 'Too hot' ],
	'plant:too-cold'         : [ ACTIVITY.ENVIRONMENT, 'Too cold' ],
	'plant:too-dark'         : [ ACTIVITY.ENVIRONMENT, 'Too dark' ],
	'plant:too-bright'       : [ ACTIVITY.ENVIRONMENT, 'Too bright' ],
	'plant:stressed'         : [ ACTIVITY.STATE, 'Stressed' ],
	'plant:electrome-shift'  : [ ACTIVITY.ELECTRICAL, 'Electrome shift' ],
	'plant:damaged'          : [ ACTIVITY.VISION, 'Damage seen' ],
	'vision:analysis'        : [ ACTIVITY.VISION, 'Looked at itself' ],
	'electro:analysis'       : [ ACTIVITY.ELECTRICAL, 'Listened' ],
	'spectral:sweep'         : [ ACTIVITY.CARE, 'Spectral probe' ],
	'plant:checkup'          : [ ACTIVITY.SYSTEM, 'Checkup' ],
	'maintenance:report'     : [ ACTIVITY.SYSTEM, 'Instrument inspected' ],
	'maintenance:component-degraded' : [ ACTIVITY.SYSTEM, 'Component degraded' ],
	'plugin:loaded'          : [ ACTIVITY.SYSTEM, 'Plugin installed' ],
}

const finite = Number.isFinite

/**
 * The feed.
 */
export class Activity {

	/**
	 * @param {object} [opts] - `{ max }`.
	 */
	constructor( opts = {} ) {

		this.max = opts.max ?? 2000
		// The bucket a repeat is folded into, measured from when that bucket
		// opened. One minute, because the feed is read as a timeline and a
		// timeline whose newest line says 17:33 at 17:59 is not one.
		//
		// It has to be measured from the start of the bucket rather than from the
		// last repeat. Sliding it forward on every repeat means a line that recurs
		// faster than the window never closes at all: "Thirsty" arriving every few
		// seconds kept a 17:33 entry alive for half an hour, growing a counter,
		// while the clock said 17:59 — which is the whole feed lying about when
		// anything happened.
		this.dedupeMs = opts.dedupeMs ?? 60_000
		this.entries = []
		/** Last seen state levels, so only changes are recorded. */
		this._states = new Map()
		this._reading = null

	}

	/**
	 * Add a line.
	 *
	 * @param   {object} entry - `{kind, label, detail, source, degraded}`.
	 * @returns {object|null}  The entry.
	 */
	add( entry ) {

		if ( !entry?.label ) return null

		// The same line arriving every cycle is a log, not a story. A routine
		// inspection that found the same thing it found five minutes ago has not
		// happened again in any sense a reader cares about — so an identical line
		// inside the window updates the timestamp of the one already there
		// instead of adding another.
		// Care actions keep their detail in the key, because two waterings are two
		// waterings and merging them would hide the second. Everything else drops
		// it: an alarm repeating with a slightly different number is the same fact
		// happening again, not a new one, and keying on the number defeats the
		// whole point.
		const key = entry.kind === ACTIVITY.CARE
			? `${entry.kind}|${entry.label}|${entry.detail ?? ''}`
			: `${entry.kind}|${entry.label}`
		const at = entry.at ?? Date.now()
		const last = this._seen?.get( key )

		this._seen ??= new Map()

		// Measured from when this bucket opened — `last.entry.at`, which never
		// moves — and not from the last repeat. Measuring from the last repeat is
		// what froze the feed: every repeat pushed the deadline out, so a
		// recurring line never aged out and the newest thing on screen stayed
		// stamped with the time it first happened.
		if ( finite( last?.entry?.at ) && at - last.entry.at < ( this.dedupeMs ?? 60_000 ) ) {

			// Inside the minute the entry stays where it happened and only the
			// counter moves. Past it, the branch is not taken, a new line is
			// pushed, and the feed advances.
			last.entry.lastAt = at
			if ( entry.detail ) last.entry.detail = entry.detail
			last.entry.repeated = ( last.entry.repeated ?? 1 ) + 1
			return last.entry

		}

		const line = {
			// When it started. It does not move.
			at,
			lastAt : at,
			kind : entry.kind ?? ACTIVITY.SYSTEM,
			label : entry.label,
			detail : entry.detail ?? null,
			// Which sensor or layer produced it, so a person can tell an
			// observation from a conclusion.
			source : entry.source ?? null,
			// Flagged rather than hidden: a line from an instrument that is
			// failing is still information, and pretending otherwise is how a
			// dying electrode's readings get believed.
			degraded : entry.degraded === true,
		}

		this.entries.push( line )
		this._seen.set( key, {
			at,
			entry : line,
		} )

		if ( this.entries.length > this.max ) {

			const gone = this.entries.shift()
			for ( const [ k, v ] of this._seen ) if ( v.entry === gone ) this._seen.delete( k )

		}

		return line

	}

	/**
	 * Start listening to a plant.
	 *
	 * Subscribes rather than asking to be told, so something added later shows
	 * up without anybody having remembered to announce it.
	 *
	 * @param   {object} plant - A `SmartPlant`.
	 * @returns {Function}     Unsubscribe.
	 */
	watch( plant ) {

		const off = []

		for ( const [ event, [ kind, label ] ] of Object.entries( FROM_EVENT ) ) {

			const handler = payload => this.add( {
				kind,
				label,
				detail : describe( event, payload ),
				source : sourceOf( event ),
			} )

			plant.on?.( event, handler )
			off.push( () => plant.events?.off?.( event, handler ) )

		}

		// Care actions carry a size, and the size is most of the information —
		// "watered" and "watered 180ml" are different lines.
		const care = payload => this.add( {
			kind : ACTIVITY.CARE,
			label : payload?.type === 'fertilize' ? 'Fertilised' : 'Watered',
			detail : finite( payload?.amount ) ? `${payload.amount} ml` : null,
			source : 'care log',
		} )

		plant.on?.( 'plant:watered', care )
		off.push( () => plant.events?.off?.( 'plant:watered', care ) )

		return () => {

			for ( const f of off ) f()

		}

	}

	/**
	 * Notice what has changed since last time.
	 *
	 * Called once a cycle. Diffs the internal states and the reading, so a state
	 * that moved earns a line and a state that sat still does not.
	 *
	 * @param   {object} plant - A `SmartPlant`.
	 * @returns {number}       Lines added.
	 */
	notice( plant ) {

		let n = 0

		const states = safely( () => plant?.states?.() ) ?? {}

		for ( const [ name, state ] of Object.entries( states ) ) {

			if ( !state?.level ) continue

			const was = this._states.get( name )
			this._states.set( name, state.level )

			// Nothing on the first pass: everything would be a change, and a feed
			// that opens with five lines saying a plant exists is noise.
			if ( was === undefined || was === state.level ) continue

			this.add( {
				kind : ACTIVITY.STATE,
				label : `${name.replace( /_/g, ' ' )} → ${state.level}`,
				detail : state.acts ? 'now gating decisions' : 'not acting on it',
				source : 'internal states',
			} )
			n++

		}

		const reading = plant?.memory?.lastReading

		if ( reading && this._reading ) {

			for ( const [ metric, limit ] of Object.entries( SIGNIFICANT ) ) {

				const before = this._reading[ metric ], now = reading[ metric ]
				if ( !finite( before ) || !finite( now ) ) continue

				const delta = now - before
				if ( Math.abs( delta ) < limit ) continue

				this.add( {
					kind : ACTIVITY.ENVIRONMENT,
					label : `${metric} ${delta > 0 ? 'rose' : 'fell'}`,
					detail : `${before.toFixed( 1 )} → ${now.toFixed( 1 )}`,
					source : 'sensor',
					degraded : safely( () => plant.maintenance?.()?.condition === 'degraded' ) === true,
				} )
				n++

			}

		}

		if ( reading ) this._reading = { ...reading }

		return n

	}

	/**
	 * A refusal, which is the most useful thing in this feed.
	 *
	 * Somebody looking at a plant that has not been watered wants to know that
	 * watering was declined and why, far more than they want another line saying
	 * the soil was read again.
	 *
	 * @param   {string} action  - What was refused.
	 * @param   {object} verdict - From `mayI` or a care refusal.
	 * @returns {object|null}    The entry.
	 */
	refused( action, verdict ) {

		const by = verdict?.blockedBy?.[ 0 ]?.state ?? verdict?.state ?? 'a safety layer'

		return this.add( {
			kind : ACTIVITY.REFUSAL,
			label : `${action} refused`,
			detail : by.replace( /_/g, ' ' ),
			source : 'gate',
		} )

	}

	/**
	 * The feed, newest first.
	 *
	 * @param   {object} [opts] - `{ limit, kind, since }`.
	 * @returns {object[]}      Entries.
	 */
	recent( opts = {} ) {

		let out = [ ...this.entries ].reverse()

		if ( opts?.kind ) out = out.filter( e => e.kind === opts.kind )
		if ( finite( opts?.since ) ) out = out.filter( e => e.at >= opts.since )

		return out.slice( 0, opts?.limit ?? 500 )

	}

	report() {

		const kinds = {}
		for ( const e of this.entries ) kinds[ e.kind ] = ( kinds[ e.kind ] ?? 0 ) + 1

		return {
			entries : this.entries.length,
			kinds,
			latest : this.entries.at( -1 ) ?? null,
			why : this.entries.length
				? `${this.entries.length} things worth mentioning, most recently ${this.entries.at( -1 ).label}.`
				: 'Nothing has happened yet that is worth a line. Readings are not activity — a feed that included every sensor tick would be a log rather than a story.',
		}

	}

	toJSON() {

		return { entries : this.entries.slice( -400 ) }

	}

}

function describe( event, payload ) {

	if ( !payload || typeof payload !== 'object' ) return null

	if ( event === 'spectral:sweep' ) return payload.bands?.length ? `${payload.bands.length} bands` : null
	if ( event === 'electro:analysis' ) return payload.events?.length ? `${payload.events.length} events` : null
	if ( event === 'vision:analysis' ) {

		const found = Object.entries( payload.findings ?? {} ).filter( ( [ , v ] ) => v ).map( ( [ k ] ) => k )
		return found.length ? found.join( ', ' ) : null

	}
	if ( event === 'maintenance:component-degraded' ) return payload.what ?? payload.metric ?? null
	if ( payload.message ) return String( payload.message ).slice( 0, 80 )
	if ( finite( payload.value ) ) return String( payload.value )

	return null

}

function sourceOf( event ) {

	if ( event.startsWith( 'electro' ) || event.includes( 'electrome' ) ) return 'electrode'
	if ( event.startsWith( 'vision' ) || event === 'plant:damaged' ) return 'camera'
	if ( event.startsWith( 'spectral' ) ) return 'lamp'
	if ( event.startsWith( 'maintenance' ) ) return 'maintenance'
	if ( event.startsWith( 'plugin' ) ) return 'plugins'

	return 'sensor'

}

function safely( fn ) {

	try {

		return fn()

	}
	catch {

		return null

	}

}
