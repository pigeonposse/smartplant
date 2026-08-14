/**
 * When several plants agreeing is worth something, and when it is worth nothing.
 *
 * The evidence ledger already caps everything a colony says at one source, and
 * that rule is right for the reason it gives: neighbours share a window, a
 * radiator, a watering can and a person, so five plants reporting dryness is one
 * observation counted five times.
 *
 * But it is right for *claims about a plant*, and this file is about the case it
 * gets backwards.
 *
 * ## The distinction the ledger cannot make
 *
 * A claim about the **room** is a different kind of claim. When four plants with
 * four separate electrodes, four separate pots and four separate histories all
 * shift electrically inside the same hour, the correlation is not a flaw in the
 * evidence — it is the evidence. Their sharing a room is precisely what is being
 * claimed, and each electrode is a genuinely independent instrument measuring it.
 *
 * So:
 *
 *   · "This plant is water-stressed" — agreement adds nothing. Still one
 *     witness, because they are all looking at the same watering can.
 *   · "Something happened in this room" — agreement is the whole point. Four
 *     instruments, four subjects, one moment.
 *
 * The second is the only shape where a colony is more reliable than its best
 * member, and it is the one this adds.
 *
 * ## And the inverse, which is more useful day to day
 *
 * One plant moving while its neighbours do not is the *opposite* finding, and it
 * is the commoner one. It is not evidence about the room at all. It is evidence
 * about that plant — its pot, its contact, its position — and the first thing
 * worth suspecting is its instrument rather than its physiology, because an
 * electrode losing contact looks exactly like a plant reacting to something
 * nobody else can detect.
 */

/** What a group of readings can support. */
export const CORROBORATION = {
	ENVIRONMENTAL : 'environmental',
	SINGULAR      : 'singular',
	NONE          : 'none',
}

/**
 * Claims that are about the room rather than about a plant.
 *
 * Only these can be corroborated by neighbours. Anything not listed stays at one
 * source however many plants say it, which is the existing rule and the correct
 * one for everything else.
 */
export const ENVIRONMENTAL = new Set( [
	'air_too_dry',
	'air_too_humid',
	'too_cold',
	'too_hot',
	'too_dark',
	'too_bright',
	'draught',
	'co2_depletion',
	'light_change',
] )

/** Confidence a claim earns from how many independent instruments agree. */
const WEIGHT = [ 0, 0.35, 0.6, 0.75, 0.85 ]

/** Past this, another plant adds nothing — they are still one room. */
export const SATURATES_AT = 4

const finite = Number.isFinite

/**
 * How much a group of plants agreeing is worth for this claim.
 *
 * @param   {string}   claim   - What is being claimed.
 * @param   {object[]} members - `{id, agrees, hasOwnElectrode}`.
 * @param   {object}   [opts]  - `{ window }` description for the message.
 * @returns {object}           `{kind, strength, why}`.
 */
export function corroborate( claim, members = [], opts = {} ) {

	members = Array.isArray( members ) ? members : []
	opts = opts ?? {}

	const agreeing = members.filter( m => m?.agrees === true )
	const independent = agreeing.filter( m => m?.hasOwnElectrode !== false )

	if ( !ENVIRONMENTAL.has( claim ) ) {

		return {
			kind : CORROBORATION.NONE,
			strength : agreeing.length ? 0.35 : 0,
			agreeing : agreeing.length,
			why : `"${claim}" is a claim about a plant, and neighbours agreeing about a plant is still one witness — they share a window, a radiator and a watering can, so their observations are one thing counted several times. It stays at a single source however many say it.`,
		}

	}

	if ( independent.length < 2 ) {

		return {
			kind : CORROBORATION.NONE,
			strength : independent.length ? 0.35 : 0,
			agreeing : independent.length,
			why : `Only ${independent.length} plant with its own instrument says so. A claim about the room needs at least two separate instruments before their agreement means anything more than one of them being right.`,
		}

	}

	const n = Math.min( independent.length, SATURATES_AT )
	const strength = WEIGHT[ n ]

	return {
		kind : CORROBORATION.ENVIRONMENTAL,
		strength,
		agreeing : independent.length,
		saturated : independent.length > SATURATES_AT,
		why : `${independent.length} plants with separate electrodes, separate pots and separate histories agree${opts.window ? ` inside ${opts.window}` : ''}. For a claim about the room that correlation is not a flaw in the evidence — it is the evidence, because sharing the room is exactly what is being claimed. Confidence ${strength}${independent.length > SATURATES_AT ? `, saturated at ${SATURATES_AT}: past that they are still one room.` : '.'}`,
	}

}

/**
 * The plant that moved while nobody else did.
 *
 * The inverse finding, and the commoner one. It says nothing about the room and
 * quite a lot about that plant — starting with its instrument, because an
 * electrode losing contact looks exactly like a plant reacting to something no
 * neighbour can detect.
 *
 * @param   {object} collective - From `collectiveState`.
 * @param   {object} [opts]     - `{ members }` count, for the message.
 * @returns {object}            `{singular, inspect, why}`.
 */
export function oddOneOut( collective, opts = {} ) {

	opts = opts ?? {}

	if ( !collective?.known ) {

		return {
			singular : false,
			why : collective?.why ?? 'No collective state to compare against.',
		}

	}

	const outliers = collective.outliers ?? []

	if ( !outliers.length ) {

		return {
			singular : false,
			why : `All ${collective.members} plants are in the same electrical state, so nobody is the odd one out.`,
		}

	}

	if ( outliers.length >= collective.members - 1 ) {

		return {
			singular : false,
			why : 'Nearly everybody is an outlier, which means there is no group to be an outlier from rather than that everybody has a problem.',
		}

	}

	return {
		singular : true,
		inspect : outliers,
		priority : 'instrument',
		why : `${outliers.map( o => `"${o}"` ).join( ', ' )} moved while ${collective.members - outliers.length} neighbours did not. That is not evidence about the room — it is evidence about that plant, and the first thing worth suspecting is its instrument rather than its physiology. An electrode losing contact looks exactly like a plant reacting to something nobody else can detect, and the difference is five minutes with a torch.`,
	}

}

/**
 * Should this plant offer what it knows to that one?
 *
 * Knowledge transfer already checks kinship and what each has learned. The half
 * that was missing is confidence on both sides: a teacher who is unsure and a
 * learner who already knows are both reasons not to bother, and the second is
 * the one that does harm — a confident prior arriving on top of local experience
 * displaces something better with something merely older.
 *
 * @param   {object} teacher - `{confidence, experience}` in this dimension.
 * @param   {object} learner - The same.
 * @param   {object} [opts]  - `{ dimension }`.
 * @returns {object}         `{offer, why}`.
 */
export function worthTeaching( teacher = {}, learner = {}, opts = {} ) {

	teacher = teacher ?? {}
	learner = learner ?? {}

	const what = opts?.dimension ?? 'this'

	if ( !finite( teacher.confidence ) || !finite( learner.experience ) ) {

		return {
			offer : false,
			why : `Whether this is worth passing on needs the teacher's confidence about ${what} and the learner's own experience of it, and at least one is unknown. Offering anyway is how a guess travels as though it were knowledge.`,
		}

	}

	if ( teacher.confidence < 0.6 ) {

		return {
			offer : false,
			why : `The teacher is only ${teacher.confidence.toFixed( 2 )} confident about ${what}. Passing on something it is unsure of does not make it more true at the other end — it makes it harder to correct, because it now has a source.`,
		}

	}

	if ( learner.experience >= 0.5 ) {

		return {
			offer : false,
			why : `The learner already has its own experience of ${what} (${learner.experience.toFixed( 2 )}). A confident prior arriving on top of local experience displaces something better with something merely older, and the whole point of local learning is that it beats inheritance.`,
		}

	}

	return {
		offer : true,
		strength : Number( ( teacher.confidence * ( 1 - learner.experience ) ).toFixed( 2 ) ),
		why : `The teacher is ${teacher.confidence.toFixed( 2 )} confident about ${what} and the learner has almost none of its own (${learner.experience.toFixed( 2 )}). That is the only shape where a transfer helps: something to give, and room to receive it.`,
	}

}
