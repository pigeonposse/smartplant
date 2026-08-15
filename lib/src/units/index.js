/**
 * Celsius or Fahrenheit, and the one rule that keeps it safe.
 *
 * Somebody in Ohio wiring their first plant should not have to read
 * "Temperature: 21.3°C" and do arithmetic in their head. That is the whole of
 * the feature, and it would be a trivial one if a unit were only a suffix.
 *
 * ## It is a display setting, and nothing below the display knows about it
 *
 * Every threshold in this library, every archetype band, the Tetens equation
 * behind VPD, the thermal stress index, the coupling model — all of it is in
 * Celsius, and all of it stays in Celsius. The unit is applied at the last
 * possible moment, on its way to a screen or a sentence.
 *
 * That is not laziness about a conversion. A number that changes unit as it
 * moves between layers is a number that will eventually arrive somewhere still
 * carrying the wrong one, and the failure is silent: 70 is a comfortable room
 * in Fahrenheit and lethal in Celsius, 15 is a cool room in Celsius and a
 * freezing one in Fahrenheit. Both of those pass every range check in the
 * library, which is exactly why neither would ever be caught.
 *
 * ## So the sensor declares its own unit, separately
 *
 * The other half of the problem is real and unrelated: plenty of probes sold in
 * the US report Fahrenheit. That is a fact about the wire, not a preference
 * about the screen, and conflating them is how a person who set
 * `units: 'imperial'` because they think in Fahrenheit ends up double
 * converting a probe that was already Celsius.
 *
 * So a driver may declare `{ unit: 'F' }` and the reading is converted **on the
 * way in**, once, at the boundary. After that the library only ever sees
 * Celsius, whatever the display is set to.
 *
 * ## And a plain wrong number is caught rather than converted
 *
 * `plausible()` exists because the most common mistake is not a missing setting
 * but a mislabelled probe. A room at "72°C" is not a hot room, it is a
 * Fahrenheit probe declared as Celsius — and saying so is more use than
 * quietly rescaling it, which would hide a wiring error behind a plausible
 * number for the rest of the plant's life.
 */

/** What a person can be shown. */
export const UNITS = {
	METRIC   : 'metric',
	IMPERIAL : 'imperial',
}

/** How a sensor can declare what it is sending. */
export const SENSOR_UNITS = {
	C : 'C',
	F : 'F',
}

/** Room temperature in Fahrenheit, as a Celsius number. The giveaway. */
export const SUSPICIOUS_C = 45

const finite = Number.isFinite

/**
 * Fahrenheit from Celsius.
 *
 * @param   {number} c - Celsius.
 * @returns {number}   Fahrenheit.
 */
export const toF = c => finite( c ) ? c * 9 / 5 + 32 : c

/**
 * Celsius from Fahrenheit.
 *
 * @param   {number} f - Fahrenheit.
 * @returns {number}   Celsius.
 */
export const toC = f => finite( f ) ? ( f - 32 ) * 5 / 9 : f

/**
 * Which unit a plant displays in.
 *
 * Metric by default, and deliberately not guessed from a locale: a Canadian
 * laptop set to en-US would silently flip every temperature on the screen, and
 * the only signal that anything had happened would be numbers that still look
 * like plausible temperatures.
 *
 * @param   {object} config - The plant config.
 * @returns {string}        `'metric'` or `'imperial'`.
 */
export function resolveUnits( config ) {

	const u = config?.units ?? config?.unit

	if ( u === UNITS.IMPERIAL || u === 'F' || u === 'fahrenheit' ) return UNITS.IMPERIAL
	return UNITS.METRIC

}

/**
 * The suffix for a temperature in this system.
 *
 * @param   {string} units - From `resolve`.
 * @returns {string}       `'°C'` or `'°F'`.
 */
export const temperatureSymbol = units => units === UNITS.IMPERIAL ? '°F' : '°C'

/**
 * A temperature, as a number in the display unit.
 *
 * Rounded to one decimal, which is more precision than any of these sensors
 * actually has and less than would make the screen unreadable.
 *
 * @param   {number} celsius - Always Celsius coming in.
 * @param   {string} units   - From `resolve`.
 * @returns {number}         The displayed number.
 */
export function temperatureValue( celsius, units ) {

	if ( !finite( celsius ) ) return celsius

	const out = units === UNITS.IMPERIAL ? toF( celsius ) : celsius
	return Math.round( out * 10 ) / 10

}

/**
 * A temperature ready to print.
 *
 * @param   {number} celsius - Always Celsius coming in.
 * @param   {string} units   - From `resolve`.
 * @returns {string}         e.g. `'21.3°C'` or `'70.3°F'`.
 */
export function formatTemperature( celsius, units ) {

	if ( !finite( celsius ) ) return '—'
	return `${temperatureValue( celsius, units )}${temperatureSymbol( units )}`

}

/**
 * A comfortable band, in the display unit.
 *
 * Converted as two temperatures rather than as a width: a 10-degree band in
 * Celsius is an 18-degree band in Fahrenheit, and scaling the width by 9/5
 * without shifting the offset produces a band that looks right and is not.
 *
 * @param   {object} band  - `{min, max}` in Celsius.
 * @param   {string} units - From `resolve`.
 * @returns {object}       `{min, max}` in the display unit.
 */
export function temperatureBand( input, units ) {

	if ( !input ) return input

	return {
		...input,
		min : temperatureValue( input.min, units ),
		max : temperatureValue( input.max, units ),
	}

}

/**
 * Normalise a reading to Celsius on its way in.
 *
 * Applied once, at the driver boundary. Everything after this point in the
 * library may assume Celsius without checking.
 *
 * @param   {object} reading - The raw reading.
 * @param   {string} [unit]  - What the driver says it sends: `'C'` or `'F'`.
 * @returns {object}         The reading, in Celsius.
 */
export function normalise( reading, unit ) {

	if ( !reading || unit !== SENSOR_UNITS.F ) return reading

	const out = { ...reading }

	// Every temperature the driver could have sent, not just the air one. A
	// probe reporting Fahrenheit reports it for the soil too, and converting one
	// of the two is worse than converting neither: the two would then disagree
	// by forty degrees and every layer that compares them would draw a
	// conclusion from the difference.
	for ( const key of [ 'temperature', 'leafTemperature', 'soilTemperature', 'dewPoint' ] ) {

		if ( finite( out[ key ] ) ) out[ key ] = Math.round( toC( out[ key ] ) * 100 ) / 100

	}

	return out

}

/**
 * Does this Celsius number look like it was really Fahrenheit?
 *
 * The check that catches the mistake this whole file is arranged around. It
 * does not convert anything — a reading this refuses is a wiring problem to
 * fix, and rescaling it would hide that for the life of the plant.
 *
 * @param   {number} celsius - The value as declared.
 * @returns {object}         `{ok, why}`.
 */
export function plausibleTemperature( celsius ) {

	if ( !finite( celsius ) ) return {
		ok : true,
		why : 'Nothing to check.',
	}

	if ( celsius > SUSPICIOUS_C ) {

		return {
			ok : false,
			suspect : SENSOR_UNITS.F,
			asFahrenheit : Math.round( toC( celsius ) * 10 ) / 10,
			why : `${celsius}°C is hotter than any room a plant survives in, and it is almost exactly what a Fahrenheit probe declared as Celsius looks like — ${celsius}°F is ${Math.round( toC( celsius ) * 10 ) / 10}°C, which is an ordinary room. Declare the driver's unit with { unit: "F" } rather than leaving it: the conversion belongs at the wire, once, and a number rescaled here would hide the mislabelling for the life of this plant.`,
		}

	}

	if ( celsius < -30 ) {

		return {
			ok : false,
			why : `${celsius}°C is colder than anything a houseplant is alive in. This is a wiring fault or a disconnected probe rather than a plant in distress.`,
		}

	}

	return {
		ok : true,
		why : 'Within the range a plant can be in.',
	}

}
