/**
 * The health of the instrument, as distinct from the health of the plant.
 *
 * Every conclusion this library reaches rests on hardware that degrades. An
 * electrode forms a callus, a soil probe corrodes, a DHT sensor latches onto one
 * value and repeats it forever, a serial link drops and nobody notices because
 * the merged reading still comes back with numbers in it.
 *
 * The failure that matters is not the loud one. A driver that throws gets caught
 * and reported. The dangerous case is a component that keeps answering while
 * being wrong: a stuck humidity sensor reads 55% all week, the plant looks
 * stable, the VPD calculation is confident, and every layer downstream reasons
 * beautifully about a number that stopped being a measurement days ago.
 *
 * So this checks the instrument, and it never quietly discards anything. A
 * component judged unreliable is *marked* unreliable — its evidence weight drops
 * and the reason is stated — because silently dropping a sensor is its own way
 * of being wrong without saying so.
 */

/** What a component can be. */
export const CONDITION = {
	OK        : 'ok',
	SUSPECT   : 'suspect',
	DEGRADED  : 'degraded',
	FAILED    : 'failed',
	UNKNOWN   : 'unknown',
}

/** Ranges outside which a reading is not a measurement of anything. */
export const PLAUSIBLE = {
	temperature  : [ -40, 70 ],
	humidity     : [ 0, 100 ],
	soil         : [ 0, 100 ],
	light        : [ 0, 200_000 ],
	ph           : [ 0, 14 ],
	conductivity : [ 0, 20_000 ],
}

const worst = conditions => {

	const order = [ CONDITION.FAILED, CONDITION.DEGRADED, CONDITION.SUSPECT, CONDITION.OK, CONDITION.UNKNOWN ]
	return order.find( c => conditions.includes( c ) ) || CONDITION.UNKNOWN

}

/**
 * Is a sensor repeating itself?
 *
 * A stuck sensor and a very stable room look almost identical, and the
 * difference is precision. Real measurement carries noise in its last digit even
 * when the world is not moving; a latched sensor returns a value that is
 * *exactly* equal, reading after reading.
 *
 * @param   {number[]} values     - Recent values, newest last.
 * @param   {object}   [opts]     - `{ minRepeats }`.
 * @returns {object}              `{stuck, at, repeats}`.
 */
export function stuckReading( values, opts = {} ) {

	const minRepeats = opts.minRepeats ?? 12
	// A caller who passes an object, or nothing, has not given us readings. That
	// is not the same as a sensor being fine, so it must not read as "not stuck".
	const usable = ( Array.isArray( values ) ? values : [] ).filter( Number.isFinite )

	if ( usable.length < minRepeats ) {

		return {
			stuck : false,
			repeats : usable.length,
			why : `Only ${usable.length} readings; ${minRepeats} identical ones are needed before calling a sensor stuck.`,
		}

	}

	const last = usable.at( -1 )
	let repeats = 1

	for ( let i = usable.length - 2; i >= 0; i-- ) {

		// Exact equality on purpose. A stable room still moves the last decimal.
		if ( usable[ i ] !== last ) break
		repeats++

	}

	return {
		stuck : repeats >= minRepeats,
		repeats,
		at : last,
		why : repeats >= minRepeats
			? `The last ${repeats} readings are all exactly ${last}. A real measurement moves in its last digit even in a still room; this sensor has latched.`
			: `Varying normally (${repeats} identical of the last ${usable.length}).`,
	}

}

/** Readings that no sensor could truthfully produce. */
export function implausible( readings, metric ) {

	const range = PLAUSIBLE[ metric ]
	if ( !range ) return {
		found : false,
	}

	const bad = ( readings || [] )
		.map( r => r[ metric ] )
		.filter( v => Number.isFinite( v ) && ( v < range[ 0 ] || v > range[ 1 ] ) )

	return {
		found : bad.length > 0,
		count : bad.length,
		examples : bad.slice( 0, 3 ),
		why : bad.length
			? `${bad.length} reading(s) outside what ${metric} can physically be (${range[ 0 ]}–${range[ 1 ]}), e.g. ${bad.slice( 0, 3 ).join( ', ' )}. The sensor is not measuring.`
			: null,
	}

}

/**
 * Electrode signal quality.
 *
 * @param   {number[]} samples    - Recent raw window.
 * @param   {number}   sampleRate - Hz.
 * @param   {object}   [opts]     - `{ mainsHz }`.
 * @returns {object}              `{condition, snr, mains, flat, why}`.
 */
export function electrodeQuality( samples, sampleRate, opts = {} ) {

	const mainsHz = opts.mainsHz ?? 50

	if ( !samples?.length || samples.length < 64 ) {

		return {
			condition : CONDITION.UNKNOWN,
			why : `Only ${samples?.length ?? 0} samples; not enough to judge signal quality.`,
		}

	}

	// Mains at or above Nyquist cannot be seen, let alone filtered: at exactly
	// twice the sample rate a sine collapses to a constant, and just under it
	// folds down into the physiological band wearing a plausible frequency. The
	// notch cannot help, and neither can anything downstream.
	if ( mainsHz > 0 && sampleRate <= mainsHz * 2 ) {

		return {
			condition : CONDITION.DEGRADED,
			aliased : true,
			why : `Sampling at ${sampleRate}Hz cannot represent ${mainsHz}Hz mains — it needs more than ${mainsHz * 2}Hz. The hum is not filtered out, it is folded down into the range where plant signals live, wearing a frequency that looks physiological. Raise the sample rate or the readings below are not what they appear to be.`,
		}

	}

	const mean = samples.reduce( ( a, b ) => a + b, 0 ) / samples.length
	const variance = samples.reduce( ( a, v ) => a + ( v - mean ) ** 2, 0 ) / samples.length
	const sd = Math.sqrt( variance )

	// A flat trace is not a calm plant. Living tissue is never electrically
	// silent, so silence means the electrode is not connected to any.
	if ( sd < 0.01 ) {

		return {
			condition : CONDITION.FAILED,
			sd : Number( sd.toFixed( 5 ) ),
			flat : true,
			why : `The trace is flat (spread ${sd.toFixed( 5 )}mV). Living tissue is never electrically silent — this electrode is not in contact with a plant.`,
		}

	}

	const issues = []
	let condition = CONDITION.OK

	if ( mainsHz > 0 ) {

		const power = bandPowerAt( samples, sampleRate, mainsHz )
		const total = variance || 1e-12
		const share = power / total

		if ( share > 0.3 ) {

			condition = CONDITION.DEGRADED
			issues.push( `${Math.round( share * 100 )}% of the signal power sits at ${mainsHz}Hz even after filtering — a grounding or shielding problem, not the plant.` )

		}
		else if ( share > 0.1 ) {

			condition = CONDITION.SUSPECT
			issues.push( `mains hum is ${Math.round( share * 100 )}% of signal power` )

		}

	}

	// Saturation: an amplifier pinned at its rail reports a number without
	// measuring anything.
	const extremes = samples.filter( v => Math.abs( v ) > 4000 ).length
	if ( extremes > samples.length * 0.02 ) {

		condition = CONDITION.DEGRADED
		issues.push( `${extremes} samples are at the amplifier's limit — the input is saturating and those readings mean nothing.` )

	}

	return {
		condition,
		sd : Number( sd.toFixed( 4 ) ),
		flat : false,
		issues,
		why : issues.length ? issues.join( ' ' ) : `Signal looks healthy (spread ${sd.toFixed( 3 )}mV).`,
	}

}

/** Power at one frequency, by direct projection — cheaper than a full FFT here. */
function bandPowerAt( samples, sampleRate, hz ) {

	const n = samples.length
	const mean = samples.reduce( ( a, b ) => a + b, 0 ) / n
	let re = 0, im = 0

	for ( let i = 0; i < n; i++ ) {

		const w = ( 2 * Math.PI * hz * i ) / sampleRate
		re += ( samples[ i ] - mean ) * Math.cos( w )
		im += ( samples[ i ] - mean ) * Math.sin( w )

	}

	return ( ( re / n ) ** 2 + ( im / n ) ** 2 ) * 2

}

/**
 * A full technical inspection of one plant's instrument.
 *
 * @param   {object} plant  - A `SmartPlant`.
 * @param   {object} [opts] - Options.
 * @returns {Promise<object>} `{condition, components, actions, verdict}`.
 */
export async function inspect( plant, opts = {} ) {

	const components = []

	// ── environmental sensors ────────────────────────────────────────────────

	// By count, not by hours. "The last twelve readings are identical" means the
	// same thing whether they took a day or a fortnight, and a time window silently
	// disables the check at any realistic sampling interval: a plant read every six
	// hours has four readings in a day, which is fewer than it takes to accuse a
	// sensor of anything.
	const rows = plant.memory.recent( opts.samples ?? 200 )

	for ( const driver of plant._drivers || [] ) {

		const id = driver.id || driver.constructor?.name || 'sensor'
		const health = driver.health || {
			reads : 0,
			failures : 0,
			consecutiveFailures : 0,
		}
		const issues = []
		let condition = CONDITION.OK

		if ( !driver.connected ) {

			condition = CONDITION.FAILED
			issues.push( 'transport is disconnected' )

		}

		if ( health.consecutiveFailures >= 3 ) {

			condition = CONDITION.FAILED
			issues.push( `${health.consecutiveFailures} reads in a row have failed: ${health.lastError}` )

		}
		else if ( health.reads > 10 && health.failures / health.reads > 0.2 ) {

			condition = worst( [ condition, CONDITION.DEGRADED ] )
			issues.push( `${Math.round( ( health.failures / health.reads ) * 100 )}% of reads fail` )

		}

		for ( const metric of driver.provides || [] ) {

			const values = rows.map( r => r[ metric ] ).filter( Number.isFinite )
			if ( !values.length ) continue

			const stuck = stuckReading( values, opts )
			if ( stuck.stuck ) {

				condition = worst( [ condition, CONDITION.DEGRADED ] )
				issues.push( `${metric}: ${stuck.why}` )

			}

			const bad = implausible( rows, metric )
			if ( bad.found ) {

				condition = worst( [ condition, CONDITION.FAILED ] )
				issues.push( `${metric}: ${bad.why}` )

			}

		}

		components.push( {
			component : id,
			kind      : 'sensor',
			condition,
			health,
			issues,
			why : issues.length ? issues.join( '; ' ) : 'Reading normally.',
		} )

	}

	// ── electrode ────────────────────────────────────────────────────────────

	const electrode = plant.sensors?.peek?.( 'electrode' )

	if ( electrode ) {

		const quality = electrodeQuality( electrode.window( 60 ), electrode.sampleRate, { mainsHz : electrode.mainsHz } )
		const issues = quality.issues ? [ ...quality.issues ] : []
		let condition = quality.condition

		// Continuity already knows how to tell a tiring contact from a changing
		// plant. Reuse that verdict rather than inventing a second opinion.
		const attribution = plant.continuity?.attribute?.()

		if ( attribution?.cause === 'electrode' ) {

			condition = worst( [ condition, CONDITION.DEGRADED ] )
			issues.push( attribution.why )

		}
		else if ( attribution?.cause === 'unattributable' && attribution.drifting ) {

			condition = worst( [ condition, CONDITION.SUSPECT ] )
			issues.push( 'the signature is drifting and there is only one electrode, so this cannot be told apart from the plant changing' )

		}

		components.push( {
			component : 'electrode',
			kind      : 'electrode',
			condition,
			quality,
			issues,
			why : issues.length ? issues.join( '; ' ) : quality.why,
		} )

	}

	// ── memory ───────────────────────────────────────────────────────────────

	const readings = plant.memory.data.readings.length
	const memoryIssues = []
	let memoryCondition = CONDITION.OK

	if ( readings === 0 ) {

		memoryCondition = CONDITION.UNKNOWN
		memoryIssues.push( 'no readings stored yet' )

	}
	else {

		const outOfOrder = plant.memory.data.readings.some( ( r, i, a ) =>
			i > 0 && new Date( r.t ) < new Date( a[ i - 1 ].t ) )

		if ( outOfOrder ) {

			memoryCondition = CONDITION.DEGRADED
			// Every window, trend and rhythm in the library assumes chronology.
			memoryIssues.push( 'readings are not in chronological order, which breaks every window and trend computed from them' )

		}

	}

	components.push( {
		component : 'memory',
		kind      : 'storage',
		condition : memoryCondition,
		readings,
		events    : plant.memory.data.events.length,
		issues    : memoryIssues,
		why : memoryIssues.length ? memoryIssues.join( '; ' ) : `${readings} readings stored, in order.`,
	} )

	// ── colony ───────────────────────────────────────────────────────────────

	if ( plant.colony?.enabled !== false ) {

		const peers = await plant.colony.peers().catch( () => [] )
		const known = plant.colony.neighbours.size
		const issues = []
		let condition = CONDITION.OK

		if ( known > 0 && peers.length === 0 ) {

			condition = CONDITION.FAILED
			issues.push( `${known} neighbour(s) were known and none is reachable now` )

		}
		else if ( peers.length < known ) {

			condition = CONDITION.DEGRADED
			issues.push( `${known - peers.length} of ${known} known neighbours are unreachable` )

		}

		components.push( {
			component : 'colony',
			kind      : 'link',
			condition,
			peers : peers.length,
			known,
			issues,
			why : issues.length ? issues.join( '; ' ) : `${peers.length} neighbour(s) reachable.`,
		} )

	}

	// ── body ─────────────────────────────────────────────────────────────────

	if ( plant.body?.safety ) {

		const denials = plant.body.safety.recent?.().filter?.( r => !r.allowed )?.length ?? 0
		const issues = []

		if ( denials >= 5 ) {

			// Refusing once is the safety layer working. Refusing constantly means
			// something upstream keeps asking for things it should not.
			issues.push( `${denials} recent actions were refused by the safety limits — the layer above is repeatedly asking for something it cannot have` )

		}

		components.push( {
			component : 'body',
			kind      : 'actuator',
			condition : denials >= 5 ? CONDITION.SUSPECT : CONDITION.OK,
			denials,
			issues,
			why : issues.length ? issues.join( '; ' ) : 'No repeated safety refusals.',
		} )

	}

	const condition = worst( components.map( c => c.condition ) )
	const broken = components.filter( c => c.condition === CONDITION.FAILED || c.condition === CONDITION.DEGRADED )

	return {
		at : new Date().toISOString(),
		condition,
		components,
		// Concrete things a person can do, rather than a status word.
		actions : broken.flatMap( c => remediation( c ) ),
		// The evidence layer should trust a degraded component less. Returned
		// rather than applied, because silently reweighting is the kind of change
		// that should be visible.
		suggestedWeights : Object.fromEntries( broken.map( c => [ c.component, c.condition === CONDITION.FAILED ? 0 : 0.25 ] ) ),
		verdict : broken.length
			? `${broken.length} component(s) need attention: ${broken.map( c => `${c.component} (${c.condition})` ).join( ', ' )}.`
			: `All ${components.length} components are reading normally.`,
	}

}

/** What to actually do about a broken component. */
function remediation( c ) {

	if ( c.kind === 'electrode' ) {

		return [ c.quality?.flat
			? 'Check the electrode is physically in contact with the plant and the lead is seated.'
			: 'Clean or reseat the electrode; if it has been in place for months, the contact may have callused over and want moving.' ]

	}

	if ( c.kind === 'sensor' ) {

		return [ c.condition === CONDITION.FAILED
			? `Sensor "${c.component}" is not producing usable measurements. Check power and wiring before trusting anything derived from it.`
			: `Sensor "${c.component}" is unreliable; readings from it should be treated as suspect until it is checked.` ]

	}

	if ( c.kind === 'link' ) return [ 'Check the colony transport — neighbours that were reachable no longer are.' ]
	if ( c.kind === 'storage' ) return [ 'The stored history is inconsistent; consider archiving it and starting a fresh record.' ]

	return []

}

/**
 * Cues for the evidence ledger.
 *
 * Instrument faults are claims about the instrument. Filing them alongside
 * claims about the plant is what lets a conclusion be discounted when the thing
 * that produced it is broken.
 *
 * @param   {object}   report - From `inspect`.
 * @returns {object[]}        Cues.
 */
export function maintenanceCues( report ) {

	return ( report?.components || [] )
		.filter( c => c.condition === CONDITION.FAILED || c.condition === CONDITION.DEGRADED )
		.map( c => ( {
			claim    : 'instrument_unreliable',
			source   : 'maintenance',
			strength : c.condition === CONDITION.FAILED ? 0.8 : 0.5,
			detail   : `${c.component}: ${c.why}`,
		} ) )

}
