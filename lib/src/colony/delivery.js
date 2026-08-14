/**
 * Getting a message there, when one way of getting there has stopped working.
 *
 * Until now a colony had exactly one transport. If it failed, messages went
 * nowhere — and six call sites swallowed the failure with an empty `catch`, so a
 * colony could be completely broken and look like it was working. A plant could
 * warn its neighbours about a pest, be told nothing had gone wrong, and have
 * warned nobody.
 *
 * The design here is taken from **Maskpert**, the delivery layer of LECC
 * (Linked Electronic Communication Core), and follows its five steps almost
 * exactly: choose candidates, order by priority, fan out, confirm, and spool
 * whatever nobody accepted so it can be retried when a link comes back.
 *
 * Three things are different, and all three come from having a living thing at
 * the other end rather than a service.
 *
 * ## Messages go off
 *
 * A general delivery layer replays a spooled message when the link returns, and
 * that is right for a service: a reading is a reading whenever it arrives.
 *
 * Here it would lie. "I am thirsty" delivered two hours late waters a plant that
 * was watered ninety minutes ago. A frame from a live aid session arrives after
 * the session closed and describes light that is no longer falling on anything.
 * So every kind of message declares how long it is worth anything, and the spool
 * drops what has gone off instead of delivering it as though it were current.
 *
 * What survives the wait — a pest warning, a lesson, a plant announcing it is
 * about to lose power — is delivered carrying the time it was written and a flag
 * saying it is late. Late and current are different facts and the receiver is
 * told which one it has.
 *
 * ## Fan-out duplicates, and here a duplicate *acts*
 *
 * Sending across every healthy link means a message can arrive twice. In
 * ordinary messaging that is noise. In this colony a second copy of a request
 * opens a second aid session, and a second pest warning halves an already
 * shortened inspection interval again. So the receiving side keeps the ids it
 * has seen and drops repeats, and that is not optional.
 *
 * ## Some links cost the plant at the other end
 *
 * This is the part no general-purpose delivery layer can model, because no
 * general-purpose link harms its recipient. Talking by light at night puts light
 * on a resting plant — it is metered, booked against that plant's own dose
 * ledger, and it is a real cost paid by somebody who did not ask for the
 * message.
 *
 * So a link carries two prices: what it costs the sender, and what it costs the
 * receiver. The second one dominates. A selector that only weighed latency and
 * reliability would reach for the optical link the moment TCP got slow, and take
 * a neighbour's circadian rhythm to save two hundred milliseconds.
 *
 * ## And an emulated link never confirms
 *
 * LECC can stand in for a transport that will not start, so routing and metrics
 * stay meaningful and the process keeps running. That is useful here too — but a
 * stand-in that reports success would recreate the exact failure the beacon
 * layer exists to prevent: a plant that believes it called for help. An emulated
 * link may hold a message. It may never say it was delivered.
 */

/** What a link is currently worth trying. */
export const LINK = {
	UP       : 'up',
	DEGRADED : 'degraded',
	OPEN     : 'open',
	EMULATED : 'emulated',
}

/**
 * How long each kind of message is worth delivering.
 *
 * Milliseconds, or `null` for "does not go off". The distinction is the whole
 * reason this file cannot simply replay a spool.
 */
export const SHELF_LIFE = {
	// Perishable: these describe a moment, and the moment passes.
	chat        : 15 * 60_000,
	report      : 15 * 60_000,
	ask         : 60_000,
	reply       : 60_000,
	'aid'       : 5 * 60_000,
	'aid-open'  : 60_000,
	'aid-frame' : 30_000,
	'aid-close' : 5 * 60_000,

	// Worth having late: a warning is still a warning, and a lesson is timeless.
	priming     : 12 * 3600_000,
	lesson      : null,
	'ask-lesson': 30 * 60_000,
	hello       : 5 * 60_000,
	sos         : null,
}

/** Default when a kind says nothing, chosen short on purpose. */
export const DEFAULT_SHELF_LIFE = 10 * 60_000

/**
 * Is this message still worth delivering?
 *
 * @param   {object} env  - The envelope.
 * @param   {number} [at] - Now, in epoch ms.
 * @returns {object}      `{fresh, ageMs, why}`.
 */
export function stillWorthIt( env, at = Date.now() ) {

	env = env ?? {}

	const written = env?.at ?? env?.body?.at

	if ( !Number.isFinite( written ) ) {

		return {
			fresh : true,
			ageMs : null,
			why : 'The message carries no time of writing, so its age is unknown. Delivered rather than dropped, because dropping on a guess is worse than delivering something slightly stale — but it cannot be marked late either.',
		}

	}

	const ageMs = at - written
	const life = Object.hasOwn( SHELF_LIFE, env.kind ) ? SHELF_LIFE[ env.kind ] : DEFAULT_SHELF_LIFE

	if ( life === null ) {

		return {
			fresh : true,
			ageMs,
			why : `A "${env.kind}" does not go off. ${Math.round( ageMs / 1000 )}s old and still worth delivering.`,
		}

	}

	if ( ageMs <= life ) {

		return {
			fresh : true,
			ageMs,
			why : `${Math.round( ageMs / 1000 )}s old, inside the ${Math.round( life / 1000 )}s this kind is good for.`,
		}

	}

	return {
		fresh : false,
		ageMs,
		why : `A "${env.kind}" is worth ${Math.round( life / 1000 )}s and this one is ${Math.round( ageMs / 1000 )}s old. Delivering it now would describe a moment that has passed as though it were this one — which is worse than never delivering it, because the receiver would act on it.`,
	}

}

/**
 * A link that has been failing gets rested.
 *
 * Straight from the LECC design and worth keeping exactly: hammering a transport
 * that is down wastes the sender's budget and, on a battery, that budget is the
 * plant's.
 */
export class Breaker {

	/**
	 * @param {object} [opts] - `{ threshold, resetMs }`.
	 */
	constructor( opts = {} ) {

		this.threshold = opts.threshold ?? 5
		this.resetMs = opts.resetMs ?? 30_000
		this.failures = 0
		this.openedAt = null

	}

	/** Whether the link may be tried right now. */
	ready( at = Date.now() ) {

		if ( this.openedAt === null ) return true

		// One trial run after the rest. If it works the breaker closes; if it
		// fails it opens again for another interval.
		return at - this.openedAt >= this.resetMs

	}

	succeeded() {

		this.failures = 0
		this.openedAt = null

	}

	failed( at = Date.now() ) {

		this.failures++
		if ( this.failures >= this.threshold ) this.openedAt = at

	}

	/**
	 * What this link is worth, at a given moment.
	 *
	 * Takes the time rather than reading the clock, so the same reasoning can be
	 * checked against a made-up sequence of failures instead of only against
	 * whatever the wall clock happens to say.
	 *
	 * @param   {number} [at] - Now.
	 * @returns {string}      One of `LINK`.
	 */
	stateAt( at = Date.now() ) {

		if ( this.openedAt === null ) return this.failures ? LINK.DEGRADED : LINK.UP
		return this.ready( at ) ? LINK.DEGRADED : LINK.OPEN

	}

	get state() {

		return this.stateAt()

	}

}

/**
 * What could not be sent, kept until a link comes back.
 *
 * Bounded, deduplicated by id, and — unlike a general spool — actively pruned by
 * shelf life rather than by one global age limit.
 */
export class Spool {

	/**
	 * @param {object} [opts] - `{ max }`.
	 */
	constructor( opts = {} ) {

		this.max = opts.max ?? 200
		this.items = new Map()
		this.dropped = { stale : 0, overflow : 0 }

	}

	get size() {

		return this.items.size

	}

	/**
	 * Hold a message nobody accepted.
	 *
	 * @param   {object} env - The envelope.
	 * @returns {object}     `{spooled, why}`.
	 */
	hold( env ) {

		if ( !env?.id ) return {
			spooled : false,
			why : 'An envelope with no id cannot be spooled, because a retry could not be told apart from a new message.',
		}

		const worth = stillWorthIt( env )

		if ( !worth.fresh ) {

			this.dropped.stale++
			return {
				spooled : false,
				why : `Not spooled. ${worth.why}`,
			}

		}

		if ( !this.items.has( env.id ) && this.items.size >= this.max ) {

			// Drop the oldest rather than refusing the newest: in an outage the
			// recent state of a plant is worth more than its state an hour ago.
			const oldest = this.items.keys().next().value
			this.items.delete( oldest )
			this.dropped.overflow++

		}

		this.items.set( env.id, env )

		return {
			spooled : true,
			why : `Held for retry. ${worth.why}`,
		}

	}

	/**
	 * Everything still worth sending, oldest first, and drop the rest.
	 *
	 * @param   {number} [at] - Now.
	 * @returns {object[]}    Envelopes.
	 */
	due( at = Date.now() ) {

		const out = []

		for ( const [ id, env ] of this.items ) {

			const worth = stillWorthIt( env, at )

			if ( worth.fresh ) out.push( env )
			else {

				this.items.delete( id )
				this.dropped.stale++

			}

		}

		return out

	}

	drop( id ) {

		this.items.delete( id )

	}

	report() {

		return {
			held : this.items.size,
			dropped : { ...this.dropped },
			why : this.items.size
				? `${this.items.size} message${this.items.size === 1 ? '' : 's'} waiting for a link to come back.`
				: 'Nothing waiting.',
		}

	}

}

/**
 * A transport, plus what it costs and how it has been behaving.
 *
 * @param   {object} transport - A `ColonyTransport`.
 * @param   {object} [opts]    - `{ name, priority, costsSender, costsReceiver, emulated }`.
 * @returns {object}           A link.
 */
export function link( transport, opts = {} ) {

	opts = opts ?? {}

	return {
		name : opts.name ?? transport?.id ?? 'link',
		transport,
		// Lower is tried first, and a priority link is the one whose acceptance
		// counts as confirmation.
		priority : opts.priority ?? 10,
		// What one message costs. `receiver` is in units of "how much this takes
		// from the plant being sent to", and it is the one that decides.
		costsSender : opts.costsSender ?? 0,
		costsReceiver : opts.costsReceiver ?? 0,
		emulated : opts.emulated === true,
		breaker : new Breaker( opts.breaker ),
		sent : 0,
		failed : 0,
	}

}

/**
 * Which links are worth trying for this message, in order.
 *
 * @param   {object[]} links - The registry.
 * @param   {object}   env   - The envelope.
 * @param   {object}   [opts] - `{ now, urgent }`.
 * @returns {object}         `{candidates, skipped}`.
 */
export function candidates( links, env, opts = {} ) {

	links = Array.isArray( links ) ? links : []
	env = env ?? {}
	opts = opts ?? {}

	const now = opts.now ?? Date.now()
	const skipped = {}
	const out = []

	for ( const l of links ) {

		// Loop prevention: a message does not go back the way it came, and does
		// not revisit a link its hop trail says it has already crossed.
		if ( env.via === l.name ) {

			skipped[ l.name ] = 'this is where the message came from'
			continue

		}

		if ( Array.isArray( env.hops ) && env.hops.includes( l.name ) ) {

			skipped[ l.name ] = 'the message has already crossed this link'
			continue

		}

		if ( !l.breaker.ready( now ) ) {

			skipped[ l.name ] = `resting after ${l.breaker.failures} failures`
			continue

		}

		// The adaptation that matters. A link with a cost to the *receiving*
		// plant is not a cheaper route, it is a bill somebody else pays, and it
		// is only worth sending unless the message is urgent enough to justify it.
		if ( l.costsReceiver > 0 && !opts.urgent ) {

			skipped[ l.name ] = `costs the receiving plant ${l.costsReceiver} and this message is not urgent enough to spend that`
			continue

		}

		out.push( l )

	}

	// Priority first, then whatever is cheapest for the sender.
	out.sort( ( a, b ) => a.priority - b.priority || a.costsSender - b.costsSender )

	return {
		candidates : out,
		skipped,
	}

}

/**
 * Send a message every way that is worth trying.
 *
 * @param   {object[]} links  - The registry.
 * @param   {object}   env    - The envelope.
 * @param   {object}   [opts] - `{ spool, fanout, urgent, now }`.
 * @returns {Promise<object>} A delivery report.
 */
export async function deliver( links, env, opts = {} ) {

	links = Array.isArray( links ) ? links : []
	opts = opts ?? {}

	if ( !env || typeof env !== 'object' ) {

		return report( {
			ok : false,
			why : 'Nothing was passed to send. An envelope needs at least { id, from, to, kind }, and without one there is no message and nothing to report about it.',
		} )

	}

	const now = opts.now ?? Date.now()

	// Stamped once, here, so shelf life is measured from when it was written
	// rather than from each retry.
	env.at ??= now
	env.hops = Array.isArray( env.hops ) ? [ ...env.hops ] : []

	const worth = stillWorthIt( env, now )

	if ( !worth.fresh ) {

		return report( {
			ok : false,
			stale : true,
			why : worth.why,
		} )

	}

	const { candidates : tryThese, skipped } = candidates( links, env, {
		now,
		urgent : opts.urgent,
	} )

	if ( !tryThese.length ) {

		const held = opts.spool?.hold( env ) ?? {
			spooled : false,
			why : 'No spool configured.',
		}

		return report( {
			ok : false,
			skipped,
			spooled : held.spooled,
			why : `No link was worth trying. ${held.why}`,
		} )

	}

	const delivered = []
	const failed = {}
	let confirmedBy = null

	// Everything reachable gets a copy, each with its own hop trail, so a relay
	// that forwards it cannot send it back round.
	for ( const l of opts.fanout === false ? tryThese.slice( 0, 1 ) : tryThese ) {

		try {

			await l.transport.send( {
				...env,
				hops : [ ...env.hops, l.name ],
				via : l.name,
				// An emulated link is told plainly what it is, so nothing
				// downstream can mistake a buffer for an arrival.
				emulated : l.emulated || undefined,
			} )

			l.sent++
			l.breaker.succeeded()

			if ( l.emulated ) {

				// Held, not delivered. A stand-in that reported success would
				// leave a plant believing it had called for help.
				failed[ l.name ] = 'emulated: the message is buffered, not delivered'
				continue

			}

			delivered.push( l.name )
			if ( confirmedBy === null && l.priority <= 10 ) confirmedBy = l.name

		}
		catch ( err ) {

			l.failed++
			l.breaker.failed( now )
			failed[ l.name ] = err.message

		}

	}

	if ( !delivered.length ) {

		const held = opts.spool?.hold( env ) ?? {
			spooled : false,
			why : 'No spool configured, so this message is simply lost — which is worth knowing rather than hiding.',
		}

		return report( {
			ok : false,
			failed,
			skipped,
			spooled : held.spooled,
			why : `Nothing accepted it. ${held.why}`,
		} )

	}

	opts.spool?.drop( env.id )

	return report( {
		ok : true,
		delivered,
		failed,
		skipped,
		confirmedBy,
		why : confirmedBy
			? `Delivered by ${delivered.join( ', ' )} and confirmed by ${confirmedBy}.`
			: `Delivered by ${delivered.join( ', ' )}, none of them a priority link — so it went, and nothing here can promise it went by the route that matters.`,
	} )

}

function report( r ) {

	return {
		ok : false,
		delivered : [],
		failed : {},
		skipped : {},
		confirmedBy : null,
		spooled : false,
		stale : false,
		...r,
	}

}

/**
 * Try everything the spool is still holding.
 *
 * @param   {object[]} links  - The registry.
 * @param   {object}   spool  - A `Spool`.
 * @param   {object}   [opts] - `{ now }`.
 * @returns {Promise<object>} `{sent, dropped, why}`.
 */
export async function drainSpool( links, spool, opts = {} ) {

	links = Array.isArray( links ) ? links : []
	opts = opts ?? {}

	if ( typeof spool?.due !== 'function' ) {

		return {
			sent : 0,
			stillHeld : 0,
			droppedStale : 0,
			why : 'No spool was given, so there is nothing held and nothing to retry.',
		}

	}

	const now = opts.now ?? Date.now()
	const before = spool.size
	const due = spool.due( now )
	const sent = []

	for ( const env of due ) {

		// Marked late, carrying the time it was written. A receiver acting on a
		// two-hour-old message should know that is what it is doing.
		const r = await deliver( links, {
			...env,
			late : true,
			delayedMs : now - ( env.at ?? now ),
		}, {
			...opts,
			spool : null,
			now,
		} )

		if ( r.ok ) {

			spool.drop( env.id )
			sent.push( env.id )

		}

	}

	return {
		sent : sent.length,
		stillHeld : spool.size,
		droppedStale : before - due.length,
		why : sent.length
			? `${sent.length} message${sent.length === 1 ? '' : 's'} delivered after waiting, each marked late and carrying the time it was written.`
			: spool.size
				? `${spool.size} still waiting; no link accepted anything.`
				: 'Nothing was waiting.',
	}

}

/**
 * The receiving side: has this already arrived?
 *
 * Fan-out means duplicates, and in this colony a duplicate acts — a second copy
 * of a request opens a second aid session, and a second pest warning shortens an
 * already shortened inspection interval again.
 */
export class Seen {

	/**
	 * @param {object} [opts] - `{ max }`.
	 */
	constructor( opts = {} ) {

		this.max = opts.max ?? 500
		this.ids = new Set()

	}

	/**
	 * @param   {object} env - The envelope.
	 * @returns {boolean}    Whether this is a repeat.
	 */
	duplicate( env ) {

		const id = env?.id
		if ( !id ) return false

		if ( this.ids.has( id ) ) return true

		this.ids.add( id )
		if ( this.ids.size > this.max ) this.ids.delete( this.ids.values().next().value )

		return false

	}

}

/**
 * How the whole delivery layer is doing.
 *
 * @param   {object[]} links - The registry.
 * @param   {object}   spool - A `Spool`.
 * @returns {object}         A report.
 */
export function health( links, spool, at = Date.now() ) {

	links = Array.isArray( links ) ? links : []

	const rows = links.map( l => ( {
		name : l.name,
		state : l.emulated ? LINK.EMULATED : l.breaker.stateAt( at ),
		priority : l.priority,
		sent : l.sent,
		failed : l.failed,
		costsReceiver : l.costsReceiver,
	} ) )

	const usable = rows.filter( r => r.state === LINK.UP || r.state === LINK.DEGRADED )

	return {
		links : rows,
		spool : typeof spool?.report === 'function' ? spool.report() : null,
		ok : usable.length > 0,
		why : usable.length
			? `${usable.length} of ${rows.length} links usable.`
			: rows.length
				? 'Every link is down or resting. Nothing this plant says is reaching anybody, and messages are being held until one comes back.'
				: 'No links registered at all, so nothing can be sent. A colony of one behaves exactly like no colony, but silently — this is that, said out loud.',
	}

}
