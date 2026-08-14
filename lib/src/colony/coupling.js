/**
 * What changes when two plants are close to each other.
 *
 * Everywhere else in this library a plant is treated as a unit that reads its
 * surroundings. Put two of them within a leaf's width and that stops being true:
 * their boundary layers overlap, their transpiration lands in the same pocket of
 * air, each one's leaves are in the other's light path, and they draw CO₂ from
 * the same small volume. They stop being two plants in a room and become one
 * coupled system with two sets of instruments in it.
 *
 * This module is about the consequences of that, and it exists because the aid
 * layer *creates* the condition. A plant that rolls over to shelter a neighbour
 * has not only delivered shelter — it has also raised the local humidity, cut
 * the other's red:far-red, and started competing for the same CO₂. Modelling the
 * help without modelling the coupling would credit one side of a trade and hide
 * the other.
 *
 * ## Some of it helps and some of it costs
 *
 * The pairing is genuinely good for both plants in still, dry, warm air: shared
 * transpiration lifts humidity in the gap, VPD falls, stomata can stay open
 * longer, and evaporative cooling is shared. That is a real, well-described
 * benefit and it is the reason grouped houseplants do better than scattered
 * ones.
 *
 * In *stagnant* air at peak light it inverts. Two plants photosynthesising into
 * a pocket of air nobody is stirring pull the local CO₂ down faster than it is
 * replaced, and both fix less carbon than either would alone. Same arrangement,
 * opposite sign, and the thing that decides which is airflow.
 *
 * So proximity here is never scored as good or bad. It is scored against the
 * conditions, and when the conditions are not instrumented it is not scored.
 *
 * ## The reference problem
 *
 * This is where most of the care in this file goes. Two neighbouring plants both
 * reading 68% humidity is not evidence of a shared humid pocket. It is equally
 * consistent with a humid room. To claim the pocket exists you need a reading
 * from outside it — the room, or a plant far enough away to be unaffected — and
 * without one the honest answer is that the effect is unverifiable rather than
 * absent.
 *
 * The same trap applies to every effect here, which is why every function
 * returns `observed: null` rather than `false` when it lacked what it needed.
 *
 * ## What is deliberately not claimed
 *
 * Plants really do signal to each other with volatiles — methyl jasmonate and
 * methyl salicylate from a plant under attack, taken up through a neighbour's
 * stomata, which then raises its own defences before anything has touched it.
 * It is one of the better-established findings in the field. No sensor in this
 * library can see it: it needs gas chromatography, not a DHT22.
 *
 * What this module does instead is state that plainly and offer the *function*
 * over the colony channel, clearly labelled. When one plant finds a pest, its
 * neighbours are told and raise their own inspection rate. That is the same
 * outcome by a completely different route, and calling it anything other than a
 * deliberate substitute would be a lie about what the hardware knows.
 *
 * Root exudates, allelopathy and mycorrhizal transfer are treated the same way
 * and are stricter still: they need a shared substrate, they cannot be measured
 * by anything here, and so they only ever appear as a configuration-time note.
 */

/** How close two plants have to be before any of this applies, in metres. */
export const COUPLING_RANGE = 0.4

/** Airflow below which a pocket of air counts as stagnant, in m/s. */
export const STAGNANT = 0.15

/** Light above which two plants are drawing on the same CO₂ hard enough to matter. */
export const ACTIVE_LIGHT = 8000

/**
 * The effects of being close, what each needs to be seen, and its sign.
 *
 * `sign` is `benefit`, `cost` or `depends` — and `depends` is not a hedge. Shade
 * avoidance genuinely helps a plant that is being overtopped and genuinely wastes
 * a plant that is not.
 */
export const COUPLING = {
	HUMIDITY_POCKET : {
		id : 'humidity-pocket',
		label : 'Shared humid pocket',
		sign : 'benefit',
		metric : 'humidity',
		direction : 'up',
		needs : [ 'humidity' ],
		reference : true,
		why : 'Two sets of leaves transpiring into the same overlapping boundary layer raise the humidity in the gap between them above the room they are standing in.',
	},
	VPD_BUFFER : {
		id : 'vpd-buffer',
		label : 'Lowered vapour pressure deficit',
		sign : 'benefit',
		metric : 'vpd',
		direction : 'down',
		needs : [ 'humidity', 'temperature' ],
		reference : true,
		why : 'The humid pocket is only worth having because of what it does to VPD. A lower deficit means less water pulled out per unit of time, so stomata can stay open longer and fix more carbon before the plant has to close them.',
	},
	EVAPORATIVE_COOLING : {
		id : 'evaporative-cooling',
		label : 'Shared evaporative cooling',
		sign : 'benefit',
		metric : 'leafTemperature',
		direction : 'down',
		needs : [ 'leafTemperature' ],
		reference : true,
		why : 'Both plants are cooling the same air by evaporating into it, so each gets some of the other\'s cooling on a hot day.',
	},
	SHADE_AVOIDANCE : {
		id : 'shade-avoidance',
		label : 'Shade avoidance response',
		sign : 'depends',
		metric : 'redFarRed',
		direction : 'down',
		needs : [ 'redFarRed' ],
		reference : false,
		why : 'Leaves absorb red and reflect far-red, so a neighbour lowers the red:far-red a plant sees even without shading it. Phytochrome reads that as competition and the plant elongates stems and re-angles leaves to climb out of it. Useful if it is genuinely being overtopped; wasted growth if it is not.',
	},
	CO2_DEPLETION : {
		id : 'co2-depletion',
		label : 'Local CO₂ depletion',
		sign : 'cost',
		metric : 'co2',
		direction : 'down',
		needs : [ 'co2' ],
		reference : true,
		gatedOn : [ 'airflow', 'light' ],
		why : 'In still air at high light, two plants draw CO₂ out of the pocket between them faster than it is replaced, and both fix less carbon than either would standing alone. The only thing that prevents it is air movement.',
	},
	PRIMING : {
		id : 'priming',
		label : 'Defence priming',
		sign : 'benefit',
		metric : null,
		direction : null,
		needs : [ 'voc-sensor' ],
		reference : false,
		substitute : 'colony-alert',
		why : 'A plant under attack releases methyl jasmonate and methyl salicylate, and a neighbour taking those up through its stomata raises its own defences before it is touched. Nothing in this library can smell it. The colony channel carries the warning instead, which reaches the same outcome by an entirely different route.',
	},
	ALLELOPATHY : {
		id : 'allelopathy',
		label : 'Root chemistry between neighbours',
		sign : 'depends',
		metric : null,
		direction : null,
		needs : [ 'shared-substrate' ],
		reference : false,
		configTime : true,
		why : 'Roots in the same substrate exchange organic acids, phenols and flavonoids — sometimes helping each other reach phosphorus and iron, sometimes suppressing each other outright. It needs a shared pot to happen at all and a laboratory to observe, so it belongs in configuration notes and nowhere near a runtime claim.',
	},
	MYCORRHIZAL : {
		id : 'mycorrhizal',
		label : 'Shared fungal network',
		sign : 'benefit',
		metric : null,
		direction : null,
		needs : [ 'shared-substrate', 'living-substrate' ],
		reference : false,
		configTime : true,
		why : 'In a living substrate, fungal hyphae can physically link two root systems and move carbon, nitrogen, water and stress signals between them. Real, and completely invisible to every sensor here.',
	},
}

const COUPLING_BY_ID = Object.fromEntries( Object.values( COUPLING ).map( c => [ c.id, c ] ) )

/** Effects that can be checked at runtime rather than only noted in setup. */
export const OBSERVABLE = Object.values( COUPLING ).filter( c => !c.configTime && c.metric )

const finite = v => Number.isFinite( v )

/**
 * Saturation vapour pressure, kPa, from the Tetens equation.
 *
 * @param   {number} tC - Temperature in °C.
 * @returns {number}    kPa.
 */
const svp = tC => 0.6108 * Math.exp( 17.27 * tC / ( tC + 237.3 ) )

/**
 * Vapour pressure deficit of air, kPa.
 *
 * @param   {number} tC - Air temperature.
 * @param   {number} rh - Relative humidity, 0-100.
 * @returns {number|null} kPa.
 */
export function airVpd( tC, rh ) {

	if ( !finite( tC ) || !finite( rh ) ) return null
	return Number( ( svp( tC ) * ( 1 - rh / 100 ) ).toFixed( 3 ) )

}

/**
 * Are these two plants close enough for any of this to apply?
 *
 * Distance is declared rather than sensed, and a declared distance is a claim
 * about the world that may simply be stale — someone moved a pot. It is accepted
 * because there is no alternative, and flagged as declared everywhere it is used.
 *
 * @param   {object} [opts] - `{ metres, sharedSubstrate }`.
 * @returns {object}        `{coupled, contact, why}`.
 */
export function coupled( opts = {} ) {
	opts = opts ?? {}

	// A measured range beats a typed one every time. This is the footnote every
	// conclusion in this module has been carrying, and a rangefinder removes it.
	const measured = Number.isFinite( opts.measuredMetres )
	const m = measured ? opts.measuredMetres : opts.metres

	if ( !finite( m ) ) {

		return {
			coupled : null,
			why : 'No distance between these two plants was declared, so whether they are coupled at all is unknown. Every effect below depends on that, and none of them can be assessed without it.',
		}

	}

	return {
		coupled : m <= COUPLING_RANGE,
		metres : m,
		sharedSubstrate : Boolean( opts.sharedSubstrate ),
		declared : !measured,
		measured,
		why : m <= COUPLING_RANGE
			? `${m}m apart, within the ${COUPLING_RANGE}m at which boundary layers overlap. ${measured ? 'Measured by a rangefinder, so it stays true when a pot is moved.' : 'Declared, not measured — if a pot was moved and nobody said so, this is wrong.'}`
			: `${m}m apart. Too far for boundary layers to overlap, so these two are neighbours in a room rather than a coupled pair.`,
	}

}

/**
 * Is the pair's shared air measurably different from the room's?
 *
 * The one function everything else in the benefit column rests on. Two plants
 * agreeing with each other is not evidence — a reading from outside the pocket
 * is what turns agreement into an effect.
 *
 * @param   {object} pair       - `{a, b}`, each a reading `{humidity, temperature, leafTemperature}`.
 * @param   {object} reference  - A reading from outside the pair: the room, or a distant plant.
 * @returns {object}            `{effects, why}`.
 */
export function pocket( pair = {}, reference = null ) {
	pair = pair ?? {}

	const { a = {}, b = {} } = pair
	const effects = []

	const push = ( def, observed, extra = {}, why ) => effects.push( {
		effect : def.id,
		label : def.label,
		sign : def.sign,
		observed,
		...extra,
		why,
	} )

	if ( !reference ) {

		for ( const def of [ COUPLING.HUMIDITY_POCKET, COUPLING.VPD_BUFFER, COUPLING.EVAPORATIVE_COOLING ] ) {

			push( def, null, {}, `Both plants can be read, but there is no reading from outside the pair. Two plants reporting the same humidity is exactly what a humid room looks like, so nothing here separates the pocket they might be making from the weather they are both standing in. Give a room sensor or a plant beyond ${COUPLING_RANGE}m and this becomes answerable.` )

		}

		return {
			effects,
			reference : false,
			why : 'No reference outside the pair, so no benefit can be attributed to the pairing.',
		}

	}

	// ── humidity ────────────────────────────────────────────────────────────
	const rhPair = [ a.humidity, b.humidity ].filter( finite )

	if ( rhPair.length === 2 && finite( reference.humidity ) ) {

		const mean = ( rhPair[ 0 ] + rhPair[ 1 ] ) / 2
		const lift = Number( ( mean - reference.humidity ).toFixed( 1 ) )

		push( COUPLING.HUMIDITY_POCKET, lift > 2, { lift }, lift > 2
			? `The air at the pair sits ${lift} points above the reference. That gap is the two of them transpiring into the same volume, and it is the thing that makes standing plants together worth doing.`
			: `The pair is within ${Math.abs( lift )} points of the reference, so there is no pocket. Either they are further apart than declared, or the air around them is moving enough to carry it away as fast as they make it.` )

	} else {

		push( COUPLING.HUMIDITY_POCKET, null, {}, 'Humidity is missing from one of the plants or from the reference, so the comparison cannot be made.' )

	}

	// ── VPD ─────────────────────────────────────────────────────────────────
	const pairVpd = [ airVpd( a.temperature, a.humidity ), airVpd( b.temperature, b.humidity ) ].filter( finite )
	const refVpd = airVpd( reference.temperature, reference.humidity )

	if ( pairVpd.length === 2 && finite( refVpd ) ) {

		const mean = ( pairVpd[ 0 ] + pairVpd[ 1 ] ) / 2
		const drop = Number( ( refVpd - mean ).toFixed( 3 ) )

		push( COUPLING.VPD_BUFFER, drop > 0.05, {
			pairVpd : Number( mean.toFixed( 3 ) ),
			referenceVpd : refVpd,
			drop,
		}, drop > 0.05
			? `VPD at the pair is ${mean.toFixed( 2 )} kPa against ${refVpd} in the room — ${drop} kPa less pull on both plants. This is the part that actually matters: a smaller deficit means each one can hold its stomata open longer before water loss forces them shut, so both fix more carbon for the same water.`
			: `VPD at the pair is ${mean.toFixed( 2 )} kPa against ${refVpd} in the room, which is not a meaningful difference. Whatever humidity they are adding is not enough to change what the air is pulling out of them.` )

	} else {

		push( COUPLING.VPD_BUFFER, null, {}, 'VPD needs temperature and humidity at both plants and at the reference, and at least one is missing.' )

	}

	// ── leaf temperature ────────────────────────────────────────────────────
	const leaves = [ a.leafTemperature, b.leafTemperature ].filter( finite )

	if ( leaves.length === 2 && finite( reference.temperature ) ) {

		const mean = ( leaves[ 0 ] + leaves[ 1 ] ) / 2
		const below = Number( ( reference.temperature - mean ).toFixed( 2 ) )

		push( COUPLING.EVAPORATIVE_COOLING, below > 0.5, { below }, below > 0.5
			? `Leaves are running ${below}°C below the reference air. Each plant is evaporating into air the other is also cooling, so some of that is the neighbour’s doing rather than its own.`
			: 'Leaf temperature is not below the reference air, so there is no shared cooling to speak of. On a plant that is not transpiring much, there would not be.' )

	} else {

		push( COUPLING.EVAPORATIVE_COOLING, null, {}, 'Leaf temperature is not instrumented on both plants, so cooling cannot be separated from air temperature.' )

	}

	return {
		effects,
		reference : true,
		why : 'Compared against a reading from outside the pair, which is the only thing that makes any of this attributable.',
	}

}

/**
 * The cost side: are these two starving each other of CO₂?
 *
 * Needs three things at once — stagnant air, active light, and a CO₂ reading.
 * Missing the reading is the common case, and it is reported as unknown rather
 * than assumed fine, because the conditions that cause it are the conditions a
 * grouped indoor plant most often lives in.
 *
 * @param   {object} m - `{co2, airflow, light}` at the pair, plus `{reference}`.
 * @returns {object}   `{observed, risk, why}`.
 */
export function co2Depletion( m = {} ) {
	m = m ?? {}

	const stagnant = finite( m.airflow ) ? m.airflow < STAGNANT : null
	const active = finite( m.light ) ? m.light > ACTIVE_LIGHT : null

	// The conditions that make it possible, before the measurement that would
	// confirm it. Worth separating: the risk is actionable on its own.
	const risk = stagnant === true && active === true

	if ( !finite( m.co2 ) ) {

		return {
			effect : COUPLING.CO2_DEPLETION.id,
			observed : null,
			risk : stagnant === null || active === null ? null : risk,
			why : risk
				? `No CO₂ sensor, and the conditions for depletion are all present: airflow at ${m.airflow} m/s is below the ${STAGNANT} m/s that counts as still, and light at ${m.light} has both plants photosynthesising hard. This is the one arrangement where standing plants together makes both of them worse, and it cannot be confirmed without a CO₂ reading. A small fan removes the problem entirely and costs less than the sensor.`
				: stagnant === null || active === null
					? 'No CO₂ sensor, and airflow or light is missing too, so neither the depletion nor the conditions for it can be assessed.'
					: `No CO₂ sensor, but the conditions for depletion are not present${stagnant === false ? ` — air is moving at ${m.airflow} m/s, which replaces the pocket faster than two plants can draw it down` : ' — light is low enough that neither plant is fixing much carbon'}.`,
		}

	}

	const depleted = finite( m.reference )
		? m.co2 < m.reference - 40
		: m.co2 < 350

	return {
		effect : COUPLING.CO2_DEPLETION.id,
		observed : depleted,
		risk,
		co2 : m.co2,
		why : depleted
			? `CO₂ at the pair is ${m.co2} ppm${finite( m.reference ) ? ` against ${m.reference} outside it` : ' — below outdoor air, indoors, which only happens where something is consuming it'}. Both plants are photosynthesising into the same pocket and taking it down faster than it refills. They are competing, not helping, and moving air is what fixes it.`
			: `CO₂ at the pair is ${m.co2} ppm, which is not depleted${finite( m.reference ) ? ` relative to the ${m.reference} ppm outside the pair` : ''}. Being close is not costing them carbon here.`,
	}

}

/**
 * Is a neighbour making this plant reach?
 *
 * Red:far-red is the direct measurement and needs no reference, because the
 * ratio is a property of the light arriving rather than a difference between two
 * places. Where it is not instrumented, nothing is inferred: a plant growing
 * taller has a dozen possible reasons and this would happily claim all of them.
 *
 * @param   {object} m - `{redFarRed, light}`.
 * @returns {object}   `{observed, why}`.
 */
export function shadeAvoidance( m = {} ) {
	m = m ?? {}

	if ( !finite( m.redFarRed ) ) {

		return {
			effect : COUPLING.SHADE_AVOIDANCE.id,
			observed : null,
			why : 'No red:far-red sensor. Elongation would be the visible sign, but a plant reaches for a dozen reasons and attributing it to a neighbour without the ratio would be guessing with a confident face.',
		}

	}

	// Open daylight sits near 1.1. Under a canopy it falls below 0.5, and the
	// phytochrome response tracks it down well before there is visible shade.
	const crowded = m.redFarRed < 0.7

	return {
		effect : COUPLING.SHADE_AVOIDANCE.id,
		observed : crowded,
		redFarRed : m.redFarRed,
		why : crowded
			? `Red:far-red of ${m.redFarRed} against roughly 1.1 in open light. Neighbouring leaves absorb red and reflect far-red, so this plant is being told there is competition overhead whether or not it is actually being shaded. It will spend growth on elongating to escape — worth it if the shade is real, wasted if the sensor is simply near a reflective leaf.`
			: `Red:far-red of ${m.redFarRed} is close to open light, so nothing nearby is casting enough of a spectral shadow to trigger a shade response.`,
	}

}

/**
 * Everything at once, for a declared pair.
 *
 * @param   {object} pair      - `{a, b, metres, sharedSubstrate}`.
 * @param   {object} reference - Reading from outside the pair.
 * @returns {object}           `{coupled, effects, benefits, costs, unknown, why}`.
 */
export function couplingState( pair = {}, reference = null ) {
	pair = pair ?? {}

	const near = coupled( pair )

	if ( near.coupled !== true ) {

		return {
			...near,
			effects : [],
			why : near.why,
		}

	}

	const at = pair.a ?? {}

	const effects = [
		...pocket( pair, reference ).effects,
		co2Depletion( {
			co2 : at.co2,
			airflow : at.airflow,
			light : at.light,
			reference : reference?.co2,
		} ),
		shadeAvoidance( at ),
	]

	const benefits = effects.filter( e => e.observed === true && COUPLING_BY_ID[ e.effect ]?.sign === 'benefit' )
	const costs = effects.filter( e => e.observed === true && COUPLING_BY_ID[ e.effect ]?.sign === 'cost' )
	const unknown = effects.filter( e => e.observed === null )

	return {
		...near,
		effects,
		benefits : benefits.map( e => e.effect ),
		costs : costs.map( e => e.effect ),
		unknown : unknown.map( e => e.effect ),
		why : costs.length
			? `Being this close is measurably costing these two: ${costs.map( e => e.effect ).join( ', ' )}. That is not an argument for separating them on its own — it is an argument for moving the air.`
			: benefits.length
				? `Being this close is measurably helping both: ${benefits.map( e => e.effect ).join( ', ' )}.`
				: `Nothing about this pairing is measurable with what is instrumented. ${unknown.length} effect${unknown.length === 1 ? '' : 's'} could not be assessed, which is not the same as the pairing doing nothing.`,
	}

}

/**
 * The warning one plant sends its neighbours when it finds a pest.
 *
 * The deliberate substitute for volatile signalling. A plant that has found
 * something tells the plants near enough to be next, and they raise their own
 * inspection rate rather than waiting for their scheduled look.
 *
 * The asymmetry is on purpose. A false alarm costs a few extra inspections; a
 * missed one costs a room. So this fires on *suspicion*, not confirmation, and
 * says which it was.
 *
 * @param   {object} finding  - `{suspected, confirmed, what, from}`.
 * @param   {object} [opts]   - `{ metres }` to the neighbour.
 * @returns {object|null}     The alert, or null if there is nothing to say.
 */
export function primingAlert( finding = {}, opts = {} ) {
	finding = finding ?? {}
	opts = opts ?? {}

	if ( !finding.suspected && !finding.confirmed ) return null

	const near = finite( opts.metres ) && opts.metres <= COUPLING_RANGE

	return {
		effect : COUPLING.PRIMING.id,
		substitute : true,
		confirmed : Boolean( finding.confirmed ),
		what : finding.what ?? 'something biotic',
		from : finding.from ?? null,
		urgency : near ? 'high' : 'normal',
		why : `${finding.confirmed ? 'Confirmed' : 'Suspected'} ${finding.what ?? 'pest or infection'} on "${finding.from ?? 'a plant in this colony'}"${near ? `, ${opts.metres}m away — close enough that mites can walk it` : ''}. This is the message a plant would send with methyl jasmonate if anything here could smell it; it goes over the channel instead, and it is sent on suspicion because a few wasted inspections cost less than a room.`,
	}

}

/**
 * What a plant should do on receiving one.
 *
 * @param   {object} alert - From `primingAlert`.
 * @returns {object}       `{prime, inspectWithin, why}`.
 */
export function receivePriming( alert ) {

	if ( !alert ) return {
		prime : false,
		why : 'No alert.',
	}

	const hours = alert.urgency === 'high' ? 6 : 24

	return {
		prime : true,
		inspectWithin : hours,
		confirmed : alert.confirmed,
		why : `Raising inspection to within ${hours}h. Nothing has been found on this plant — that is the point of priming, and it is why the response is to look sooner rather than to treat. Treating on a neighbour's finding would be dosing a plant for a problem it may not have.`,
	}

}

/**
 * Configuration-time notes for two plants that will share a substrate.
 *
 * Nothing here is measured and nothing here is enforced. It is stated at setup
 * because that is the only moment it can be acted on, and left out of every
 * runtime judgement because none of it can be checked afterwards.
 *
 * @param   {object} [opts] - `{ sharedSubstrate, livingSubstrate, species }`.
 * @returns {object[]}      Notes.
 */
export function substrateNotes( opts = {} ) {
	opts = opts ?? {}

	if ( !opts.sharedSubstrate ) return []

	const notes = [ {
		effect : COUPLING.ALLELOPATHY.id,
		measurable : false,
		why : COUPLING.ALLELOPATHY.why,
	} ]

	if ( opts.livingSubstrate ) notes.push( {
		effect : COUPLING.MYCORRHIZAL.id,
		measurable : false,
		why : COUPLING.MYCORRHIZAL.why,
	} )

	notes.push( {
		effect : 'shared-substrate-moisture',
		measurable : true,
		why : 'The one consequence of a shared pot that is measurable: a single soil probe now speaks for two root systems drawing on it at different rates, and watering to one plant\'s reading waters both. Two probes, or treat the reading as the pot\'s rather than either plant\'s.',
	} )

	return notes

}
