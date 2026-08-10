/**
 * Plant phenotyping from pixels — the analyses PlantCV performs, implemented
 * directly over a raw frame so they run anywhere Node runs: no Python, no
 * OpenCV build, no model download.
 *
 * These are deliberately the *classical* measurements, because they are the ones
 * that are cheap, interpretable and reproducible. A neural detector tells you
 * "leaf, 0.94". A vegetation index tells you the plant lost 8% of its canopy
 * since Tuesday, and you can check the arithmetic.
 *
 * @typedef {object} Frame
 * @property {number}     width    - Pixels.
 * @property {number}     height   - Pixels.
 * @property {number}     channels - 3 (RGB) or 4 (RGBA).
 * @property {Uint8Array} data     - Interleaved samples, row-major.
 */

/**
 * Excess Green index (ExG = 2G − R − B), the standard vegetation index for
 * ordinary RGB cameras. Normalized to −1..1.
 *
 * @param   {number} r - Red 0-255.
 * @param   {number} g - Green 0-255.
 * @param   {number} b - Blue 0-255.
 * @returns {number}   −1..1, higher is greener.
 */
export function excessGreen( r, g, b ) {

	const sum = r + g + b
	if ( sum === 0 ) return 0
	// Chromatic coordinates first, so the index is invariant to brightness —
	// otherwise every measurement tracks the room lights instead of the plant.
	const rn = r / sum, gn = g / sum, bn = b / sum
	return 2 * gn - rn - bn

}

/** Pixel accessor for either RGB or RGBA layouts. */
function pixel( frame, i ) {

	const o = i * frame.channels
	return {
		r : frame.data[ o ],
		g : frame.data[ o + 1 ],
		b : frame.data[ o + 2 ],
	}

}

/**
 * Segment plant from background using the Excess Green index.
 *
 * @param   {Frame}  frame           - Input frame.
 * @param   {object} [opts]          - Options.
 * @param   {number} [opts.threshold]- ExG threshold. Default 0.05.
 * @returns {{mask: Uint8Array, count: number, coverage: number}} Binary mask.
 */
export function segmentPlant( frame, opts = {} ) {

	const threshold = opts.threshold ?? 0.05
	const n = frame.width * frame.height
	const mask = new Uint8Array( n )
	let count = 0

	for ( let i = 0; i < n; i++ ) {

		const { r, g, b } = pixel( frame, i )
		// Very dark pixels have unreliable chromaticity — a black background can
		// otherwise read as "green" from sensor noise alone.
		if ( r + g + b < 45 ) continue
		if ( excessGreen( r, g, b ) >= threshold ) {

			mask[ i ] = 1
			count++

		}

	}

	return {
		mask,
		count,
		coverage : n ? Number( ( count / n ).toFixed( 5 ) ) : 0,
	}

}

/**
 * Colour composition of the plant pixels, split into the categories that carry
 * diagnostic meaning.
 *
 * Chlorosis (yellowing) suggests nitrogen or iron deficiency or overwatering;
 * necrosis (brown) suggests scorch, rot or advanced damage. Tracking their
 * fraction over days is how you see a problem before it is obvious.
 *
 * @param   {Frame}      frame - Input frame.
 * @param   {Uint8Array} mask  - Plant mask from `segmentPlant`.
 * @returns {object}           Fractions and mean colour.
 */
export function tissueComposition( frame, mask ) {

	let healthy = 0, chlorotic = 0, necrotic = 0, total = 0
	let sumR = 0, sumG = 0, sumB = 0

	for ( let i = 0; i < mask.length; i++ ) {

		if ( !mask[ i ] ) continue
		const { r, g, b } = pixel( frame, i )
		total++
		sumR += r
		sumG += g
		sumB += b

		const { h, s, v } = rgbToHsv( r, g, b )

		if ( v < 0.28 || ( h >= 15 && h <= 45 && s > 0.25 && v < 0.55 ) ) necrotic++
		else if ( h >= 40 && h <= 70 && s > 0.3 ) chlorotic++
		else healthy++

	}

	const frac = x => ( total ? Number( ( x / total ).toFixed( 4 ) ) : 0 )

	return {
		pixels    : total,
		healthy   : frac( healthy ),
		chlorotic : frac( chlorotic ),
		necrotic  : frac( necrotic ),
		meanColor : total
			? {
				r : Math.round( sumR / total ),
				g : Math.round( sumG / total ),
				b : Math.round( sumB / total ),
			}
			: null,
	}

}

/**
 * Canopy geometry: bounding box, centroid, and the vertical mass distribution
 * that reveals drooping.
 *
 * A turgid plant carries its canopy high and wide; a wilting one collapses
 * downward and inward. Comparing `verticalCentroid` across frames of a fixed
 * camera detects wilting hours before a human notices.
 *
 * @param   {Uint8Array} mask   - Plant mask.
 * @param   {number}     width  - Frame width.
 * @param   {number}     height - Frame height.
 * @returns {object}            Geometry.
 */
export function canopyGeometry( mask, width, height ) {

	let minX = width, maxX = -1, minY = height, maxY = -1
	let sumX = 0, sumY = 0, count = 0

	// Row profile: how much plant sits at each height.
	const rows = Array.from( { length : height }, () => 0 )

	for ( let y = 0; y < height; y++ ) {

		for ( let x = 0; x < width; x++ ) {

			if ( !mask[ y * width + x ] ) continue
			count++
			sumX += x
			sumY += y
			rows[ y ]++
			if ( x < minX ) minX = x
			if ( x > maxX ) maxX = x
			if ( y < minY ) minY = y
			if ( y > maxY ) maxY = y

		}

	}

	if ( !count ) return {
		found : false,
	}

	const boxW = maxX - minX + 1
	const boxH = maxY - minY + 1

	return {
		found            : true,
		pixels           : count,
		boundingBox      : {
			x : minX,
			y : minY,
			width : boxW,
			height : boxH,
		},
		centroid         : {
			x : Math.round( sumX / count ),
			y : Math.round( sumY / count ),
		},
		// 0 = canopy sits at the top of the frame, 1 = at the bottom.
		verticalCentroid : Number( ( sumY / count / height ).toFixed( 4 ) ),
		// Width over height: falls as a plant droops inward.
		aspectRatio      : Number( ( boxW / boxH ).toFixed( 3 ) ),
		// How much of the bounding box the plant actually fills. A sparse, leggy
		// plant scores low; a dense healthy one scores high.
		density          : Number( ( count / ( boxW * boxH ) ).toFixed( 4 ) ),
		rowProfile       : rows,
	}

}

/**
 * Full single-frame phenotype.
 *
 * @param   {Frame}  frame  - Input frame.
 * @param   {object} [opts] - Options forwarded to `segmentPlant`.
 * @returns {object}        Phenotype.
 */
export function analyzeFrame( frame, opts = {} ) {

	validateFrame( frame )

	const seg      = segmentPlant( frame, opts )
	const tissue   = tissueComposition( frame, seg.mask )
	const geometry = canopyGeometry( seg.mask, frame.width, frame.height )

	return {
		width     : frame.width,
		height    : frame.height,
		coverage  : seg.coverage,
		tissue,
		geometry,
		// A single 0-100 number the kernel can treat like any other metric.
		healthIndex : healthIndex( seg, tissue ),
		timestamp   : new Date(),
	}

}

/**
 * Visual health, 0-100.
 *
 * Combines how much healthy green tissue is present with how much of it has
 * gone yellow or brown. Deliberately simple and auditable.
 */
function healthIndex( seg, tissue ) {

	if ( !tissue.pixels ) return 0
	const quality = tissue.healthy - tissue.chlorotic * 0.5 - tissue.necrotic
	// Coverage saturates at 40% of frame: beyond that, more plant is not healthier.
	const presence = Math.min( 1, seg.coverage / 0.4 )
	return Math.max( 0, Math.min( 100, Math.round( quality * presence * 100 ) ) )

}

/**
 * Compare two phenotypes to measure change over time — growth, decline, wilting.
 *
 * @param   {object} before - Earlier `analyzeFrame` result.
 * @param   {object} after  - Later result.
 * @returns {object}        Deltas and an interpretation.
 */
export function compareFrames( before, after ) {

	const covDelta = after.coverage - before.coverage
	const covPct   = before.coverage > 0 ? ( covDelta / before.coverage ) * 100 : 0

	const droop = after.geometry?.found && before.geometry?.found
		? after.geometry.verticalCentroid - before.geometry.verticalCentroid
		: null

	const findings = []
	// Thresholds are relative and intentionally loose: a fixed camera still sees
	// lighting and breeze changes frame to frame.
	if ( covPct > 5 ) findings.push( `canopy grew ${covPct.toFixed( 1 )}%` )
	if ( covPct < -5 ) findings.push( `canopy shrank ${Math.abs( covPct ).toFixed( 1 )}%` )
	if ( droop !== null && droop > 0.02 ) findings.push( 'canopy has dropped — possible wilting' )
	if ( droop !== null && droop < -0.02 ) findings.push( 'canopy has lifted — turgor recovered' )

	const chlDelta = after.tissue.chlorotic - before.tissue.chlorotic
	const necDelta = after.tissue.necrotic - before.tissue.necrotic
	if ( chlDelta > 0.03 ) findings.push( `yellowing increased ${( chlDelta * 100 ).toFixed( 1 )} points` )
	if ( necDelta > 0.02 ) findings.push( `browning increased ${( necDelta * 100 ).toFixed( 1 )} points` )

	return {
		coverageDelta   : Number( covDelta.toFixed( 5 ) ),
		coveragePercent : Number( covPct.toFixed( 2 ) ),
		droopDelta      : droop === null ? null : Number( droop.toFixed( 4 ) ),
		chlorosisDelta  : Number( chlDelta.toFixed( 4 ) ),
		necrosisDelta   : Number( necDelta.toFixed( 4 ) ),
		healthDelta     : after.healthIndex - before.healthIndex,
		findings,
	}

}

/**
 * RGB to HSV. Hue in degrees, saturation and value in 0-1.
 *
 * @param   {number} r - Red 0-255.
 * @param   {number} g - Green 0-255.
 * @param   {number} b - Blue 0-255.
 * @returns {{h: number, s: number, v: number}} HSV.
 */
export function rgbToHsv( r, g, b ) {

	const rn = r / 255, gn = g / 255, bn = b / 255
	const max = Math.max( rn, gn, bn )
	const min = Math.min( rn, gn, bn )
	const d = max - min

	let h = 0
	if ( d !== 0 ) {

		if ( max === rn ) h = 60 * ( ( ( gn - bn ) / d ) % 6 )
		else if ( max === gn ) h = 60 * ( ( bn - rn ) / d + 2 )
		else h = 60 * ( ( rn - gn ) / d + 4 )

	}
	if ( h < 0 ) h += 360

	return {
		h,
		s : max === 0 ? 0 : d / max,
		v : max,
	}

}

/**
 * Build a frame from raw bytes.
 *
 * @param   {Uint8Array|Buffer} data     - Interleaved samples.
 * @param   {number}            width    - Pixels.
 * @param   {number}            height   - Pixels.
 * @param   {number}            [channels] - 3 or 4.
 * @returns {Frame}                      The frame.
 */
export function createFrame( data, width, height, channels = 3 ) {

	const frame = {
		width,
		height,
		channels,
		data : data instanceof Uint8Array ? data : new Uint8Array( data ),
	}
	validateFrame( frame )
	return frame

}

function validateFrame( frame ) {

	if ( !frame?.data || !frame.width || !frame.height ) {

		throw new Error( 'A frame needs { data, width, height, channels }.' )

	}
	const expected = frame.width * frame.height * frame.channels
	if ( frame.data.length < expected ) {

		throw new Error( `Frame buffer too small: expected ${expected} bytes for ${frame.width}x${frame.height}x${frame.channels}, got ${frame.data.length}.` )

	}

}

/**
 * Render a phenotype as a compact line for an AI prompt.
 *
 * @param   {object} p - `analyzeFrame` result.
 * @returns {string}   One-line brief.
 */
export function describePhenotype( p ) {

	if ( !p.geometry?.found ) return 'No plant detected in frame.'

	const parts = [
		`canopy covers ${( p.coverage * 100 ).toFixed( 1 )}% of frame`,
		`visual health ${p.healthIndex}/100`,
	]
	if ( p.tissue.chlorotic > 0.05 ) parts.push( `${( p.tissue.chlorotic * 100 ).toFixed( 0 )}% yellowing` )
	if ( p.tissue.necrotic > 0.03 ) parts.push( `${( p.tissue.necrotic * 100 ).toFixed( 0 )}% browning` )
	parts.push( `canopy density ${p.geometry.density}` )

	return parts.join( ', ' )

}
