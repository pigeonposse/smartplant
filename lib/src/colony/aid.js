/**
 * One plant doing something for another.
 *
 * Everything else in the colony is talk: a plant says how it is, another asks a
 * question, knowledge passes. Nothing acts. This is the layer where a plant on
 * wheels can move aside so a neighbour gets the window, or carry its lamp over
 * to something that needs light it cannot reach.
 *
 * It is also the layer with the most ways to do harm, so most of the code here
 * is about refusing.
 *
 * ## Approaching is how disease travels
 *
 * Mites walk. Spores fall. Scale crawls between touching leaves. Every form of
 * aid that involves getting closer is also the transmission route for everything
 * a plant can catch, which makes proximity the one thing that must be gated
 * hardest.
 *
 * The gate runs in both directions, because either plant can be the source: a
 * helper with a biotic sign must not go, and a neighbour with one must not be
 * approached. And "no sign" is not the same as "clear" — a plant with no camera
 * cannot rule out an infestation it has no way to see. Unknown blocks, exactly
 * as it does everywhere else in this library.
 *
 * ## Light shone by a neighbour is still a dose
 *
 * The dangerous mistake here is subtle. Every plant meters its own light: a dose
 * ledger, dark-hour protection, contraindications that refuse blue to a
 * water-stressed plant. All of it is keyed on the lamp that plant controls.
 *
 * A neighbour arriving with its own lamp goes straight past all of it. The
 * receiver's ledger records nothing, so its own system may then light it again
 * in good faith and deliver twice what either intended — each half correctly
 * metered, the total unmetered.
 *
 * So aid that emits light is refused unless the receiver accepts it *through its
 * own safety layer* and books the dose. The helper cannot decide it is safe; only
 * the plant being lit can.
 */

/** What one plant can do for another. */
export const AID = {
	MOVE_ASIDE : 'move-aside',
	YIELD_SPOT : 'yield-spot',
	SHELTER    : 'shelter',
	SHADE      : 'shade',
	WARMTH     : 'warmth',
	LIGHT      : 'light',
	WINDBREAK  : 'windbreak',
	HUDDLE     : 'huddle',
}

/** Which kinds require getting close enough to transmit something. */
export const CONTACT_AID = [ AID.SHELTER, AID.LIGHT, AID.SHADE, AID.WARMTH, AID.WINDBREAK, AID.HUDDLE ]

/**
 * Aid where both plants gain, rather than one spending for the other.
 *
 * Every other kind here has a giver and a receiver, and the interesting question
 * is what it costs the giver. Standing close enough to share a humid pocket is
 * not like that: the humidity each one adds is breathed by both, so refusing it
 * costs the refuser as much as the asker. It is also the only kind that can be
 * bad for both at once, which is why it is the only kind with a gate on the
 * conditions rather than on the plants.
 */
export const RECIPROCAL_AID = [ AID.HUDDLE ]

/**
 * What each kind of help is supposed to change, and in which direction.
 *
 * The thing that makes a session general rather than light-specific. Two quite
 * different shapes of help hide behind the word "aid":
 *
 *   **accumulate** — a dose. Light is the clear case: it adds up, and enough is
 *   enough. The session ends when the total measured is what was needed.
 *
 *   **sustain** — a condition. Shade, shelter and warmth deliver no total at
 *   all; they hold something at a level for as long as it is needed. There is no
 *   quantity to reach, and a session that counted one would stop at an arbitrary
 *   moment having learned nothing about whether the plant is still suffering.
 *
 * Treating the second kind as the first was the mistake baked into the first
 * version of this file.
 */
export const AID_EFFECT = {
	[ AID.LIGHT ]      : {
		metric : 'light',
		mode : 'accumulate',
		direction : 'up',
		unit : 'lux·s',
		why : 'Light adds up. Enough is a total, and the session ends when the total has arrived.',
	},
	[ AID.SHADE ]      : {
		metric : 'light',
		mode : 'sustain',
		direction : 'down',
		unit : 'lux',
		why : 'Shade holds light below a ceiling. There is no dose of shade — it either is or is not blocking the sun, for as long as the sun is a problem.',
	},
	[ AID.MOVE_ASIDE ] : {
		metric : 'light',
		mode : 'sustain',
		direction : 'up',
		unit : 'lux',
		why : 'Getting out of the way should raise the light reaching the other plant, and keep it raised. If it does not, the mover was not the thing casting the shadow.',
	},
	[ AID.YIELD_SPOT ] : {
		metric : 'light',
		mode : 'sustain',
		direction : 'up',
		unit : 'lux',
		why : 'Swapping places is only help if the spot actually is better, which the receiver can now check rather than assume.',
	},
	[ AID.WARMTH ]     : {
		metric : 'temperature',
		mode : 'sustain',
		direction : 'up',
		unit : '°C',
		why : 'Blocking a cold draught raises the temperature at the sheltered plant and holds it there.',
	},
	[ AID.SHELTER ]    : {
		metric : 'airflow',
		mode : 'sustain',
		direction : 'down',
		unit : 'm/s',
		why : 'Standing between a plant and moving air reduces what reaches it. Sustained, not accumulated.',
	},
	[ AID.HUDDLE ]     : {
		metric : 'humidity',
		mode : 'sustain',
		direction : 'up',
		unit : '%',
		reciprocal : true,
		why : 'Two plants close enough for their boundary layers to overlap transpire into the same air and both end up in a more humid, lower-VPD pocket than the room around them. Neither gives anything away — which is also why it is the one kind of help that can leave both worse off, if the air is too still to bring CO2 back in.',
	},
	[ AID.WINDBREAK ]  : {
		metric : 'airflow',
		mode : 'sustain',
		direction : 'down',
		unit : 'm/s',
		why : 'The same as shelter, over a longer span and usually outdoors.',
	},
}

/**
 * How to tell whether a given kind of help is working.
 *
 * @param   {string} kind - One of `AID`.
 * @returns {object|null} The effect definition.
 */
export function aidEffect( kind ) {

	return AID_EFFECT[ kind ] ?? null

}

/**
 * Would standing these two together starve them of CO2?
 *
 * The check that stops grouping from being unconditionally good. Two plants
 * photosynthesising into still air pull the local CO2 down faster than it
 * refills, and the arrangement that helps them in dry moving air makes both of
 * them worse in stagnant air at midday.
 *
 * Unknown airflow does not block, and that is a deliberate exception to how the
 * rest of this library treats missing data. Everywhere else the missing reading
 * hides a hazard; here it hides a mild, reversible inefficiency that resolves on
 * its own the moment anyone opens a door, and refusing every huddle on rooms
 * without an anemometer would refuse nearly all of them. It is flagged instead.
 *
 * @param   {object} helper - A `SmartPlant`.
 * @param   {object} [opts] - `{ airflow, light }`, else read from the plant.
 * @returns {object}        `{unsafe, why}`.
 */
export function crowdingRisk( helper, opts = {} ) {
	opts = opts ?? {}

	const last = helper?.memory?.lastReading ?? {}
	const airflow = opts.airflow ?? last.airflow
	const light = opts.light ?? last.light

	const stagnant = Number.isFinite( airflow ) ? airflow < 0.15 : null
	const active = Number.isFinite( light ) ? light > 8000 : null

	if ( stagnant === true && active === true ) {

		return {
			unsafe : true,
			reason : 'co2-depletion',
			why : `Not now. Airflow is ${airflow} m/s and light is ${light}: still air, both plants fixing carbon hard. Standing closer in these conditions means competing for the CO2 in the same pocket, and both would fix less than they do apart. This is worth doing at night, or in moving air, or with a fan running — the arrangement is fine, the timing is not.`,
		}

	}

	return {
		unsafe : false,
		flagged : stagnant === null,
		why : stagnant === null
			? 'No airflow reading, so CO2 depletion cannot be ruled out. Allowed anyway: unlike the hazards this library refuses on missing data, this one is mild, reversible and fixed by opening a window. Worth knowing rather than worth blocking.'
			: `Airflow at ${airflow} m/s replaces the air between them faster than two plants can draw it down.`,
	}

}

/**
 * Can these two safely be near each other?
 *
 * @param   {object} a - `{id, biotic, canSee}`.
 * @param   {object} b - `{id, biotic, canSee}`.
 * @returns {object}   `{safe, why}`.
 */
export function proximitySafe( a, b ) {

	// Either side may be missing entirely — a peer that never announced itself
	// is exactly the case this gate must not wave through.
	a = a ?? {}
	b = b ?? {}

	for ( const [ one, other ] of [ [ a, b ], [ b, a ] ] ) {

		if ( one.biotic === true ) {

			return {
				safe : false,
				blocked : one.id,
				reason : 'biotic',
				why : `"${one.id}" is showing signs of pests or infection. Moving it next to "${other.id}" is exactly how that spreads — mites walk and spores fall, and proximity is the route. No contact aid until that clears.`,
			}

		}

	}

	// Not seeing a pest is not the same as not having one. A plant with no camera
	// has no way to rule out an infestation, and treating silence as a clean bill
	// of health is how one gets carried across a room.
	const blind = [ a, b ].filter( p => p.canSee === false )

	if ( blind.length ) {

		return {
			safe : false,
			blocked : blind.map( p => p.id ),
			reason : 'unverifiable',
			why : `${blind.map( p => `"${p.id}"` ).join( ' and ' )} ${blind.length === 1 ? 'has' : 'have'} no camera, so an infestation cannot be ruled out. Absence of evidence is not evidence here — a plant that cannot look cannot certify itself clean, and contact aid is the one place that distinction matters most.`,
		}

	}

	return {
		safe : true,
		why : 'Neither plant is showing biotic signs and both can check themselves.',
	}

}

/**
 * Read a plant's state for the purposes of deciding whether to go near it.
 *
 * @param   {object} plant - A `SmartPlant`.
 * @returns {object}       `{id, biotic, canSee, why}`.
 */
export function bioticStatus( plant ) {

	const vision = plant?.perception?.vision?.findings
	const watch = plant?._lastInfectionWatch
	const canSee = Boolean( plant?.vision )

	const suspected = Boolean( watch?.suspected || vision?.pests || vision?.spots )

	return {
		id : plant?.colony?.id ?? plant?.memory?.plant?.name ?? 'plant',
		biotic : canSee ? suspected : null,
		canSee,
		why : !canSee
			? 'No camera, so nothing can be confirmed or ruled out.'
			: suspected
				? 'Visible or electrical signs consistent with a pest or infection.'
				: 'Nothing visible and nothing in the electrical record.',
	}

}

/**
 * Can this plant help, and does it cost more than it has?
 *
 * @param   {object} helper  - A `SmartPlant`.
 * @param   {string} kind    - One of `AID`.
 * @param   {object} [opts]  - `{ metres }`.
 * @returns {object}         `{able, cost, why}`.
 */
export function canOffer( helper, kind, opts = {} ) {
	opts = opts ?? {}

	if ( !Object.values( AID ).includes( kind ) ) {

		return {
			able : false,
			why : `Unknown kind of help "${kind}". One of: ${Object.values( AID ).join( ', ' )}.`,
		}

	}

	if ( kind === AID.LIGHT && !helper.spectral ) {

		return {
			able : false,
			why : 'This plant has no lamp, so it has no light to offer.',
		}

	}

	// A plant defending itself is a bad candidate for helping anyone. It is
	// already spending, and the help would come out of the same budget.
	const busy = helper?._lastDefense ?? helper?.defense?.()

	if ( busy && busy.posture?.hold?.includes( 'aid-session' ) ) {

		return {
			able : false,
			reason : 'defending',
			why : `Not now. ${busy.statement} A plant mounting a defence has somewhere else to put its energy, and offering ${kind} would take from that. This is not a permanent refusal — it lifts when the response does.`,
		}

	}

	// Huddling is the one kind whose cost is not paid by either plant. It is paid
	// by the pocket of air between them, and only when nothing is stirring it.
	if ( kind === AID.HUDDLE ) {

		const risk = crowdingRisk( helper, opts )
		if ( risk.unsafe ) return {
			able : false,
			...risk,
		}

	}

	const needsMoving = kind !== AID.LIGHT || opts.metres

	if ( needsMoving && !helper.body ) {

		return {
			able : false,
			why : 'This plant cannot move. Aid that requires going anywhere needs `embody()` and a drive.',
		}

	}

	// The helper's own energy comes first. A plant that strands itself being
	// generous has turned one problem into two.
	if ( helper.power && opts.metres ) {

		const travel = helper.power.canTravel( opts.metres )

		if ( !travel.afford ) {

			return {
				able : false,
				cost : travel.costWh,
				why : `Not enough charge to go and come back. ${travel.why}`,
			}

		}

	}

	return {
		able : true,
		why : `Able to offer ${kind}.`,
	}

}

/**
 * Decide on a request for help.
 *
 * @param   {object} helper   - The plant being asked.
 * @param   {object} request  - `{ kind, from, metres, biotic, canSee }`.
 * @returns {object}          `{accept, why}`.
 */
export function considerRequest( helper, request = {} ) {
	request = request ?? {}

	const kind = request.kind
	const able = canOffer( helper, kind, request )

	if ( !able.able ) return {
		accept : false,
		...able,
	}

	if ( CONTACT_AID.includes( kind ) ) {

		const mine = bioticStatus( helper )
		const theirs = {
			id : request.from ?? 'the asker',
			biotic : request.biotic ?? null,
			canSee : request.canSee ?? false,
		}

		const near = proximitySafe( mine, theirs )

		if ( !near.safe ) return {
			accept : false,
			...near,
		}

	}

	if ( kind === AID.LIGHT ) {

		// The helper may carry a lamp over. It may not decide the dose is safe:
		// that judgement belongs to the plant being lit, through its own ledger.
		return {
			accept : true,
			conditional : true,
			why : 'Willing to bring light, but the dose has to be authorised and booked by the plant receiving it. A lamp arriving from outside bypasses that plant\'s own dark-hour protection, contraindications and dose ledger, and a dose nobody recorded is a dose that can be delivered twice.',
		}

	}

	return {
		accept : true,
		why : `${kind} costs this plant little and does not require touching anything.`,
	}

}

/**
 * Accept light from a neighbour — the receiving side.
 *
 * Runs the offered emission through this plant's own spectral safety, and books
 * it against this plant's own dose ledger. Without this the two halves of a
 * shared dose are each correctly metered and the total is not metered at all.
 *
 * @param   {object} plant   - The plant being lit.
 * @param   {object} offer   - `{ from, band, seconds, level }`.
 * @returns {Promise<object>} `{accepted, why}`.
 */
export async function acceptLight( plant, offer = {} ) {

	offer = offer ?? {}

	if ( !plant?.spectral ) {

		return {
			accepted : false,
			why : 'This plant has no spectral layer, so it has nothing to meter an incoming dose with. Light it cannot account for is light it must refuse.',
		}

	}

	const verdict = plant.spectral.safety.validate( {
		band    : offer.band,
		mode    : 'treat',
		seconds : offer.seconds ?? 0,
		level   : offer.level ?? 0.5,
	}, plant.context() )

	if ( !verdict.allowed ) {

		return {
			accepted : false,
			verdict,
			why : `Refused by this plant's own safety layer, which is the only one that knows what it has already had today: ${verdict.reasons.join( ' ' )}`,
		}

	}

	// Booked here, on the receiver, because this is the ledger that decides
	// whether the *next* dose is allowed.
	plant.spectral.safety.record( offer.band, verdict.request.seconds, verdict.request.level ?? offer.level )

	return {
		accepted : true,
		band : offer.band,
		seconds : verdict.request.seconds,
		from : offer.from,
		why : `Accepted ${verdict.request.seconds}s of ${offer.band} from "${offer.from}" and booked it against this plant's own daily dose. Whatever it asks its own lamp for later will be measured against this.`,
	}

}
