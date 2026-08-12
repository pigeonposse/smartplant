/**
 * The electrome as a systemic signature.
 *
 * Event detection asks "did something happen just now?". This asks a different
 * and more useful question: **"is this plant's baseline electrical state still
 * the one I know?"**
 *
 * That matters because the reference stops being the species and becomes the
 * individual. A generic table says a Monstera wants 35-70% soil. A fingerprint
 * says *this* plant, on *this* electrode, in *this* corner, normally sits at a
 * particular spectral shape — and that shape has drifted over four days.
 *
 * The drift usually arrives before the soil sensor has anything to say, because
 * membrane transport reorganizes long before bulk water content moves. That is
 * the whole value: early warning from the plant's own baseline, not from a
 * threshold someone else chose.
 */

import { ChangePointDetector } from '../fusion/filters.js'
import { complexity, spectralFeatures, timeFeatures } from './features.js'
import { notch } from './dsp.js'

/**
 * A stable, comparable description of an electrical state.
 *
 * Deliberately dimensionless where possible: absolute millivolts depend on
 * electrode contact, which drifts on its own and would swamp any biological
 * signal. Ratios and shape survive that; raw amplitude does not.
 *
 * @typedef {object} Fingerprint
 * @property {number}   complexity   - 0-1 signal richness.
 * @property {number}   entropy      - Spectral flatness, 0-1.
 * @property {number}   centroid     - Spectral centre of mass, Hz.
 * @property {object}   bands        - Fractional power per physiological band.
 * @property {number}   kurtosis     - Spikiness.
 * @property {number}   skewness     - Asymmetry.
 * @property {number}   variability  - SD over median absolute level, dimensionless.
 * @property {number}   sampleRate
 * @property {number}   durationS
 */

/** The feature axes compared between fingerprints, and their weights. */
const AXES = [
	{
		key : 'complexity',
		weight : 1.2,
		scale : 1,
	},
	{
		key : 'entropy',
		weight : 1.0,
		scale : 1,
	},
	{
		key : 'kurtosis',
		weight : 0.6,
		scale : 5,
	},
	{
		key : 'skewness',
		weight : 0.4,
		scale : 2,
	},
	{
		key : 'variability',
		weight : 0.8,
		scale : 1,
	},
	{
		key : 'bands.slow',
		weight : 1.0,
		scale : 1,
	},
	{
		key : 'bands.medium',
		weight : 1.0,
		scale : 1,
	},
	{
		key : 'bands.fast',
		weight : 0.8,
		scale : 1,
	},
]

/**
 * Compute a fingerprint from a window of samples.
 *
 * @param   {number[]}    samples      - Raw samples (mV).
 * @param   {number}      sampleRate   - Samples per second.
 * @param   {object}      [opts]       - Options.
 * @param   {number}      [opts.mainsHz] - Mains frequency to notch out. 0 disables.
 * @returns {Fingerprint}              The signature.
 */
export function electromeFingerprint( samples, sampleRate, opts = {} ) {

	const mainsHz = opts.mainsHz ?? 50
	let clean = [ ...samples ]
	if ( mainsHz > 0 && mainsHz < sampleRate / 2 ) clean = notch( clean, sampleRate, mainsHz )

	const time     = timeFeatures( clean )
	const spectral = spectralFeatures( clean, sampleRate )

	// Variability normalized by level: an electrode that drifts to a different
	// DC offset must not read as a different plant.
	const level = Math.abs( time.median ) || 1
	const variability = Number( ( time.sd / level ).toFixed( 5 ) )

	return {
		complexity  : complexity( clean ),
		entropy     : spectral.available ? spectral.entropy : 0,
		centroid    : spectral.available ? spectral.centroidHz : 0,
		bands       : spectral.available ? spectral.bands : {},
		kurtosis    : time.kurtosis,
		skewness    : time.skewness,
		variability,
		dominantPeriodS : spectral.available ? spectral.dominantPeriodS : null,
		sampleRate,
		durationS   : Number( ( clean.length / sampleRate ).toFixed( 1 ) ),
		at          : new Date().toISOString(),
	}

}

/** Read a possibly-nested axis key like `bands.slow`. */
function axisValue( fp, key ) {

	const v = key.includes( '.' )
		? key.split( '.' ).reduce( ( acc, k ) => acc?.[ k ], fp )
		: fp?.[ key ]
	return Number.isFinite( v ) ? v : 0

}

/**
 * Distance between two fingerprints, 0 = identical.
 *
 * Weighted and scaled per axis, so kurtosis (which ranges over units) does not
 * drown entropy (which ranges 0-1).
 *
 * @param   {Fingerprint} a - First.
 * @param   {Fingerprint} b - Second.
 * @returns {number}        Distance.
 */
export function fingerprintDistance( a, b ) {

	if ( !a || !b ) return Infinity

	let sum = 0, weight = 0

	for ( const axis of AXES ) {

		const delta = Math.abs( axisValue( a, axis.key ) - axisValue( b, axis.key ) ) / axis.scale
		sum += delta * axis.weight
		weight += axis.weight

	}

	return Number( ( sum / weight ).toFixed( 5 ) )

}

/**
 * Which axes moved most between two fingerprints, worst first.
 *
 * This is what makes a shift actionable rather than a number: "entropy up,
 * medium band down" is a description a reasoner and a human can both use.
 *
 * @param   {Fingerprint} from - Baseline.
 * @param   {Fingerprint} to   - Current.
 * @returns {object[]}         `{axis, from, to, delta, direction}`.
 */
export function fingerprintDelta( from, to ) {

	return AXES
		.map( axis => {

			const a = axisValue( from, axis.key )
			const b = axisValue( to, axis.key )
			const delta = ( b - a ) / axis.scale

			return {
				axis      : axis.key,
				from      : Number( a.toFixed( 4 ) ),
				to        : Number( b.toFixed( 4 ) ),
				delta     : Number( delta.toFixed( 4 ) ),
				weighted  : Number( ( Math.abs( delta ) * axis.weight ).toFixed( 4 ) ),
				direction : delta > 0 ? 'up' : 'down',
			}

		} )
		.filter( d => Math.abs( d.delta ) > 1e-6 )
		.sort( ( a, b ) => b.weighted - a.weighted )

}

/**
 * The plant's own normal, learned and then watched.
 *
 * Builds a baseline from a settling period, then reports how far the current
 * state has drifted from it. Change-point detection over the distance series
 * separates a genuine reorganization from the ordinary wobble of a living
 * electrode.
 */
export class ElectromeBaseline {

	/**
	 * @param {object} [opts]                 - Options.
	 * @param {number} [opts.settleSamples]   - Fingerprints needed before a baseline exists.
	 * @param {number} [opts.maxHistory]      - Ring-buffer size.
	 * @param {number} [opts.shiftThreshold]  - Distance that counts as a shift.
	 * @param {object} [opts.changePoint]     - `ChangePointDetector` options.
	 */
	constructor( opts = {} ) {

		// A dozen windows is roughly a day at hourly sampling: enough to average
		// out the circadian swing rather than freezing one phase of it as "normal".
		this.settleSamples  = opts.settleSamples ?? 12
		this.maxHistory     = opts.maxHistory ?? 500
		this.shiftThreshold = opts.shiftThreshold ?? 0.12

		/** @type {Fingerprint[]} */
		this.history  = []
		/** @type {Fingerprint|null} */
		this.baseline = null
		this.detector = new ChangePointDetector( {
			threshold : 0.6,
			drift : 0.02,
			...opts.changePoint,
		} )

		this.shifts = []

	}

	get settled() {

		return !!this.baseline

	}

	/**
	 * Fold in a new fingerprint.
	 *
	 * @param   {Fingerprint} fp - The fingerprint.
	 * @returns {object}         `{settled, distance, shifted, delta, verdict}`.
	 */
	push( fp ) {

		this.history.push( fp )
		if ( this.history.length > this.maxHistory ) this.history.shift()

		if ( !this.baseline ) {

			if ( this.history.length < this.settleSamples ) {

				return {
					settled  : false,
					needed   : this.settleSamples - this.history.length,
					verdict  : `Learning this plant's normal: ${this.history.length}/${this.settleSamples} windows.`,
				}

			}

			this.baseline = medianFingerprint( this.history.slice( -this.settleSamples ) )
			return {
				settled : true,
				distance : 0,
				shifted : false,
				verdict : `Baseline established from ${this.settleSamples} windows. This is now what "normal" means for this plant.`,
			}

		}

		const distance = fingerprintDistance( this.baseline, fp )
		const change   = this.detector.push( distance )
		const shifted  = distance > this.shiftThreshold || ( change.changed && change.direction === 'up' )

		const delta = shifted ? fingerprintDelta( this.baseline, fp ) : []

		if ( shifted ) {

			const record = {
				at : fp.at,
				distance,
				delta : delta.slice( 0, 3 ),
			}
			this.shifts.push( record )
			if ( this.shifts.length > 100 ) this.shifts.shift()

		}

		return {
			settled  : true,
			distance,
			shifted,
			changePoint : change.changed ? change : null,
			delta,
			verdict  : this.explain( distance, shifted, delta ),
		}

	}

	explain( distance, shifted, delta ) {

		if ( !shifted ) return `Electrical state is within this plant's normal range (distance ${distance}).`

		const top = delta.slice( 0, 2 )
			.map( d => `${d.axis.replace( '.', ' ' )} ${d.direction} (${d.from} → ${d.to})` )
			.join( ', ' )

		return `Baseline electrical state has shifted (distance ${distance}): ${top}. `
			+ 'This often precedes anything the soil or the camera can see.'

	}

	/**
	 * Re-learn the baseline from recent history.
	 *
	 * Needed after anything that legitimately changes the signature: moving the
	 * electrode, repotting, a season turning. Without it the system would keep
	 * reporting a shift that is simply the new truth.
	 *
	 * @param   {string} [reason] - Why.
	 * @returns {object}          `{rebased}`.
	 */
	rebase( reason = 'manual' ) {

		const window = this.history.slice( -this.settleSamples )
		if ( window.length < 2 ) return {
			rebased : false,
			reason : 'not enough history to rebase',
		}

		this.baseline = medianFingerprint( window )
		this.detector.reset()

		return {
			rebased : true,
			reason,
			from : window.length,
		}

	}

	/** Distance over time, for charting or for the reasoner. */
	series( n = 50 ) {

		if ( !this.baseline ) return []
		return this.history.slice( -n ).map( fp => ( {
			at : fp.at,
			distance : fingerprintDistance( this.baseline, fp ),
		} ) )

	}

	toJSON() {

		return {
			baseline : this.baseline,
			history  : this.history.slice( -this.settleSamples * 2 ),
			shifts   : this.shifts.slice( -20 ),
		}

	}

	static fromJSON( data, opts = {} ) {

		const b = new ElectromeBaseline( opts )
		b.baseline = data?.baseline ?? null
		b.history  = data?.history ?? []
		b.shifts   = data?.shifts ?? []
		return b

	}

}

/**
 * Median across fingerprints, axis by axis.
 *
 * Median rather than mean: one window containing a large action potential
 * should not redefine what the plant's resting state is.
 *
 * @param   {Fingerprint[]} list - Fingerprints.
 * @returns {Fingerprint}        The median signature.
 */
export function medianFingerprint( list ) {

	const med = values => {

		const s = values.filter( Number.isFinite ).sort( ( a, b ) => a - b )
		return s.length ? s[ Math.floor( s.length / 2 ) ] : 0

	}

	const bandKeys = [ ...new Set( list.flatMap( fp => Object.keys( fp.bands || {} ) ) ) ]

	return {
		complexity  : med( list.map( f => f.complexity ) ),
		entropy     : med( list.map( f => f.entropy ) ),
		centroid    : med( list.map( f => f.centroid ) ),
		kurtosis    : med( list.map( f => f.kurtosis ) ),
		skewness    : med( list.map( f => f.skewness ) ),
		variability : med( list.map( f => f.variability ) ),
		bands       : Object.fromEntries( bandKeys.map( k => [ k, med( list.map( f => f.bands?.[ k ] ) ) ] ) ),
		sampleRate  : list[ 0 ]?.sampleRate ?? null,
		durationS   : med( list.map( f => f.durationS ) ),
		n           : list.length,
		at          : new Date().toISOString(),
	}

}

/**
 * Turn a shift into cues the evidence ledger can weigh.
 *
 * A drift alone is not a diagnosis — it says "something reorganized", not what.
 * These are deliberately weak claims, meant to corroborate other modalities
 * rather than to stand on their own.
 *
 * @param   {object}   shift - Result of `ElectromeBaseline.push`.
 * @returns {object[]} Cues.
 */
export function shiftCues( shift ) {

	if ( !shift?.shifted ) return []

	const cues = [ {
		claim    : 'electrome_shift',
		strength : Math.min( 0.8, shift.distance * 3 ),
		detail   : shift.verdict,
	} ]

	const by = key => shift.delta?.find( d => d.axis === key )

	// Loss of complexity and a quieter medium band is the signature of a plant
	// doing less: dormancy, cold, or the early flattening that precedes stress.
	const cx = by( 'complexity' )
	if ( cx && cx.direction === 'down' && Math.abs( cx.delta ) > 0.15 ) {

		cues.push( {
			claim    : 'reduced_activity',
			strength : 0.5,
			detail   : `electrical complexity fell from ${cx.from} to ${cx.to}`,
		} )

	}

	// Rising entropy with rising fast-band power reads as noise, and the most
	// common cause of that is the electrode, not the plant.
	const en = by( 'entropy' )
	const fast = by( 'bands.fast' )
	if ( en?.direction === 'up' && fast?.direction === 'up' ) {

		cues.push( {
			claim    : 'electrode_degrading',
			strength : 0.4,
			detail   : 'entropy and fast-band power both rose — check electrode contact before reading anything physiological into this',
		} )

	}

	return cues

}
