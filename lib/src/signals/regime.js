/**
 * Regime change, collective state, and the one inference worth two modalities.
 *
 * Three related things, all resting on the same observation from the electrome
 * literature: the *character* of a plant's electrical activity shifts before
 * anything is visible on the leaf. Not its amplitude — its character. Complexity
 * falls, entropy narrows, power moves between bands. A plant that is failing
 * looks different in kind, not merely in degree, and it does so early.
 *
 * The temptation with that finding is to promise lead time — "detects drought
 * three days before wilting". Nobody can promise that here. The published lead
 * times come from plants stressed deliberately, in known ways, under
 * instrumentation nobody has at home, and they vary by species, by stressor and
 * by individual. What this reports is that the regime changed and when. Whether
 * it precedes anything in *your* plant is something only your plant can
 * eventually tell you.
 */

import { fingerprintDistance } from './electrome.js'

// ── regime change ───────────────────────────────────────────────────────────

/**
 * Detect that the electrical regime has shifted, and when.
 *
 * Distinct from `ElectromeBaseline`'s shift detection, which asks whether the
 * latest window departs from recent normal. This asks the sharper question:
 * is there a **point in the record** on either side of which the plant behaves
 * like two different systems?
 *
 * @param   {object[]} history      - Fingerprints, oldest first, `{at, fingerprint}`.
 * @param   {object}   [opts]       - Options.
 * @param   {number}   [opts.minEra]- Samples each side of a candidate. Default 5.
 * @param   {number}   [opts.minSeparation] - Between-era distance to call it. Default 0.12.
 * @returns {object}                `{changed, at, index, separation, why}`.
 */
export function regimeChange( history, opts = {} ) {

	const minEra = opts.minEra ?? 5
	const minSeparation = opts.minSeparation ?? 0.12
	const rows = ( history || [] ).filter( h => h?.fingerprint )

	if ( rows.length < minEra * 2 ) {

		return {
			changed : false,
			known   : false,
			why : `Need at least ${minEra * 2} windows to look for a change point; have ${rows.length}.`,
		}

	}

	let best = null

	// Every admissible split, scored by how unlike each other the two eras are
	// relative to how varied they are inside themselves. A boundary only counts
	// when it separates more than the noise within each side.
	for ( let cut = minEra; cut <= rows.length - minEra; cut++ ) {

		const before = rows.slice( 0, cut ).map( r => r.fingerprint )
		const after  = rows.slice( cut ).map( r => r.fingerprint )

		const between = meanDistance( before, after )
		const within = ( meanPairwise( before ) + meanPairwise( after ) ) / 2
		const separation = between - within

		if ( !best || separation > best.separation ) {

			best = {
				cut,
				between,
				within,
				separation,
			}

		}

	}

	const changed = best.separation >= minSeparation

	return {
		known      : true,
		changed,
		at         : changed ? rows[ best.cut ].at : null,
		index      : changed ? best.cut : null,
		separation : Number( best.separation.toFixed( 4 ) ),
		between    : Number( best.between.toFixed( 4 ) ),
		within     : Number( best.within.toFixed( 4 ) ),
		why : changed
			? `The record splits at ${rows[ best.cut ].at}: the windows on either side differ from each other (${best.between.toFixed( 3 )}) by more than they vary within themselves (${best.within.toFixed( 3 )}). The plant is behaving like a different system than it was. What that precedes, only this plant's own history can eventually say.`
			: `No split in this record separates the windows by more than they already vary among themselves (best ${best.separation.toFixed( 3 )}, needs ${minSeparation}). The regime is unchanged.`,
	}

}

function meanPairwise( fps ) {

	if ( fps.length < 2 ) return 0
	let sum = 0, n = 0

	for ( let i = 0; i < fps.length; i++ ) {

		for ( let j = i + 1; j < fps.length; j++ ) {

			sum += fingerprintDistance( fps[ i ], fps[ j ] )
			n++

		}

	}

	return n ? sum / n : 0

}

function meanDistance( a, b ) {

	let sum = 0, n = 0

	for ( const x of a ) {

		for ( const y of b ) {

			sum += fingerprintDistance( x, y )
			n++

		}

	}

	return n ? sum / n : 0

}

/**
 * Cues for the evidence ledger.
 *
 * @param   {object}   change - From `regimeChange`.
 * @returns {object[]}        Cues.
 */
export function regimeCues( change ) {

	if ( !change?.changed ) return []

	return [ {
		claim    : 'regime_change',
		source   : 'regime',
		strength : Math.min( 0.6, 0.3 + change.separation ),
		detail   : `electrical regime changed at ${change.at} (separation ${change.separation})`,
	} ]

}

// ── collective state ────────────────────────────────────────────────────────

/**
 * One signature for a whole colony.
 *
 * Worth being precise about what this is for. A colony-level state is *not*
 * evidence that the plants are influencing each other — they share a window, a
 * radiator and a watering can, and that explains almost every correlation you
 * will ever see between them. Reading coordinated change as communication is the
 * single easiest mistake to make here, and it is unfalsifiable without a sensor
 * for whatever the supposed channel is.
 *
 * What it *is* good for is the opposite inference, and that one is sound:
 * several independent plants shifting at once is strong evidence of a **shared
 * environmental event**, detected more sensitively than any of them alone could
 * manage. One plant changing is a plant. Every plant changing is the room.
 *
 * @param   {object[]} members - `{id, fingerprint}` per plant.
 * @param   {object}   [opts]  - `{ tightness }`, distance below which they agree.
 * @returns {object}           `{known, coherence, outliers, verdict}`.
 */
export function collectiveState( members, opts = {} ) {

	const tightness = opts.tightness ?? 0.15
	const valid = ( members || [] ).filter( m => m?.fingerprint )

	if ( valid.length < 2 ) {

		return {
			known : false,
			why : `A collective state needs at least two plants; have ${valid.length}.`,
		}

	}

	// Distance from each member to the group, so an outlier is visible as an
	// outlier rather than dragging the summary toward itself.
	const distances = valid.map( m => ( {
		id : m.id,
		distance : Number( ( meanDistance( [ m.fingerprint ], valid.filter( o => o !== m ).map( o => o.fingerprint ) ) ).toFixed( 4 ) ),
	} ) )

	const mean = distances.reduce( ( a, d ) => a + d.distance, 0 ) / distances.length
	const outliers = distances.filter( d => d.distance > tightness * 2 )

	return {
		known     : true,
		members   : valid.length,
		coherence : Number( Math.max( 0, 1 - mean / 0.3 ).toFixed( 3 ) ),
		spread    : Number( mean.toFixed( 4 ) ),
		distances,
		outliers  : outliers.map( o => o.id ),
		verdict : outliers.length
			? `${valid.length} plants, of which ${outliers.map( o => `"${o.id}"` ).join( ', ' )} sits apart from the rest. A single plant differing from its neighbours is about that plant — its pot, its contact, its position — not about the room.`
			: mean < tightness
				? `All ${valid.length} plants share an electrical state (coherence ${( 1 - mean / 0.3 ).toFixed( 2 )}). Independent plants agreeing points at something they have in common: the room, not each other.`
				: `The ${valid.length} plants are in no shared state (spread ${mean.toFixed( 3 )}). Each is doing its own thing.`,
	}

}

/**
 * Did the whole colony move at once?
 *
 * @param   {object[]} before - `{id, fingerprint}` before.
 * @param   {object[]} after  - `{id, fingerprint}` after.
 * @param   {object}   [opts] - `{ minShift, minFraction }`.
 * @returns {object}          `{shared, moved, verdict}`.
 */
export function collectiveShift( before, after, opts = {} ) {

	const minShift = opts.minShift ?? 0.12
	const minFraction = opts.minFraction ?? 0.75

	const byId = new Map( ( before || [] ).map( m => [ m.id, m.fingerprint ] ) )
	const pairs = ( after || [] )
		.filter( m => byId.has( m.id ) )
		.map( m => ( {
			id : m.id,
			shift : Number( fingerprintDistance( byId.get( m.id ), m.fingerprint ).toFixed( 4 ) ),
		} ) )

	if ( pairs.length < 2 ) {

		return {
			shared : false,
			known : false,
			why : 'Need the same two or more plants measured at both moments.',
		}

	}

	const moved = pairs.filter( p => p.shift >= minShift )
	const fraction = moved.length / pairs.length

	return {
		known    : true,
		shared   : fraction >= minFraction,
		moved    : moved.map( m => m.id ),
		fraction : Number( fraction.toFixed( 2 ) ),
		pairs,
		verdict : fraction >= minFraction
			? `${moved.length} of ${pairs.length} plants changed state together. Separate pots, separate electrodes, one event — this is the room, and it is detected earlier than any single plant would have managed.`
			: moved.length
				? `Only ${moved.length} of ${pairs.length} plants changed. Whatever happened, happened to ${moved.length === 1 ? 'that one' : 'those'} and not to the room.`
				: `No plant changed state.`,
	}

}

// ── early infection ─────────────────────────────────────────────────────────

/**
 * Two independent signs of a plant going wrong before it looks wrong.
 *
 * This is the one multi-modal inference in the library that genuinely earns the
 * word corroboration. A drop in electrical complexity and the first yellowing
 * seen by a camera do not share a failure mode: a bad electrode does not cause
 * chlorosis, and a white-balance error does not lower entropy. When both move
 * together they really are two witnesses.
 *
 * It reports. It does not act. Isolation and treatment are physical, expensive
 * to get wrong, and belong behind the evidence ledger's risk gates like anything
 * else — an automatic quarantine on a false positive is a worse outcome than a
 * late true one.
 *
 * @param   {object} signals          - What is known.
 * @param   {object} [signals.regime] - From `regimeChange`.
 * @param   {object} [signals.drift]  - From `ContinuityTracker.attribute()`.
 * @param   {object} [signals.vision] - Vision findings, `{chlorosis, spots, wilting}`.
 * @returns {object}                  `{suspected, corroborated, sources, why}`.
 */
export function infectionWatch( signals = {} ) {

	const sources = []
	const missing = []

	const electrical = signals.regime?.changed
		|| ( signals.drift?.cause === 'physiology' && signals.drift?.drifting )

	if ( electrical ) sources.push( 'electrical' )
	else if ( !signals.regime && !signals.drift ) missing.push( 'electrical' )

	const visual = Boolean( signals.vision?.chlorosis || signals.vision?.spots )
	if ( visual ) sources.push( 'visual' )
	else if ( !signals.vision ) missing.push( 'visual' )

	// A single-site electrical change is exactly what a failing electrode looks
	// like, so it cannot stand alone as evidence of anything biological.
	if ( signals.drift?.cause === 'electrode' ) {

		return {
			suspected    : false,
			corroborated : false,
			sources,
			why : 'The electrical change is confined to one electrode, which makes it the contact rather than the plant. Fix the electrode before reading anything into it.',
		}

	}

	const corroborated = sources.length >= 2

	return {
		suspected    : sources.length > 0,
		corroborated,
		sources,
		missing,
		// Deliberately capped below the threshold a high-risk action needs. This
		// is a reason to look, never a reason to act on its own.
		cues : corroborated
			? [ {
				claim    : 'possible_infection',
				source   : 'infection-watch',
				strength : 0.55,
				detail   : `electrical regime change and visible change agree — two modalities with no shared failure mode`,
			} ]
			: [],
		why : corroborated
			? 'Both the electrical regime and the plant\'s appearance changed. These two do not fail together — a bad contact causes no yellowing and a white-balance error lowers no entropy — so this is worth a close look. It is not, on its own, grounds for isolating or treating anything.'
			: sources.length
				? `Only the ${sources[ 0 ]} channel shows anything${missing.length ? `, and there is no ${missing.join( ' or ' )} channel to check it against` : ''}. One modality is a reason to watch, not a finding.`
				: 'Nothing in either channel suggests a problem.',
	}

}
