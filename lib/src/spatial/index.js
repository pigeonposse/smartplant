/**
 * What one scan tells a plant, without mapping anything.
 *
 * A 360° rangefinder returns a ring of distances. Cartographer and the SLAM
 * stacks that followed it turn thousands of those into a consistent map of a
 * building, which is a hard problem, solved, and not this one — the navigation
 * layer already delegates it to Nav2 for exactly that reason, and Cartographer
 * itself now says in its own README that it is no longer actively maintained.
 *
 * So this deliberately stops well short. It answers what a **single scan**
 * answers, which needs no map, no loop closure and no pose graph:
 *
 *   · How far is the nearest neighbour, actually.
 *   · Is there room around this pot to move at all.
 *   · Has something appeared between this plant and the window.
 *
 * ## The first of those is the point
 *
 * The coupling layer — shared humidity, competing for the same CO₂, whether a
 * pest can walk across — rests entirely on how far apart two plants are, and
 * until now that number was **typed in by a person**. Every conclusion it draws
 * carries a note saying so:
 *
 *     Declared, not measured — if a pot was moved and nobody said so, this is wrong.
 *
 * A scanning lidar removes that footnote. It is the single most valuable thing
 * this hardware does here, and it needs none of the machinery that makes SLAM
 * hard.
 *
 * ## What a scan cannot tell you
 *
 * It returns distance and angle. It does not know that the return at 0.3m is a
 * plant rather than a chair leg, so "nearest neighbour" is only a neighbour
 * because somebody said a plant is roughly over there. Bearings are declared and
 * ranges are measured, and the two are kept apart everywhere below — the same
 * split the rest of this library keeps between what was stated and what was
 * observed.
 */

/** A scan is a ring of these. */
export const RETURN = {
	/** Nothing came back — open space, or a surface that does not reflect. */
	NONE : null,
}

/** Below this a return is the plant's own foliage rather than the room. */
export const SELF_RANGE = 0.15

const finite = Number.isFinite

/**
 * Normalise a scan into `{angle, range}` pairs, dropping what is unusable.
 *
 * Accepts the two shapes every rangefinder library produces: an array of ranges
 * evenly spaced around the circle, or explicit angle/range pairs.
 *
 * @param   {object|Array} scan - `{ranges, angleMin, angleMax}` or `[{angle, range}]`.
 * @returns {object[]}          Points, angle in radians.
 */
export function points( scan ) {

	if ( Array.isArray( scan ) ) {

		return scan
			.filter( p => finite( p?.angle ) && finite( p?.range ) && p.range > 0 )
			.map( p => ( {
				angle : p.angle,
				range : p.range,
			} ) )

	}

	const ranges = scan?.ranges
	if ( !Array.isArray( ranges ) || !ranges.length ) return []

	const min = finite( scan.angleMin ) ? scan.angleMin : 0
	const max = finite( scan.angleMax ) ? scan.angleMax : 2 * Math.PI
	const step = ( max - min ) / ranges.length

	return ranges
		.map( ( range, i ) => ( {
			angle : min + i * step,
			range,
		} ) )
		.filter( p => finite( p.range ) && p.range > 0 )

}

/** Shortest way round the circle between two bearings. */
const angleGap = ( a, b ) => {

	const d = Math.abs( a - b ) % ( 2 * Math.PI )
	return d > Math.PI ? 2 * Math.PI - d : d

}

/**
 * How far away is the thing somebody said is over there?
 *
 * The bearing is declared and the range is measured, and the result says which
 * is which. A lidar cannot tell a plant from a chair leg; what it can do is
 * measure the distance to whatever is in the direction you point it.
 *
 * @param   {object|Array} scan     - The scan.
 * @param   {object}       neighbour - `{id, bearing}` in radians.
 * @param   {object}       [opts]   - `{ arc }` how wide to look. Default ±15°.
 * @returns {object}                `{metres, measured, why}`.
 */
export function rangeTo( scan, neighbour = {}, opts = {} ) {

	const arc = opts.arc ?? ( 15 * Math.PI / 180 )
	const pts = points( scan )

	if ( !pts.length ) {

		return {
			metres : null,
			measured : false,
			why : 'The scan is empty, so nothing can be measured from it.',
		}

	}

	if ( !finite( neighbour.bearing ) ) {

		return {
			metres : null,
			measured : false,
			why : `No bearing was given for "${neighbour.id ?? 'the neighbour'}". A lidar measures distance in a direction; it cannot pick a plant out of a room, so the direction has to come from somebody who knows which way it is.`,
		}

	}

	// Ignore the plant's own leaves, which sit right up against the sensor.
	const inArc = pts.filter( p => angleGap( p.angle, neighbour.bearing ) <= arc && p.range > SELF_RANGE )

	if ( !inArc.length ) {

		return {
			metres : null,
			measured : false,
			why : `Nothing came back within ${Math.round( arc * 180 / Math.PI )}° of that bearing beyond ${SELF_RANGE}m. Either the neighbour has moved, or it is beyond this sensor's range, or what is there does not reflect — and those are different problems.`,
		}

	}

	const nearest = inArc.reduce( ( a, b ) => ( b.range < a.range ? b : a ) )

	return {
		metres : Number( nearest.range.toFixed( 3 ) ),
		measured : true,
		bearingDeclared : true,
		returns : inArc.length,
		why : `${nearest.range.toFixed( 2 )}m to the nearest return in that direction, measured. The direction itself is declared — this replaces a distance somebody typed with one the sensor took, which is what every shared-humidity and CO2 conclusion has been resting on.`,
	}

}

/**
 * Is there room to move, and in which directions.
 *
 * The navigation layer refuses a move it cannot justify; this is what turns a
 * scan into the clearance figure it wants. Still not a map — it describes the
 * ring around the pot right now, and says nothing about anywhere else.
 *
 * @param   {object|Array} scan   - The scan.
 * @param   {object}       [opts] - `{ radius }` the pot's own footprint.
 * @returns {object}              `{clear, tightest, openings, why}`.
 */
export function clearance( scan, opts = {} ) {

	const radius = opts.radius ?? 0.2
	const pts = points( scan ).filter( p => p.range > SELF_RANGE )

	if ( !pts.length ) {

		return {
			clear : null,
			why : 'Nothing came back at all. That is either a completely open space or a sensor that is not working, and a clearance figure that cannot tell those apart is not one worth acting on.',
		}

	}

	const tightest = pts.reduce( ( a, b ) => ( b.range < a.range ? b : a ) )

	// Sectors with nothing within a metre are where the pot could actually go.
	const openings = []
	const step = 30 * Math.PI / 180

	for ( let a = 0; a < 2 * Math.PI; a += step ) {

		const sector = pts.filter( p => angleGap( p.angle, a ) <= step / 2 )
		const nearest = sector.length ? Math.min( ...sector.map( p => p.range ) ) : Infinity

		if ( nearest > 1 ) openings.push( {
			bearing : Number( a.toFixed( 3 ) ),
			metres : finite( nearest ) ? Number( nearest.toFixed( 2 ) ) : null,
		} )

	}

	return {
		clear : tightest.range > radius * 2,
		tightest : {
			metres : Number( tightest.range.toFixed( 3 ) ),
			bearing : Number( tightest.angle.toFixed( 3 ) ),
		},
		openings,
		why : tightest.range > radius * 2
			? `Nearest obstruction ${tightest.range.toFixed( 2 )}m away, with ${openings.length} direction${openings.length === 1 ? '' : 's'} open beyond a metre.`
			: `Boxed in: something is ${tightest.range.toFixed( 2 )}m away and this pot is ${( radius * 2 ).toFixed( 2 )}m across. Nothing here can move until that clears, and a plan that says otherwise is planning through a wall.`,
	}

}

/**
 * Has something appeared that was not there before?
 *
 * The one comparison worth making between two scans without building a map. It
 * matters because it can explain a reading: light dropping thirty per cent is a
 * cloudy week or it is a box somebody put on the windowsill, and those call for
 * completely different responses.
 *
 * @param   {object|Array} before - The earlier scan.
 * @param   {object|Array} after  - The later one.
 * @param   {object}       [opts] - `{ minChange }` metres. Default 0.3.
 * @returns {object}              `{changed, appeared, why}`.
 */
export function whatChanged( before, after, opts = {} ) {

	const minChange = opts.minChange ?? 0.3
	const a = points( before ), b = points( after )

	if ( a.length < 8 || b.length < 8 ) {

		return {
			changed : null,
			why : 'One of the two scans is too sparse to compare. This is a comparison of a ring against a ring, and a handful of returns is not a ring.',
		}

	}

	// Compared sector by sector rather than point by point: a sensor that
	// started at a slightly different angle would otherwise look like the whole
	// room had moved.
	const step = 10 * Math.PI / 180
	const nearestIn = ( pts, at ) => {

		const sector = pts.filter( p => angleGap( p.angle, at ) <= step / 2 )
		return sector.length ? Math.min( ...sector.map( p => p.range ) ) : null

	}

	const appeared = []

	for ( let at = 0; at < 2 * Math.PI; at += step ) {

		const was = nearestIn( a, at ), now = nearestIn( b, at )
		if ( !finite( was ) || !finite( now ) ) continue

		if ( was - now >= minChange ) appeared.push( {
			bearing : Number( at.toFixed( 3 ) ),
			was : Number( was.toFixed( 2 ) ),
			now : Number( now.toFixed( 2 ) ),
		} )

	}

	return {
		changed : appeared.length > 0,
		appeared,
		why : appeared.length
			? `Something is closer than it was in ${appeared.length} direction${appeared.length === 1 ? '' : 's'} — nearest now ${Math.min( ...appeared.map( x => x.now ) ).toFixed( 2 )}m. Worth knowing before blaming a drop in light on the weather: a box on the windowsill and a cloudy week look identical in the light record and call for completely different responses.`
			: 'Nothing has moved closer since the last scan.',
	}

}

/**
 * Everything one scan supports, in one call.
 *
 * @param   {object|Array} scan  - The scan.
 * @param   {object}       [opts] - `{ neighbours: [{id, bearing}], radius, previous }`.
 * @returns {object}             A reading of the space.
 */
export function readSpace( scan, opts = {} ) {

	opts = opts ?? {}

	const space = {
		returns : points( scan ).length,
		clearance : clearance( scan, opts ),
		neighbours : ( opts.neighbours ?? [] ).map( n => ( {
			id : n.id,
			...rangeTo( scan, n, opts ),
		} ) ),
	}

	if ( opts.previous ) space.changes = whatChanged( opts.previous, scan, opts )

	const measured = space.neighbours.filter( n => n.measured )

	space.why = space.returns
		? `${space.returns} returns. ${space.clearance.why}${measured.length ? ` ${measured.length} neighbour distance${measured.length === 1 ? '' : 's'} measured rather than declared.` : ''}`
		: 'Nothing came back from this scan.'

	return space

}
