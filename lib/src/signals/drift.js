/**
 * Whether this is still the same plant.
 *
 * `ElectromeBaseline` answers "has something changed since recently?" — it holds
 * a rolling median of the last few windows and flags departures from it. That is
 * the right question for a stress event and exactly the wrong one for slow
 * change, because a baseline that follows the plant will follow it anywhere. A
 * signature can walk a very long way over three months while every single step
 * sits comfortably inside the recent normal, and nothing ever fires. The frog
 * does not notice the water.
 *
 * So continuity is measured against an **anchor**: the signature captured once,
 * when the baseline first settled, which does not move. Distance from the anchor
 * is drift. Distance from the rolling baseline is an event. They are different
 * measurements and the system needs both.
 *
 * ## The confound that makes this hard
 *
 * An electrode ages. Contact impedance changes as the tissue responds to being
 * pierced, a callus forms over weeks, the gel dries, oxide builds on the metal.
 * Every one of those produces a slow, coherent, monotonic change in the recorded
 * signature — which is to say, they produce something indistinguishable from the
 * plant reorganising itself, if you only look at one electrode.
 *
 * This is not a small caveat. Over the months-long deployments where drift is
 * worth measuring at all, electrode degradation is the *more likely* explanation
 * of the two. A continuity score from a single electrode does not measure the
 * plant; it measures the plant and the electrode, inseparably.
 *
 * The discriminator is physical: **the plant is shared between electrodes and a
 * contact is not.** Real physiological reorganisation shows up at every site, in
 * the same axes, in the same direction. A degrading contact shows up at its own
 * site and nowhere else. With two sites this is answerable. With one it is not,
 * and this module says so instead of guessing.
 */

import { fingerprintDelta, fingerprintDistance } from './electrome.js'

const DAY_MS = 86_400_000

/** How far a signature has moved before the word "drift" is earned. */
export const DRIFT_BANDS = [
	{
		max : 0.08,
		id : 'stable',
		says : 'unchanged',
	},
	{
		max : 0.18,
		id : 'slight',
		says : 'slightly changed',
	},
	{
		max : 0.35,
		id : 'marked',
		says : 'markedly changed',
	},
	{
		max : Infinity,
		id : 'transformed',
		says : 'no longer recognisable as the same signature',
	},
]

const bandFor = d => DRIFT_BANDS.find( b => d <= b.max )

/**
 * Tracks one plant's electrical identity over months, per electrode site.
 */
export class ContinuityTracker {

	/**
	 * @param {object} [opts]              - Options.
	 * @param {number} [opts.anchorAfter]  - Samples before the anchor is fixed. Default 12.
	 * @param {number} [opts.history]      - Samples kept per site. Default 500.
	 * @param {number} [opts.recent]       - Samples averaged as "now". Default 5.
	 * @param {number} [opts.minDays]      - Span before a slope means anything. Default 7.
	 */
	constructor( opts = {} ) {

		// An explicit null is a different mistake from omitting the argument, and
		// a default only covers the second. Both should land on the same message.
		opts = opts ?? {}


		this.anchorAfter = opts.anchorAfter ?? 12
		this.historyLimit = opts.history ?? 500
		this.recent = opts.recent ?? 5
		this.minDays = opts.minDays ?? 7

		/** @type {Map<string, {anchor: object|null, anchoredAt: number|null, history: object[]}>} */
		this.sites = new Map()

	}

	_site( id ) {

		if ( !this.sites.has( id ) ) {

			this.sites.set( id, {
				anchor : null,
				anchoredAt : null,
				history : [],
			} )

		}
		return this.sites.get( id )

	}

	/**
	 * Add a signature for one electrode site.
	 *
	 * @param   {object} fingerprint - From `electromeFingerprint`.
	 * @param   {object} [opts]      - `{ site, at }`.
	 * @returns {object}             `{anchored, samples}`.
	 */
	push( fingerprint, opts = {} ) {

		if ( !fingerprint ) throw new Error( 'ContinuityTracker.push needs a fingerprint.' )

		const id = opts.site || 'primary'
		const at = opts.at ? new Date( opts.at ).getTime() : Date.now()
		const site = this._site( id )

		site.history.push( {
			at,
			fingerprint,
		} )
		if ( site.history.length > this.historyLimit ) site.history.shift()

		// The anchor is fixed once, from the settling period, and then left alone.
		// Re-anchoring on every accepted state is exactly how drift becomes
		// invisible, so it takes a deliberate call.
		if ( !site.anchor && site.history.length >= this.anchorAfter ) {

			site.anchor = medianOf( site.history.slice( 0, this.anchorAfter ).map( h => h.fingerprint ) )
			site.anchoredAt = site.history[ 0 ].at

		}

		return {
			site : id,
			anchored : Boolean( site.anchor ),
			samples : site.history.length,
		}

	}

	/**
	 * How far one site has moved from its anchor, and how fast.
	 *
	 * @param   {string} [id] - Site id.
	 * @returns {object}      `{known, distance, band, perDay, axes}`.
	 */
	drift( id = 'primary' ) {

		const site = this.sites.get( id )

		if ( !site?.anchor ) {

			return {
				site : id,
				known : false,
				samples : site?.history.length ?? 0,
				reason : `No anchor yet for "${id}": ${site?.history.length ?? 0} of ${this.anchorAfter} settling samples.`,
			}

		}

		const recent = site.history.slice( -this.recent )
		const now = medianOf( recent.map( h => h.fingerprint ) )
		const distance = fingerprintDistance( site.anchor, now )
		const spanDays = ( recent.at( -1 ).at - site.anchoredAt ) / DAY_MS

		// A rate needs enough elapsed time to be a rate rather than an artefact of
		// two nearby samples.
		const perDay = spanDays >= this.minDays
			? Number( ( distance / spanDays ).toFixed( 5 ) )
			: null

		return {
			site      : id,
			known     : true,
			distance  : Number( distance.toFixed( 4 ) ),
			band      : bandFor( distance ).id,
			says      : bandFor( distance ).says,
			perDay,
			spanDays  : Number( spanDays.toFixed( 1 ) ),
			// Which axes moved, so attribution has something to compare.
			axes      : fingerprintDelta( site.anchor, now ),
			// 1 is "identical to the plant it settled as", 0 is unrecognisable.
			continuity: Number( Math.max( 0, 1 - distance / 0.5 ).toFixed( 3 ) ),
		}

	}

	/**
	 * Is the drift the plant, or the electrode?
	 *
	 * @param   {object} [opts] - `{ minAgreement }`, default 0.6.
	 * @returns {object}        `{cause, confidence, why, perSite}`.
	 */
	attribute( opts = {} ) {

		// An explicit null is a different mistake from omitting the argument, and
		// a default only covers the second. Both should land on the same message.
		opts = opts ?? {}


		const minAgreement = opts.minAgreement ?? 0.6
		const perSite = [ ...this.sites.keys() ].map( id => this.drift( id ) )
		const known = perSite.filter( d => d.known )

		if ( !known.length ) {

			return {
				cause : 'unknown',
				perSite,
				why : 'No site has settled long enough to have an anchor.',
			}

		}

		if ( known.length === 1 ) {

			const only = known[ 0 ]

			// The honest answer, and the important one. A single electrode cannot
			// separate the plant from its own contact, and over the timescales where
			// drift matters, the contact is the more likely explanation.
			return {
				cause      : 'unattributable',
				confidence : 0,
				perSite,
				drifting   : only.band !== 'stable',
				why        : only.band === 'stable'
					? `"${only.site}" is stable (${only.distance}), so there is nothing to attribute.`
					: `The signature at "${only.site}" has moved ${only.distance} from its anchor, but one electrode cannot tell a changing plant from a changing contact — a forming callus and a reorganising electrome look identical from a single site. Add a second electrode to make this answerable.`,
			}

		}

		const drifting = known.filter( d => d.band !== 'stable' )

		if ( !drifting.length ) {

			return {
				cause      : 'stable',
				confidence : 1,
				perSite,
				drifting   : false,
				why        : `All ${known.length} sites are within ${Math.max( ...known.map( d => d.distance ) )} of their anchors. This is the same plant, measured the same way.`,
			}

		}

		if ( drifting.length < known.length ) {

			const names = drifting.map( d => `"${d.site}"` ).join( ', ' )

			// Drift at some sites and not others cannot be the plant: the plant is
			// shared between the electrodes and a contact is not.
			return {
				cause      : 'electrode',
				confidence : 0.8,
				perSite,
				drifting   : true,
				suspect    : drifting.map( d => d.site ),
				why        : `${names} drifted while the other site held steady. The plant is common to both electrodes, so a change in only one of them is the contact, not the physiology. Check the ${names} electrode before reading anything into this.`,
			}

		}

		// Every site moved. If they moved the same way, that is the plant.
		const agreement = axisAgreement( drifting.map( d => d.axes ) )

		if ( agreement >= minAgreement ) {

			return {
				cause      : 'physiology',
				confidence : Number( agreement.toFixed( 2 ) ),
				perSite,
				drifting   : true,
				agreement  : Number( agreement.toFixed( 2 ) ),
				why        : `All ${known.length} sites drifted in the same direction on the same axes (agreement ${agreement.toFixed( 2 )}). Independent contacts do not fail in step, so this is the plant reorganising, not the electrodes ageing.`,
			}

		}

		return {
			cause      : 'unclear',
			confidence : Number( agreement.toFixed( 2 ) ),
			perSite,
			drifting   : true,
			agreement  : Number( agreement.toFixed( 2 ) ),
			why        : `Every site drifted, but in different directions (agreement only ${agreement.toFixed( 2 )}). Shared physiology would move them together, so this looks like both contacts degrading independently rather than one plant changing.`,
		}

	}

	/**
	 * Cues for the evidence ledger.
	 *
	 * Only attributed physiological drift becomes a claim about the plant.
	 * Electrode drift is a claim about the equipment and is filed as such.
	 *
	 * @returns {object[]} Cues.
	 */
	cues() {

		const a = this.attribute()

		if ( a.cause === 'physiology' ) {

			const worst = a.perSite.filter( d => d.known ).sort( ( x, y ) => y.distance - x.distance )[ 0 ]
			return [ {
				claim    : 'electrome_reorganisation',
				source   : 'continuity',
				strength : Math.min( 0.65, 0.3 + worst.distance ),
				detail   : `signature ${worst.says} since settling (${worst.distance} over ${worst.spanDays}d), corroborated across ${a.perSite.length} sites`,
			} ]

		}

		if ( a.cause === 'electrode' || a.cause === 'unclear' ) {

			return [ {
				claim    : 'electrode_degraded',
				source   : 'continuity',
				strength : 0.6,
				// Deliberately a claim about the hardware. Everything downstream of a
				// degraded electrode is suspect, and that is worth knowing loudly.
				detail   : a.suspect ? `drift confined to ${a.suspect.join( ', ' )}` : 'sites drifting independently',
			} ]

		}

		return []

	}

	/**
	 * Deliberately re-anchor, accepting the current state as the new normal.
	 *
	 * For after a repot, a move, or an electrode replacement — moments when the
	 * old anchor genuinely stops being the right reference.
	 *
	 * @param   {string} reason - Why. Recorded, because an unexplained re-anchor
	 *                            is how drift gets erased by accident.
	 * @param   {string} [id]   - Site, or every site.
	 * @returns {object}        What was re-anchored.
	 */
	reanchor( reason, id ) {

		if ( !reason ) throw new Error( 'Re-anchoring erases the drift record, so it needs a stated reason.' )

		const ids = id ? [ id ] : [ ...this.sites.keys() ]
		const done = []

		for ( const site of ids ) {

			const s = this.sites.get( site )
			if ( !s?.history.length ) continue

			const window = s.history.slice( -Math.max( this.recent, 3 ) )
			s.anchor = medianOf( window.map( h => h.fingerprint ) )
			s.anchoredAt = window[ 0 ].at
			done.push( site )

		}

		return {
			reanchored : done,
			reason,
			at : new Date().toISOString(),
		}

	}

	/** Everything, readable. */
	report() {

		const attribution = this.attribute()

		return {
			sites : [ ...this.sites.keys() ],
			drift : attribution.perSite,
			attribution,
			verdict : attribution.why,
		}

	}

}

/** Median across fingerprints, reused from the electrome module's shape. */
function medianOf( fingerprints ) {

	const valid = fingerprints.filter( Boolean )
	if ( !valid.length ) return null
	if ( valid.length === 1 ) return valid[ 0 ]

	const median = xs => {

		const s = [ ...xs ].sort( ( a, b ) => a - b )
		const m = Math.floor( s.length / 2 )
		return s.length % 2 ? s[ m ] : ( s[ m - 1 ] + s[ m ] ) / 2

	}

	const out = { ...valid[ 0 ] }

	for ( const key of [ 'complexity', 'entropy', 'variability' ] ) {

		const xs = valid.map( f => f[ key ] ).filter( Number.isFinite )
		if ( xs.length ) out[ key ] = Number( median( xs ).toFixed( 5 ) )

	}

	if ( valid[ 0 ].bands ) {

		out.bands = {}
		for ( const band of Object.keys( valid[ 0 ].bands ) ) {

			const xs = valid.map( f => f.bands?.[ band ] ).filter( Number.isFinite )
			if ( xs.length ) out.bands[ band ] = Number( median( xs ).toFixed( 5 ) )

		}

	}

	return out

}

/**
 * Do these sites agree about which way things moved?
 *
 * 1 is "same axes, same direction everywhere". 0 is "no shared story".
 */
function axisAgreement( deltas ) {

	if ( deltas.length < 2 ) return 0

	const directions = deltas.map( d => new Map( ( d || [] ).map( a => [ a.axis, a.direction ] ) ) )
	const axes = new Set( directions.flatMap( m => [ ...m.keys() ] ) )

	if ( !axes.size ) return 0

	let agreed = 0, compared = 0

	for ( const axis of axes ) {

		const votes = directions.map( m => m.get( axis ) ).filter( Boolean )
		if ( votes.length < 2 ) continue

		compared++
		if ( votes.every( v => v === votes[ 0 ] ) ) agreed++

	}

	return compared ? agreed / compared : 0

}

export { axisAgreement, medianOf as medianFingerprintOf }
