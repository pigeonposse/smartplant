/**
 * Going back over what happened, while nothing is happening.
 *
 * A plant in its subjective night is not doing much and neither is the system
 * watching it. Those hours are the natural place to do the one kind of work that
 * needs no sensor and no actuator: going back over the record and asking what
 * would have happened if something had been done differently.
 *
 * ## Nothing is emitted, and that is not a limitation
 *
 * The obvious version of this involves replaying past electrical patterns back
 * at the plant with the amber channel — a light show of its own history. There
 * is no mechanism by which that does anything. Showing a plant a light resembling
 * its own electrome from last month is not a stimulus it can interpret; it is a
 * lamp on at night, which is the exact thing the dark-hours interlock exists to
 * prevent, dressed as insight.
 *
 * So this runs entirely on stored data. It could equally run at midday. It runs
 * at night because that is when nothing else needs the CPU and when acting on
 * the plant would be least welcome anyway.
 *
 * ## Counterfactuals over a record are still counterfactuals
 *
 * "What if I had watered 30 ml less" cannot be answered by rerunning anything.
 * There is no simulator of a plant here and building one would be inventing the
 * physiology this library spends its refusals avoiding.
 *
 * What *can* be answered is narrower and honest: **has this ever happened
 * differently, and did it go better?** The resolution ledger holds occasions
 * where the same problem was met with different responses, and comparing those
 * is a real comparison over real outcomes rather than a simulation.
 *
 * So a "what if" here always resolves to "there were N times this happened, M of
 * them handled the other way, and here is how those went" — or to nothing at
 * all, which is the usual answer and the correct one.
 *
 * ## And it cannot move anything on its own
 *
 * Consolidation that reweights priors from replay is adaptation without new
 * evidence, which is exactly the circle `adaptation.js` is built to avoid. A
 * night of thinking about old data produces no new information about the world.
 *
 * So findings go through the same gate as everything else: they are proposals,
 * they need the calibration record to exist before they can move a threshold,
 * and until then they are things to tell a person.
 */

/** Why a night's work produced nothing. */
export const QUIET = {
	NOT_RESTING : 'not-resting',
	TOO_LOADED  : 'too-loaded',
	NO_HISTORY  : 'no-history',
}

/** Minimum comparable occurrences before a comparison means anything. */
export const MIN_ARMS = 3

const finite = Number.isFinite

/**
 * Is this a good moment to go back over things?
 *
 * @param   {object} plant  - A `SmartPlant`.
 * @param   {object} [opts] - `{ now }`.
 * @returns {object}        `{ready, why}`.
 */
export function restingNow( plant, opts = {} ) {

	opts = opts ?? {}

	const light = plant?.memory?.lastReading?.light
	const states = safely( () => plant?.states?.() ) ?? {}

	// A plant already spending on something should not have its CPU budget spent
	// on introspection either — on a battery those are the same budget.
	const load = states.stress_load
	const defense = states.defense_activation

	if ( ( load?.acts && load.level === 'high' ) || ( defense?.acts && defense.level === 'high' ) ) {

		return {
			ready : false,
			reason : QUIET.TOO_LOADED,
			why : 'This plant is in the middle of something. Going back over old records costs nothing physiologically, but on a battery the power it takes is power the plant might need — and there is nothing here that will not keep until tomorrow.',
		}

	}

	if ( finite( light ) && light > 50 ) {

		return {
			ready : false,
			reason : QUIET.NOT_RESTING,
			why : `${light} lux. Nothing here needs darkness — it runs entirely on stored data and would work at midday — but the night is when nothing else wants the processor, so that is when it goes.`,
		}

	}

	return {
		ready : true,
		why : finite( light )
			? `Dark at ${light} lux and nothing pressing. A good moment to go back over the record.`
			: 'Nothing pressing, and no light reading to say otherwise.',
	}

}

function safely( fn ) {

	try {

		return fn()

	}
	catch {

		return null

	}

}

/**
 * Has this problem ever been met differently, and did that go better?
 *
 * The honest form of "what if". No simulation: a comparison between things that
 * actually happened, or nothing.
 *
 * @param   {object} ledger  - A `ResolutionLedger`.
 * @param   {string} problem - The problem to look at.
 * @returns {object}         `{known, arms, best, why}`.
 */
export function counterfactual( ledger, problem ) {

	const history = ledger?.history?.get?.( problem )

	if ( !Array.isArray( history ) || !history.length ) {

		return {
			known : false,
			problem,
			why : `Nothing recorded for "${problem}". There is no simulator of a plant here — a "what if" can only be answered by finding a time it went the other way, and there is no time at all.`,
		}

	}

	// Group by what was done. Occurrences where nothing was done are a real arm
	// and the most important one: the base rate.
	const arms = new Map()

	for ( const entry of history ) {

		const action = entry?.action ?? 'nothing'
		const list = arms.get( action ) ?? []
		list.push( entry )
		arms.set( action, list )

	}

	const usable = [ ...arms.entries() ]
		.filter( ( [ , list ] ) => list.length >= MIN_ARMS )
		.map( ( [ action, list ] ) => {

			const resolved = list.filter( e => e?.resolved === true ).length

			return {
				action,
				n : list.length,
				resolved,
				rate : Number( ( resolved / list.length ).toFixed( 2 ) ),
			}

		} )
		.sort( ( a, b ) => b.rate - a.rate )

	if ( usable.length < 2 ) {

		return {
			known : false,
			problem,
			arms : usable,
			why : `"${problem}" has only ever been met one way${usable.length ? ` (${usable[ 0 ].action}, ${usable[ 0 ].n} times)` : ''}. A counterfactual needs a time somebody did something else, and there is not one. This is the ordinary answer and it is the correct one — it is not a gap to be filled by imagining the other arm.`,
		}

	}

	const best = usable[ 0 ]
	const worst = usable.at( -1 )
	const gap = best.rate - worst.rate

	return {
		known : true,
		problem,
		arms : usable,
		best : best.action,
		gap : Number( gap.toFixed( 2 ) ),
		why : gap < 0.2
			? `"${problem}" has been met ${usable.length} different ways and they all worked about as well (${usable.map( a => `${a.action} ${a.rate}` ).join( ', ' )}). Which is a finding: there is no better answer to reach for here, and any preference between them is a preference rather than a result.`
			: `"${problem}" resolved ${best.rate} of the time with ${best.action} (${best.n} occasions) against ${worst.rate} with ${worst.action} (${worst.n}). Real occasions compared against real outcomes, not a simulation — but ${best.n} and ${worst.n} are small numbers and whoever chose between them at the time may have been choosing on something this record does not hold.`,
	}

}

/**
 * A night's work.
 *
 * @param   {object} plant  - A `SmartPlant`.
 * @param   {object} [opts] - `{ force, calibration }`.
 * @returns {Promise<object>} `{ran, findings, proposals, why}`.
 */
export async function consolidate( plant, opts = {} ) {

	opts = opts ?? {}

	const resting = restingNow( plant, opts )

	if ( !resting.ready && !opts.force ) {

		return {
			ran : false,
			reason : resting.reason,
			findings : [],
			proposals : [],
			emitted : false,
			why : resting.why,
		}

	}

	const ledger = plant?.resolutions ?? plant?._resolutions
	const problems = ledger?.history ? [ ...ledger.history.keys() ] : []

	if ( !problems.length ) {

		return {
			ran : true,
			findings : [],
			proposals : [],
			emitted : false,
			why : 'Nothing has gone wrong often enough to have been met more than one way. A night with nothing to go over is the ordinary case for a plant that has been fine.',
		}

	}

	const findings = problems
		.map( p => counterfactual( ledger, p ) )
		.filter( f => f.known )

	// Findings are not changes. Anything that would move a threshold goes
	// through the same gate as everything else, and a night of thinking about
	// old data has produced no new information about the world.
	const grounded = opts.calibration?.report?.()?.states?.some( s => s.known )

	const proposals = findings
		.filter( f => f.gap >= 0.3 )
		.map( f => ( {
			problem : f.problem,
			prefer : f.best,
			gap : f.gap,
			actionable : Boolean( grounded ),
			why : grounded
				? `Worth preferring ${f.best} for "${f.problem}" next time. ${f.why}`
				: `Would prefer ${f.best} for "${f.problem}", and this cannot act on its own: nothing has ever told this system it was wrong, so a preference formed by rereading its own record is a preference formed from its own conclusions. Worth a person's eye.`,
		} ) )

	return {
		ran : true,
		at : Date.now(),
		findings,
		proposals,
		emitted : false,
		why : findings.length
			? `Went back over ${problems.length} recorded problems and found ${findings.length} that have been met more than one way${proposals.length ? `, ${proposals.length} of them with a clear difference` : ' with no clear difference between the approaches'}. Nothing was emitted and nothing acted on: this ran entirely on stored data.`
			: `Went back over ${problems.length} recorded problems and none has ever been met more than one way. There is nothing to compare, which is the usual answer — a counterfactual needs a time somebody did something else.`,
	}

}
