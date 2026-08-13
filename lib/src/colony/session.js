/**
 * A live channel between two plants while one is helping the other.
 *
 * The first version of aid was a single exchange: ask, accept, act, hope. The
 * helper decided what to emit and the receiver booked an estimate of it, which
 * meant both were reasoning about a number rather than about what happened.
 *
 * That was the wrong shape. A plant being lit **has a light sensor**, and that
 * sensor measures what actually arrives — including light it did not ask for and
 * cannot account for any other way. Bookkeeping was a workaround for a
 * measurement that was available all along.
 *
 * And light is only one thing a plant can do for another. Shade, shelter from a
 * draught, warmth, getting out of the way — each changes something the receiving
 * plant already measures, so each can be verified the same way. What differs is
 * *which* metric and in *which* direction, and that comes from the kind of aid
 * rather than from anything in here.
 *
 * So aid runs as a session. Both sides stream while it lasts: the helper says
 * what it is emitting, the receiver says what it is measuring, and the receiver
 * decides when to stop based on what it has actually received. Neither is
 * working blind, and the record afterwards describes an event rather than an
 * intention.
 *
 * ## What each side knows, and why both are needed
 *
 * The measurement is ground truth about **quantity**: the receiver's sensor sees
 * the delta from ambient and integrates it, whatever the source.
 *
 * It is not ground truth about **band**. A lux sensor is broadband and weighted
 * for a human eye; it cannot tell red from blue, and the dose ledger is per band
 * because 4h of red and 4h of blue are entirely different things to a plant.
 * That part only the emitter knows.
 *
 * So the two are cross-checked rather than ranked. And where they disagree —
 * the helper reports emitting and the receiver measures nothing — that is not a
 * bookkeeping discrepancy, it is a misaimed lamp, a blocked path, or a driver
 * that never turned on. Worth catching, and only catchable because both are
 * talking.
 *
 * ## The receiver holds the stop
 *
 * The helper cannot know how much light this plant has already had today, what
 * its substrate is doing, or whether its stomata are shut. The plant being
 * helped ends the session, and a session that loses its channel ends itself —
 * an unattended lamp burning on somebody else's plant is precisely the failure
 * this whole layer exists to avoid.
 */

/** Where a session is in its life. */
export const PHASE = {
	BASELINE : 'baseline',
	RUNNING  : 'running',
	CLOSED   : 'closed',
}

/** Why a session ended. */
export const CLOSED = {
	SATISFIED   : 'satisfied',
	REFUSED     : 'refused',
	LOST        : 'channel-lost',
	TIMEOUT     : 'timeout',
	CANCELLED   : 'cancelled',
	MISMATCH    : 'no-delivery',
}

let counter = 0

/**
 * One collaboration, from acceptance to close.
 */
export class AidSession {

	/**
	 * @param {object} opts             - Options.
	 * @param {string} opts.kind        - Which sort of aid.
	 * @param {string} opts.helper      - Who is giving.
	 * @param {string} opts.receiver    - Who is getting.
	 * @param {string} [opts.band]      - For light aid.
	 * @param {object} [opts.effect]    - `{metric, mode, direction}` from `aidEffect`.
	 * @param {number} [opts.target]    - Total to accumulate, or level to hold.
	 * @param {number} [opts.targetSeconds] - What was asked for.
	 * @param {number} [opts.maxSeconds]    - Hard ceiling regardless. Default 3600.
	 * @param {number} [opts.staleMs]   - Silence after which the channel counts as lost. Default 15000.
	 */
	constructor( opts = {} ) {

		this.id = `aid_${++counter}_${Date.now().toString( 36 )}`
		this.kind = opts.kind
		this.helper = opts.helper
		this.receiver = opts.receiver
		this.band = opts.band ?? null
		// What this kind of help is supposed to change, and which way. Without it
		// a session can run but cannot tell whether it is doing anything.
		this.effect = opts.effect ?? null
		this.target = opts.target ?? null
		this.metric = opts.effect?.metric ?? 'light'
		this.targetSeconds = opts.targetSeconds ?? null
		this.maxSeconds = opts.maxSeconds ?? 3600
		this.staleMs = opts.staleMs ?? 15_000

		this.phase = PHASE.BASELINE
		this.openedAt = opts.at ?? Date.now()
		this.startedAt = null
		this.closedAt = null
		this.closedBecause = null

		/** The metric's value before the helper began, so change is attributable. */
		this.ambient = null
		/** Every frame from both sides, in order. */
		this.frames = []

		this._lastHelperFrame = null
		this._lastReceiverFrame = null
		this._integrated = 0
		this._sustainedSince = null

	}

	/**
	 * Record what the room looks like before anything is emitted.
	 *
	 * Without this the receiver cannot tell borrowed light from the sun.
	 *
	 * @param   {number} lux - Current ambient.
	 * @returns {object}     `{ready, why}`.
	 */
	baseline( value ) {

		if ( this.phase !== PHASE.BASELINE ) {

			return {
				ready : false,
				why : 'The baseline can only be taken before the session starts.',
			}

		}

		if ( !Number.isFinite( value ) ) {

			return {
				ready : false,
				why : `This session is judged on ${this.metric}, and it needs a reading of it before anything begins. Without one, nothing measured afterwards can be attributed to the helper rather than to the weather.`,
			}

		}

		this.ambient = value
		this.phase = PHASE.RUNNING
		this.startedAt = Date.now()

		return {
			ready : true,
			ambient : value,
			metric : this.metric,
			why : this.effect?.direction === 'down'
				? `${this.metric} is at ${value} before help. Anything below that during the session is the helper.`
				: `${this.metric} is at ${value} before help. Anything above that during the session is the helper.`,
		}

	}

	/** A frame from the plant giving help. */
	emitting( frame = {} ) {

		return this._frame( 'helper', {
			band : frame.band ?? this.band,
			level : frame.level ?? null,
			emitting : frame.emitting !== false,
			at : frame.at ?? Date.now(),
		} )

	}

	/** A frame from the plant receiving it. */
	measuring( frame = {} ) {

		const at = frame.at ?? Date.now()
		// Accept the metric by name or as a plain `value`, so a caller does not
		// have to know which one this session happens to watch.
		const value = frame.value ?? frame[ this.metric ] ?? frame.lux

		const known = Number.isFinite( value ) && Number.isFinite( this.ambient )
		// "Change in the helpful direction" — down for shade and shelter, up for
		// light and warmth. One number, whichever way the help runs.
		const change = known
			? ( this.effect?.direction === 'down' ? this.ambient - value : value - this.ambient )
			: null

		if ( known && this._lastReceiverFrame && this.effect?.mode === 'accumulate' ) {

			const dt = ( at - this._lastReceiverFrame.at ) / 1000
			this._integrated += Math.max( 0, change ) * dt

		}

		if ( known && this.effect?.mode === 'sustain' ) {

			// A sustained effect is only working while it is present. Losing it
			// resets the clock rather than quietly keeping credit for it.
			if ( change > 0 ) this._sustainedSince ??= at
			else this._sustainedSince = null

		}

		return this._frame( 'receiver', {
			value,
			change : known ? Number( change.toFixed( 2 ) ) : null,
			at,
		} )

	}

	_frame( side, data ) {

		const entry = {
			side,
			...data,
		}
		this.frames.push( entry )
		if ( this.frames.length > 2000 ) this.frames.shift()

		if ( side === 'helper' ) this._lastHelperFrame = entry
		else this._lastReceiverFrame = entry

		return entry

	}

	/**
	 * Seconds since the session began emitting.
	 *
	 * Measured from the frames rather than from the wall clock: the session's
	 * notion of time should come from the data flowing through it, so a replayed
	 * or simulated stream behaves exactly as a live one does.
	 */
	get elapsedSeconds() {

		if ( !this.startedAt ) return 0

		const latest = Math.max(
			this._lastHelperFrame?.at ?? 0,
			this._lastReceiverFrame?.at ?? 0,
			this.closedAt ?? 0,
		)

		return ( ( latest || Date.now() ) - this.startedAt ) / 1000

	}

	/**
	 * How much has measurably arrived.
	 *
	 * For a dose, the integral of the change. For a sustained effect there is no
	 * total to give — the honest answer is the current change and how long it has
	 * held, which is what `holding` reports.
	 */
	get delivered() {

		return Number( this._integrated.toFixed( 1 ) )

	}

	/** For sustained help: is the effect present, and for how long. */
	get holding() {

		const last = this._lastReceiverFrame

		return {
			present : Number.isFinite( last?.change ) && last.change > 0,
			change : last?.change ?? null,
			seconds : this._sustainedSince && last
				? Number( ( ( last.at - this._sustainedSince ) / 1000 ).toFixed( 1 ) )
				: 0,
		}

	}

	/**
	 * Should this stop now?
	 *
	 * Called by the receiver, because the receiver is the only one that knows.
	 *
	 * @param   {object} [opts] - `{ now, target, satisfied }`.
	 * @returns {object}        `{stop, because, why}`.
	 */
	shouldStop( opts = {} ) {

		const now = opts.now ?? Date.now()

		if ( this.phase === PHASE.CLOSED ) return {
			stop : true,
			because : this.closedBecause,
			why : 'Already closed.',
		}

		// A channel that has gone quiet means an unattended lamp on somebody
		// else's plant, which is worse than no help at all.
		const lastAny = Math.max(
			this._lastHelperFrame?.at ?? 0,
			this._lastReceiverFrame?.at ?? 0,
		)

		if ( lastAny && now - lastAny > this.staleMs ) {

			return {
				stop : true,
				because : CLOSED.LOST,
				why : `Nothing has come down the channel for ${Math.round( ( now - lastAny ) / 1000 )}s. The session ends rather than leaving a lamp running on a plant nobody is watching.`,
			}

		}

		if ( this.elapsedSeconds >= this.maxSeconds ) {

			return {
				stop : true,
				because : CLOSED.TIMEOUT,
				why : `Hit the ${this.maxSeconds}s ceiling. Every session has one regardless of what it measures, because a sensor stuck at a low reading would otherwise ask for light forever.`,
			}

		}

		const target = opts.target ?? this.target
		const unit = this.effect?.unit ?? ''

		// A dose is finished when enough has arrived, whoever sent it.
		if ( this.effect?.mode === 'accumulate'
			&& Number.isFinite( target ) && this.delivered >= target ) {

			return {
				stop : true,
				because : CLOSED.SATISFIED,
				delivered : this.delivered,
				why : `${this.delivered}${unit} measured against a target of ${target}. This is what arrived rather than what was sent, so it holds whether the helper turns out stronger or weaker than either of them assumed.`,
			}

		}

		// A sustained effect ends when the receiver no longer needs it — which the
		// receiver states, because only it knows. There is no total to reach.
		if ( this.effect?.mode === 'sustain' && opts.satisfied ) {

			return {
				stop : true,
				because : CLOSED.SATISFIED,
				holding : this.holding,
				why : `The receiving plant says it no longer needs this. Sustained help has no dose to finish — it ends when the condition that called for it does, and after ${Math.round( this.holding.seconds )}s of ${this.metric} held ${this.effect.direction === 'down' ? 'below' : 'above'} ${this.ambient}, that is now.`,
			}

		}

		// The universal check, and the one that generalises furthest: the helper
		// says it is helping and the receiver's own instrument sees no change.
		// That is not a bookkeeping discrepancy, it is something physically wrong.
		const nothingHappening = this.effect?.mode === 'accumulate'
			? this.delivered < 1
			: !this.holding.present

		if ( this._lastHelperFrame?.emitting && this.elapsedSeconds > 20 && nothingHappening ) {

			return {
				stop : true,
				because : CLOSED.MISMATCH,
				why : `The helper reports acting and this plant's ${this.metric} has not moved ${this.effect?.direction === 'down' ? 'down' : 'up'} in ${Math.round( this.elapsedSeconds )}s. Whatever is being done is not reaching this plant — wrong position, something in between, or it never started. Stopping: a session that delivers nothing is worse than none, because it looks like help.`,
			}

		}

		return {
			stop : false,
			delivered : this.delivered,
			elapsed : Number( this.elapsedSeconds.toFixed( 1 ) ),
		}

	}

	/**
	 * End it.
	 *
	 * @param   {string} because - One of `CLOSED`.
	 * @param   {object} [opts]  - `{ why }`.
	 * @returns {object}         The record.
	 */
	close( because = CLOSED.CANCELLED, opts = {} ) {

		if ( this.phase === PHASE.CLOSED ) return this.record()

		this.phase = PHASE.CLOSED
		this.closedAt = Date.now()
		this.closedBecause = because
		this.closedWhy = opts.why ?? null

		return this.record()

	}

	/** What happened, for both sides and for the log. */
	record() {

		return {
			id : this.id,
			kind : this.kind,
			helper : this.helper,
			receiver : this.receiver,
			band : this.band,
			phase : this.phase,
			openedAt : new Date( this.openedAt ).toISOString(),
			seconds : Number( this.elapsedSeconds.toFixed( 1 ) ),
			metric : this.metric,
			mode : this.effect?.mode ?? null,
			ambient : this.ambient,
			delivered : this.effect?.mode === 'accumulate' ? this.delivered : null,
			holding : this.effect?.mode === 'sustain' ? this.holding : null,
			frames : this.frames.length,
			because : this.closedBecause,
			why : this.closedWhy,
			// Both halves, stated as what each actually is. Neither replaces the
			// other: the sensor knows how much, only the emitter knows which band.
			accounting : {
				measured : this.effect?.mode === 'accumulate'
					? `${this.delivered}${this.effect?.unit ?? ''} of ${this.metric} against a baseline of ${this.ambient ?? '?'}, from this plant's own sensor.`
					: `${this.metric} held at a change of ${this.holding.change ?? '?'} for ${this.holding.seconds}s against a baseline of ${this.ambient ?? '?'}, from this plant's own sensor.`,
				declared : this.band
					? `Emitter reported band "${this.band}". A broadband lux sensor cannot confirm that, and the dose ledger is per band, so this half rests on the emitter being truthful about which channel it used.`
					: 'No band involved — this kind of help is judged entirely on the measured change.',
			},
		}

	}

}
