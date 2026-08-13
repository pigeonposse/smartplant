/**
 * What each thing you do to a plant looks like electrically.
 *
 * The literature on electrome-based stress classification is genuinely
 * promising: the whole pattern of electrical activity — entropy, complexity,
 * band structure, the colour of its noise — discriminates drought from salinity
 * from wounding far better than counting action potentials does. The reported
 * accuracies are high.
 *
 * They are also achieved with **labelled data**, inside one experiment, on
 * plants somebody deliberately stressed in a known way. That is the part which
 * does not survive contact with a houseplant. Nobody at home can tell the
 * library "this window was salinity"; a model shipped pre-trained on someone
 * else's greenhouse would be confidently wrong about your ficus, and there is no
 * honest way to promise otherwise.
 *
 * But the labels are not actually missing. Every time somebody waters,
 * fertilises, repots or moves a plant, the care log records **what happened and
 * exactly when**. That is a labelled event, already in the memory of every
 * installation, and nobody has to be asked for it. So instead of classifying
 * stress the plant might be under, this learns the signature of the things that
 * are known to have been done to it — and then recognises them happening again.
 *
 * That is a smaller claim than the papers make, and it is one that can actually
 * be kept.
 */

import { extractFeatures } from './features.js'
import { fingerprintDistance, electromeFingerprint } from './electrome.js'

/**
 * A library of what interventions look like on this plant.
 */
export class InterventionSignatures {

	/**
	 * @param {object} [opts]              - Options.
	 * @param {number} [opts.minExamples]  - Occurrences before a signature is usable. Default 3.
	 * @param {number} [opts.maxPerType]   - Examples kept per intervention. Default 30.
	 * @param {number} [opts.matchDistance]- Distance under which a match is claimed. Default 0.12.
	 */
	constructor( opts = {} ) {

		// An explicit null is a different mistake from omitting the argument, and
		// a default only covers the second. Both should land on the same message.
		opts = opts ?? {}


		this.minExamples = opts.minExamples ?? 3
		this.maxPerType = opts.maxPerType ?? 30
		this.matchDistance = opts.matchDistance ?? 0.12

		/** @type {Map<string, object[]>} intervention → recorded signatures */
		this.library = new Map()

	}

	/**
	 * Record what the plant did after a known intervention.
	 *
	 * @param   {string}   type        - What was done: `'water'`, `'fertilize'`…
	 * @param   {number[]} samples     - Electrode window following it.
	 * @param   {number}   sampleRate  - Hz.
	 * @param   {object}   [opts]      - `{ at, mainsHz }`.
	 * @returns {object}               `{type, examples, usable}`.
	 */
	record( type, samples, sampleRate, opts = {} ) {

		if ( !type ) throw new Error( 'An intervention signature needs to know what was done.' )
		if ( !Array.isArray( samples ) || samples.length < 32 ) {

			return {
				type,
				recorded : false,
				why : `Need at least 32 electrode samples to characterise "${type}"; got ${samples?.length ?? 0}.`,
			}

		}

		const fingerprint = electromeFingerprint( samples, sampleRate, opts )

		if ( !this.library.has( type ) ) this.library.set( type, [] )
		const list = this.library.get( type )

		list.push( {
			at : opts.at ? new Date( opts.at ).toISOString() : new Date().toISOString(),
			fingerprint,
			features : extractFeatures( samples, sampleRate ),
		} )
		if ( list.length > this.maxPerType ) list.shift()

		return {
			type,
			recorded : true,
			examples : list.length,
			usable   : list.length >= this.minExamples,
		}

	}

	/**
	 * Learn from a plant's own care log, with no extra input from anyone.
	 *
	 * @param   {object} plant   - A `SmartPlant` with an electrode.
	 * @param   {object} [opts]  - `{ types, windowMinutes }`.
	 * @returns {object}         What was learned.
	 */
	learnFrom( plant, opts = {} ) {

		const driver = plant.sensors?.peek?.( 'electrode' )

		if ( !driver ) {

			return {
				learned : false,
				why : 'No electrode attached, so there is no electrical response to associate with anything.',
			}

		}

		const types = opts.types || [ 'water', 'fertilize' ]
		const windowMinutes = opts.windowMinutes ?? 30
		const events = ( plant.memory?.data?.events || [] ).filter( e => types.includes( e.type ) )
		const learned = []

		for ( const event of events ) {

			// Only events whose window still sits inside the electrode buffer can be
			// characterised; the rest are labels with no recording behind them.
			const samples = typeof driver.windowAround === 'function'
				? driver.windowAround( new Date( event.t ).getTime(), windowMinutes * 60 )
				: null

			if ( !samples?.length ) continue

			const r = this.record( event.type, samples, driver.sampleRate, {
				at : event.t,
				mainsHz : driver.mainsHz,
			} )
			if ( r.recorded ) learned.push( r )

		}

		return {
			learned : learned.length > 0,
			events  : events.length,
			recorded: learned.length,
			why : learned.length
				? `Characterised ${learned.length} of ${events.length} logged interventions from the electrode buffer.`
				: `${events.length} interventions are logged, but none of them still has electrode data behind it. The buffer only reaches back so far — signatures accumulate from now on.`,
		}

	}

	/** The averaged signature of one intervention, if there is enough of it. */
	signature( type ) {

		const list = this.library.get( type ) || []

		if ( list.length < this.minExamples ) {

			return {
				type,
				known : false,
				examples : list.length,
				why : `Only ${list.length} recorded example(s) of "${type}"; ${this.minExamples} are needed before its signature means anything.`,
			}

		}

		// How much the examples resemble each other. An intervention whose own
		// occurrences look nothing alike has no signature to speak of, and saying
		// that is more useful than averaging them into a shape nothing matches.
		const distances = []
		for ( let i = 0; i < list.length; i++ ) {

			for ( let j = i + 1; j < list.length; j++ ) {

				distances.push( fingerprintDistance( list[ i ].fingerprint, list[ j ].fingerprint ) )

			}

		}

		const spread = distances.reduce( ( a, b ) => a + b, 0 ) / distances.length
		const consistency = Number( Math.max( 0, 1 - spread / 0.3 ).toFixed( 3 ) )

		return {
			type,
			known      : true,
			examples   : list.length,
			consistency,
			// A signature is only usable for recognition when its own occurrences
			// resemble each other. Below that, the average is a shape none of them
			// actually has, and matching against it would be noise with a name.
			reliable   : consistency >= 0.6,
			spread     : Number( spread.toFixed( 4 ) ),
			latest     : list.at( -1 ).fingerprint,
			why : consistency >= 0.6
				? `"${type}" has a consistent signature across ${list.length} occurrences (consistency ${consistency}).`
				: `"${type}" has been recorded ${list.length} times but the occurrences look very different from each other (consistency only ${consistency}). Either the intervention is not consistent on this plant, or something else dominates the window.`,
		}

	}

	/**
	 * Does this window look like something that has been done before?
	 *
	 * @param   {number[]} samples    - Electrode window.
	 * @param   {number}   sampleRate - Hz.
	 * @param   {object}   [opts]     - `{ mainsHz }`.
	 * @returns {object}              `{match, distance, candidates, why}`.
	 */
	identify( samples, sampleRate, opts = {} ) {

		const fingerprint = electromeFingerprint( samples, sampleRate, opts )

		const candidates = [ ...this.library.keys() ]
			.map( type => this.signature( type ) )
			.filter( s => s.known && s.reliable )
			.map( s => ( {
				type : s.type,
				distance : Number( fingerprintDistance( fingerprint, s.latest ).toFixed( 4 ) ),
				consistency : s.consistency,
			} ) )
			.sort( ( a, b ) => a.distance - b.distance )

		if ( !candidates.length ) {

			return {
				match : null,
				candidates,
				why : 'Nothing has been characterised on this plant yet, so there is nothing to recognise.',
			}

		}

		const best = candidates[ 0 ]
		const runnerUp = candidates[ 1 ]

		if ( best.distance > this.matchDistance ) {

			return {
				match : null,
				candidates,
				why : `This does not look like any of the ${candidates.length} intervention(s) characterised on this plant (closest is "${best.type}" at ${best.distance}).`,
			}

		}

		// Two candidates equally close is not an identification. Naming the nearer
		// one would be picking a winner out of a tie.
		if ( runnerUp && runnerUp.distance - best.distance < best.distance * 0.5 ) {

			return {
				match : null,
				ambiguous : [ best.type, runnerUp.type ],
				candidates,
				why : `This resembles "${best.type}" (${best.distance}) and "${runnerUp.type}" (${runnerUp.distance}) about equally. The two are not distinguishable on this plant's electrode.`,
			}

		}

		return {
			match : best.type,
			distance : best.distance,
			confidence : Number( Math.max( 0, 1 - best.distance / this.matchDistance ).toFixed( 3 ) ),
			candidates,
			why : `Looks like "${best.type}" (distance ${best.distance}, characterised from ${this.library.get( best.type ).length} occurrences).`,
		}

	}

	/** Everything characterised so far. */
	report() {

		const signatures = [ ...this.library.keys() ].map( t => this.signature( t ) )

		return {
			interventions : signatures,
			usable : signatures.filter( s => s.known ).length,
			verdict : signatures.length
				? `${signatures.filter( s => s.known ).length} of ${signatures.length} logged intervention(s) have a usable electrical signature on this plant.`
				: 'Nothing has been characterised yet. Water or feed the plant with the electrode attached and its signature will be recorded.',
		}

	}

}
