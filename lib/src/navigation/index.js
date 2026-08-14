/**
 * Moving a plant around a house without being clumsy about it.
 *
 * ## What this is not
 *
 * It is not a SLAM implementation, a path planner or a costmap. ROS 2 and Nav2
 * have spent a decade on those and do them properly, and a version written here
 * would be worse in every way that matters while looking, from the outside, like
 * it worked. That is the most dangerous kind of code to put underneath a pot.
 *
 * So mapping, localisation and planning are delegated. What this module supplies
 * is the part a general-purpose robot stack has no reason to know: **the
 * constraints that come from the thing being carried being alive.**
 *
 * ## What a robot stack does not know about a plant
 *
 * A Nav2 costmap knows about obstacles and clearance. It does not know that:
 *
 *   · A two-metre ficus in a pot has its centre of mass high and its base
 *     narrow. A doorway threshold a delivery robot crosses without noticing is
 *     a tipping moment for that, and a tipped plant is not a failed navigation
 *     — it is a broken plant and soil across a floor.
 *
 *   · Getting there is only half the journey. A plant that arrives with no
 *     charge is stranded somewhere it did not choose, away from its own
 *     conditions, and cannot get back.
 *
 *   · Some destinations are worse than where it started. A robot asked to go to
 *     a coordinate goes there. A plant asked to move toward light should not end
 *     up in a draught, against a radiator, or in a spot where it will be in
 *     somebody's way for a week.
 *
 *   · Some neighbours must not be approached at all. Proximity is how
 *     infestation spreads, and the plant with the pest is not marked on any map.
 *
 * Each of those is a refusal this library can make and a robot stack cannot,
 * because each depends on knowing what is being moved and what it is being moved
 * toward.
 *
 * ## The contract
 *
 * An adapter supplies a `Surveyor` — anything that can answer where the plant
 * is, what is around it, and whether a path exists. A ROS 2 bridge is the
 * obvious implementation; so is a hand-drawn map of a flat, and so is a stub
 * that says "I do not know", which is the default and which correctly refuses
 * every move.
 */

/** What a move can be refused for. */
export const REFUSAL = {
	NO_MAP     : 'no-map',
	TIPPING    : 'tipping',
	CHARGE     : 'charge',
	BIOTIC     : 'biotic',
	WORSE      : 'worse-destination',
	BLOCKED    : 'blocked',
	DEFENDING  : 'defending',
}

/**
 * How stable a potted plant is, and what that means for what it can cross.
 *
 * The ratio of height to base width is the whole story. A tall plant in a narrow
 * pot tips at a bump a squat one rides over, and the tipping angle follows
 * directly from the geometry — no model of the plant is needed, only its shape.
 */
export const STABILITY = {
	/** Tangent of the tilt at which the centre of mass leaves the base. */
	tipAngle : ( heightM, baseM ) => Math.atan( ( baseM / 2 ) / ( heightM / 2 ) ),
}

/**
 * Can this plant physically cross that?
 *
 * @param   {object} plant    - `{heightM, baseM, potMassKg}`.
 * @param   {object} obstacle - `{stepM, slopeRad}`.
 * @returns {object}          `{safe, why}`.
 */
export function canCross( plant = {}, obstacle = {} ) {
	plant = plant ?? {}
	obstacle = obstacle ?? {}

	plant = plant ?? {}
	obstacle = obstacle ?? {}

	const { heightM, baseM } = plant

	if ( !Number.isFinite( heightM ) || !Number.isFinite( baseM ) ) {

		return {
			safe : null,
			reason : REFUSAL.TIPPING,
			why : 'The plant\'s height and base width were not declared, so how easily it tips is unknown. This is two numbers with a tape measure, and without them nothing here can say whether a threshold is a bump or a fall. Refusing: a tipped plant is not a failed manoeuvre to retry, it is soil across a floor and a broken stem.',
		}

	}

	const limit = STABILITY.tipAngle( heightM, baseM )

	// A step tips a wheeled base by roughly the angle whose tangent is the step
	// over the wheelbase. Half the static limit, because a moving plant carries
	// momentum the static calculation ignores and foliage sways after the pot
	// has stopped.
	const margin = limit / 2
	const slope = obstacle.slopeRad ?? ( Number.isFinite( obstacle.stepM ) && Number.isFinite( plant.wheelbaseM )
		? Math.atan( obstacle.stepM / plant.wheelbaseM )
		: null )

	if ( !Number.isFinite( slope ) ) {

		return {
			safe : null,
			reason : REFUSAL.TIPPING,
			why : 'Neither a slope nor a step height and wheelbase were given, so the tilt this obstacle would impose cannot be worked out.',
		}

	}

	return {
		safe : slope < margin,
		tipAngle : Number( limit.toFixed( 3 ) ),
		imposed : Number( slope.toFixed( 3 ) ),
		why : slope < margin
			? `This plant is ${heightM}m tall on a ${baseM}m base, so it leaves its own footprint at ${( limit * 180 / Math.PI ).toFixed( 0 )}°. The obstacle imposes ${( slope * 180 / Math.PI ).toFixed( 0 )}°, inside the half-of-static margin used here because a moving plant carries momentum and foliage keeps swaying after the pot has stopped.`
			: `Refused. ${heightM}m tall on a ${baseM}m base tips at ${( limit * 180 / Math.PI ).toFixed( 0 )}° and this imposes ${( slope * 180 / Math.PI ).toFixed( 0 )}°. A delivery robot would cross this without noticing; it is a tipping moment for a plant with its mass this high.`,
	}

}

/**
 * Is the destination actually better than where the plant is now?
 *
 * The question a robot stack never asks. It is given a coordinate and it goes
 * there. A plant should not arrive somewhere that is brighter and also colder,
 * draughtier, or next to a radiator — and it should not be moved at all for a
 * gain it cannot measure.
 *
 * @param   {object} here  - Current conditions.
 * @param   {object} there - Conditions at the destination, if known.
 * @param   {object} want  - `{metric, direction}`.
 * @returns {object}       `{better, why}`.
 */
export function worthMoving( here = {}, there = null, want = {} ) {
	here = here ?? {}
	want = want ?? {}

	here = here ?? {}
	want = want ?? {}

	if ( !there ) {

		return {
			better : null,
			reason : REFUSAL.WORSE,
			why : 'Nothing is known about conditions at the destination. Moving a plant somewhere nobody has measured is a guess dressed as a decision — it may be brighter and it may be a windowsill that drops to 8°C at night. Leave a sensor there for a day first, or move it and watch, but do not call the second one a plan.',
		}

	}

	const metric = want.metric ?? 'light'
	const up = ( want.direction ?? 'up' ) === 'up'

	const from = here[ metric ]
	const to = there[ metric ]

	if ( !Number.isFinite( from ) || !Number.isFinite( to ) ) {

		return {
			better : null,
			why : `${metric} is not known at both ends, so there is no comparison to make.`,
		}

	}

	const gain = up ? to - from : from - to

	// Everything else that changed. A move that fixes one metric and breaks two
	// is not an improvement, and this is where a naive "go toward the light"
	// gets a plant killed.
	const costs = []

	for ( const [ k, v ] of Object.entries( there ) ) {

		if ( k === metric || !Number.isFinite( v ) || !Number.isFinite( here[ k ] ) ) continue

		const delta = v - here[ k ]
		const threshold = TOLERANCE[ k ]

		if ( Number.isFinite( threshold ) && Math.abs( delta ) > threshold ) costs.push( {
			metric : k,
			from : here[ k ],
			to : v,
		} )

	}

	if ( gain <= 0 ) {

		return {
			better : false,
			gain,
			why : `${metric} is ${to} there against ${from} here, which is not an improvement. The move costs charge and disturbs a settled plant, and neither is worth spending on a destination that is no better.`,
		}

	}

	return {
		better : costs.length === 0,
		gain : Number( gain.toFixed( 1 ) ),
		costs,
		why : costs.length
			? `${metric} improves by ${gain.toFixed( 1 )}, and ${costs.map( c => `${c.metric} moves ${c.from} → ${c.to}` ).join( ', ' )}. That is a trade rather than an improvement, and it is the trade that makes "move toward the light" dangerous — the brightest spot in a flat is very often the coldest and draughtiest one.`
			: `${metric} improves by ${gain.toFixed( 1 )} and nothing else moves enough to matter. Worth the journey.`,
	}

}

/** How much a metric may change at a destination before it counts against the move. */
const TOLERANCE = {
	temperature : 3,
	humidity : 15,
	airflow : 0.4,
	co2 : 200,
}

/**
 * Everything checked, in the order that fails cheapest first.
 *
 * @param   {object} plant  - A `SmartPlant`, or a shape with the same fields.
 * @param   {object} move   - `{to, obstacle, there, want, metres, neighbours}`.
 * @param   {object} [deps] - `{ surveyor }`.
 * @returns {Promise<object>} `{go, refusals, why}`.
 */
export async function planMove( plant, move = {}, deps = {} ) {
	move = move ?? {}
	deps = deps ?? {}

	move = move ?? {}
	deps = deps ?? {}

	if ( !plant || typeof plant !== 'object' ) {

		return {
			go : false,
			refusals : [ {
				reason : REFUSAL.NO_MAP,
				why : 'No plant was given, so there is nothing to check and nothing to move. Every refusal below this point is about a specific plant, and without one none of them can be made.',
			} ],
			why : 'Not moving: no plant was given.',
		}

	}

	const refusals = []
	const note = ( reason, why ) => refusals.push( {
		reason,
		why,
	} )

	// ── cheapest first: is the plant in a state to be moved at all ──────────
	const states = plant.states?.() ?? {}

	if ( states.defense_activation?.acts ) {

		note( REFUSAL.DEFENDING, `${states.defense_activation.statement} Being carried across a room is an elective disturbance, and this plant is already spending on something.` )

	}

	// ── the neighbours it would pass or arrive beside ───────────────────────
	for ( const n of move.neighbours ?? [] ) {

		if ( n.biotic === true ) note( REFUSAL.BIOTIC, `"${n.id}" is showing biotic signs, and the destination puts this plant within ${n.metres ?? '?'}m of it. Proximity is the transmission route; arriving next to an infestation is the one outcome worth more than any lighting gain.` )
		else if ( n.canSee === false ) note( REFUSAL.BIOTIC, `"${n.id}" is at the destination and has no camera, so it cannot be cleared. A plant that cannot look cannot certify itself clean.` )

	}

	// ── the geometry ────────────────────────────────────────────────────────
	if ( move.obstacle ) {

		const cross = canCross( plant.chassis ?? plant, move.obstacle )
		if ( cross.safe !== true ) note( REFUSAL.TIPPING, cross.why )

	}

	// ── the round trip, not the trip ────────────────────────────────────────
	if ( plant.power && Number.isFinite( move.metres ) ) {

		const travel = plant.power.canTravel( move.metres * 2 )
		if ( !travel.afford ) note( REFUSAL.CHARGE, `Not enough charge for the journey and back. ${travel.why} A plant that arrives stranded has been moved somewhere it did not choose and cannot leave.` )

	}

	// ── is it worth it ──────────────────────────────────────────────────────
	const worth = worthMoving( plant.memory?.lastReading ?? {}, move.there, move.want )
	if ( worth.better !== true ) note( REFUSAL.WORSE, worth.why )

	// ── and only then, is there a path ──────────────────────────────────────
	if ( !refusals.length ) {

		const surveyor = deps.surveyor ?? plant.surveyor

		if ( !surveyor ) {

			note( REFUSAL.NO_MAP, 'No surveyor is attached, so there is no map, no localisation and no path. This library does not do that part — attach a ROS 2 bridge or another implementation of the surveyor contract. Everything above was checked and passed; only the navigation is missing.' )

		}
		else {

			const path = await surveyor.pathTo( move.to )

			if ( !path?.found ) note( REFUSAL.BLOCKED, path?.why ?? 'The surveyor found no route.' )

		}

	}

	return {
		go : refusals.length === 0,
		refusals,
		worth,
		why : refusals.length
			? `Not moving. ${refusals.map( r => r.why ).join( ' ' )}`
			: `Clear to move${Number.isFinite( move.metres ) ? ` ${move.metres}m` : ''}. ${worth.why}`,
	}

}

/**
 * The shape an adapter has to provide.
 *
 * Deliberately small. Everything hard lives behind these three calls, and the
 * default implementation below answers "I do not know" to all of them — which
 * makes a plant with no navigation stack refuse to move rather than move badly.
 */
export class Surveyor {

	/** Where the plant is. */
	async pose() {

		return {
			known : false,
			why : 'No localisation. This is the base Surveyor, which knows nothing on purpose.',
		}

	}

	/** What is around it. */
	async surroundings() {

		return {
			known : false,
			why : 'No map.',
		}

	}

	/**
	 * Is there a route to somewhere.
	 *
	 * @param   {object} to - Destination.
	 * @returns {Promise<object>} `{found, why}`.
	 */
	async pathTo( to ) {

		return {
			found : false,
			to,
			why : 'The base Surveyor cannot plan a path. Attach one that can — a ROS 2 bridge onto Nav2 is the intended implementation, and this library deliberately does not reimplement it.',
		}

	}

}

/**
 * A surveyor backed by a ROS 2 bridge.
 *
 * The adapter is thin by design: it forwards, and it translates refusals into
 * this library's language. Everything about maps, costmaps, recovery behaviours
 * and localisation stays on the other side of it, where it belongs.
 *
 * @param   {object} bridge - Anything with `call( service, args )`.
 * @returns {Surveyor}      A surveyor.
 */
export function ros2Surveyor( bridge ) {

	return Object.assign( new Surveyor(), {

		async pose() {

			const r = await bridge.call( 'get_pose' )
			return {
				known : Boolean( r?.pose ),
				...r,
			}

		},

		async surroundings() {

			const r = await bridge.call( 'get_costmap' )
			return {
				known : Boolean( r ),
				...r,
			}

		},

		async pathTo( to ) {

			const r = await bridge.call( 'compute_path_to_pose', { goal : to } )

			return {
				found : Boolean( r?.path?.length ),
				length : r?.path?.length ?? 0,
				why : r?.path?.length
					? `Nav2 returned a path of ${r.path.length} poses.`
					: `Nav2 found no route: ${r?.error ?? 'no reason given'}. The plant stays where it is — a partial path is not a path, and improvising the rest is exactly what this adapter exists to avoid.`,
			}

		},

	} )

}
