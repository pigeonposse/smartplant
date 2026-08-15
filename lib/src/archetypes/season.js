/**
 * The same plant wants different things in January and in July.
 *
 * The archetype tables give one set of comfortable bands per plant type, and
 * they are wrong for most of the year. A tropical understorey plant is
 * comfortable between 15 and 32 °C — but the bottom of that range is a
 * reasonable winter night and a bad summer one, and the same 20% soil moisture
 * is a plant coasting through dormancy and a plant in trouble in June.
 *
 * There are three things to get right, and only the first is obvious.
 *
 * ## Hemispheres
 *
 * There was no notion of one anywhere in the library, which means a northern
 * calendar applied to a user in Santiago or Melbourne is inverted for six months
 * a year — telling them to cut back watering in their spring and to feed heavily
 * going into their winter. It is the kind of error that looks like a plant doing
 * badly rather than like a bug.
 *
 * So the hemisphere is asked for, and when it is not known the seasonal
 * adjustment does not run at all. Guessing it from a timezone would be a guess
 * dressed as a fact, and half the guesses would be backwards.
 *
 * ## Indoors, seasons are muted but photoperiod is not
 *
 * A heated flat holds temperature far steadier than the garden outside it, so
 * the seasonal shift in what a plant *needs* is smaller indoors than a climate
 * table would suggest. What is not muted is daylength: a windowsill in December
 * gets a third of the light it gets in June whatever the thermostat does.
 *
 * So the light and water adjustments are the strong ones, and temperature moves
 * least. That is the opposite of what an outdoor growing calendar would say.
 *
 * ## And the plant's own second year beats every table here
 *
 * This is the part that matters most and is easiest to leave out. These bands
 * are a starting guess for a plant nobody has watched through a winter yet. Once
 * there *is* a record of what this plant actually did last January, that record
 * is better than any archetype average — it knows the flat, the window and the
 * radiator.
 *
 * So the seasonal prior fades as the plant's own history accumulates, exactly as
 * an inherited prior does. A plant in its third year is running on itself.
 */

/** Where on the planet, which decides which way the year runs. */
export const HEMISPHERE = {
	NORTH : 'north',
	SOUTH : 'south',
	/** Within about 15° of the equator there is no thermal season worth modelling. */
	TROPICAL : 'tropical',
}

/** The four, by month index in the northern hemisphere. */
export const SEASON = {
	WINTER : 'winter',
	SPRING : 'spring',
	SUMMER : 'summer',
	AUTUMN : 'autumn',
}

const NORTHERN = [
	SEASON.WINTER, SEASON.WINTER,
	SEASON.SPRING, SEASON.SPRING, SEASON.SPRING,
	SEASON.SUMMER, SEASON.SUMMER, SEASON.SUMMER,
	SEASON.AUTUMN, SEASON.AUTUMN, SEASON.AUTUMN,
	SEASON.WINTER,
]

/**
 * What each season does to a plant's needs, as multipliers on its bands.
 *
 * Deliberately modest. These describe a plant indoors, where the thermostat
 * flattens most of the year and the window does not — so `light` moves most,
 * `soil` follows it because a plant photosynthesising less drinks less, and
 * `temperature` barely moves at all.
 *
 * A grower's outdoor calendar would have these the other way round, and applying
 * one indoors is how a plant ends up being watered on a schedule that belongs to
 * a garden.
 */
export const SEASONAL = {
	[ SEASON.WINTER ] : {
		light : 0.55,
		soil : 0.7,
		temperature : 0.97,
		humidity : 1,
		why : 'A third of the daylight and a plant that has slowed down to match. It photosynthesises less, so it drinks less — the commonest way a houseplant is killed is being watered in January on a July schedule.',
	},
	[ SEASON.SPRING ] : {
		light : 0.85,
		soil : 1,
		temperature : 1,
		humidity : 1,
		why : 'Coming back. Demand rises ahead of the light, which is why a plant can look thirsty in March on the same watering that suited it in February.',
	},
	[ SEASON.SUMMER ] : {
		light : 1,
		soil : 1.15,
		temperature : 1.03,
		humidity : 0.95,
		why : 'The reference. Longest days, highest demand, and the drier air of a heated or air-conditioned room working against it.',
	},
	[ SEASON.AUTUMN ] : {
		light : 0.75,
		soil : 0.85,
		temperature : 0.99,
		humidity : 1,
		why : 'Winding down. Watering should follow the light down rather than the calendar, and it usually lags by weeks.',
	},
}

/**
 * How long before a plant's own record replaces this table.
 *
 * A full year is when its own history first covers every season; by two it has
 * seen each of them twice and the table has nothing left to add.
 */
export const FADES_OVER_DAYS = 730

const finite = Number.isFinite

/**
 * Which season is it for this plant?
 *
 * @param   {object} [opts] - `{ hemisphere, at }`.
 * @returns {object}        `{season, known, why}`.
 */
export function seasonNow( opts = {} ) {

	opts = opts ?? {}

	const hemisphere = opts.hemisphere

	if ( !hemisphere ) {

		return {
			season : null,
			known : false,
			why : 'No hemisphere was given, so which half of the year this is cannot be worked out. It is not guessed from a clock or a timezone: half the guesses would be exactly six months wrong, and that produces advice to cut back watering in somebody\'s spring — which looks like a plant doing badly rather than like a mistake.',
		}

	}

	if ( hemisphere === HEMISPHERE.TROPICAL ) {

		return {
			season : null,
			known : true,
			tropical : true,
			why : 'Near the equator there is no thermal season worth modelling — there is a wet season and a dry one, and which months those are depends on the specific place rather than on the latitude. The plant\'s own record is the only useful guide, and it is a better one than any table.',
		}

	}

	const month = finite( opts.month ) ? opts.month : new Date( opts.at ?? Date.now() ).getMonth()
	const north = NORTHERN[ month ]

	const season = hemisphere === HEMISPHERE.SOUTH
		? {
			winter : SEASON.SUMMER,
			summer : SEASON.WINTER,
			spring : SEASON.AUTUMN,
			autumn : SEASON.SPRING,
		}[ north ]
		: north

	return {
		season,
		known : true,
		hemisphere,
		month,
		why : `${season} in the ${hemisphere}ern hemisphere.`,
	}

}

/**
 * How much this table still has to say, given what the plant has lived through.
 *
 * @param   {number} days - How long this plant has been recorded.
 * @returns {object}      `{weight, why}`.
 */
export function seasonalWeight( days ) {

	if ( !finite( days ) || days <= 0 ) {

		return {
			weight : 1,
			why : 'No history at all, so the table is everything there is.',
		}

	}

	const weight = Math.max( 0, 1 - days / FADES_OVER_DAYS )

	return {
		weight : Number( weight.toFixed( 3 ) ),
		days : Math.round( days ),
		why : weight <= 0
			? `${Math.round( days )} days of its own record, covering every season at least twice. The table has nothing left to add — this plant knows its own flat, its own window and its own radiator better than any archetype average does.`
			: weight > 0.6
				? `${Math.round( days )} days recorded, so most of what is known about this plant's year still comes from the table rather than from the plant.`
				: `${Math.round( days )} days recorded. Its own history is now carrying most of the weight, and the table is fading out of the way as it should.`,
	}

}

/**
 * Bend a set of comfortable bands toward the season.
 *
 * @param   {object} ranges - `{metric: {min, max}}`.
 * @param   {object} [opts] - `{ hemisphere, days, at, month }`.
 * @returns {object}        `{ranges, applied, why}`.
 */
export function seasonalRanges( ranges, opts = {} ) {

	opts = opts ?? {}

	const when = seasonNow( opts )

	if ( !when.season ) {

		return {
			ranges,
			applied : false,
			season : null,
			why : when.why,
		}

	}

	const { weight, why : fading } = seasonalWeight( opts.days )

	if ( weight <= 0 ) {

		return {
			ranges,
			applied : false,
			season : when.season,
			weight : 0,
			why : fading,
		}

	}

	const shift = SEASONAL[ when.season ]
	const out = {}

	for ( const [ metric, band ] of Object.entries( ranges ?? {} ) ) {

		const factor = shift[ metric ]

		if ( !finite( factor ) || !finite( band?.min ) || !finite( band?.max ) ) {

			out[ metric ] = band
			continue

		}

		// Blended by weight rather than applied whole: a plant halfway through its
		// second year gets half the table and half itself.
		const blended = 1 + ( factor - 1 ) * weight

		out[ metric ] = {
			...band,
			min : Number( ( band.min * blended ).toFixed( 2 ) ),
			max : Number( ( band.max * blended ).toFixed( 2 ) ),
		}

	}

	return {
		ranges : out,
		applied : true,
		season : when.season,
		hemisphere : when.hemisphere,
		weight,
		why : `${when.why} ${shift.why} Applied at ${Math.round( weight * 100 )}% — ${fading}`,
	}

}

/**
 * What the plant's own record says about this season, if it has seen one.
 *
 * The thing that eventually replaces the table. Not an average of the whole
 * history: an average of *this month last year*, which is the only part of the
 * record that describes this part of the year.
 *
 * @param   {object[]} readings - The full history, oldest first.
 * @param   {object}   [opts]   - `{ at, metric }`.
 * @returns {object}            `{known, band, why}`.
 */
export function seasonFromHistory( readings, opts = {} ) {

	opts = opts ?? {}

	const metric = opts.metric ?? 'soil'
	const at = new Date( opts.at ?? Date.now() )
	const month = at.getMonth()

	const sameSeason = ( readings ?? [] ).filter( r => {

		const t = new Date( r?.t ?? r?.timestamp )
		if ( Number.isNaN( t.getTime() ) ) return false

		// Same month, any earlier year.
		return t.getMonth() === month
			&& t.getFullYear() < at.getFullYear()
			&& finite( r[ metric ] )

	} )

	if ( sameSeason.length < 20 ) {

		return {
			known : false,
			samples : sameSeason.length,
			why : `${sameSeason.length} readings from this month in an earlier year, and this needs 20. A plant that has not been through a winter has nothing of its own to say about winter, however much data it has from summer.`,
		}

	}

	const values = sameSeason.map( r => r[ metric ] ).sort( ( a, b ) => a - b )
	const at10 = values[ Math.floor( values.length * 0.1 ) ]
	const at90 = values[ Math.floor( values.length * 0.9 ) ]

	return {
		known : true,
		samples : sameSeason.length,
		band : {
			min : Number( at10.toFixed( 2 ) ),
			max : Number( at90.toFixed( 2 ) ),
		},
		why : `${sameSeason.length} readings of ${metric} from this month last year, sitting between ${at10.toFixed( 1 )} and ${at90.toFixed( 1 )}. This is what this plant actually did in this room at this time of year, which beats any archetype average.`,
	}

}
