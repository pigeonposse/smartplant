/**
 * How much water, and for how long.
 *
 * A pump on a relay needs two numbers nobody has been giving it: millilitres and
 * seconds. Until now `water()` recorded that a watering happened and said
 * nothing about its size, which is fine for a person with a watering can and
 * useless for a pump.
 *
 * ## The species is not the number that matters
 *
 * The obvious design is a table of millilitres per archetype. It is the wrong
 * shape, and it is wrong by an order of magnitude rather than a little.
 *
 * A Monstera in a 12 cm pot holds about 700 ml of substrate. The same Monstera
 * in a 40 cm pot holds about 25 litres. They are the same plant with the same
 * archetype and they want thirty times the water, and any table keyed on species
 * will be badly wrong for one of them.
 *
 * What the archetype *does* determine is the **fraction** of the substrate to
 * wet and how much standing water the roots will tolerate — a xerophyte wants a
 * small fraction and needs to dry out completely between, an aroid wants most of
 * the pot wet and rots if it stays that way. So the archetype gives a fraction
 * and a tolerance, the pot gives the volume, and the two multiply.
 *
 * If nobody has said how big the pot is, no volume is offered. A default pot
 * size would be a guess with the same order-of-magnitude error as the table this
 * replaces.
 *
 * ## Seconds are not millilitres either
 *
 * Turning a volume into a pump duration needs the flow rate of that specific
 * pump through that specific tube at that specific head height, and it drifts as
 * the tube ages and the reservoir empties. It is measured, not looked up.
 *
 * So a duration is only offered once somebody has calibrated the pump, and the
 * calibration is one number anybody can take with a measuring jug and a
 * stopwatch. Without it the system says the volume and refuses the duration,
 * which is the honest half of the answer rather than a plausible whole one.
 *
 * ## And it is open-loop, which is the dangerous part
 *
 * A pump dosing by time reports success whether or not water arrived. A blocked
 * line, an empty reservoir and a tube that fell out of the pot all look
 * identical from the relay, and all of them report a watering that did not
 * happen — which is worse than no automation, because the record then says the
 * plant was watered.
 *
 * So every dose comes with what to check afterwards and how long to wait for it.
 * The soil probe is what closes the loop, and a dose that produced no rise in
 * moisture is a fault rather than a plant that drank quickly.
 */

/** How much of the substrate to wet, and what happens if it stays wet. */
export const WATERING = {
	xerophyte : {
		fraction : 0.25,
		soakToRunoff : true,
		dryBackTo : 0.15,
		waitHours : 2,
		why : 'Soak hard and then leave it completely alone. These evolved for rain that arrives rarely and drains fast, and the thing that kills them is not drought but a substrate that never dries — roots sitting damp rot within days. A quarter of the pot volume, poured until it runs out of the bottom, then nothing until the probe says it is almost dry.',
	},
	tropical : {
		fraction : 0.35,
		soakToRunoff : false,
		dryBackTo : 0.5,
		waitHours : 1,
		why : 'Evenly moist and never saturated. The usual failure here is not underwatering — it is a dense substrate with no air left in it, so a third of the pot volume at a time and never enough to leave it standing.',
	},
	hygrophyte : {
		fraction : 0.45,
		soakToRunoff : false,
		dryBackTo : 0.65,
		waitHours : 1,
		why : 'These come from ground that is genuinely wet and they wilt fast when it is not. A larger fraction, more often, and the top of the substrate should not be allowed to dry at all.',
	},
	heliophyte : {
		fraction : 0.3,
		soakToRunoff : true,
		dryBackTo : 0.3,
		waitHours : 2,
		why : 'Full sun means high transpiration and fast turnover. Water thoroughly and let it drain — in strong light the pot empties quickly on its own, and the risk is the reverse of a shade plant.',
	},
	c4 : {
		fraction : 0.3,
		soakToRunoff : true,
		dryBackTo : 0.25,
		waitHours : 2,
		why : 'Efficient with water by design, and they use it fast when it is there. Thorough and infrequent suits them better than little and often.',
	},
	woody : {
		fraction : 0.4,
		soakToRunoff : true,
		dryBackTo : 0.35,
		waitHours : 4,
		why : 'Deep roots and stored reserves, so it is slow to show thirst and slow to recover from a mistake. Water the whole rootball rather than the top of it, and expect the response to take hours rather than minutes — a shallow watering wets the top and leaves the roots that matter dry.',
	},
}

/**
 * Subgroups that want something different from their archetype.
 *
 * Only where it genuinely differs. A subgroup that behaves like its archetype is
 * not listed, because a table that repeats itself invites somebody to change one
 * copy.
 */
export const SUBGROUP_WATERING = {
	aroid : {
		fraction : 0.3,
		dryBackTo : 0.45,
		why : 'Thick roots that need air more than most aroids get. Slightly less than the tropical default, and allowed to dry further between.',
	},
	epiphyte : {
		fraction : 0.2,
		soakToRunoff : true,
		dryBackTo : 0.25,
		why : 'These grow on bark, not in soil. What they want is a brief drench and then air — a pot kept evenly moist is closer to how they die than to how they live.',
	},
	succulent : {
		fraction : 0.2,
		dryBackTo : 0.1,
		waitHours : 3,
		why : 'Stored water in the tissue means it can wait far longer than it looks, and it takes up water slowly — a big dose mostly runs past the roots and out.',
	},
	cactus : {
		fraction : 0.2,
		dryBackTo : 0.08,
		waitHours : 3,
		why : 'The same, more so. Almost every dead houseplant cactus was overwatered.',
	},
	fern : {
		fraction : 0.45,
		dryBackTo : 0.7,
		waitHours : 1,
		why : 'The one group where letting it dry once is a real setback rather than a nuisance.',
	},
	carnivorous : {
		fraction : 0.4,
		dryBackTo : 0.7,
		waitHours : 1,
		why : 'Wet, and with the wrong water they die: these need rain or distilled. Tap water kills them slowly through mineral build-up, and nothing in this library can tell what is in the reservoir.',
	},
}

/** Litres of substrate in a round pot, from its diameter and depth in cm. */
export function potVolume( { diameterCm, depthCm } = {} ) {

	if ( !Number.isFinite( diameterCm ) ) return null

	// Most pots are roughly as deep as they are wide, and taper. The 0.6 accounts
	// for the taper and for the substrate not filling to the rim.
	const depth = Number.isFinite( depthCm ) ? depthCm : diameterCm

	return Number( ( Math.PI * ( diameterCm / 2 ) ** 2 * depth * 0.6 / 1000 ).toFixed( 2 ) )

}

const finite = Number.isFinite

/**
 * What this plant's watering should look like.
 *
 * @param   {object} plant  - `{archetype, subgroup, pot: {diameterCm, depthCm, litres}}`.
 * @param   {object} [opts] - `{ season }` weight from the seasonal table.
 * @returns {object}        `{known, ml, why}`.
 */
export function dose( plant = {}, opts = {} ) {

	plant = plant ?? {}
	opts = opts ?? {}

	const archetype = plant.archetype?.id ?? plant.archetype
	const subgroup = plant.subgroup ?? plant.archetype?.subgroup

	const base = WATERING[ archetype ]

	if ( !base ) {

		return {
			known : false,
			missing : [ 'archetype' ],
			why : 'No archetype, so there is nothing to say what fraction of this pot should be wet. A cactus and a fern want opposite things from the same pot, and guessing between them is how one of them dies.',
		}

	}

	const profile = {
		...base,
		...( SUBGROUP_WATERING[ subgroup ] ?? {} ),
	}

	const litres = finite( plant.pot?.litres )
		? plant.pot.litres
		: potVolume( plant.pot )

	if ( !finite( litres ) ) {

		return {
			known : false,
			missing : [ 'pot' ],
			profile,
			why : `${archetype}${subgroup ? ` (${subgroup})` : ''} wants ${Math.round( profile.fraction * 100 )}% of its substrate wetted, and nobody has said how big the pot is. That fraction is the part the plant decides; the volume is the part the pot decides, and the same plant in a 12cm pot and a 40cm one wants thirty times the water. Pass { pot: { diameterCm } } — a default would be wrong by that same factor.`,
		}

	}

	// Substrate holds roughly a third of its volume as available water when
	// saturated. The fraction is of that, not of the pot.
	const ml = Math.round( litres * 1000 * 0.33 * profile.fraction * ( opts.season ?? 1 ) )

	return {
		known : true,
		ml,
		litres,
		fraction : profile.fraction,
		soakToRunoff : profile.soakToRunoff === true,
		dryBackTo : profile.dryBackTo,
		waitHours : profile.waitHours,
		archetype,
		subgroup : subgroup ?? null,
		why : `${ml} ml for a ${litres} litre pot. ${profile.why}${opts.season && opts.season !== 1 ? ` Scaled to ${Math.round( opts.season * 100 )}% for the time of year.` : ''}`,
		// An estimate to start from, not a measurement. It gets replaced.
		estimated : true,
	}

}

/**
 * How long to run the pump for that volume.
 *
 * Only answerable once somebody has measured the pump. Flow rate depends on the
 * pump, the tube, the head height and how full the reservoir is, and it drifts —
 * so it is measured with a jug and a stopwatch rather than looked up.
 *
 * @param   {number} ml    - The volume.
 * @param   {object} pump  - `{mlPerSecond, measuredAt}`.
 * @returns {object}       `{known, seconds, why}`.
 */
export function pumpSeconds( ml, pump = {} ) {

	pump = pump ?? {}

	if ( !finite( ml ) ) {

		return {
			known : false,
			why : 'No volume to convert.',
		}

	}

	if ( !finite( pump.mlPerSecond ) || pump.mlPerSecond <= 0 ) {

		return {
			known : false,
			ml,
			missing : [ 'pump.mlPerSecond' ],
			why : `${ml} ml, and no way to turn that into seconds. The flow rate depends on this pump, this tube and this head height, and it drifts as the tube ages and the reservoir empties — so it is measured rather than assumed. Run the pump into a measuring jug for ten seconds, divide, and pass { pump: { mlPerSecond } }. The volume above is still the honest half of the answer.`,
		}

	}

	const seconds = Number( ( ml / pump.mlPerSecond ).toFixed( 1 ) )
	const age = pump.measuredAt ? Date.now() - pump.measuredAt : null

	return {
		known : true,
		seconds,
		ml,
		mlPerSecond : pump.mlPerSecond,
		stale : finite( age ) && age > 90 * 86_400_000,
		why : `${seconds}s at ${pump.mlPerSecond} ml/s.${finite( age ) && age > 90 * 86_400_000 ? ` That rate was measured ${Math.round( age / 86_400_000 )} days ago and flow drifts — worth checking it against a jug again.` : ''}`,
	}

}

/**
 * What to look for after a dose, and when to give up on it.
 *
 * The part that makes automated watering safe rather than merely automatic. A
 * pump reports success whether or not water arrived: a blocked line, an empty
 * reservoir and a tube that has fallen out of the pot are identical from the
 * relay, and each records a watering that did not happen. Only the soil probe
 * can tell.
 *
 * @param   {object} plan   - From `dose`.
 * @param   {number} before - Soil moisture at the moment of watering.
 * @param   {number} after  - Soil moisture after `waitHours`.
 * @returns {object}        `{arrived, why}`.
 */
export function confirm( plan, before, after ) {

	if ( !finite( before ) || !finite( after ) ) {

		return {
			arrived : null,
			why : 'No soil reading either side, so whether the water arrived is unknown. An open-loop pump is the one piece of automation here that can fail silently and leave a record saying the opposite — without a probe, every dose is a claim rather than an event.',
		}

	}

	const rise = after - before

	if ( rise >= 5 ) {

		return {
			arrived : true,
			rise : Number( rise.toFixed( 1 ) ),
			why : `Soil rose ${rise.toFixed( 1 )} points after the dose, so water reached the substrate.`,
		}

	}

	return {
		arrived : false,
		rise : Number( rise.toFixed( 1 ) ),
		fault : true,
		why : `The pump ran and soil moved ${rise.toFixed( 1 )} points, which is not a watering. Something between the reservoir and the pot: an empty tank, a blocked or kinked line, a tube that has come out of the pot, or a pump that is spinning without priming. Check before dosing again — a second dose on a blocked line does nothing except record a second watering that did not happen.`,
	}

}
