/**
 * PlantContext — turns memory into prompt.
 *
 * Every AI call in SmartPlant goes through this, so a plugin never hand-rolls a
 * prompt from raw numbers. The context is deliberately compact: models reason
 * better over a short, well-labelled brief than over a dump of 2000 readings.
 */

import { METRICS, METRIC_KEYS } from '../sensors/driver.js'

/** Comfort ranges used when no species profile has been generated yet. */
export const DEFAULT_RANGES = {
	temperature : {
		min : 18,
		max : 26,
	},
	humidity    : {
		min : 40,
		max : 65,
	},
	soil        : {
		min : 35,
		max : 70,
	},
	light       : {
		min : 200,
		max : 800,
	},
	ph          : {
		min : 5.5,
		max : 7,
	},
	conductivity: {
		min : 200,
		max : 1500,
	},
}

/**
 * Score one metric as a 0-100 comfort percentage.
 *
 * Unlike a plain min-max normalization, this peaks at the middle of the range
 * and falls off on *both* sides — being soaked is as wrong as being parched,
 * which the 1.x `calculatePercentage` treated as 100%.
 *
 * @param   {number} value - Measured value.
 * @param   {object} range - `{min, max}`.
 * @returns {number}       0-100.
 */
export function comfortScore( value, range ) {

	if ( !Number.isFinite( value ) || !range ) return 0
	const { min, max } = range
	if ( !Number.isFinite( min ) || !Number.isFinite( max ) || max <= min ) return 0

	if ( value >= min && value <= max ) return 100

	const span     = max - min
	const distance = value < min ? min - value : value - max
	// Score decays to 0 one full range-width outside the comfort band.
	return Math.max( 0, Math.round( ( 1 - distance / span ) * 100 ) )

}

/**
 * Vapour pressure deficit, in kPa.
 *
 * The number that actually drives transpiration, and the one that decides
 * whether an open stoma is comfortable or expensive. Two plants at 55% soil can
 * be in completely different situations at 0.6 kPa and at 2.4 kPa.
 *
 * Tetens equation for saturation vapour pressure.
 *
 * @param   {number} temperature - °C.
 * @param   {number} humidity    - Relative humidity, %.
 * @returns {number|null}        kPa, or null without both inputs.
 */
export function vaporPressureDeficit( temperature, humidity ) {

	if ( !Number.isFinite( temperature ) || !Number.isFinite( humidity ) ) return null

	const svp = 0.61078 * Math.exp( ( 17.27 * temperature ) / ( temperature + 237.3 ) )
	return Number( ( svp * ( 1 - humidity / 100 ) ).toFixed( 3 ) )

}

/**
 * Classify a VPD into the bands that change how a reading should be read.
 *
 * @param   {number} vpd - kPa.
 * @returns {string}     `'low'` | `'comfortable'` | `'high'` | `'severe'`.
 */
export function vpdBand( vpd ) {

	if ( !Number.isFinite( vpd ) ) return 'unknown'
	if ( vpd < 0.4 ) return 'low'
	if ( vpd <= 1.2 ) return 'comfortable'
	if ( vpd <= 2.0 ) return 'high'
	return 'severe'

}

/**
 * Overall wellbeing, 0-100, averaged over the metrics actually measured.
 *
 * @param   {object} reading - Sensor reading.
 * @param   {object} ranges  - Metric → `{min,max}`.
 * @returns {number}         0-100.
 */
export function happiness( reading, ranges = DEFAULT_RANGES ) {

	const scores = METRIC_KEYS
		.filter( k => Number.isFinite( reading?.[ k ] ) && ranges[ k ] )
		.map( k => comfortScore( reading[ k ], ranges[ k ] ) )

	if ( !scores.length ) return 0
	return Math.round( scores.reduce( ( a, b ) => a + b, 0 ) / scores.length )

}

/**
 * Which metrics are outside their comfort band, and in which direction.
 *
 * @param   {object}   reading - Sensor reading.
 * @param   {object}   ranges  - Metric → `{min,max}`.
 * @returns {object[]}         `{metric, value, direction, range, score}`.
 */
export function deviations( reading, ranges = DEFAULT_RANGES ) {

	const out = []
	for ( const key of METRIC_KEYS ) {

		const value = reading?.[ key ]
		const range = ranges[ key ]
		if ( !Number.isFinite( value ) || !range ) continue
		if ( value < range.min || value > range.max ) {

			out.push( {
				metric    : key,
				value,
				direction : value < range.min ? 'low' : 'high',
				range,
				score     : comfortScore( value, range ),
				unit      : METRICS[ key ]?.unit || '',
			} )

		}

	}
	return out.sort( ( a, b ) => a.score - b.score )

}

/**
 * Build the structured context object shared by every AI call.
 *
 * @param   {object} opts           - Options.
 * @param   {import('./store.js').PlantMemory} opts.memory - Memory.
 * @param   {object} [opts.reading] - Current reading (defaults to the last stored one).
 * @param   {object} [opts.ranges]  - Comfort ranges override.
 * @returns {object}                Context.
 */
export function buildContext( {
	memory, reading, ranges, archetype,
} ) {

	const effectiveRanges = ranges || memory?.profile?.ranges || DEFAULT_RANGES
	const current = reading || memory?.lastReading || {}
	const stats24 = memory?.stats?.( 24 ) || {}

	return {
		plant : {
			...memory?.plant,
			daysKnown : memory?.plant?.since
				? Math.floor( ( Date.now() - new Date( memory.plant.since ).getTime() ) / 86_400_000 )
				: null,
		},
		current,
		ranges     : effectiveRanges,
		// VPD is derived, not measured, but it changes how several measured
		// values should be read — so it belongs in the shared context.
		vpd        : vaporPressureDeficit( current.temperature, current.humidity ),
		// Carried so downstream readings can know whether this plant's stomata
		// are meant to be open right now at all.
		archetype  : archetype ?? null,
		vpdBand    : vpdBand( vaporPressureDeficit( current.temperature, current.humidity ) ),
		happiness  : happiness( current, effectiveRanges ),
		deviations : deviations( current, effectiveRanges ),
		stats24,
		care       : {
			daysSinceWater      : memory?.daysSince?.( 'water' ) ?? null,
			daysSinceFertilizer : memory?.daysSince?.( 'fertilize' ) ?? null,
			lastEvents          : ( memory?.data?.events || [] ).slice( -5 ).reverse(),
		},
		notes   : ( memory?.notes || [] ).slice( -3 ),
		profile : memory?.profile || null,
	}

}

/**
 * Render the context as a compact prompt brief.
 *
 * @param   {object} ctx - Result of `buildContext`.
 * @returns {string}     Human/model-readable brief.
 */
export function renderContext( ctx ) {

	const lines = []
	const p = ctx.plant || {}

	lines.push( `PLANT: ${p.name || 'unnamed'}${p.species ? ` (${p.species})` : ''}${p.type ? ` — ${p.type}` : ''}` )
	if ( p.daysKnown != null ) lines.push( `Known for: ${p.daysKnown} day(s)` )

	const cur = METRIC_KEYS
		.filter( k => Number.isFinite( ctx.current?.[ k ] ) )
		.map( k => `${METRICS[ k ].label} ${ctx.current[ k ]}${METRICS[ k ].unit}` )
	lines.push( `CURRENT: ${cur.length ? cur.join( ', ' ) : 'no sensor data'}` )
	lines.push( `WELLBEING: ${ctx.happiness}/100` )
	if ( Number.isFinite( ctx.vpd ) ) lines.push( `VPD: ${ctx.vpd} kPa (${vpdBand( ctx.vpd )})` )

	if ( ctx.deviations?.length ) {

		lines.push( 'OUT OF RANGE: ' + ctx.deviations
			.map( d => `${METRICS[ d.metric ].label} ${d.direction} (${d.value}${d.unit}, ideal ${d.range.min}-${d.range.max}${d.unit})` )
			.join( '; ' ) )

	}
	else lines.push( 'OUT OF RANGE: none' )

	const trends = Object.entries( ctx.stats24 || {} )
		.filter( ( [ , s ] ) => Math.abs( s.trend ) > 0.05 )
		.map( ( [ k, s ] ) => `${METRICS[ k ].label} ${s.trend > 0 ? 'rising' : 'falling'} (avg ${s.avg}${METRICS[ k ].unit} over ${s.n} readings)` )
	if ( trends.length ) lines.push( `24H TRENDS: ${trends.join( '; ' )}` )

	const care = []
	if ( ctx.care?.daysSinceWater != null ) care.push( `last watered ${ctx.care.daysSinceWater} day(s) ago` )
	if ( ctx.care?.daysSinceFertilizer != null ) care.push( `last fertilized ${ctx.care.daysSinceFertilizer} day(s) ago` )
	if ( care.length ) lines.push( `CARE HISTORY: ${care.join( ', ' )}` )

	if ( ctx.notes?.length ) {

		lines.push( `OWNER NOTES: ${ctx.notes.map( n => n.text ).join( ' | ' )}` )

	}

	// Multimodal observations, when a camera or electrode is attached. Rendered
	// as plain sentences rather than raw numbers: the model reasons far better
	// over "12% of the canopy is yellowing" than over a tissue histogram.
	if ( ctx.vision?.description ) {

		lines.push( `VISION: ${ctx.vision.description}` )
		if ( ctx.vision.change?.findings?.length ) {

			lines.push( `VISION CHANGE: ${ctx.vision.change.findings.join( '; ' )}` )

		}
		if ( ctx.vision.detections?.length ) {

			const seen = ctx.vision.detections.slice( 0, 5 ).map( d => `${d.label} (${Math.round( d.confidence * 100 )}%)` )
			lines.push( `VISION DETECTIONS: ${seen.join( ', ' )}` )

		}

	}

	if ( ctx.electro?.summary ) {

		const s = ctx.electro.summary
		const bits = [ `${s.physiological} electrical event(s) in the window (${s.ratePerHour}/h)` ]
		if ( s.damageSignal ) bits.push( 'variation potentials present — the electrical signature of tissue damage' )
		if ( ctx.electro.circadian?.verdict ) bits.push( ctx.electro.circadian.verdict )
		lines.push( `ELECTROPHYSIOLOGY: ${bits.join( '; ' )}` )

	}

	return lines.join( '\n' )

}
