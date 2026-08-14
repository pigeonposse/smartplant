/**
 * Finding out when the system was wrong about itself.
 *
 * The prediction ledger already measures the system being wrong about the
 * *plant*: it forecast a soil curve, the curve came out differently, and the
 * difference is recorded. This is the other half, and it is harder — measuring
 * when the system was wrong about **its own internal states**.
 *
 * An internal state with `acts: true` refuses things. It withholds water, it
 * stops a spectral probe, it declines to lend a plant to a neighbour. Every one
 * of those refusals is a claim that the action would have been worse than the
 * refusal, and nothing has ever checked it. A state that is too eager refuses
 * good care forever and looks exactly like a state that is working.
 *
 * ## The counterfactual problem, and the one way round it
 *
 * The trouble with grading a refusal is that the refused thing did not happen,
 * so there is nothing to compare against. "We did not water it and the plant was
 * fine" does not mean the refusal was right; it may have been fine either way.
 * That is the shape of every counterfactual and it does not have a clean
 * statistical answer from observational data.
 *
 * There is exactly one place where the other arm of the experiment exists in
 * this library, and it is worth building the whole thing around:
 *
 * **An override is a natural experiment.** Every refusal here carries a
 * `{ force: true }` escape, and a person who takes it has run the trial the
 * system declined to run. If the state said "watering this would make it worse",
 * somebody watered it anyway, and the plant was fine — that is a false positive,
 * observed rather than inferred.
 *
 * So this grades overrides, and treats un-overridden refusals as what they are:
 * unknown. A refusal nobody argued with teaches nothing.
 *
 * ## What it does with that
 *
 * Nothing automatic, at first. A state that is wrong a third of the time when
 * tested is a fact worth putting in front of a person before it is a fact worth
 * acting on, because the sample is small for a long time and the failure mode of
 * self-calibration is a system that tunes itself into agreeing with whatever it
 * already believed.
 *
 * When there is enough — and `MIN_TRIALS` is deliberately high — it raises the
 * bar that state has to clear before it is allowed to act. It never lowers it.
 * A state that has been *too permissive* cannot be detected this way at all,
 * because nobody overrides a permission, and pretending otherwise would be
 * inventing evidence in the direction that loosens a safety gate.
 */

import { CONFIDENCE, LEVEL } from './index.js'

/** How an override turned out. */
export const OUTCOME = {
	/** The state was right: doing it anyway made things worse. */
	VINDICATED : 'vindicated',
	/** The state was wrong: doing it anyway was fine. */
	FALSE_POSITIVE : 'false-positive',
	/** Not enough happened afterwards to say. */
	UNCLEAR : 'unclear',
}

/**
 * Overrides needed before a state's record is allowed to change anything.
 *
 * High on purpose. A handful of overrides is an anecdote, and a system that
 * retunes its own safety gates from anecdotes is worse than one that never
 * retunes them at all.
 */
export const MIN_TRIALS = 12

/** How wrong a state has to be, over that many trials, to have its bar raised. */
export const TOO_EAGER = 0.4

const finite = Number.isFinite

/**
 * Grade one override.
 *
 * The comparison is between what the plant was doing before the forced action
 * and what it was doing after. Deliberately coarse: this is asking "did the
 * thing the state was afraid of actually happen", not measuring an effect size.
 *
 * @param   {object} before - `{wellbeing, states}` at the moment of the override.
 * @param   {object} after  - The same, some hours later.
 * @param   {object} [opts] - `{ margin }` how much change counts. Default 8.
 * @returns {object}        `{outcome, why}`.
 */
export function grade( before, after, opts = {} ) {

	const margin = opts.margin ?? 8

	if ( !finite( before?.wellbeing ) || !finite( after?.wellbeing ) ) {

		return {
			outcome : OUTCOME.UNCLEAR,
			why : 'Wellbeing is not known at both ends, so there is nothing to compare. An override with no follow-up teaches nothing, which is why the outcome is recorded separately from the override itself.',
		}

	}

	const delta = after.wellbeing - before.wellbeing

	// Did the state that refused get *worse* after the thing it refused was done
	// anyway? That is the sharpest available signal, sharper than wellbeing.
	const worsened = worseningStates( before.states, after.states )

	if ( worsened.length ) {

		return {
			outcome : OUTCOME.VINDICATED,
			delta : Number( delta.toFixed( 1 ) ),
			worsened,
			why : `${worsened.join( ', ' )} got worse after the refusal was overridden. The state was afraid of something and the something happened.`,
		}

	}

	if ( delta <= -margin ) {

		return {
			outcome : OUTCOME.VINDICATED,
			delta : Number( delta.toFixed( 1 ) ),
			why : `Wellbeing fell ${Math.abs( delta ).toFixed( 0 )} points after the override. Not proof — plants decline for their own reasons — but it is the direction the state predicted.`,
		}

	}

	if ( delta >= -margin / 2 ) {

		return {
			outcome : OUTCOME.FALSE_POSITIVE,
			delta : Number( delta.toFixed( 1 ) ),
			why : `The action the state refused was taken anyway and nothing got worse. This is the one place a refusal can be checked at all: the person ran the trial the system declined to run, and the system's fear was not borne out.`,
		}

	}

	return {
		outcome : OUTCOME.UNCLEAR,
		delta : Number( delta.toFixed( 1 ) ),
		why : `Wellbeing moved ${delta.toFixed( 1 )}, which is neither the harm the state predicted nor a clean absence of it.`,
	}

}

const RANK = {
	[ LEVEL.UNKNOWN ] : 0,
	[ LEVEL.LOW ] : 1,
	[ LEVEL.MEDIUM ] : 2,
	[ LEVEL.HIGH ] : 3,
}

function worseningStates( before = {}, after = {} ) {

	const out = []

	for ( const [ name, b ] of Object.entries( before ?? {} ) ) {

		const a = after?.[ name ]
		if ( !a?.level || !b?.level ) continue
		if ( ( RANK[ a.level ] ?? 0 ) > ( RANK[ b.level ] ?? 0 ) ) out.push( name )

	}

	return out

}

/**
 * The record of what each state's refusals have been worth.
 */
export class StateCalibration {

	/**
	 * @param {object} [opts] - `{ minTrials, tooEager }`.
	 */
	constructor( opts = {} ) {

		this.minTrials = opts.minTrials ?? MIN_TRIALS
		this.tooEager = opts.tooEager ?? TOO_EAGER
		/** state name → array of graded overrides. */
		this.trials = new Map()
		/** Refusals awaiting an outcome. */
		this.open = new Map()

	}

	/**
	 * A state refused something and somebody did it anyway.
	 *
	 * @param   {object} entry - `{state, level, confidence, action, before}`.
	 * @returns {string}       A handle to close it with.
	 */
	overridden( entry = {} ) {

		if ( !entry.state ) return null

		const id = `${entry.state}_${Date.now()}_${this.open.size}`

		this.open.set( id, {
			...entry,
			at : Date.now(),
		} )

		return id

	}

	/**
	 * How it turned out.
	 *
	 * @param   {string} id    - From `overridden`.
	 * @param   {object} after - `{wellbeing, states}` some hours later.
	 * @returns {object}       `{outcome, why}`.
	 */
	settle( id, after ) {

		const open = this.open.get( id )

		if ( !open ) return {
			outcome : OUTCOME.UNCLEAR,
			why : 'No open override with that handle.',
		}

		this.open.delete( id )

		const result = grade( open.before, after )

		const list = this.trials.get( open.state ) ?? []
		list.push( {
			at : open.at,
			level : open.level,
			confidence : open.confidence,
			action : open.action,
			...result,
		} )
		this.trials.set( open.state, list )

		return result

	}

	/**
	 * What this state's refusals have been worth so far.
	 *
	 * @param   {string} name - State name.
	 * @returns {object}      `{known, rate, trials, why}`.
	 */
	record( name ) {

		const list = ( this.trials.get( name ) ?? [] ).filter( t => t.outcome !== OUTCOME.UNCLEAR )

		if ( list.length < this.minTrials ) {

			return {
				known : false,
				trials : list.length,
				needed : this.minTrials,
				why : `${list.length} of ${this.minTrials} usable overrides. A refusal nobody argued with teaches nothing, and a handful that somebody did is an anecdote — a system that retunes its own safety gates from anecdotes is worse than one that never retunes them.`,
			}

		}

		const wrong = list.filter( t => t.outcome === OUTCOME.FALSE_POSITIVE ).length
		const rate = wrong / list.length

		return {
			known : true,
			trials : list.length,
			falsePositives : wrong,
			rate : Number( rate.toFixed( 2 ) ),
			tooEager : rate >= this.tooEager,
			why : rate >= this.tooEager
				? `${wrong} of ${list.length} times this state refused something, somebody did it anyway and nothing went wrong. It is refusing good care, and the bar it has to clear before acting goes up.`
				: `${wrong} of ${list.length} overrides went unpunished, which is within what a cautious gate should cost. This state is earning its refusals.`,
		}

	}

	/**
	 * Should this state still be allowed to act?
	 *
	 * The only thing this class changes, and it moves in one direction. A state
	 * found too eager needs high confidence rather than merely adequate
	 * confidence before it gates anything.
	 *
	 * A state that has been *too permissive* cannot be found this way at all,
	 * because nobody overrides a permission. Loosening a gate on the strength of
	 * evidence that structurally cannot exist would be inventing it.
	 *
	 * @param   {object} state - An internal state.
	 * @returns {object}       `{acts, why}`.
	 */
	gate( state ) {

		if ( !state?.name || !state.acts ) return {
			acts : Boolean( state?.acts ),
			why : 'Not acting anyway.',
		}

		const record = this.record( state.name )

		if ( !record.known || !record.tooEager ) return {
			acts : true,
			record,
			why : record.known
				? `Acting. ${record.why}`
				: `Acting, with no track record either way. ${record.why}`,
		}

		const strong = state.confidence === CONFIDENCE.HIGH

		return {
			acts : strong,
			record,
			why : strong
				? `This state has a history of refusing things that turned out fine (${record.rate} of the time), so it now needs high confidence to act — and it has it.`
				: `Not acting. ${record.why} It would need high confidence rather than ${state.confidence} to gate anything, until its record improves.`,
		}

	}

	/**
	 * Everything known, for the diagnosis and the trajectory log.
	 *
	 * @returns {object} A report.
	 */
	report() {

		const states = [ ...this.trials.keys() ].map( name => ( {
			name,
			...this.record( name ),
		} ) )

		const eager = states.filter( s => s.tooEager )

		return {
			states,
			open : this.open.size,
			why : eager.length
				? `${eager.map( s => s.name ).join( ', ' )} refuse things that turn out to have been fine often enough to have been reined in.`
				: states.some( s => s.known )
					? 'Every state with a record is earning its refusals.'
					: 'No state has been overridden enough times to have a record. Which is the ordinary case, and it means every gate here is still running on its original judgement.',
		}

	}

}
