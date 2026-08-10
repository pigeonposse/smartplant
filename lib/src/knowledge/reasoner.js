/**
 * Forward-chaining reasoner.
 *
 * Turns observations into conclusions by repeatedly applying rules until nothing
 * new is derived, keeping the derivation trail for every conclusion.
 *
 * The point is not to replace the LLM — it is to give it *grounded* premises and
 * to catch the cases where a deterministic rule is simply better. "Soil at 4% for
 * six hours" needs no model to interpret, and a rule cannot hallucinate.
 */

import { PREDICATES, resolveConflicts } from './ontology.js'

/**
 * @typedef {object} Rule
 * @property {string}   id          - Stable identifier.
 * @property {string}   description - What it encodes.
 * @property {Function} when        - `(facts, ctx) => boolean | object` — truthy fires it.
 * @property {Function} conclude    - `(match, ctx) => {conclusion, confidence, because}`.
 * @property {number}   [priority]  - Higher fires first.
 */

/** Rules over the standard observation vocabulary. */
export const DEFAULT_RULES = [
	{
		id          : 'dry-soil-drought',
		description : 'Soil below its comfort band means drought stress.',
		priority    : 10,
		when : f => f.deviations?.find( d => d.metric === 'soil' && d.direction === 'low' ),
		conclude : ( d ) => ( {
			conclusion : 'drought_stress',
			confidence : d.score <= 25 ? 0.95 : 0.75,
			because    : [ `soil at ${d.value}${d.unit}, below the ideal ${d.range.min}-${d.range.max}${d.unit}` ],
		} ),
	},
	{
		id          : 'wet-soil-overwatering',
		description : 'Soil above its band, especially if watered recently, means overwatering.',
		priority    : 10,
		when : f => f.deviations?.find( d => d.metric === 'soil' && d.direction === 'high' ),
		conclude : ( d, ctx ) => {

			const recent = ctx.care?.daysSinceWater
			return {
				conclusion : 'overwatering',
				// A recent watering makes a wet reading expected, not alarming.
				confidence : recent !== null && recent <= 1 ? 0.55 : 0.85,
				because    : [
					`soil at ${d.value}${d.unit}, above the ideal ${d.range.min}-${d.range.max}${d.unit}`,
					recent !== null ? `last watered ${recent} day(s) ago` : null,
				].filter( Boolean ),
			}

		},
	},
	{
		id          : 'chronic-wet-root-rot',
		description : 'Sustained saturation is the precondition for root rot.',
		priority    : 20,
		when : ( f, ctx ) => {

			const wet = ctx.stats24?.soil
			return wet && wet.n >= 6 && wet.min > ( ctx.ranges?.soil?.max ?? 70 )

		},
		conclude : ( _m, ctx ) => ( {
			conclusion : 'root_rot',
			confidence : 0.6,
			because    : [ `soil never dropped below ${ctx.stats24.soil.min}% across ${ctx.stats24.soil.n} readings in 24h` ],
		} ),
	},
	{
		id          : 'heat',
		description : 'Temperature above the band means heat stress.',
		priority    : 10,
		when : f => f.deviations?.find( d => d.metric === 'temperature' && d.direction === 'high' ),
		conclude : d => ( {
			conclusion : 'heat_stress',
			confidence : d.score <= 25 ? 0.9 : 0.7,
			because    : [ `temperature at ${d.value}${d.unit}, above the ideal ${d.range.min}-${d.range.max}${d.unit}` ],
		} ),
	},
	{
		id          : 'cold',
		description : 'Temperature below the band means cold stress.',
		priority    : 10,
		when : f => f.deviations?.find( d => d.metric === 'temperature' && d.direction === 'low' ),
		conclude : d => ( {
			conclusion : 'cold_stress',
			confidence : d.score <= 25 ? 0.9 : 0.7,
			because    : [ `temperature at ${d.value}${d.unit}, below the ideal ${d.range.min}-${d.range.max}${d.unit}` ],
		} ),
	},
	{
		id          : 'dark',
		description : 'Light below the band means a light deficit.',
		priority    : 10,
		when : f => f.deviations?.find( d => d.metric === 'light' && d.direction === 'low' ),
		conclude : d => ( {
			conclusion : 'light_deficit',
			confidence : 0.7,
			because    : [ `light at ${d.value} lux, below the ideal ${d.range.min}-${d.range.max} lux` ],
		} ),
	},
	{
		id          : 'dry-air-mites',
		description : 'Warm and dry air is the classic spider-mite window.',
		priority    : 30,
		when : ( f, ctx ) => {

			const h = ctx.current?.humidity
			const t = ctx.current?.temperature
			return Number.isFinite( h ) && Number.isFinite( t ) && h < 35 && t > 22
				? {
					h,
					t,
				}
				: false

		},
		conclude : m => ( {
			conclusion : 'spider_mites',
			confidence : 0.45,
			because    : [ `humidity ${m.h}% with temperature ${m.t}°C — conditions spider mites favour` ],
		} ),
	},
	{
		id          : 'vision-droop',
		description : 'A canopy that has dropped between frames is wilting.',
		priority    : 15,
		when : ( f, ctx ) => ( ctx.vision?.change?.droopDelta > 0.02 ? ctx.vision.change : false ),
		conclude : c => ( {
			conclusion : 'canopy_droop',
			confidence : 0.7,
			because    : [ `canopy centroid dropped by ${( c.droopDelta * 100 ).toFixed( 1 )}% of frame height` ],
		} ),
	},
	{
		id          : 'vision-chlorosis',
		description : 'Increasing yellow tissue is chlorosis.',
		priority    : 15,
		when : ( f, ctx ) => {

			const chl = ctx.vision?.phenotype?.tissue?.chlorotic
			return chl > 0.12 ? chl : false

		},
		conclude : chl => ( {
			conclusion : 'chlorosis',
			confidence : 0.65,
			because    : [ `${( chl * 100 ).toFixed( 0 )}% of canopy pixels are yellowing` ],
		} ),
	},
	{
		id          : 'electro-damage',
		description : 'A variation potential is the plant signalling tissue damage.',
		priority    : 5,
		when : ( f, ctx ) => ( ctx.electro?.summary?.damageSignal ? ctx.electro.summary : false ),
		conclude : s => ( {
			conclusion : 'tissue_damage',
			confidence : 0.6,
			because    : [ `${s.counts.variation_potential} variation potential(s) detected — the electrical signature of wounding` ],
		} ),
	},
	{
		id          : 'electro-arrhythmia',
		description : 'A lost or off-period circadian rhythm precedes visible stress.',
		priority    : 25,
		when : ( f, ctx ) => ( ctx.electro?.circadian && ctx.electro.circadian.healthy === false ? ctx.electro.circadian : false ),
		conclude : c => ( {
			conclusion : 'weak_circadian_rhythm',
			confidence : 0.55,
			because    : [ c.verdict ],
		} ),
	},
]

export class Reasoner {

	/**
	 * @param {object}        [opts]        - Options.
	 * @param {TripleStore}   [opts.store]  - Ontology store, for treatment lookup.
	 * @param {Rule[]}        [opts.rules]  - Rules. Defaults to `DEFAULT_RULES`.
	 */
	constructor( opts = {} ) {

		this.store = opts.store || null
		this.rules = [ ...( opts.rules || DEFAULT_RULES ) ].sort( ( a, b ) => ( b.priority ?? 0 ) - ( a.priority ?? 0 ) )

	}

	/**
	 * Add a rule.
	 *
	 * @param   {Rule}     rule - The rule.
	 * @returns {Reasoner}      this
	 */
	addRule( rule ) {

		if ( !rule?.id || typeof rule.when !== 'function' || typeof rule.conclude !== 'function' ) {

			throw new Error( 'A rule needs { id, when, conclude }.' )

		}
		this.rules.push( rule )
		this.rules.sort( ( a, b ) => ( b.priority ?? 0 ) - ( a.priority ?? 0 ) )
		return this

	}

	/**
	 * Run the rules over a context.
	 *
	 * @param   {object} ctx        - Plant context, optionally with `vision` and `electro`.
	 * @param   {object} [opts]     - Options.
	 * @param   {number} [opts.minConfidence] - Drop weaker conclusions.
	 * @returns {object}            `{conclusions, treatments, explanation}`.
	 */
	infer( ctx, opts = {} ) {

		const minConfidence = opts.minConfidence ?? 0.4
		const facts = {
			deviations : ctx.deviations || [],
			current    : ctx.current || {},
			happiness  : ctx.happiness,
		}

		/** @type {Map<string, object>} */
		const conclusions = new Map()

		for ( const rule of this.rules ) {

			let match
			try {

				match = rule.when( facts, ctx )

			}
			catch {

				// A rule that throws on unusual input must not stop the others.
				continue

			}
			if ( !match ) continue

			let derived
			try {

				derived = rule.conclude( match, ctx )

			}
			catch {

				continue

			}
			if ( !derived?.conclusion || derived.confidence < minConfidence ) continue

			const existing = conclusions.get( derived.conclusion )
			if ( existing ) {

				// Independent rules agreeing is genuine corroboration, but two
				// weak signals should not become a certainty.
				existing.confidence = Math.min( 0.98, existing.confidence + ( 1 - existing.confidence ) * derived.confidence * 0.5 )
				existing.because.push( ...derived.because )
				existing.rules.push( rule.id )

			}
			else {

				conclusions.set( derived.conclusion, {
					conclusion : derived.conclusion,
					confidence : Number( derived.confidence.toFixed( 3 ) ),
					because    : [ ...derived.because ],
					rules      : [ rule.id ],
				} )

			}

		}

		const ranked = [ ...conclusions.values() ]
			.map( c => ( {
				...c,
				confidence : Number( c.confidence.toFixed( 3 ) ),
			} ) )
			.sort( ( a, b ) => b.confidence - a.confidence )

		return {
			conclusions : ranked,
			...this._treatments( ranked ),
			explanation : this.explain( ranked ),
		}

	}

	/** Collect and de-conflict treatments for the ranked conclusions. */
	_treatments( conclusions ) {

		if ( !this.store ) return {
			treatments : [],
			dropped : [],
		}

		const candidates = []
		for ( const c of conclusions ) {

			for ( const t of this.store.query( c.conclusion, PREDICATES.TREATED_BY ) ) {

				const id = String( t.object )
				if ( !candidates.some( x => x.treatment === id ) ) {

					candidates.push( {
						treatment : id,
						for       : c.conclusion,
						confidence: c.confidence,
					} )

				}

			}

		}

		const { kept, dropped } = resolveConflicts( this.store, candidates.map( c => c.treatment ) )

		return {
			treatments : kept.map( t => candidates.find( c => c.treatment === t ) ),
			dropped,
		}

	}

	/**
	 * Human-readable derivation. This is the artefact that makes the system
	 * auditable — every claim with the observation behind it.
	 *
	 * @param   {object[]} conclusions - Ranked conclusions.
	 * @returns {string}               Explanation text.
	 */
	explain( conclusions ) {

		if ( !conclusions.length ) return 'No conditions inferred: every measured metric is inside its comfort band.'

		return conclusions
			.map( c => {

				const pct = Math.round( c.confidence * 100 )
				const why = c.because.map( b => `    · ${b}` ).join( '\n' )
				return `${c.conclusion.replace( /_/g, ' ' )} (${pct}% confidence)\n${why}`

			} )
			.join( '\n' )

	}

}
