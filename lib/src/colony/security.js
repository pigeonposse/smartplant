/**
 * Preparing a plant for a threat its neighbour already has.
 *
 * Priming is one of the better-established findings in plant defence. Expose a
 * plant to a low dose of a stress, or to the volatile signature of a neighbour
 * under attack, and it does not mount a defence — it becomes *ready* to. Defence
 * transcripts sit poised, chromatin around them opens, and when the attack
 * arrives the response is faster and larger than it would have been. The plant
 * pays very little until the threat is real.
 *
 * The colony channel already carries the warning (see `coupling.js`). This is
 * what a warned plant can actually *do* with it, using the actuators this
 * library has: light, air, and the electrode.
 *
 * ## Three things this deliberately does not do
 *
 * A first design of this protocol had all three, and each is worth naming,
 * because each is the kind of mistake that produces a system that looks
 * sophisticated and makes plants worse.
 *
 * **It does not lower red:far-red.** The instinct is that a low R:FR signals
 * threat and should push a plant toward defence. It is precisely backwards.
 * Inactivating phytochrome B — which is what low R:FR does — *suppresses*
 * jasmonate and salicylate responsiveness. It is the canonical growth-defence
 * trade-off: a plant that believes it is being shaded out spends on stem
 * elongation and disinvests from defence. Pairing a UV-B pulse with a low R:FR
 * would induce defence with one hand and switch it off with the other. Where
 * this protocol touches R:FR at all, it holds it *high*.
 *
 * **It does not drive the electrode.** That micro-currents alter membrane
 * potential is real. That there is a dosable, reproducible protocol for closing
 * stomata to a chosen percentage with 0.5-2 µA is not — and a system that
 * injects current into living tissue on the strength of a plausible mechanism
 * has stopped being an instrument. The electrode stays what it is everywhere
 * else in this library: a witness. It reports whether the priming is landing.
 *
 * **It does not accept a warning from anywhere.** A pest outbreak two thousand
 * kilometres away, on the same species, says almost nothing about this room.
 * This library's own doctrine is that context diversity gates transferability
 * and that a room of neighbours is one witness rather than many. A global alert
 * ring would contradict both. Proximity is the whole signal here, because the
 * thing being warned about physically travels.
 *
 * ## What it does do
 *
 * Two actuations, both anchored:
 *
 *   · **UV-B**, which is genuinely well established: it activates the UVR8
 *     photoreceptor, which drives phenolic and flavonoid biosynthesis, which
 *     makes leaf tissue tougher and less palatable. Used commercially in
 *     glasshouses. It is also the most dangerous thing this library can emit,
 *     to the plant and to whoever is in the room, so it is gated hardest.
 *
 *   · **Airflow**, which breaks the leaf boundary layer. Drier leaf surfaces
 *     are worse for fungal spore germination, and disrupted transpiration
 *     gradients make a plant harder for a searching insect to locate. It costs
 *     the plant almost nothing and it is the only phase safe to run on a plant
 *     that is already struggling.
 *
 * And priming is a cost. A plant spending on phenolics is not spending on
 * growth, so `stress_load` can refuse the whole thing, and does.
 */

import { KINSHIP, kinship } from '../migration/teaching.js'
import { LEVEL } from '../states/index.js'

/** How the protocol runs, in order. */
export const PHASE = {
	AIRFLOW  : 'airflow',
	UVB      : 'uvb',
	WATCH    : 'watch',
	STAND_DOWN : 'stand-down',
}

/** How far a warning is allowed to travel, and what it is worth at that range. */
export const RING = {
	CONTACT : {
		id : 'contact',
		metres : 0.4,
		weight : 1,
		why : 'Touching or near enough for leaves to meet. Mites walk this distance; there is no gap to cross.',
	},
	ROOM : {
		id : 'room',
		metres : 8,
		weight : 0.6,
		why : 'The same room, the same air, the same watering can and the same hands. This is how most infestations actually move between houseplants.',
	},
	BUILDING : {
		id : 'building',
		metres : 60,
		weight : 0.25,
		why : 'The same building but not the same air. Worth knowing about, not worth spending on unless something else agrees.',
	},
}

/**
 * The one thing UV-B is allowed to do, and everything it is not.
 *
 * UV-B damages DNA. That is not incidental to how it works — the plant's
 * response is a response to damage — and it is why this is the only emission in
 * this library with a hard daily cap that no caller can raise. It also burns
 * human skin and eyes, and a plant on a shelf is at eye height.
 */
export const UVB = {
	nm : 300,
	/** Seconds per day, total. Well below any published phytotoxic threshold. */
	maxSecondsPerDay : 90,
	/** Seconds in one pulse. Short pulses, repeated, are what the literature uses. */
	pulseSeconds : 15,
	level : 0.3,
	why : 'Activates UVR8, which drives phenolic and flavonoid synthesis and toughens the leaf surface. Real, and used in commercial glasshouses. Also genuinely hazardous, which is why it is capped, interlocked and refused by default rather than merely configured.',
}

const finite = Number.isFinite

/**
 * Which ring a neighbour falls in.
 *
 * @param   {number} metres - Declared distance.
 * @returns {object|null}   The ring.
 */
export function ringFor( metres ) {

	if ( !finite( metres ) ) return null

	for ( const r of [ RING.CONTACT, RING.ROOM, RING.BUILDING ] ) {

		if ( metres <= r.metres ) return r

	}

	return null

}

/**
 * How much a warning from that plant is worth to this one.
 *
 * Two independent gates, multiplied. A pest that only eats one family is not a
 * threat to a plant in another, however close it is standing; and a pest that
 * would happily eat this plant is still not arriving from a different building.
 *
 * @param   {object} alert - `{from, species, archetype, what, metres, confirmed}`.
 * @param   {object} plant - The plant considering it.
 * @returns {object}       `{weight, ring, kin, why}`.
 */
export function relevance( alert = {}, plant = {} ) {

	const ring = ringFor( alert.metres )

	if ( !ring ) {

		return {
			weight : 0,
			why : finite( alert.metres )
				? `${alert.metres}m away. Beyond ${RING.BUILDING.metres}m a warning carries no information about this plant's situation — the thing being warned about has to physically travel here, and the whole basis of the alert is that it can. A pest on the same species in another city is a fact about that city.`
				: 'No distance was declared, so there is no way to know whether this warning is about a plant sharing this air or one on another continent. It is the difference between acting and ignoring, and it cannot be guessed.',
		}

	}

	const kin = kinship( {
		species : alert.species,
		archetype : alert.archetype,
	}, {
		species : plant.memory?.plant?.species,
		archetype : plant.archetype?.id,
	} )

	// Host specificity is the other half. Most serious pests are narrow, and a
	// plant priming itself against something that cannot eat it has spent for
	// nothing.
	const host = kin.kinship === KINSHIP.SPECIES ? 1
		: kin.kinship === KINSHIP.ARCHETYPE ? 0.5
			: 0.25

	const weight = Number( ( ring.weight * host ).toFixed( 2 ) )

	return {
		weight,
		ring : ring.id,
		kin : kin.kinship,
		why : `${ring.why} ${kin.kinship === KINSHIP.SPECIES
			? 'Same species, so whatever is eating that plant eats this one.'
			: kin.kinship === KINSHIP.NEIGHBOUR
				? 'Nothing in common biologically, so most of what could be over there is host-specific and cannot cross. Not dismissed — a spider mite eats almost anything — but worth a fraction of what the same warning would be from a sibling.'
				: 'Same strategy, different species. Some of what threatens one threatens the other, and a good deal of it does not.'}`,
	}

}

/**
 * Decide whether to prime, and how far to go.
 *
 * @param   {object} plant  - The plant considering it.
 * @param   {object} alert  - The warning.
 * @param   {object} [opts] - `{ allowUvb, occupied }`.
 * @returns {object}        `{prime, phases, why}`.
 */
export function considerAlert( plant, alert = {}, opts = {} ) {

	const rel = relevance( alert, plant )

	if ( rel.weight < 0.15 ) {

		return {
			prime : false,
			relevance : rel,
			why : `Not priming. ${rel.why}`,
		}

	}

	const states = plant.states?.() ?? {}
	const load = states.stress_load
	const defense = states.defense_activation

	// Priming is not free. A plant spending on phenolics is not spending on
	// growth, and a plant that has been through several episodes has less to
	// spend. This is the refusal that keeps the whole idea honest.
	if ( load?.acts && load.level === LEVEL.HIGH ) {

		return {
			prime : false,
			relevance : rel,
			blocked : 'stress_load',
			why : `Not priming. ${load.why} Priming costs a plant real resources — phenolics and flavonoids are built out of carbon that would otherwise be growth — and asking that of a plant already running on reduced capacity trades a possible threat for a certain cost. Watching instead.`,
		}

	}

	// A plant already mounting a defence does not need to be prepared for one.
	if ( defense?.acts && defense.level === 'high' ) {

		return {
			prime : false,
			relevance : rel,
			blocked : 'defense_activation',
			why : 'Not priming. This plant is already mounting a defence, and priming exists to get a plant ready for something that has not happened yet. Adding an induction on top of an active response is spending twice for one outcome.',
		}

	}

	const phases = [ PHASE.AIRFLOW ]

	// UV-B is off unless someone deliberately turned it on for this plant, and
	// even then it needs the threat to be worth it and the room to be empty.
	const uvb = uvbGate( plant, rel, opts )
	if ( uvb.allowed ) phases.push( PHASE.UVB )

	phases.push( PHASE.WATCH )

	return {
		prime : true,
		relevance : rel,
		phases,
		uvb,
		// Held high rather than lowered. Low R:FR would suppress exactly the
		// pathway this is trying to prepare.
		redFarRed : {
			hold : 'high',
			why : 'Red:far-red is held high, not lowered. Low R:FR inactivates phytochrome B, and that suppresses jasmonate and salicylate responsiveness — the growth-defence trade-off. Lowering it here would switch off the pathway the rest of this protocol is trying to prepare.',
		},
		why : `Priming at weight ${rel.weight}. ${rel.why} Running ${phases.join( ' → ' )}${uvb.allowed ? '' : `, without UV-B: ${uvb.why}`}`,
	}

}

/**
 * May this plant emit UV-B right now?
 *
 * Off by default, and every one of these refusals is a real hazard rather than
 * a caution. This is the only emission in the library that can hurt a person.
 *
 * @param   {object} plant - The plant.
 * @param   {object} rel   - From `relevance`.
 * @param   {object} opts  - `{ allowUvb, occupied }`.
 * @returns {object}       `{allowed, why}`.
 */
export function uvbGate( plant, rel = {}, opts = {} ) {

	if ( opts.allowUvb !== true ) {

		return {
			allowed : false,
			reason : 'not-enabled',
			why : 'UV-B is off unless explicitly enabled for this plant. It is the one thing here that can injure the person in the room as well as the plant, so it is opt-in per installation rather than a default anyone inherits.',
		}

	}

	if ( !plant.spectral?.light?.channels?.includes?.( 'uvb' ) ) {

		return {
			allowed : false,
			reason : 'no-emitter',
			why : 'No UV-B channel on this fixture. Almost no consumer grow light has one, and nothing else in the spectrum substitutes — the response is specific to UVR8, which does not absorb visible light.',
		}

	}

	if ( opts.occupied === true ) {

		return {
			allowed : false,
			reason : 'occupied',
			why : 'Somebody is in the room. UV-B burns skin and eyes, a plant on a shelf is at eye height, and nothing about a possible aphid justifies that. It waits until the room is empty.',
		}

	}

	if ( rel.weight < 0.5 ) {

		return {
			allowed : false,
			reason : 'weak-alert',
			why : `The warning is worth ${rel.weight}, which is not enough to justify the strongest intervention available. Airflow costs the plant nothing and runs anyway; UV-B is held for a threat that is close and host-relevant.`,
		}

	}

	const today = plant.spectral?.safety?.usedToday?.( 'uvb' ) ?? 0

	if ( today >= UVB.maxSecondsPerDay ) {

		return {
			allowed : false,
			reason : 'daily-cap',
			usedSeconds : today,
			why : `${today}s of UV-B already today against a cap of ${UVB.maxSecondsPerDay}s. This cap cannot be raised by a caller: the plant's response to UV-B is a response to DNA damage, and more of it past this point is damage without the benefit.`,
		}

	}

	return {
		allowed : true,
		pulseSeconds : Math.min( UVB.pulseSeconds, UVB.maxSecondsPerDay - today ),
		level : UVB.level,
		why : `Enabled, fixture has the channel, room is empty, warning is worth ${rel.weight}, and ${UVB.maxSecondsPerDay - today}s of the daily budget remain. ${UVB.why}`,
	}

}

/**
 * Build the plan a primed plant runs.
 *
 * Ordered by cost. Airflow first because it is nearly free and starts working
 * immediately; UV-B second because it is expensive and hazardous; watching last
 * and longest, because the only honest way to know whether any of this helped is
 * to look.
 *
 * @param   {object} decision - From `considerAlert`.
 * @returns {object[]}        The phases.
 */
export function protocol( decision ) {

	if ( !decision?.prime ) return []

	const plan = []

	if ( decision.phases.includes( PHASE.AIRFLOW ) ) plan.push( {
		phase : PHASE.AIRFLOW,
		afterMinutes : 0,
		forMinutes : 120,
		action : {
			airflow : 'increase',
		},
		why : 'Moving air breaks the boundary layer at the leaf surface. Drier surfaces are worse for fungal spore germination, and a disrupted transpiration plume is harder for a searching insect to home in on. It costs the plant almost nothing, which is why it runs first and runs regardless.',
	} )

	if ( decision.phases.includes( PHASE.UVB ) ) plan.push( {
		phase : PHASE.UVB,
		afterMinutes : 15,
		forMinutes : 60,
		action : {
			band : 'uvb',
			pulseSeconds : decision.uvb.pulseSeconds,
			level : decision.uvb.level,
			redFarRed : 'hold-high',
		},
		why : 'Short UV-B pulses activate UVR8 and push the leaf toward phenolics and flavonoids — tougher, more bitter tissue. Red:far-red is held high throughout, because letting it fall would suppress the jasmonate response this is meant to prepare.',
	} )

	plan.push( {
		phase : PHASE.WATCH,
		afterMinutes : 0,
		forMinutes : 6 * 60,
		action : {
			inspect : true,
			electrode : 'observe',
		},
		why : 'The electrode watches rather than drives. If the priming is landing there will be a measurable change in this plant\'s own electrical baseline, and if there is not, that is worth knowing before the same protocol is run again.',
	} )

	plan.push( {
		phase : PHASE.STAND_DOWN,
		afterMinutes : 6 * 60,
		forMinutes : 0,
		action : { restore : true },
		why : 'Everything returns to normal after six hours unless the warning is renewed. A primed state that nobody stands down becomes a permanently half-defending plant, which is the growth-defence trade-off paid forever for a threat that passed.',
	} )

	return plan

}
