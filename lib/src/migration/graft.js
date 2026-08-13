/**
 * Receiving an inheritance.
 *
 * Two rules govern this side, and both exist because inherited knowledge is
 * knowledge about somewhere else until proven otherwise.
 *
 * **The new body always wins.** An inherited prior is a starting guess with a
 * finite weight, and that weight shrinks as the plant accumulates outcomes of
 * its own. It never commands. If the inheritance says one thing and this plant's
 * own measurements say another, the measurements are right — they are the only
 * evidence about *this* pot, in *this* room.
 *
 * **Arrival is checked, not assumed.** The bundle carries the conditions its
 * priors were learned under, so the graft can compare them against where it has
 * landed and hold back what does not survive the comparison. Waiting for bad
 * priors to dilute away is not good enough: the plant suffers for the whole
 * length of the dilution, and that is the period when it is most fragile.
 */

import { compareConditions, SCHEMA_VERSION } from './bundle.js'
import { summarizeConditions } from './bundle.js'

/**
 * A live inheritance held by a plant.
 *
 * Priors are advisory by construction. There is no method here that acts.
 */
export class Inheritance {

	/**
	 * @param {object} bundle             - The imported bundle.
	 * @param {object} [opts]             - Options.
	 * @param {object} [opts.compatibility] - Result of `compareConditions`.
	 * @param {number} [opts.priorStrength] - Inherited weight, in effective local trials. Default 10.
	 * @param {number} [opts.shadowTrials]  - Local outcomes before priors stop being shadow-only. Default 5.
	 * @param {number} [opts.halfLifeDays]  - Time decay for untested priors. Default 60.
	 */
	constructor( bundle, opts = {} ) {

		this.bundle = bundle
		this.compatibility = opts.compatibility || null
		this.priorStrength = opts.priorStrength ?? 10
		this.shadowTrials  = opts.shadowTrials ?? 5
		this.halfLifeDays  = opts.halfLifeDays ?? 60
		this.graftedAt     = opts.graftedAt ?? Date.now()

		/** Local outcomes per action, which is what dilutes the inheritance. */
		this.local = new Map()

		/** @type {Map<string, object>} Priors that survived the arrival check. */
		this.priors = new Map()
		/** @type {object[]} Priors held back, with the reason. */
		this.held = []

		this._admit()

	}

	/** Decide which inherited policies are allowed to advise at all. */
	_admit() {

		// With no shared measurements there is no way to check anything, so every
		// prior is admitted at heavily reduced weight rather than trusted or
		// silently dropped. Unverified is its own state.
		const envWeight = this.compatibility?.mean ?? 0.3
		const mismatched = new Set( ( this.compatibility?.mismatches || [] ).map( m => m.metric ) )

		for ( const policy of this.bundle.policies || [] ) {

			// A policy about watering cannot be trusted into a pot whose soil
			// behaves nothing like the one it was learned in.
			const dependsOnMismatch = [ ...mismatched ].some( m => policy.action.toLowerCase().includes( m.slice( 0, 4 ) ) )

			if ( dependsOnMismatch ) {

				this.held.push( {
					action : policy.action,
					reason : `The environments differ on ${[ ...mismatched ].join( ', ' )}, which is exactly what this policy is about. Held back — it would be a fix for a problem this plant may not have.`,
				} )
				continue

			}

			this.priors.set( policy.action, {
				action   : policy.action,
				expected : policy.meanReward,
				weight   : Number( ( policy.transferability * envWeight ).toFixed( 3 ) ),
				source   : {
					trials   : policy.trials,
					distinct : policy.distinct,
					band     : policy.band,
				},
			} )

		}

	}

	/** Record an outcome this plant produced itself. */
	recordLocal( action, reward ) {

		const stat = this.local.get( action ) || {
			n : 0,
			sum : 0,
		}
		stat.n++
		stat.sum += Number( reward ?? 0 )
		this.local.set( action, stat )
		return stat

	}

	/** Is this action still inside its shadow period? */
	inShadow( action ) {

		return ( this.local.get( action )?.n ?? 0 ) < this.shadowTrials

	}

	/**
	 * The inherited estimate for an action, at its current weight.
	 *
	 * @param   {string} action - Action id.
	 * @returns {object|null}   `{expected, weight, advisory, why}` or null.
	 */
	prior( action ) {

		const p = this.priors.get( action )
		if ( !p ) return null

		const localN = this.local.get( action )?.n ?? 0

		// Bayesian shrinkage: the inheritance is worth `priorStrength` local
		// trials at the start and fades on a fixed schedule from there. Nothing
		// discretionary about it — the plant outgrows its inheritance by measuring.
		const evidenceDecay = this.priorStrength / ( this.priorStrength + localN )

		// And it fades with time even when nothing tests it. A prior nobody has
		// ever put to the question is not a validated belief, and leaving it at
		// full strength forever means a policy that was never checked here keeps
		// as much say as one this plant confirmed. Belief that is never examined
		// should get quieter, not louder.
		const ageDays = ( Date.now() - this.graftedAt ) / 86_400_000
		const timeDecay = Number( Math.pow( 0.5, ageDays / this.halfLifeDays ).toFixed( 4 ) )

		const weight = Number( ( p.weight * evidenceDecay * timeDecay ).toFixed( 3 ) )

		return {
			action,
			expected : p.expected,
			weight,
			advisory : this.inShadow( action ),
			localTrials : localN,
			decay : {
				evidence : Number( evidenceDecay.toFixed( 3 ) ),
				time     : timeDecay,
				ageDays  : Number( ageDays.toFixed( 1 ) ),
			},
			why : this.inShadow( action )
				? `Inherited from a plant that tried this ${p.source.trials} times across ${p.source.distinct} situations. Advisory only until this plant has ${this.shadowTrials} outcomes of its own.`
				: `Inherited prior now carries weight ${weight}, against ${localN} local outcomes. This plant's own record is taking over.`,
		}

	}

	/**
	 * Blend an inherited prior with what this plant has measured.
	 *
	 * @param   {string} action    - Action id.
	 * @param   {number} [localMean] - This plant's own estimate, if it has one.
	 * @returns {object}           `{expected, weight, fromInheritance, why}`.
	 */
	blend( action, localMean ) {

		const prior = this.prior( action )
		const stat = this.local.get( action )
		const measured = Number.isFinite( localMean )
			? localMean
			: ( stat?.n ? stat.sum / stat.n : null )

		if ( !prior ) {

			return {
				action,
				expected : measured,
				weight   : 0,
				fromInheritance : false,
				why : 'Nothing inherited for this action; this plant is on its own record.',
			}

		}

		if ( measured === null ) {

			return {
				action,
				expected : prior.expected,
				weight   : prior.weight,
				fromInheritance : true,
				why : `No local outcomes yet — starting from the inherited estimate. ${prior.why}`,
			}

		}

		const expected = prior.expected * prior.weight + measured * ( 1 - prior.weight )

		return {
			action,
			expected : Number( expected.toFixed( 4 ) ),
			weight   : prior.weight,
			localMean : Number( measured.toFixed( 4 ) ),
			fromInheritance : prior.weight > 0.05,
			why : `Inherited ${prior.expected} at weight ${prior.weight}, this plant's own ${measured.toFixed( 3 )} at ${( 1 - prior.weight ).toFixed( 2 )}.`,
		}

	}

	/** What was inherited, what was held back, and how much still applies. */
	report() {

		const priors = [ ...this.priors.keys() ].map( a => this.prior( a ) )

		return {
			species    : this.bundle.manifest.species,
			sourceHash : this.bundle.manifest.sourceHash,
			compatibility : this.compatibility?.verdict ?? 'unchecked',
			admitted   : priors.length,
			held       : this.held,
			withheldAtSource : ( this.bundle.withheld || [] ).length,
			shadow     : priors.filter( p => p.advisory ).map( p => p.action ),
			priors,
		}

	}

}

/**
 * Graft an inheritance onto a plant.
 *
 * Comfort ranges are blended immediately — they are descriptive and low-risk.
 * Policies are not: they arrive as advisory priors and have to earn their way in.
 *
 * @param   {object} plant            - The receiving `SmartPlant`.
 * @param   {object} bundle           - A bundle from `exportBundle`.
 * @param   {object} [opts]           - Options.
 * @param   {number} [opts.rangeWeight] - How far to move comfort ranges. Default 0.4.
 * @param   {boolean} [opts.force]    - Accept a species mismatch. Off by default.
 * @returns {object}                  `{inheritance, compatibility, ranges}`.
 */
export function importBundle( plant, bundle, opts = {} ) {

	if ( !bundle?.manifest ) throw new Error( 'Not an inheritance bundle: no manifest.' )

	if ( bundle.manifest.schemaVersion !== SCHEMA_VERSION ) {

		throw new Error( `Bundle schema v${bundle.manifest.schemaVersion} cannot be read by this version (v${SCHEMA_VERSION}). Re-export from the source plant.` )

	}

	const target = String( plant?.memory?.plant?.species || '' ).toLowerCase().trim()

	if ( !target ) {

		throw new Error( 'The receiving plant has no species set, so there is no way to know whether this inheritance applies to it.' )

	}

	if ( target !== bundle.manifest.species && !opts.force ) {

		throw new Error( `Species mismatch: the bundle is for "${bundle.manifest.species}", this plant is "${target}". Priors do not carry across species. Pass { force: true } only if you know why you are doing this.` )

	}

	const here = summarizeConditions( plant.memory.since( opts.hours ?? 24 * 30 ) )
	const compatibility = compareConditions( bundle.conditions || {}, here || {} )

	// Ranges move part of the way, never all of it — the inheritance is a strong
	// hint about the species, not a measurement of this pot.
	const rangeWeight = Math.min( 1, Math.max( 0, opts.rangeWeight ?? 0.4 ) )
	// A poor environmental match pulls that further back on its own.
	const effective = rangeWeight * ( compatibility.mean ?? 0.5 )

	for ( const [ metric, range ] of Object.entries( bundle.ranges || {} ) ) {

		const current = plant.ranges[ metric ]
		if ( !current ) {

			plant.ranges[ metric ] = {
				min : range.min,
				max : range.max,
			}
			continue

		}

		plant.ranges[ metric ] = {
			min : Number( ( current.min * ( 1 - effective ) + range.min * effective ).toFixed( 2 ) ),
			max : Number( ( current.max * ( 1 - effective ) + range.max * effective ).toFixed( 2 ) ),
		}

	}

	const inheritance = new Inheritance( bundle, {
		compatibility,
		...opts,
	} )

	plant.inheritance = inheritance

	return {
		inheritance,
		compatibility,
		ranges : plant.ranges,
	}

}
