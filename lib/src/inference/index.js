/**
 * What the metrics say together that none of them says alone.
 *
 * A soil probe reports moisture. A thermometer reports air temperature. Crossed
 * against each other and against the leaf, they report something neither
 * contains: whether the plant has its stomata open, how hard its roots are
 * having to pull, whether the extra light you just added is doing anything at
 * all.
 *
 * That is the difference between reading a plant as a set of gauges and reading
 * it as one system. Most of these are ratios and differences that a
 * horticulturist computes in their head; the point of writing them down is that
 * the system can compute them every minute, and notice when one of them starts
 * to move.
 *
 * ## Every inference states what it could not use
 *
 * Almost none of these can be computed from what a starter kit measures. Real
 * VPD needs a leaf temperature that a cheap rig does not have; photosynthetic
 * saturation needs PAR and CO₂. The temptation is to substitute — to use air
 * temperature where leaf temperature belongs, and quietly report the result as
 * though it were the real thing.
 *
 * That substitution is exactly the failure mode. Air temperature stands in for
 * leaf temperature only when the stomata are doing nothing, which is precisely
 * the case the measurement exists to detect. So an inference either has what it
 * needs or it says which sensor would unlock it. Nothing is estimated from a
 * proxy that fails in the interesting case.
 */

import { vaporPressureDeficit } from '../memory/context.js'

/** Saturation vapour pressure, kPa (Tetens). */
const svp = t => 0.61078 * Math.exp( ( 17.27 * t ) / ( t + 237.3 ) )

/** A result nobody can compute yet, and what would fix that. */
const needs = ( id, label, missing, unlocks ) => ( {
	id,
	label,
	known : false,
	missing,
	why : `Needs ${missing.join( ' and ' )}. ${unlocks}`,
} )

/**
 * Vapour pressure deficit at the leaf, not in the air.
 *
 * The air VPD says how thirsty the atmosphere is. The **leaf** VPD says how hard
 * that atmosphere is actually pulling on this plant, and the two diverge exactly
 * when it matters: a transpiring leaf runs cooler than the air around it, and a
 * leaf that has shut its stomata runs hotter.
 *
 * @param   {object} m - Metrics.
 * @returns {object}   The inference.
 */
export function leafVpd( m ) {

	if ( !Number.isFinite( m.temperature ) || !Number.isFinite( m.humidity ) ) {

		return needs( 'leafVpd', 'Leaf VPD', [ 'temperature', 'humidity' ],
			'Without it there is no way to tell atmospheric demand from plant response.' )

	}

	const airVpd = vaporPressureDeficit( m.temperature, m.humidity )

	if ( !Number.isFinite( m.leafTemperature ) ) {

		return {
			id : 'leafVpd',
			label : 'Leaf VPD',
			known : false,
			airVpd,
			missing : [ 'leafTemperature' ],
			// Deliberately not estimated. Using air temperature as a stand-in
			// assumes the leaf is not transpiring, which is the one thing this
			// measurement exists to find out.
			why : `Air VPD is ${airVpd} kPa, but the leaf's own deficit needs an infrared leaf temperature. Substituting air temperature would assume the stomata are closed, which is precisely what this is meant to determine.`,
		}

	}

	// Vapour pressure inside the leaf is saturated at leaf temperature; the air
	// holds whatever it holds. The difference is the actual driving force.
	const inside = svp( m.leafTemperature )
	const outside = svp( m.temperature ) * ( m.humidity / 100 )
	const leaf = Number( ( inside - outside ).toFixed( 3 ) )
	const delta = Number( ( m.leafTemperature - m.temperature ).toFixed( 2 ) )

	return {
		id : 'leafVpd',
		label : 'Leaf VPD',
		known : true,
		value : leaf,
		airVpd,
		leafMinusAir : delta,
		unit : 'kPa',
		// A cooler leaf is an evaporating leaf. A hotter one has stopped.
		state : delta < -1 ? 'transpiring' : delta > 1 ? 'closed' : 'balanced',
		why : delta < -1
			? `The leaf is ${Math.abs( delta )}°C cooler than the air, which is evaporation doing the cooling: the stomata are open and working.`
			: delta > 1
				? `The leaf is ${delta}°C warmer than the air. It has stopped cooling itself, which means the stomata are shut — check water before adding light or heat.`
				: `Leaf and air are within a degree, so the plant is neither transpiring hard nor visibly shut down.`,
	}

}

/**
 * How open the stomata are, inferred rather than measured.
 *
 * A porometer measures this directly and almost nobody has one. The energy
 * balance gives a usable proxy: the more a leaf cools itself below air
 * temperature for a given atmospheric demand, the more water it is letting go.
 *
 * @param   {object} m - Metrics.
 * @returns {object}   The inference.
 */
export function stomatalOpening( m ) {

	if ( Number.isFinite( m.stomatalConductance ) ) {

		return {
			id : 'stomata',
			label : 'Stomatal opening',
			known : true,
			measured : true,
			value : m.stomatalConductance,
			unit : 'mmol/m²/s',
			why : 'Measured directly by a porometer, so nothing here is inferred.',
		}

	}

	const vpd = leafVpd( m )

	if ( !vpd.known ) {

		return needs( 'stomata', 'Stomatal opening', vpd.missing || [ 'leafTemperature' ],
			'This is what detects water stress hours before a leaf visibly wilts.' )

	}

	// Cooling per unit of atmospheric demand. Not a conductance in real units —
	// an index, and labelled as one.
	const index = Number( Math.max( 0, Math.min( 1, -vpd.leafMinusAir / Math.max( vpd.airVpd, 0.2 ) / 3 ) ).toFixed( 3 ) )

	return {
		id : 'stomata',
		label : 'Stomatal opening',
		known : true,
		measured : false,
		index,
		unit : 'index 0-1',
		state : index > 0.5 ? 'open' : index > 0.15 ? 'partial' : 'closed',
		why : `Inferred from ${Math.abs( vpd.leafMinusAir )}°C of leaf cooling against ${vpd.airVpd} kPa of demand. This is an index, not a conductance — a porometer would give the real figure.`,
	}

}

/**
 * Is the plant taking up water and salts together, or leaving the salts behind?
 *
 * The most useful thing two cheap probes can tell you jointly. Moisture falling
 * while conductivity climbs means water is leaving and the fertiliser is not —
 * which concentrates it around the roots and burns them, on a plant that looks
 * like it is simply drinking.
 *
 * @param   {object[]} rows - Readings, oldest first.
 * @param   {object}   [opts] - `{ hours }`.
 * @returns {object}          The inference.
 */
export function uptakeBalance( rows, opts = {} ) {

	const hours = opts.hours ?? 12
	const cutoff = Date.now() - hours * 3_600_000

	const window = ( rows || [] )
		.filter( r => new Date( r.t ).getTime() >= cutoff )
		.filter( r => Number.isFinite( r.soil ) && Number.isFinite( r.conductivity ) )

	if ( window.length < 6 ) {

		return needs( 'uptake', 'Water and salt uptake', [ 'soil', 'conductivity' ],
			`This is what separates a plant drinking normally from one concentrating fertiliser around its own roots. Have ${window.length} paired readings, need 6.` )

	}

	const first = window[ 0 ], last = window.at( -1 )
	const dSoil = last.soil - first.soil
	const dEc = last.conductivity - first.conductivity

	// Only meaningful while water is actually leaving the substrate.
	if ( dSoil > -2 ) {

		return {
			id : 'uptake',
			label : 'Water and salt uptake',
			known : true,
			state : 'idle',
			dSoil : Number( dSoil.toFixed( 2 ) ),
			dEc : Number( dEc.toFixed( 1 ) ),
			why : `Substrate moisture has not fallen over ${hours}h, so there is no uptake to characterise.`,
		}

	}

	const rising = dEc > 20

	return {
		id : 'uptake',
		label : 'Water and salt uptake',
		known : true,
		state : rising ? 'salt_accumulating' : 'balanced',
		dSoil : Number( dSoil.toFixed( 2 ) ),
		dEc : Number( dEc.toFixed( 1 ) ),
		cue : rising
			? {
				claim : 'salt_accumulation',
				source : 'inference',
				strength : 0.5,
				detail : `soil down ${Math.abs( dSoil ).toFixed( 1 )}% while conductivity rose ${dEc.toFixed( 0 )}µS/cm over ${hours}h`,
			}
			: null,
		why : rising
			? `Moisture fell ${Math.abs( dSoil ).toFixed( 1 )}% while conductivity rose ${dEc.toFixed( 0 )}µS/cm. The plant is taking the water and leaving the salts, which concentrates them around the roots. Flush the substrate rather than feeding again.`
			: `Moisture and conductivity fell together, which is water and nutrients being taken up in step.`,
	}

}

/**
 * How dry the substrate really is, in the terms a root experiences.
 *
 * Percentage moisture is a property of the substrate, not of the plant's
 * difficulty: 30% in coir and 30% in clay are entirely different experiences.
 * Matric potential is the force a root must generate to get water out, which is
 * the quantity the plant actually feels.
 *
 * @param   {object} m - Metrics.
 * @returns {object}   The inference.
 */
export function rootEffort( m ) {

	if ( Number.isFinite( m.matricPotential ) ) {

		const kPa = m.matricPotential

		return {
			id : 'rootEffort',
			label : 'Root effort',
			known : true,
			measured : true,
			value : kPa,
			unit : 'kPa',
			state : kPa > -10 ? 'saturated' : kPa > -30 ? 'comfortable' : kPa > -60 ? 'working' : 'straining',
			why : kPa > -10
				? `At ${kPa} kPa the substrate is close to saturation — the roots have water and may be short of air.`
				: kPa < -60
					? `At ${kPa} kPa the roots are pulling hard for every drop. This is stress regardless of what the moisture percentage says.`
					: `At ${kPa} kPa water is available without much effort.`,
		}

	}

	return needs( 'rootEffort', 'Root effort', [ 'matricPotential' ],
		'Moisture percentage describes the substrate; a tensiometer describes what the plant has to do to drink from it, and 30% means different things in coir and in clay.' )

}

/**
 * Is more light still doing anything?
 *
 * Above a species-dependent ceiling, extra light stops being photosynthesis and
 * starts being heat and photoinhibition. Answering this needs the response, not
 * just the stimulus.
 *
 * @param   {object[]} rows - Readings, oldest first.
 * @returns {object}        The inference.
 */
export function lightSaturation( rows ) {

	const usable = ( rows || [] ).filter( r =>
		Number.isFinite( r.par ) && ( Number.isFinite( r.co2 ) || Number.isFinite( r.activity ) ) )

	if ( usable.length < 12 ) {

		return needs( 'lightSaturation', 'Light saturation', [ 'par', 'co2 or activity' ],
			'A lux meter measures what a human eye sees, not what a leaf can use. Saturation needs PAR against an actual response.' )

	}

	const response = r => ( Number.isFinite( r.co2 ) ? -r.co2 : r.activity )
	const sorted = [ ...usable ].sort( ( a, b ) => a.par - b.par )
	const half = Math.floor( sorted.length / 2 )
	const low = sorted.slice( 0, half ), high = sorted.slice( half )

	const mean = ( xs, f ) => xs.reduce( ( a, r ) => a + f( r ), 0 ) / xs.length
	const lowPar = mean( low, r => r.par ), highPar = mean( high, r => r.par )
	const gain = ( mean( high, response ) - mean( low, response ) ) / Math.max( 1, highPar - lowPar )

	const saturated = gain <= 0

	return {
		id : 'lightSaturation',
		label : 'Light saturation',
		known : true,
		parRange : [ Number( lowPar.toFixed( 0 ) ), Number( highPar.toFixed( 0 ) ) ],
		gain : Number( gain.toFixed( 5 ) ),
		saturated,
		why : saturated
			? `Between ${lowPar.toFixed( 0 )} and ${highPar.toFixed( 0 )} µmol/m²/s the response stops improving. Light above this is heat and photoinhibition, not photosynthesis — and it is being paid for.`
			: `Response is still climbing with light across ${lowPar.toFixed( 0 )}–${highPar.toFixed( 0 )} µmol/m²/s, so this plant has not reached its ceiling.`,
	}

}

/**
 * How much of the substrate's thermal behaviour says it is dry.
 *
 * Water has an enormous heat capacity. A wet pot tracks air temperature slowly;
 * a dry one follows it almost immediately. That difference is a moisture reading
 * that does not depend on the moisture probe — useful precisely when the probe
 * is the thing you are unsure about.
 *
 * @param   {object[]} rows - Readings, oldest first.
 * @returns {object}        The inference.
 */
export function thermalInertia( rows ) {

	const usable = ( rows || [] ).filter( r =>
		Number.isFinite( r.temperature ) && Number.isFinite( r.soilTemperature ) )

	if ( usable.length < 12 ) {

		return needs( 'thermalInertia', 'Substrate thermal inertia', [ 'soilTemperature' ],
			'A soil thermometer gives a moisture signal that does not depend on the moisture probe, which is what makes it worth having.' )

	}

	const airSwing = Math.max( ...usable.map( r => r.temperature ) ) - Math.min( ...usable.map( r => r.temperature ) )
	const soilSwing = Math.max( ...usable.map( r => r.soilTemperature ) ) - Math.min( ...usable.map( r => r.soilTemperature ) )

	if ( airSwing < 1 ) {

		return {
			id : 'thermalInertia',
			label : 'Substrate thermal inertia',
			known : false,
			why : `Air temperature only moved ${airSwing.toFixed( 1 )}°C over this window. Without a swing in the air there is nothing for the substrate to lag behind.`,
		}

	}

	const ratio = Number( ( soilSwing / airSwing ).toFixed( 3 ) )

	return {
		id : 'thermalInertia',
		label : 'Substrate thermal inertia',
		known : true,
		ratio,
		airSwing : Number( airSwing.toFixed( 1 ) ),
		soilSwing : Number( soilSwing.toFixed( 1 ) ),
		state : ratio > 0.7 ? 'dry' : ratio > 0.4 ? 'moderate' : 'wet',
		why : ratio > 0.7
			? `The substrate followed ${Math.round( ratio * 100 )}% of a ${airSwing.toFixed( 1 )}°C air swing, which is what dry material does — there is little water in there to absorb the heat.`
			: `The substrate absorbed most of a ${airSwing.toFixed( 1 )}°C air swing (${Math.round( ratio * 100 )}% passed through), which takes water.`,
	}

}

/**
 * Everything that can be inferred from what this plant actually has.
 *
 * @param   {object} plant - A `SmartPlant`.
 * @param   {object} [opts] - `{ hours }`.
 * @returns {object}       `{known, blocked, cues, unlock}`.
 */
export function inferAll( plant, opts = {} ) {

	const reading = plant.memory?.lastReading || {}
	const rows = plant.memory?.data?.readings || []

	const results = [
		leafVpd( reading ),
		stomatalOpening( reading ),
		rootEffort( reading ),
		uptakeBalance( rows, opts ),
		lightSaturation( rows ),
		thermalInertia( rows ),
	]

	const known = results.filter( r => r.known )
	const blocked = results.filter( r => !r.known )

	// Which single sensor would unlock the most, which is the question somebody
	// deciding what to buy next actually has.
	const wanted = new Map()

	for ( const b of blocked ) {

		for ( const miss of b.missing || [] ) {

			wanted.set( miss, ( wanted.get( miss ) || 0 ) + 1 )

		}

	}

	const unlock = [ ...wanted.entries() ]
		.sort( ( a, b ) => b[ 1 ] - a[ 1 ] )
		.map( ( [ metric, n ] ) => ( {
			metric,
			unlocks : n,
		} ) )

	return {
		known,
		blocked,
		cues : known.map( r => r.cue ).filter( Boolean ),
		unlock,
		verdict : `${known.length} of ${results.length} cross-metric readings available.${unlock.length ? ` Adding ${unlock[ 0 ].metric} would unlock ${unlock[ 0 ].unlocks} more.` : ''}`,
	}

}
