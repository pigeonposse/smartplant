/**
 * Has the plant changed how it answers?
 *
 * Everything else here measures state: what the plant is doing now, how far that
 * is from normal, whether it is drifting. This measures something else — whether
 * the *same* stimulus now produces a *different* response than it used to.
 *
 * That is stress memory, or priming: a plant that has been through a drought
 * often shuts its stomata faster the next time the soil dries, and one that has
 * been shaded reaches differently for light afterwards. The response function
 * itself changes with history. It is one of the genuinely interesting things
 * about living with a plant for a year rather than a week.
 *
 * ## What this is not
 *
 * It is tempting to call this an epigenetic readout. It is not, and the label
 * would be a straightforward overclaim: nothing here touches methylation,
 * chromatin, or any molecular mechanism, and no electrode can infer them. What
 * is measured is behavioural and electrical — the plant's reaction to a known
 * stimulus, before and after. That is real, it is measurable with the hardware
 * this library already supports, and it stands perfectly well under its own name.
 *
 * ## The confounds, which are the whole difficulty
 *
 * A response measured in March and again in September differs for reasons that
 * have nothing to do with memory. The plant is bigger. The days are a different
 * length. The second watering happened in warmer air. Any of these produces a
 * changed response, and attributing it to priming would be wrong.
 *
 * So occurrences are only compared when they started from **comparable
 * conditions**, using the same coarse context banding the migration layer uses
 * to decide whether two situations are the same situation. Unmatched pairs are
 * reported as unmatched rather than quietly averaged in. Where a confound cannot
 * be excluded — and plant age never can be, from readings alone — it is named.
 */

import { contextSignature } from '../migration/transferability.js'

/**
 * The trajectory of one metric in the window after a stimulus.
 *
 * @param   {object[]} readings   - `{t, ...metrics}` rows, oldest first.
 * @param   {number}   at         - Stimulus time, ms.
 * @param   {object}   [opts]     - Options.
 * @param   {string}   [opts.metric]     - Which metric. Default `'soil'`.
 * @param   {number}   [opts.windowHours]- How long a response lasts. Default 24.
 * @param   {number}   [opts.baselineHours] - Window before, for the starting point. Default 6.
 * @returns {object|null}         `{amplitude, latencyHours, from, to, context}`.
 */
export function responseProfile( readings, at, opts = {} ) {

	const metric = opts.metric || 'soil'
	const windowMs = ( opts.windowHours ?? 24 ) * 3600_000
	const baseMs   = ( opts.baselineHours ?? 6 ) * 3600_000

	const rows = readings
		// Spread first: putting it after would let the row's own ISO `t` overwrite
		// the numeric one and every window comparison would silently match nothing.
		.map( r => ( {
			...r,
			t : new Date( r.t ).getTime(),
		} ) )
		.filter( r => Number.isFinite( r[ metric ] ) )

	const before = rows.filter( r => r.t >= at - baseMs && r.t <= at )
	const after  = rows.filter( r => r.t > at && r.t <= at + windowMs )

	// Without a starting point there is nothing to measure a change from, and
	// without the window afterwards there is no response to measure.
	if ( before.length < 2 || after.length < 3 ) return null

	const from = before.reduce( ( a, r ) => a + r[ metric ], 0 ) / before.length

	// The extreme reached, and how long it took to get there — amplitude alone
	// would miss a response that is the same size but arrives twice as fast,
	// which is exactly the kind of change priming produces.
	let peak = after[ 0 ], peakDev = Math.abs( after[ 0 ][ metric ] - from )

	for ( const r of after ) {

		const dev = Math.abs( r[ metric ] - from )
		if ( dev > peakDev ) {

			peakDev = dev
			peak = r

		}

	}

	return {
		at           : new Date( at ).toISOString(),
		metric,
		from         : Number( from.toFixed( 3 ) ),
		to           : Number( peak[ metric ].toFixed( 3 ) ),
		amplitude    : Number( ( peak[ metric ] - from ).toFixed( 3 ) ),
		latencyHours : Number( ( ( peak.t - at ) / 3600_000 ).toFixed( 2 ) ),
		samples      : after.length,
		// The conditions it started from, for matching like with like later.
		context      : {
			temperature : before.at( -1 ).temperature,
			humidity    : before.at( -1 ).humidity,
			soil        : before.at( -1 ).soil,
			light       : before.at( -1 ).light,
		},
	}

}

/**
 * Every response to a given kind of stimulus, in order.
 *
 * @param   {object[]} readings - Reading rows.
 * @param   {object[]} events   - Care-log events, `{t, type}`.
 * @param   {string}   type     - Event type, e.g. `'water'`.
 * @param   {object}   [opts]   - Passed to `responseProfile`.
 * @returns {object[]}          Profiles, oldest first.
 */
export function responseHistory( readings, events, type, opts = {} ) {

	return ( events || [] )
		.filter( e => e.type === type )
		.map( e => responseProfile( readings, new Date( e.t ).getTime(), opts ) )
		.filter( Boolean )
		.sort( ( a, b ) => new Date( a.at ) - new Date( b.at ) )

}

/** Mean and spread, for comparing two eras. */
function stats( xs ) {

	const n = xs.length
	if ( !n ) return null
	const mean = xs.reduce( ( a, b ) => a + b, 0 ) / n
	const sd = Math.sqrt( xs.reduce( ( a, x ) => a + ( x - mean ) ** 2, 0 ) / n )
	return {
		n,
		mean : Number( mean.toFixed( 3 ) ),
		sd : Number( sd.toFixed( 3 ) ),
	}

}

/**
 * Did the response change after a given moment?
 *
 * @param   {object[]} history      - From `responseHistory`.
 * @param   {number|string} episode - The dividing event.
 * @param   {object}   [opts]       - Options.
 * @param   {number}   [opts.minPerEra] - Occurrences needed each side. Default 3.
 * @param   {boolean}  [opts.matchContext] - Compare only comparable starts. Default true.
 * @returns {object}                The verdict.
 */
export function hysteresis( history, episode, opts = {} ) {

	if ( !Array.isArray( history ) || !history.length ) {

		return {
			known : false,
			reason : 'No recorded responses to compare. Build one with `responseHistory( readings, events, type )` first.',
		}

	}

	const minPerEra = opts.minPerEra ?? 3
	const matchContext = opts.matchContext !== false
	const cut = new Date( episode ).getTime()

	let before = history.filter( h => new Date( h.at ).getTime() < cut )
	let after  = history.filter( h => new Date( h.at ).getTime() >= cut )

	const rawCounts = {
		before : before.length,
		after : after.length,
	}
	let matched = null

	if ( matchContext ) {

		// Only compare occurrences that started from the same kind of situation.
		// A watering into warm dry air and one into cool damp air produce different
		// responses for reasons that are not memory, and averaging them together
		// manufactures hysteresis out of the weather.
		const sigsAfter = new Set( after.map( h => contextSignature( h.context ) ).filter( Boolean ) )
		const sigsBefore = new Set( before.map( h => contextSignature( h.context ) ).filter( Boolean ) )
		const shared = [ ...sigsAfter ].filter( s => sigsBefore.has( s ) )

		if ( shared.length ) {

			const keep = new Set( shared )
			before = before.filter( h => keep.has( contextSignature( h.context ) ) )
			after  = after.filter( h => keep.has( contextSignature( h.context ) ) )
			matched = {
				situations : shared.length,
				before : before.length,
				after : after.length,
			}

		}
		else {

			return {
				known : false,
				rawCounts,
				reason : 'The stimulus never recurred under comparable conditions after the episode, so any difference in response could just as easily be the difference in conditions. Nothing can be concluded.',
			}

		}

	}

	if ( before.length < minPerEra || after.length < minPerEra ) {

		return {
			known : false,
			rawCounts,
			matched,
			reason : `Need ${minPerEra} comparable occurrences either side; have ${before.length} before and ${after.length} after.`,
		}

	}

	const amp = {
		before : stats( before.map( h => h.amplitude ) ),
		after : stats( after.map( h => h.amplitude ) ),
	}
	const lat = {
		before : stats( before.map( h => h.latencyHours ) ),
		after : stats( after.map( h => h.latencyHours ) ),
	}

	// Pooled spread, so a shift only counts when it is large next to the natural
	// variation between occurrences rather than large in absolute terms.
	const pooled = ( a, b ) => Math.sqrt( ( a.sd ** 2 + b.sd ** 2 ) / 2 ) || 1e-9
	const ampShift = ( amp.after.mean - amp.before.mean ) / pooled( amp.before, amp.after )
	const latShift = ( lat.after.mean - lat.before.mean ) / pooled( lat.before, lat.after )

	const changed = Math.abs( ampShift ) > 1 || Math.abs( latShift ) > 1

	return {
		known    : true,
		changed,
		rawCounts,
		matched,
		amplitude: {
			...amp,
			shift : Number( ampShift.toFixed( 2 ) ),
		},
		latency  : {
			...lat,
			shift : Number( latShift.toFixed( 2 ) ),
		},
		direction: changed ? describeDirection( ampShift, latShift ) : 'unchanged',
		verdict  : verdictFor( changed, ampShift, latShift, amp, lat, matched ),
		// Named because it cannot be excluded from readings alone, and it is the
		// most likely alternative explanation for any change found here.
		caveat   : 'A plant is older and larger at the second measurement than the first. Growth changes the response too, and no reading in this record can separate that from memory.',
	}

}

function describeDirection( ampShift, latShift ) {

	const parts = []
	if ( ampShift > 1 ) parts.push( 'stronger' )
	if ( ampShift < -1 ) parts.push( 'weaker' )
	if ( latShift > 1 ) parts.push( 'slower' )
	if ( latShift < -1 ) parts.push( 'faster' )
	return parts.join( ' and ' ) || 'unchanged'

}

function verdictFor( changed, ampShift, latShift, amp, lat, matched ) {

	const where = matched
		? `across ${matched.situations} comparable starting situation(s)`
		: 'without matching starting conditions'

	if ( !changed ) {

		return `The response is the same as before (amplitude ${amp.before.mean} → ${amp.after.mean}, latency ${lat.before.mean}h → ${lat.after.mean}h), ${where}. No hysteresis.`

	}

	const bits = []
	if ( Math.abs( ampShift ) > 1 ) bits.push( `amplitude moved ${amp.before.mean} → ${amp.after.mean}` )
	if ( Math.abs( latShift ) > 1 ) bits.push( `it now peaks in ${lat.after.mean}h rather than ${lat.before.mean}h` )

	return `The plant answers the same stimulus differently since the episode: ${bits.join( ', ' )}, ${where}. This is a change in the response itself, not in the conditions it was measured under.`

}

/**
 * Cues for the evidence ledger.
 *
 * A changed response function is a fact about the plant's history, and a strong
 * hint that thresholds tuned before the episode no longer fit.
 *
 * @param   {object}   result   - From `hysteresis`.
 * @param   {string}   stimulus - What it was a response to.
 * @returns {object[]}          Cues.
 */
export function hysteresisCues( result, stimulus = 'stimulus' ) {

	if ( !result?.known || !result.changed ) return []

	return [ {
		claim    : 'response_changed',
		source   : 'hysteresis',
		// Capped: this is a real signal but it rests on few occurrences and one
		// confound that cannot be excluded.
		strength : 0.45,
		detail   : `response to ${stimulus} is now ${result.direction} than before the episode`,
	} ]

}
