/**
 * What actually worked, last time this happened.
 *
 * The library records that a problem occurred and records that something was
 * done. What it never joined up is whether the one fixed the other — so every
 * time a familiar problem comes back, the system meets it as though for the
 * first time, with no access to the fact that this exact plant has been here
 * four times before and one particular thing helped.
 *
 * ## Why this is dangerous to build naively
 *
 * Almost every plant problem resolves on its own. Soil dries and gets watered on
 * the usual schedule; a hot afternoon passes; a droop recovers overnight. If you
 * simply record "problem appeared → I did X → problem went away", you will learn
 * with total confidence that X works. So will everything else you happened to do
 * that week.
 *
 * And because a ledger like this is used to *choose* the next action, it
 * confirms itself: it recommends X, X gets credit again, X becomes doctrine. A
 * resolution ledger without a control is a machine for manufacturing
 * superstition, and it is worse than having no ledger at all, because it is
 * confident.
 *
 * So the control is not an option here, it is the design. Every problem carries
 * a **base rate**: how often, and how fast, episodes of it resolved when nothing
 * was done. An action is only credited with what it achieved *above* that. Most
 * of the time the honest answer is that the plant would have recovered anyway,
 * and this says so.
 *
 * ## The other two things that make it lie
 *
 * **Everything at once.** Water, feed and move a plant on the same afternoon and
 * no ledger on earth can tell you which one helped. Credit is only assigned from
 * episodes where an action appeared alone; episodes with several are recorded
 * and reported as unattributable.
 *
 * **n is tiny.** A houseplant produces perhaps three or four episodes of any
 * given problem in a year. Concluding from two is exactly the false precision
 * the rest of this library refuses everywhere else, so it refuses it here too.
 *
 * ## The same problem is not the same problem
 *
 * "Thirsty" in dry air at 30°C and "thirsty" in still humid air at 18°C share a
 * name and very little else: different cause, different urgency, and quite
 * possibly a different fix. Pooling them produces an average treatment for a
 * situation nobody was ever in.
 *
 * So episodes carry the conditions they started in, and a lookup can be narrowed
 * to the ones that actually resemble now — using the same coarse banding the
 * migration layer uses to decide whether two situations are the same situation.
 * When there are too few comparable episodes, the wider answer is given with
 * that fact attached rather than silently.
 */

import { contextSignature } from '../migration/transferability.js'

const HOUR = 3_600_000

/**
 * One episode of one problem, from onset to resolution.
 *
 * @typedef {object} Episode
 * @property {string}   problem  - What went wrong.
 * @property {number}   openedAt - When it was noticed.
 * @property {number}   [closedAt] - When it stopped.
 * @property {string[]} actions  - What was done while it was open.
 * @property {boolean}  [resolved] - Whether it actually cleared.
 */

export class ResolutionLedger {

	/**
	 * @param {object} [opts]             - Options.
	 * @param {number} [opts.minEpisodes] - Episodes of a problem before anything is claimed. Default 4.
	 * @param {number} [opts.minTreated]  - Episodes with one action before crediting it. Default 3.
	 * @param {number} [opts.minLift]     - How much better than doing nothing counts. Default 0.25.
	 * @param {number} [opts.maxOpenHours] - After this an unresolved episode is closed as a failure. Default 168.
	 * @param {number} [opts.keep]        - Episodes retained per problem. Default 100.
	 */
	constructor( opts = {} ) {

		this.minEpisodes  = opts.minEpisodes ?? 4
		this.minTreated   = opts.minTreated ?? 3
		this.minLift      = opts.minLift ?? 0.25
		this.maxOpenHours = opts.maxOpenHours ?? 168
		this.keep         = opts.keep ?? 100

		/** @type {Map<string, Episode[]>} */
		this.history = new Map()
		/** @type {Map<string, Episode>} */
		this.open = new Map()

	}

	/**
	 * A problem has been noticed.
	 *
	 * Re-opening one that is already open does nothing: a condition that keeps
	 * firing is one episode, not fifty.
	 *
	 * @param   {string} problem  - Claim id.
	 * @param   {object} [opts]   - `{ at, context }`.
	 * @returns {Episode}         The episode.
	 */
	opened( problem, opts = {} ) {

		if ( this.open.has( problem ) ) return this.open.get( problem )

		const episode = {
			problem,
			openedAt : opts.at ?? Date.now(),
			context  : opts.context || {},
			actions  : [],
			closedAt : null,
			resolved : null,
		}

		this.open.set( problem, episode )
		return episode

	}

	/**
	 * Something was done while a problem was open.
	 *
	 * Actions taken with nothing open are ignored on purpose: routine watering on
	 * a healthy plant is not a treatment for anything, and counting it as one is
	 * how "watering cures everything" gets learned.
	 *
	 * @param   {string} action - What was done.
	 * @param   {object} [opts] - `{ at, problem }` to target one open problem.
	 * @returns {string[]}      Problems this was recorded against.
	 */
	acted( action, opts = {} ) {

		const targets = opts.problem
			? [ opts.problem ].filter( p => this.open.has( p ) )
			: [ ...this.open.keys() ]

		for ( const problem of targets ) {

			const episode = this.open.get( problem )
			if ( !episode.actions.includes( action ) ) episode.actions.push( action )

		}

		return targets

	}

	/**
	 * A problem stopped, or was given up on.
	 *
	 * @param   {string}  problem    - Claim id.
	 * @param   {object}  [opts]     - `{ resolved, at }`.
	 * @returns {Episode|null}       The closed episode.
	 */
	closed( problem, opts = {} ) {

		const episode = this.open.get( problem )
		if ( !episode ) return null

		episode.closedAt = opts.at ?? Date.now()
		episode.resolved = opts.resolved ?? true
		episode.hours = Number( ( ( episode.closedAt - episode.openedAt ) / HOUR ).toFixed( 2 ) )

		this.open.delete( problem )

		if ( !this.history.has( problem ) ) this.history.set( problem, [] )
		const list = this.history.get( problem )
		list.push( episode )
		if ( list.length > this.keep ) list.shift()

		return episode

	}

	/**
	 * Close anything that has been open too long, as a failure.
	 *
	 * An episode nobody ever closed is not a success, and letting it sit open
	 * forever would quietly keep it out of every statistic below.
	 *
	 * @param   {number}   [now] - Current time.
	 * @returns {Episode[]}      What was timed out.
	 */
	expire( now = Date.now() ) {

		const out = []

		for ( const [ problem, episode ] of this.open ) {

			if ( now - episode.openedAt >= this.maxOpenHours * HOUR ) {

				out.push( this.closed( problem, {
					resolved : false,
					at : now,
				} ) )

			}

		}

		return out

	}

	/**
	 * How often this problem goes away on its own.
	 *
	 * This is the number everything else is measured against. Without it, any
	 * action taken during a problem that was going to clear anyway looks like a
	 * cure.
	 *
	 * @param   {string} problem - Claim id.
	 * @returns {object}         `{known, rate, medianHours, n}`.
	 */
	baseRate( problem, opts = {} ) {

		const untreated = ( opts.episodes ?? this.history.get( problem ) ?? [] ).filter( e => !e.actions.length )

		if ( untreated.length < this.minTreated ) {

			return {
				problem,
				known : false,
				n     : untreated.length,
				why   : `Only ${untreated.length} episode(s) of "${problem}" where nothing was done. Without a few of those there is nothing to compare a treatment against, and every action would look like a cure.`,
			}

		}

		const resolved = untreated.filter( e => e.resolved )
		const hours = resolved.map( e => e.hours ).sort( ( a, b ) => a - b )

		return {
			problem,
			known : true,
			n     : untreated.length,
			rate  : Number( ( resolved.length / untreated.length ).toFixed( 3 ) ),
			medianHours : hours.length ? hours[ Math.floor( hours.length / 2 ) ] : null,
			why   : `${resolved.length} of ${untreated.length} episodes of "${problem}" cleared with no intervention at all.`,
		}

	}

	/**
	 * What has actually helped with this problem, above doing nothing.
	 *
	 * @param   {string} problem - Claim id.
	 * @returns {object}         `{known, base, actions, unattributable}`.
	 */
	whatWorked( problem, opts = {} ) {

		const all = this.history.get( problem ) || []
		let episodes = all
		let narrowed = null

		// Narrow to episodes that started somewhere like now, when asked and when
		// there are enough of them to be worth narrowing to.
		if ( opts.like ) {

			const want = contextSignature( opts.like )
			const alike = want ? all.filter( e => contextSignature( e.context ) === want ) : []

			if ( alike.length >= this.minEpisodes ) {

				episodes = alike
				narrowed = {
					matched : alike.length,
					of : all.length,
					why : `Narrowed to the ${alike.length} episode(s) that began in conditions like these.`,
				}

			}
			else {

				// Saying which question was answered matters: "what works for this
				// problem" and "what works for this problem in weather like today"
				// can have different answers, and pretending otherwise is how an
				// average treatment gets recommended for a situation nobody is in.
				narrowed = {
					matched : alike.length,
					of : all.length,
					fellBack : true,
					why : `Only ${alike.length} past episode(s) began in conditions like these, which is too few to narrow to. This answer is drawn from all ${all.length} episode(s) of "${problem}" regardless of the conditions they happened in.`,
				}

			}

		}

		if ( episodes.length < this.minEpisodes ) {

			return {
				problem,
				known : false,
				n     : episodes.length,
				why   : `"${problem}" has happened ${episodes.length} time(s); ${this.minEpisodes} are needed before this plant's own history says anything.`,
			}

		}

		const base = this.baseRate( problem, { episodes } )

		if ( !base.known ) {

			return {
				problem,
				known : false,
				base,
				n     : episodes.length,
				why   : base.why,
			}

		}

		// Only episodes where exactly one thing was done can attribute anything.
		// Water, feed and move a plant on the same afternoon and no arithmetic
		// recovers which one helped.
		const single = episodes.filter( e => e.actions.length === 1 )
		const multi  = episodes.filter( e => e.actions.length > 1 )

		const byAction = new Map()

		for ( const e of single ) {

			const a = e.actions[ 0 ]
			if ( !byAction.has( a ) ) byAction.set( a, [] )
			byAction.get( a ).push( e )

		}

		const actions = [ ...byAction.entries() ]
			.map( ( [ action, list ] ) => {

				const resolved = list.filter( e => e.resolved )
				const rate = resolved.length / list.length
				const hours = resolved.map( e => e.hours ).sort( ( a, b ) => a - b )
				const median = hours.length ? hours[ Math.floor( hours.length / 2 ) ] : null

				return {
					action,
					n : list.length,
					rate : Number( rate.toFixed( 3 ) ),
					medianHours : median,
					// The only number that matters: what this bought over waiting.
					lift : Number( ( rate - base.rate ).toFixed( 3 ) ),
					// And whether it was faster, which can matter even at equal rates.
					hoursSaved : median !== null && base.medianHours !== null
						? Number( ( base.medianHours - median ).toFixed( 2 ) )
						: null,
					enough : list.length >= this.minTreated,
				}

			} )
			.sort( ( a, b ) => b.lift - a.lift )

		return {
			problem,
			known : true,
			base,
			episodes : episodes.length,
			narrowed,
			actions,
			unattributable : multi.length
				? {
					episodes : multi.length,
					why : `${multi.length} episode(s) had more than one thing done at once, so none of them can credit anything. Change one thing at a time if you want this to learn.`,
				}
				: null,
		}

	}

	/**
	 * What to do about a problem that is happening now.
	 *
	 * @param   {string} problem  - Claim id.
	 * @param   {object} [opts]   - `{ doseModifier }` from hysteresis.
	 * @returns {object}          `{recommend, action, confidence, why}`.
	 */
	recommend( problem, opts = {} ) {

		const worked = this.whatWorked( problem, opts )

		if ( !worked.known ) {

			return {
				problem,
				recommend : false,
				why : worked.why,
			}

		}

		const usable = worked.actions.filter( a => a.enough && a.lift >= this.minLift )

		if ( !usable.length ) {

			const best = worked.actions[ 0 ]

			return {
				problem,
				recommend : false,
				base : worked.base,
				why : best
					? `Nothing has beaten waiting. "${best.action}" cleared it ${Math.round( best.rate * 100 )}% of the time against ${Math.round( worked.base.rate * 100 )}% for doing nothing — a difference of ${best.lift}, which is inside the noise for ${best.n} episode(s). This plant has probably been recovering on its own.`
					: `"${problem}" clears on its own ${Math.round( worked.base.rate * 100 )}% of the time and nothing has been tried alone often enough to beat that.`,
			}

		}

		const best = usable[ 0 ]
		const dose = opts.doseModifier ?? null

		return {
			problem,
			recommend  : true,
			action     : best.action,
			// Bounded: this rests on a handful of episodes from one plant.
			confidence : Number( Math.min( 0.7, best.lift + best.n / 40 ).toFixed( 3 ) ),
			lift       : best.lift,
			n          : best.n,
			base       : worked.base,
			dose,
			narrowed   : worked.narrowed,
			why : `"${best.action}" resolved "${problem}" in ${best.n} episode(s) where it was the only thing done — ${Math.round( best.rate * 100 )}% against ${Math.round( worked.base.rate * 100 )}% for waiting${best.hoursSaved > 0 ? `, and about ${best.hoursSaved}h sooner` : ''}.${worked.narrowed ? ` ${worked.narrowed.why}` : ''}${dose ? ` ${dose.why}` : ''}`,
		}

	}

	/** Everything learned so far, readable. */
	report() {

		const problems = [ ...this.history.keys() ].map( p => {

			const w = this.whatWorked( p )
			return {
				problem : p,
				episodes : ( this.history.get( p ) || [] ).length,
				known : w.known,
				best : w.known ? w.actions[ 0 ] ?? null : null,
				why : w.why ?? null,
			}

		} )

		return {
			problems,
			open : [ ...this.open.keys() ],
			verdict : problems.length
				? `${problems.filter( p => p.known ).length} of ${problems.length} problem(s) have enough history to say anything about.`
				: 'Nothing has gone wrong yet, so there is nothing to have learned from.',
		}

	}

	/** Serialisable form, for memory and for inheritance. */
	toJSON() {

		return {
			version : 1,
			history : Object.fromEntries( this.history ),
		}

	}

	/** Restore from `toJSON`. */
	static from( data, opts = {} ) {

		const ledger = new ResolutionLedger( opts )
		for ( const [ problem, episodes ] of Object.entries( data?.history || {} ) ) {

			ledger.history.set( problem, episodes )

		}
		return ledger

	}

}

/**
 * Turn measured hysteresis into a change of dose.
 *
 * The library measures whether a plant now answers the same stimulus
 * differently, and then does nothing with it. This is the missing half.
 *
 * The mapping is deliberately **asymmetric**, and that asymmetry is the whole
 * point. A plant that has become *more* reactive since an episode needs less of
 * whatever you were doing — the same watering now moves it further. But a plant
 * that has become *less* reactive must not simply be given more. Reduced
 * response is at least as often damage as it is tolerance, and root rot answers
 * a bigger drink by getting worse. So the weak direction reduces confidence and
 * asks for a look, rather than raising the dose.
 *
 * @param   {object} hysteresis - From `hysteresis()`.
 * @returns {object|null}       `{factor, why}` or null when nothing is known.
 */
export function doseModifier( hysteresis ) {

	if ( !hysteresis?.known || !hysteresis.changed ) return null

	const stronger = /stronger/.test( hysteresis.direction )
	const faster   = /faster/.test( hysteresis.direction )
	const weaker   = /weaker/.test( hysteresis.direction )
	const slower   = /slower/.test( hysteresis.direction )

	if ( stronger || faster ) {

		// Same input, bigger effect. Keeping the old dose overshoots.
		const factor = stronger && faster ? 0.6 : 0.75

		return {
			factor,
			direction : 'reduce',
			why : `This plant answers ${hysteresis.direction} than it used to, so the amount that used to be right now overshoots. Cut it to about ${Math.round( factor * 100 )}%.`,
		}

	}

	if ( weaker || slower ) {

		// The tempting move is to give more. It is also how a plant with damaged
		// roots gets drowned by somebody being helpful.
		return {
			factor : 1,
			direction : 'hold',
			caution : true,
			why : `This plant answers ${hysteresis.direction} than it used to. Do not read that as needing more: a weaker response is as often damage as tolerance, and increasing the dose is how root damage gets made worse. Keep the amount the same and find out why the response fell.`,
		}

	}

	return null

}
