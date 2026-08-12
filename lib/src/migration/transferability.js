/**
 * What is worth inheriting, and what only looks like it is.
 *
 * The tempting way to score a learned policy for export is by how much evidence
 * stands behind it: number of trials, average reward, how recent. That ranking
 * is close to backwards.
 *
 * A policy with five hundred outcomes, every one of them recorded on the same
 * windowsill at the same time of year, has enormous evidential weight and almost
 * no transferable content. What it encodes is *that windowsill*. Ship it to a
 * plant in another room and you have shipped a very confident description of
 * somewhere else.
 *
 * A policy tried thirty times across cold mornings and warm afternoons, damp
 * substrate and dry, has less evidence and far more of the thing you actually
 * want: a regularity that survived a change of conditions.
 *
 * So context diversity is not one term among several here. It is the gate. No
 * amount of evidence rescues a policy that was only ever tested in one world.
 */

/**
 * Bands used to decide whether two situations are "the same situation".
 *
 * Deliberately coarse. 43% and 47% soil are not different worlds, and treating
 * them as such would manufacture diversity that is not there — which is the
 * exact failure this module exists to prevent.
 */
export const CONTEXT_BANDS = {
	temperature : [ 10, 16, 20, 24, 28 ],
	humidity    : [ 30, 45, 60, 75 ],
	soil        : [ 20, 35, 50, 65 ],
	light       : [ 200, 800, 2000, 10_000 ],
	hour        : [ 6, 11, 16, 21 ],
}

/** Which band a value falls into, as an index. */
function bandOf( metric, value ) {

	const edges = CONTEXT_BANDS[ metric ]
	if ( !edges || !Number.isFinite( value ) ) return null

	let i = 0
	while ( i < edges.length && value >= edges[ i ] ) i++
	return i

}

/**
 * A coarse signature of one situation, used to count distinct worlds.
 *
 * @param   {object} context - An episode context.
 * @returns {string}         Signature, or `''` when nothing usable is present.
 */
export function contextSignature( context = {} ) {

	const parts = []

	for ( const metric of Object.keys( CONTEXT_BANDS ) ) {

		const band = bandOf( metric, context[ metric ] )
		if ( band !== null ) parts.push( `${metric}${band}` )

	}

	return parts.join( '|' )

}

/**
 * How many genuinely different situations a set of episodes covers, 0-1.
 *
 * Normalised Shannon entropy over context signatures. Entropy rather than a
 * plain count because thirty trials in one world and one trial in another is
 * not meaningful coverage of two worlds — the distribution matters, not just
 * the number of distinct labels.
 *
 * @param   {object[]} contexts - Episode contexts.
 * @returns {object}            `{score, distinct, dominant, counts}`.
 */
export function contextDiversity( contexts = [] ) {

	const counts = new Map()
	let usable = 0

	for ( const ctx of contexts ) {

		const sig = contextSignature( ctx )
		if ( !sig ) continue
		counts.set( sig, ( counts.get( sig ) || 0 ) + 1 )
		usable++

	}

	if ( usable === 0 || counts.size <= 1 ) {

		return {
			score    : 0,
			distinct : counts.size,
			dominant : usable ? 1 : 0,
			counts,
		}

	}

	let entropy = 0
	for ( const n of counts.values() ) {

		const p = n / usable
		entropy -= p * Math.log2( p )

	}

	// Against the entropy of a perfectly even spread over the same number of
	// situations, so the score asks "is this coverage balanced?" rather than
	// rewarding a long tail of one-off contexts.
	const max = Math.log2( counts.size )
	const dominant = Math.max( ...counts.values() ) / usable

	return {
		score    : Number( ( max > 0 ? entropy / max : 0 ).toFixed( 3 ) ),
		distinct : counts.size,
		// How much of the evidence sits in the single most common situation. A
		// policy that is 90% one context is a single-context policy wearing a
		// disguise, whatever its entropy says.
		dominant : Number( dominant.toFixed( 3 ) ),
		counts,
	}

}

/** Confidence from sample size, saturating rather than growing without bound. */
function evidenceWeight( n, minTrials ) {

	if ( n < minTrials ) return 0
	// Reaches ~0.9 around 25 trials. Beyond that, more of the same tells you
	// very little you did not already know.
	return Number( ( 1 - Math.exp( -n / 12 ) ).toFixed( 3 ) )

}

/** Decay for stale evidence: a plant's world changes with the seasons. */
function recencyWeight( newestAt, halfLifeDays ) {

	if ( !newestAt ) return 0.5
	const ageDays = ( Date.now() - new Date( newestAt ).getTime() ) / 86_400_000
	if ( !Number.isFinite( ageDays ) || ageDays < 0 ) return 1
	return Number( Math.pow( 0.5, ageDays / halfLifeDays ).toFixed( 3 ) )

}

/**
 * Score one learned policy for export.
 *
 * @param   {object}   policy               - `{action, episodes}`.
 * @param   {object}   [opts]               - Options.
 * @param   {number}   [opts.minTrials]     - Below this, nothing is exportable. Default 8.
 * @param   {number}   [opts.minDistinct]   - Distinct situations required. Default 3.
 * @param   {number}   [opts.maxDominant]   - Largest share one situation may hold. Default 0.7.
 * @param   {number}   [opts.halfLifeDays]  - Recency half-life. Default 120.
 * @returns {object}                        `{score, band, why, blockers, parts}`.
 */
export function transferability( policy, opts = {} ) {

	const minTrials    = opts.minTrials ?? 8
	const minDistinct  = opts.minDistinct ?? 3
	const maxDominant  = opts.maxDominant ?? 0.7
	const halfLifeDays = opts.halfLifeDays ?? 120

	const episodes = policy?.episodes || []
	const n = episodes.length
	const diversity = contextDiversity( episodes.map( e => e.context ) )

	const blockers = []

	if ( n < minTrials ) {

		blockers.push( `only ${n} outcomes, needs ${minTrials} before it means anything` )

	}

	if ( diversity.distinct < minDistinct ) {

		blockers.push( diversity.distinct <= 1
			? 'learned in a single set of conditions — this describes that spot, not the plant'
			: `only ${diversity.distinct} distinct situations, needs ${minDistinct} to show it survives a change of conditions` )

	}

	if ( diversity.dominant > maxDominant ) {

		blockers.push( `${Math.round( diversity.dominant * 100 )}% of the evidence comes from one situation — the spread is nominal, not real` )

	}

	const parts = {
		diversity : diversity.score,
		evidence  : evidenceWeight( n, minTrials ),
		recency   : recencyWeight( episodes.at( -1 )?.at, halfLifeDays ),
	}

	// Diversity multiplies rather than adds, and a blocked policy scores zero
	// outright. Evidence cannot buy its way past a single-context history.
	const score = blockers.length
		? 0
		: Number( ( parts.diversity * parts.evidence * parts.recency ).toFixed( 3 ) )

	return {
		score,
		band     : bandFor( score ),
		blockers,
		parts,
		diversity,
		trials   : n,
		why      : blockers.length
			? `Not transferable: ${blockers.join( '; ' )}.`
			: `Transferable (${score}): held across ${diversity.distinct} distinct situations over ${n} outcomes.`,
	}

}

function bandFor( score ) {

	if ( score <= 0 ) return 'blocked'
	if ( score < 0.25 ) return 'weak'
	if ( score < 0.5 ) return 'moderate'
	return 'strong'

}

export { evidenceWeight, recencyWeight }
