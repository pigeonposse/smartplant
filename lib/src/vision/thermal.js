/**
 * The plant's own temperature, everywhere at once.
 *
 * A contact leaf probe gives one number from one leaf, and the devices catalogue
 * already says that single sensor unlocks more than any other addition — real
 * leaf VPD, inferred stomatal opening, water stress hours before a leaf visibly
 * wilts. A thermal camera gives that number for every pixel of the canopy, with
 * nothing touching the plant.
 *
 * Which is better in two ways and worse in one, and the one is the important
 * one to be clear about first.
 *
 * ## An uncalibrated thermal camera does not know the temperature
 *
 * A Lepton-class sensor is accurate to roughly ±5 °C in absolute terms and to a
 * few hundredths *relative to itself within one frame*. Emissivity, the
 * reflected background, the distance and the sensor's own temperature all shift
 * the absolute reading, and a leaf is not a blackbody.
 *
 * So absolute values from here are not trustworthy and are not offered as
 * `leafTemperature`. What is trustworthy is **differences inside one frame**,
 * and it happens that every useful thing here is a difference:
 *
 *   · leaf minus air — the whole basis of thermal water-stress sensing
 *   · leaf minus leaf — which part of the canopy is transpiring and which is not
 *   · the spread across the canopy — an even canopy versus a patchy one
 *
 * A transpiring leaf sits *below* air temperature because evaporation cools it.
 * A leaf whose stomata have closed stops cooling and drifts up toward air. That
 * gap is the measurement, it is a difference, and it survives an uncalibrated
 * sensor as long as the air temperature comes from a thermometer rather than
 * from the same thermal frame.
 *
 * ## Which is why it needs an air reading it did not take itself
 *
 * Reading air temperature off the background of the same thermal image would
 * cancel the very offset that makes the difference reliable — both numbers would
 * be wrong by the same unknown amount, and their difference would look perfect
 * while being meaningless. So the air reading comes from the ordinary sensor,
 * and without one this reports the canopy's internal spread and refuses the
 * stress index.
 *
 * ## No hardware library is imported
 *
 * `flir-lepton`, `thermal-js` and the rest are somebody else's packages, they
 * change, and several of them need a native build. The same contract as the
 * presence and lidar drivers applies: a callback hands over a frame of
 * temperatures, and whatever produced it is the caller's business.
 */

/** What a frame can support. */
export const THERMAL = {
	/** Differences within the frame. Always available. */
	RELATIVE : 'relative',
	/** Leaf against air. Needs a separate air thermometer. */
	STRESS   : 'stress',
}

/**
 * How far below air a well-watered leaf sits, in still indoor air.
 *
 * The reference point for the stress index. Outdoors under full sun the gap is
 * larger; indoors, with less radiation and less wind, it is small — which means
 * the whole scale here is compressed and a difference of half a degree matters.
 */
export const FULLY_WATERED_GAP = -1.5

/** And where a leaf sits once it has given up cooling itself. */
export const NON_TRANSPIRING_GAP = 1.5

const finite = Number.isFinite

/**
 * Basic statistics over the temperatures in a frame.
 *
 * @param   {object} frame - `{width, height, data}` where data is °C per pixel.
 * @returns {object}       `{known, min, max, mean, why}`.
 */
export function frameStats( frame ) {

	const data = frame?.data

	if ( !data || typeof data.length !== 'number' || data.length < 16 ) {

		return {
			known : false,
			why : 'No usable thermal frame. Expected { width, height, data } where data is one temperature per pixel — a Lepton gives 160×120, which is 19 200 of them.',
		}

	}

	let min = Infinity, max = -Infinity, sum = 0, n = 0

	for ( let i = 0; i < data.length; i++ ) {

		const v = data[ i ]
		if ( !finite( v ) ) continue
		if ( v < min ) min = v
		if ( v > max ) max = v
		sum += v
		n++

	}

	if ( !n ) {

		return {
			known : false,
			why : 'Every pixel in the frame is unusable.',
		}

	}

	return {
		known : true,
		pixels : n,
		min : Number( min.toFixed( 2 ) ),
		max : Number( max.toFixed( 2 ) ),
		mean : Number( ( sum / n ).toFixed( 2 ) ),
		spread : Number( ( max - min ).toFixed( 2 ) ),
		why : `${n} pixels between ${min.toFixed( 1 )} and ${max.toFixed( 1 )}. These are the sensor's own numbers and they carry its absolute error — what they are good for is the differences between them.`,
	}

}

/**
 * Which pixels are the plant.
 *
 * A leaf transpiring in a room is the coldest thing in the frame, so the plant
 * separates from its background by being cool rather than by being green. That
 * is convenient and it fails in exactly one case worth naming: a plant that has
 * stopped transpiring altogether is at room temperature and disappears into the
 * wall behind it.
 *
 * So the segmentation says how confident it is, and a frame with no cool region
 * is reported as ambiguous rather than as a plant at room temperature.
 *
 * @param   {object} frame  - The frame.
 * @param   {object} [opts] - `{ percentile }`. Default the coolest quarter.
 * @returns {object}        `{known, canopy, why}`.
 */
export function segment( frame, opts = {} ) {

	const stats = frameStats( frame )
	if ( !stats.known ) return stats

	const percentile = opts?.percentile ?? 0.25
	const values = Array.from( frame.data ).filter( finite ).sort( ( a, b ) => a - b )
	const cut = values[ Math.floor( values.length * percentile ) ]

	const canopy = values.filter( v => v <= cut )
	const background = values.filter( v => v > cut )

	const bgMean = background.length
		? background.reduce( ( a, b ) => a + b, 0 ) / background.length
		: null
	const canopyMean = canopy.reduce( ( a, b ) => a + b, 0 ) / canopy.length

	const separation = finite( bgMean ) ? bgMean - canopyMean : 0

	// Under half a degree of separation is not a plant standing out from a wall,
	// it is noise being split at a percentile.
	if ( separation < 0.5 ) {

		return {
			known : false,
			separation : Number( separation.toFixed( 2 ) ),
			why : `The coolest quarter of this frame is only ${separation.toFixed( 2 )}°C below the rest, which is not enough to call it a plant. Either the camera is not pointed at one, or — and this is the case worth knowing — the plant has stopped transpiring and is now at room temperature, which makes it invisible against the wall behind it. A plant that vanishes from a thermal image is a finding, not a failure to find one.`,
		}

	}

	return {
		known : true,
		pixels : canopy.length,
		mean : Number( canopyMean.toFixed( 2 ) ),
		min : Number( canopy[ 0 ].toFixed( 2 ) ),
		max : Number( canopy.at( -1 ).toFixed( 2 ) ),
		spread : Number( ( canopy.at( -1 ) - canopy[ 0 ] ).toFixed( 2 ) ),
		background : finite( bgMean ) ? Number( bgMean.toFixed( 2 ) ) : null,
		separation : Number( separation.toFixed( 2 ) ),
		why : `${canopy.length} pixels sitting ${separation.toFixed( 1 )}°C below the rest of the frame — that is the canopy, cooler than the room because it is evaporating.`,
	}

}

/**
 * How hard this plant is working to cool itself.
 *
 * The established measurement built on exactly this: leaf temperature against
 * air, scaled between a well-watered leaf and one that has stopped transpiring.
 * Zero is a plant cooling itself freely; one is a plant that has closed up.
 *
 * @param   {object} frame   - The thermal frame.
 * @param   {number} airTemp - From a thermometer, not from this frame.
 * @param   {object} [opts]  - `{ wet, dry }` reference gaps.
 * @returns {object}         `{known, index, why}`.
 */
export function stressIndex( frame, airTemp, opts = {} ) {

	const canopy = segment( frame, opts )
	if ( !canopy.known ) return canopy

	if ( !finite( airTemp ) ) {

		return {
			known : false,
			canopy,
			missing : [ 'temperature' ],
			why : `The canopy is at ${canopy.mean}°C by this sensor's reckoning, and without an air temperature from a separate thermometer that number means very little — it carries the camera's absolute error, which can be five degrees. Taking the air reading off the background of the same frame would cancel that error out of both numbers and make their difference look perfect while meaning nothing. This needs a real thermometer.`,
		}

	}

	const gap = canopy.mean - airTemp
	const wet = opts?.wet ?? FULLY_WATERED_GAP
	const dry = opts?.dry ?? NON_TRANSPIRING_GAP

	const index = Math.min( 1.2, Math.max( -0.2, ( gap - wet ) / ( dry - wet ) ) )

	return {
		known : true,
		index : Number( index.toFixed( 2 ) ),
		gap : Number( gap.toFixed( 2 ) ),
		canopy,
		airTemp,
		why : index <= 0.3
			? `The canopy sits ${Math.abs( gap ).toFixed( 1 )}°C ${gap < 0 ? 'below' : 'above'} the air. A leaf cools itself by evaporating, so a cool canopy is a plant with its stomata open and water to spend — this one is comfortable.`
			: index >= 0.7
				? `The canopy is only ${Math.abs( gap ).toFixed( 1 )}°C ${gap < 0 ? 'below' : 'above'} the air, which means it has largely stopped cooling itself. A leaf that is not evaporating is a leaf that has shut its stomata, and indoors that is usually water — hours before it looks wilted.`
				: `The canopy is ${Math.abs( gap ).toFixed( 1 )}°C ${gap < 0 ? 'below' : 'above'} air, part way between freely transpiring and closed up. Worth watching rather than acting on: indoors this whole scale is compressed into about three degrees, so half a degree of drift moves it a long way.`,
	}

}

/**
 * Is the canopy working evenly?
 *
 * The thing one contact probe fundamentally cannot see. A single leaf clip tells
 * you about that leaf; a frame tells you whether one side of the plant has
 * stopped transpiring while the other has not — which is what a blocked vessel,
 * a root problem on one side, or a branch in a draught looks like before it
 * looks like anything.
 *
 * @param   {object} frame  - The frame.
 * @param   {object} [opts] - `{ uneven }` degrees that count. Default 2.
 * @returns {object}        `{even, why}`.
 */
export function evenness( frame, opts = {} ) {

	const canopy = segment( frame, opts )
	if ( !canopy.known ) return canopy

	const limit = opts?.uneven ?? 2

	return {
		even : canopy.spread <= limit,
		spread : canopy.spread,
		why : canopy.spread <= limit
			? `${canopy.spread}°C across the canopy, which is one plant doing one thing.`
			: `${canopy.spread}°C between the coolest and warmest parts of the canopy. Part of this plant is transpiring and part is not, and a contact probe on one leaf would have reported whichever it happened to be clipped to. A blocked vessel, a root problem on one side, or a branch sitting in a draught all look like this well before they look like anything visible.`,
	}

}

/**
 * A false-colour map, for the panel.
 *
 * Relative by construction: the scale runs from the coolest pixel in the frame
 * to the warmest, so it shows structure honestly and says nothing about absolute
 * temperature — which is exactly what this sensor can support.
 *
 * @param   {object} frame  - The frame.
 * @param   {object} [opts] - `{ width }` to downsample to.
 * @returns {object}        `{rows, min, max, why}`.
 */
export function heatmap( frame, opts = {} ) {

	const stats = frameStats( frame )
	if ( !stats.known ) return stats

	const w = frame.width ?? Math.round( Math.sqrt( frame.data.length ) )
	const h = frame.height ?? Math.round( frame.data.length / w )
	const out = opts?.width ?? 48
	const step = Math.max( 1, Math.floor( w / out ) )

	const rows = []
	const span = stats.max - stats.min || 1

	for ( let y = 0; y < h; y += step * 2 ) {

		const row = []

		for ( let x = 0; x < w; x += step ) {

			const v = frame.data[ y * w + x ]
			row.push( finite( v ) ? Math.round( ( ( v - stats.min ) / span ) * 100 ) / 100 : null )

		}

		rows.push( row )

	}

	return {
		rows,
		min : stats.min,
		max : stats.max,
		relative : true,
		why : `Scaled between the coolest and warmest pixel in this frame. Relative on purpose — an uncalibrated sensor knows how parts of a scene differ far better than it knows how warm any of them is.`,
	}

}
