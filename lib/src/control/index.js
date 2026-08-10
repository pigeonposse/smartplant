/**
 * Hierarchical control.
 *
 * Two loops that run at completely different speeds and must not block each
 * other:
 *
 *   Planner  (minutes-hours) — "the light is better by the south window in the
 *                              mornings; relocate at 08:00"
 *   Reflex   (milliseconds)  — "there is a chair leg 8cm ahead; stop"
 *
 * A reflex always preempts a plan. The arbitrator enforces that ordering, runs
 * every proposal past the safety supervisor, and records why the winner won.
 */

import { EventBus } from '../core/events.js'
import { VERDICT } from '../safety/index.js'

/** Priority bands. Higher always wins. */
export const PRIORITY = {
	PLAN     : 10,   // deliberate, slow, optional
	COMFORT  : 30,   // improve conditions
	CARE     : 50,   // the plant needs something
	REFLEX   : 80,   // avoid immediate harm
	SAFETY   : 100,  // stop everything
}

/**
 * @typedef {object} Proposal
 * @property {string} id         - Who proposed it.
 * @property {number} priority   - A `PRIORITY` value.
 * @property {object} mission    - `{ type, ... }` — passed to the supervisor.
 * @property {string} [reason]   - Why.
 * @property {number} [confidence] - 0-1.
 * @property {number} [ttlMs]    - How long the proposal stays valid.
 */

export class Arbitrator {

	/**
	 * @param {object} [opts]              - Options.
	 * @param {object} opts.safety         - A `SafetySupervisor`.
	 * @param {object} [opts.evidence]     - An `EvidenceLedger`, for risk gating.
	 * @param {number} [opts.tickMs]       - Reflex evaluation period.
	 */
	constructor( opts = {} ) {

		if ( !opts.safety ) throw new Error( 'Arbitrator requires a SafetySupervisor.' )

		this.safety   = opts.safety
		this.evidence = opts.evidence || null
		this.tickMs   = opts.tickMs ?? 100
		this.events   = new EventBus()

		/** @type {Map<string, object>} */
		this.planners = new Map()
		/** @type {Map<string, object>} */
		this.reflexes = new Map()

		/** @type {Proposal[]} */
		this.pending  = []
		this.current  = null
		this.history  = []

		this._timer   = null
		this.running  = false

	}

	/**
	 * Register a slow planner.
	 *
	 * @param   {string}   id                 - Planner id.
	 * @param   {object}   config             - Options.
	 * @param   {number}   config.periodMs    - How often it runs.
	 * @param   {Function} config.plan        - `(snapshot, ctx) => Proposal | Proposal[] | null`.
	 * @param   {number}   [config.priority]  - Default `PRIORITY.PLAN`.
	 * @returns {Arbitrator}                  this
	 */
	registerPlanner( id, config ) {

		if ( typeof config?.plan !== 'function' ) throw new Error( `Planner "${id}" needs a plan() function.` )

		this.planners.set( id, {
			id,
			periodMs : config.periodMs ?? 300_000,
			priority : config.priority ?? PRIORITY.PLAN,
			plan     : config.plan,
			lastRun  : 0,
			runs     : 0,
			errors   : 0,
		} )

		return this

	}

	/**
	 * Register a fast reflex.
	 *
	 * A reflex must be synchronous and cheap. It runs on every tick, and anything
	 * that can block — an AI call, a disk write — belongs in a planner instead.
	 *
	 * @param   {string}   id                - Reflex id.
	 * @param   {object}   config            - Options.
	 * @param   {Function} config.check      - `(fastSnapshot) => Proposal | null`.
	 * @param   {number}   [config.priority] - Default `PRIORITY.REFLEX`.
	 * @returns {Arbitrator}                 this
	 */
	registerReflex( id, config ) {

		if ( typeof config?.check !== 'function' ) throw new Error( `Reflex "${id}" needs a check() function.` )

		this.reflexes.set( id, {
			id,
			priority : config.priority ?? PRIORITY.REFLEX,
			check    : config.check,
			fires    : 0,
			errors   : 0,
		} )

		return this

	}

	/**
	 * Submit a proposal directly.
	 *
	 * @param   {Proposal} proposal - The proposal.
	 * @returns {Arbitrator}        this
	 */
	propose( proposal ) {

		this.pending.push( {
			...proposal,
			at    : Date.now(),
			ttlMs : proposal.ttlMs ?? 60_000,
		} )
		return this

	}

	/**
	 * Run reflexes against a fast snapshot. Synchronous by design.
	 *
	 * @param   {object}     snapshot - `MultirateState.snapshot()`.
	 * @returns {Proposal[]}          Proposals raised.
	 */
	runReflexes( snapshot ) {

		const raised = []

		for ( const reflex of this.reflexes.values() ) {

			let proposal
			try {

				proposal = reflex.check( snapshot.fast, snapshot )

			}
			catch ( err ) {

				// A broken reflex must never stop the others — the next one might be
				// the collision check.
				reflex.errors++
				this.events.emit( 'control:error', {
					stage : 'reflex',
					id : reflex.id,
					error : err,
				} )
				continue

			}

			if ( !proposal ) continue

			reflex.fires++
			const full = {
				priority : reflex.priority,
				ttlMs    : 5000,
				...proposal,
				id       : proposal.id || reflex.id,
				at       : Date.now(),
			}
			raised.push( full )
			this.pending.push( full )

		}

		return raised

	}

	/**
	 * Run any planners whose period has elapsed.
	 *
	 * @param   {object}   snapshot - Full snapshot.
	 * @param   {object}   [ctx]    - Plant context.
	 * @returns {Promise<Proposal[]>} Proposals raised.
	 */
	async runPlanners( snapshot, ctx ) {

		const now = Date.now()
		const raised = []

		for ( const planner of this.planners.values() ) {

			if ( now - planner.lastRun < planner.periodMs ) continue
			planner.lastRun = now

			let result
			try {

				result = await planner.plan( snapshot, ctx )
				planner.runs++

			}
			catch ( err ) {

				planner.errors++
				this.events.emit( 'control:error', {
					stage : 'planner',
					id : planner.id,
					error : err,
				} )
				continue

			}

			for ( const proposal of [].concat( result || [] ) ) {

				if ( !proposal ) continue
				const full = {
					priority : planner.priority,
					ttlMs    : planner.periodMs,
					...proposal,
					id       : proposal.id || planner.id,
					at       : Date.now(),
				}
				raised.push( full )
				this.pending.push( full )

			}

		}

		return raised

	}

	/**
	 * Choose what to do.
	 *
	 * Order: drop expired → sort by priority → for each, check evidence, then
	 * safety → the first that survives wins. Everything else is recorded as
	 * rejected, with the reason.
	 *
	 * @param   {object} [opts]      - Options.
	 * @param   {object} [opts.risk] - Risk level for evidence gating.
	 * @returns {object}             `{decision, rejected, explanation}`.
	 */
	decide( opts = {} ) {

		const now = Date.now()
		this.pending = this.pending.filter( p => now - p.at <= ( p.ttlMs ?? 60_000 ) )

		const ranked = [ ...this.pending ].sort( ( a, b ) => {

			if ( b.priority !== a.priority ) return b.priority - a.priority
			// Same priority: prefer the more confident, then the more recent.
			if ( ( b.confidence ?? 0 ) !== ( a.confidence ?? 0 ) ) return ( b.confidence ?? 0 ) - ( a.confidence ?? 0 )
			return b.at - a.at

		} )

		const rejected = []

		for ( const proposal of ranked ) {

			// Evidence gate: only for deliberate actions. A reflex avoiding a
			// collision must never wait for a second opinion.
			if ( this.evidence && proposal.claim && proposal.priority < PRIORITY.REFLEX ) {

				const risk = opts.risk || proposal.risk
				if ( risk ) {

					const enough = this.evidence.isEnough( proposal.claim, risk )
					if ( !enough.allowed ) {

						rejected.push( {
							proposal,
							by : 'evidence',
							reasons : enough.missing,
						} )
						continue

					}

				}

			}

			const verdict = this.safety.validate( proposal.mission || {} )

			if ( verdict.verdict === VERDICT.DENY ) {

				rejected.push( {
					proposal,
					by : 'safety',
					reasons : verdict.reasons,
				} )
				continue

			}

			const decision = {
				...proposal,
				mission  : verdict.mission,
				modified : verdict.verdict === VERDICT.MODIFY,
				safety   : verdict.reasons,
				decidedAt: now,
			}

			this.current = decision
			this.pending = this.pending.filter( p => p !== proposal )

			const record = {
				at : new Date().toISOString(),
				decision,
				rejected,
			}
			this.history.push( record )
			if ( this.history.length > 200 ) this.history.shift()

			this.events.emit( 'control:decision', record )

			return {
				decision,
				rejected,
				explanation : this._explain( decision, rejected ),
			}

		}

		// Nothing survived. Staying put is always an option, and here it is the
		// correct one — that is the whole point of a safe default.
		const fallback = this.safety.safeMode()
		this.current = null

		return {
			decision : null,
			fallback,
			rejected,
			explanation : rejected.length
				? `No action taken. ${rejected.length} proposal(s) rejected: ${rejected.map( r => `${r.proposal.id} (${r.by}: ${r.reasons[ 0 ]})` ).join( '; ' )}`
				: `No proposals. ${fallback.reason}`,
		}

	}

	_explain( decision, rejected ) {

		const parts = [ `${decision.id} → ${decision.mission?.type || 'action'}` ]
		if ( decision.reason ) parts.push( `because ${decision.reason}` )
		if ( decision.modified ) parts.push( `(adjusted: ${decision.safety.join( ' ' )})` )
		if ( rejected.length ) parts.push( `preempted ${rejected.length} lower-priority proposal(s)` )
		return parts.join( ' ' )

	}

	/**
	 * Start the control loop.
	 *
	 * @param   {object}   opts             - Options.
	 * @param   {Function} opts.snapshot    - `() => snapshot`.
	 * @param   {Function} opts.execute     - `(decision) => Promise<void>`.
	 * @param   {Function} [opts.context]   - `() => plantContext`.
	 * @returns {Arbitrator}                this
	 */
	start( opts ) {

		if ( this.running ) return this
		if ( typeof opts?.snapshot !== 'function' ) throw new Error( 'start() needs a snapshot() function.' )

		this.running = true
		this.safety.watchdog.start()

		let planTick = 0

		this._timer = setInterval( async () => {

			try {

				this.safety.watchdog.beat()

				const snapshot = opts.snapshot()
				this.runReflexes( snapshot )

				// Planners are polled on a slower cadence than reflexes: they are
				// async and must never delay a collision check.
				planTick++
				if ( planTick % 10 === 0 ) {

					await this.runPlanners( snapshot, opts.context?.() )

				}

				const result = this.decide()
				if ( result.decision && opts.execute ) {

					await opts.execute( result.decision )
					if ( result.decision.mission?.type === 'move' ) this.safety.notifyMoved()

				}

			}
			catch ( err ) {

				this.events.emit( 'control:error', {
					stage : 'loop',
					error : err,
				} )

			}

		}, this.tickMs )

		this._timer.unref?.()
		return this

	}

	stop() {

		if ( this._timer ) clearInterval( this._timer )
		this._timer = null
		this.running = false
		this.safety.watchdog.stop()
		return this

	}

	on( event, fn ) {

		return this.events.on( event, fn )

	}

	/** Operational metrics: how often reflexes overrode plans, and why. */
	stats() {

		const decisions = this.history.length
		const byReflex = this.history.filter( h => h.decision.priority >= PRIORITY.REFLEX ).length
		const rejectedBySafety = this.history.reduce( ( a, h ) => a + h.rejected.filter( r => r.by === 'safety' ).length, 0 )
		const rejectedByEvidence = this.history.reduce( ( a, h ) => a + h.rejected.filter( r => r.by === 'evidence' ).length, 0 )

		return {
			decisions,
			reflexOverrides : byReflex,
			overrideRate    : decisions ? Number( ( byReflex / decisions ).toFixed( 3 ) ) : null,
			rejectedBySafety,
			rejectedByEvidence,
			planners : [ ...this.planners.values() ].map( p => ( {
				id : p.id,
				runs : p.runs,
				errors : p.errors,
			} ) ),
			reflexes : [ ...this.reflexes.values() ].map( r => ( {
				id : r.id,
				fires : r.fires,
				errors : r.errors,
			} ) ),
		}

	}

}

/**
 * A collision reflex over any distance channel.
 *
 * The canonical example: cheap, synchronous, and it preempts everything.
 *
 * @param   {object} [opts]           - Options.
 * @param   {string} [opts.channel]   - Distance channel name.
 * @param   {number} [opts.stopM]     - Stop below this distance.
 * @returns {object}                  A reflex config for `registerReflex`.
 */
export function collisionReflex( opts = {} ) {

	const channel = opts.channel || 'distance'
	const stopM   = opts.stopM ?? 0.15

	return {
		priority : PRIORITY.REFLEX,
		check    : fast => {

			const d = fast[ channel ]
			if ( !d || d.stale || !Number.isFinite( d.value ) ) return null
			if ( d.value > stopM ) return null

			return {
				id       : 'collision',
				reason   : `obstacle at ${d.value.toFixed( 2 )}m`,
				mission  : { type : 'stop' },
				confidence : 1,
			}

		},
	}

}

/**
 * A reflex that halts motion when localization is lost.
 *
 * Driving without knowing where you are is how a plant ends up down the stairs.
 *
 * @param   {object} [opts] - Options.
 * @returns {object}        A reflex config.
 */
export function lostLocalizationReflex( opts = {} ) {

	const channel = opts.channel || 'pose'

	return {
		priority : PRIORITY.SAFETY,
		check    : fast => {

			const pose = fast[ channel ]
			if ( pose && !pose.stale ) return null

			return {
				id      : 'lost-localization',
				reason  : 'position unknown or stale',
				mission : { type : 'stop' },
				confidence : 1,
			}

		},
	}

}
