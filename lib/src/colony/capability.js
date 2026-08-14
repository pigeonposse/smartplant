/**
 * What a plant is equipped with, published to its neighbours.
 *
 * Until now a plant learned what a neighbour could do by asking and being
 * refused. That works — the skill layer already answers "I have no electrode"
 * rather than inventing a number — but it means every capability is discovered
 * by a failed request, and it means one plant cannot *plan* around another's
 * hardware. It can only find out afterwards.
 *
 * A manifest fixes that. On joining, a plant states what it has: which metrics
 * it can read, which layers are attached, what it can physically do, and which
 * optical hardware it carries. Neighbours keep it, and from then on they know
 * what is worth asking for.
 *
 * ## Why this is more than a convenience
 *
 * Three things in this library become possible only once capability is known
 * ahead of time rather than discovered on refusal:
 *
 *   · **Optical signalling.** A plant must not blink a message at a neighbour
 *     whose only light sensor samples once a second. The message would be sent,
 *     nothing would receive it, and the sender would spend its last energy
 *     talking to a wall. The manifest is what makes that check possible before
 *     the first pulse.
 *
 *   · **Asking the right plant.** A colony with one camera and six blind plants
 *     should route every question about pests to the one that can see, rather
 *     than broadcasting and collecting five refusals.
 *
 *   · **Knowing what a silence means.** A neighbour that never reports airflow
 *     might have steady air or no anemometer, and those are completely different
 *     facts. The manifest separates them.
 *
 * ## It is a claim, not a measurement
 *
 * Everything here is self-reported. A plant saying it has a camera is a claim
 * about itself that nothing verifies, and a stale manifest — hardware unplugged,
 * driver failed — will keep asserting a capability that no longer exists. So
 * capability is treated as *permission to ask*, never as a guarantee of an
 * answer, and every consumer still handles the refusal it was trying to avoid.
 *
 * The one thing it must never become is a substitute for the refusal itself.
 */

/** Things a plant can be equipped to do, beyond reading a metric. */
export const FACULTY = {
	SEE       : 'see',
	ELECTRODE : 'electrode',
	SPECTRAL  : 'spectral',
	MOVE      : 'move',
	SPEAK     : 'speak',
	HEAR      : 'hear',
	RANGE     : 'range',
	FAST_LIGHT : 'fast-light',
	SOLAR     : 'solar',
	BATTERY   : 'battery',
}

/**
 * How fast a light sensor has to be before it can receive a pulsed message.
 *
 * An ordinary ambient light sensor integrates over 100-500 ms and reports once
 * a second or slower. That is the correct design for measuring daylight and it
 * is hopeless for decoding anything modulated: by Nyquist, a receiver sampling
 * at 1 Hz cannot recover a signal switching faster than 0.5 Hz, and no amount of
 * cleverness in the sender changes that.
 *
 * A photodiode on a fast ADC is a different instrument. The threshold below is
 * deliberately conservative — well above what the slowest usable link needs, and
 * far above anything a lux sensor can reach, so the two can never be confused.
 */
export const RECEIVE_HZ = 1000

/**
 * Build this plant's manifest.
 *
 * @param   {object} plant - A `SmartPlant`.
 * @returns {object}       The manifest.
 */
export function manifest( plant ) {

	plant = plant ?? {}

	const metrics = new Set()

	for ( const key of Object.keys( plant.memory?.lastReading ?? {} ) ) {

		if ( Number.isFinite( plant.memory.lastReading[ key ] ) ) metrics.add( key )

	}

	const faculties = []
	const add = ( f, on ) => { if ( on ) faculties.push( f ) }

	add( FACULTY.SEE, Boolean( plant.vision ) )
	add( FACULTY.ELECTRODE, Boolean( plant.electrode || plant.perception?.electro ) )
	add( FACULTY.SPECTRAL, Boolean( plant.spectral ) )
	add( FACULTY.MOVE, Boolean( plant.body?.drive || plant.drive ) )
	add( FACULTY.SPEAK, Boolean( plant.audio?.speaker ) )
	add( FACULTY.HEAR, Boolean( plant.audio?.microphone ) )
	add( FACULTY.RANGE, Boolean( plant.rangefinder ) )
	add( FACULTY.SOLAR, Boolean( plant.power?.solar ) )
	add( FACULTY.BATTERY, Boolean( plant.power ) )

	// The one faculty that cannot be inferred from a layer being attached,
	// because it is a property of the sensor rather than of the software.
	const photodiodeHz = plant.optical?.sampleRateHz ?? plant.sensors?.opticalSampleRateHz
	add( FACULTY.FAST_LIGHT, Number.isFinite( photodiodeHz ) && photodiodeHz >= RECEIVE_HZ )

	return {
		id : plant.colony?.id ?? plant.memory?.plant?.name ?? 'plant',
		species : plant.memory?.plant?.species ?? null,
		archetype : plant.archetype?.id ?? null,
		metrics : [ ...metrics ].sort(),
		faculties,
		photodiodeHz : Number.isFinite( photodiodeHz ) ? photodiodeHz : null,
		// Stamped so a consumer can decide a manifest is too old to rely on. A
		// plant that was unplugged an hour ago still advertises what it had.
		at : Date.now(),
		declared : true,
	}

}

/**
 * Can this neighbour do the thing being considered?
 *
 * @param   {object} m       - A neighbour's manifest.
 * @param   {string} faculty - One of `FACULTY`.
 * @returns {object}         `{can, why}`.
 */
export function capable( m, faculty ) {

	if ( !m || !Array.isArray( m.faculties ) ) {

		return {
			can : null,
			why : `Nothing is known about this neighbour's equipment. It may well be able to ${faculty}; there is simply no manifest, which happens with a plant that joined before this version or one that never announced itself. Ask and handle the refusal.`,
		}

	}

	const can = m.faculties.includes( faculty )

	return {
		can,
		declared : true,
		why : can
			? `"${m.id}" declares it can ${faculty}. Declared, not verified — treat it as permission to ask rather than a promise of an answer.`
			: `"${m.id}" does not have what ${faculty} needs, so asking would only produce a refusal.`,
	}

}

/**
 * Which neighbours can answer a question about a given metric?
 *
 * @param   {Map|object} neighbours - Peer id to manifest.
 * @param   {string}     metric     - Metric name.
 * @returns {object}                `{who, blind, why}`.
 */
export function whoCanRead( neighbours, metric ) {

	const entries = neighbours instanceof Map
		? [ ...neighbours.entries() ]
		: Object.entries( neighbours ?? {} )

	const who = []
	const blind = []
	const unknown = []

	for ( const [ id, m ] of entries ) {

		if ( !Array.isArray( m?.metrics ) ) unknown.push( id )
		else if ( m.metrics.includes( metric ) ) who.push( id )
		else blind.push( id )

	}

	return {
		who,
		blind,
		unknown,
		why : who.length
			? `${who.length} neighbour${who.length === 1 ? '' : 's'} can read ${metric}. Asking the rest would collect refusals and nothing else.`
			: `No neighbour reads ${metric}${unknown.length ? `, though ${unknown.length} never said what they have` : ''}. A silence about ${metric} from this colony means the instrument is missing, not that the value is steady — which are entirely different facts.`,
	}

}

/**
 * Can this plant send a pulsed optical message to that one?
 *
 * The check that has to happen before any light-based signalling. The sender
 * needs an emitter; the receiver needs a sensor fast enough to see it change.
 * The second half is the one that is easy to forget and fatal to skip: a plant
 * spending its last energy blinking at a lux sensor has thrown that energy away
 * and, worse, believes it has called for help.
 *
 * @param   {object} sender   - Sender's manifest.
 * @param   {object} receiver - Receiver's manifest.
 * @returns {object}          `{can, why}`.
 */
export function opticalLink( sender, receiver ) {

	if ( !sender?.faculties?.includes( FACULTY.SPECTRAL ) ) {

		return {
			can : false,
			reason : 'no-emitter',
			why : 'This plant has no spectral layer, so it has no emitter to signal with.',
		}

	}

	if ( !receiver ) {

		return {
			can : false,
			reason : 'unknown-receiver',
			why : 'Nothing is known about the intended receiver. Optical signalling is the one channel where sending blind is genuinely wasteful — there is no acknowledgement, so a message nobody can decode is indistinguishable from a message nobody answered.',
		}

	}

	if ( !receiver.faculties?.includes( FACULTY.FAST_LIGHT ) ) {

		return {
			can : false,
			reason : 'slow-receiver',
			receiver : receiver.id,
			why : `"${receiver.id}" reads light${receiver.photodiodeHz ? ` at ${receiver.photodiodeHz} Hz` : ' with an ambient light sensor'}, which is far too slow to decode a pulsed message. An ambient sensor integrates over hundreds of milliseconds by design — that is what makes it good at daylight and useless at anything modulated. This link needs a photodiode on a fast ADC at ${RECEIVE_HZ} Hz or better on the receiving side.`,
		}

	}

	return {
		can : true,
		receiver : receiver.id,
		hz : receiver.photodiodeHz,
		why : `"${receiver.id}" declares a photodiode at ${receiver.photodiodeHz} Hz, fast enough to decode pulses. Declared rather than verified, so a message going unanswered still means "nobody decoded it" as much as "nobody replied".`,
	}

}

/**
 * Everyone in the colony who could receive an optical message.
 *
 * @param   {object}     sender     - Sender's manifest.
 * @param   {Map|object} neighbours - Peer id to manifest.
 * @returns {object}                `{who, why}`.
 */
export function opticalPeers( sender, neighbours ) {

	const entries = neighbours instanceof Map
		? [ ...neighbours.entries() ]
		: Object.entries( neighbours ?? {} )

	const who = entries.filter( ( [ , m ] ) => opticalLink( sender, m ).can ).map( ( [ id ] ) => id )

	return {
		who,
		why : who.length
			? `${who.length} neighbour${who.length === 1 ? '' : 's'} could decode a pulsed message.`
			: 'Nobody in this colony has a light sensor fast enough to decode pulses, so optical signalling would emit into a room where nothing is listening. Worth knowing before the battery is low rather than after.',
	}

}
