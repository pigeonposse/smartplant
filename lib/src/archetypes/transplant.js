/**
 * Moving a plant into a bigger pot.
 *
 * The person does one thing: says how many litres the new pot holds. Everything
 * that follows — the volumes, the expectations, the caution, and deciding when
 * it is over — is the system's work.
 *
 * That division is the whole design. Somebody repotting a plant has soil on
 * their hands and no interest in configuring settling windows, and a form that
 * asked them to would be pushing the system's job onto them. What they know that
 * the system cannot is the physical fact: the pot is now this big.
 *
 * ## The same plant, a different container
 *
 * Nothing about the symbiont is reset. The calibration record, the resolution
 * ledger, the trajectory, the adaptation log and the electrome history all
 * survive — this is a plant that has been moved, not a new plant.
 *
 * What resets is everything keyed to the container. Soil moisture in a five
 * litre pot means something different from the same number in a one litre pot:
 * the substrate is deeper, dries more slowly, and the probe is sitting somewhere
 * else in it. So the old soil baseline is closed and a new one starts empty, and
 * comparisons across the boundary are marked invalid rather than quietly made.
 *
 * ## Settling is caution, not a countdown
 *
 * A repotted plant has had its roots disturbed, and for a while afterwards it
 * behaves oddly for reasons that have nothing to do with how it is being looked
 * after. Reading that as water stress, or as a defence response, or as evidence
 * that a threshold needs moving would all be wrong in the same way.
 *
 * So during settling the elective things wait, watering leans conservative, and
 * the internal states are believed less. It ends when the readings stop being
 * chaotic rather than when a number of days has passed — a plant that settles in
 * four days should not be treated as fragile for a fortnight, and one still
 * wobbling after three weeks should not be declared fine because the calendar
 * says so.
 */

/** Where a transplant is. */
export const PHASE = {
	NONE     : 'none',
	SETTLING : 'settling',
	SETTLED  : 'settled',
}

/** The window inside which settling is even considered finished. */
export const MIN_SETTLING_DAYS = 5
export const MAX_SETTLING_DAYS = 21

/** Readings needed before the new pot has a curve of its own. */
export const MIN_READINGS = 40

const finite = Number.isFinite

/**
 * Open a transplant.
 *
 * @param   {object} plant - A `SmartPlant`.
 * @param   {object} opts  - `{ volumeL, note, electrodeMoved }`.
 * @returns {object}       The episode.
 */
export function start( plant, opts = {} ) {

	opts = opts ?? {}

	if ( !finite( opts.volumeL ) || opts.volumeL <= 0 ) {

		return {
			started : false,
			why : 'A transplant needs the new pot\'s volume in litres, and it is the one thing here that cannot be worked out — every watering figure, every drying expectation and every judgement about running out of room is scaled by it. A tape measure round the rim, or the number on the pot.',
		}

	}

	const was = plant?.config?.pot?.litres ?? plant?.config?.pot?.diameterCm
		? ( plant.config.pot.litres ?? null )
		: null

	const episode = {
		phase : PHASE.SETTLING,
		at : Date.now(),
		fromL : was,
		volumeL : opts.volumeL,
		note : opts.note ?? null,
		electrodeMoved : opts.electrodeMoved === true,
		// The moment everything before stops being comparable. Soil in a five
		// litre pot is not the same measurement as soil in a one litre pot.
		boundary : Date.now(),
		readingsAtStart : plant?.memory?.data?.readings?.length ?? 0,
	}

	return {
		started : true,
		episode,
		why : `${was ? `${was}L → ${opts.volumeL}L` : `Now ${opts.volumeL}L`}. Everything scaled by the pot is recalculated and the soil baseline starts again — the same number means something different in a deeper substrate with the probe somewhere else in it. Nothing about the plant's own record is touched: this is a plant that was moved, not a new one.${opts.electrodeMoved ? ' The electrode was moved too, so a break in continuity now is a contact to reseat rather than a plant in trouble.' : ''}`,
	}

}

/**
 * What a transplant changes, and what it deliberately does not.
 *
 * Kept as a table because the interesting content is the second column — the
 * things that look like they should reset and must not.
 */
export const RESETS = {
	wateringDose : {
		resets : true,
		why : 'Scales directly with the volume. A dose sized for one litre is a quarter of what five litres wants.',
	},
	dryingExpectation : {
		resets : true,
		why : 'A deeper substrate holds more and empties more slowly, so every expectation about how fast soil should fall is wrong until relearned.',
	},
	soilBaseline : {
		resets : true,
		why : 'The probe is in a different place in a different substrate. The old comfortable band describes a pot that no longer exists.',
	},
	weightBaseline : {
		resets : true,
		why : 'A new pot with new substrate weighs something else entirely.',
	},
	rootSpace : {
		resets : true,
		why : 'The whole point of moving it was that the last container was running out. Judging the new one on the old one\'s behaviour is the mistake this exists to avoid.',
	},
	calibration : {
		resets : false,
		why : 'Which of the system\'s own refusals turned out to be unnecessary is about the model, not the pot. It costs twelve overrides to build and a repotting does not invalidate one of them.',
	},
	resolutions : {
		resets : false,
		why : 'What actually resolved a problem for this plant is still what resolved it.',
	},
	trajectory : {
		resets : false,
		why : 'Losing it here would lose exactly the record that shows a transplant happening.',
	},
	electromeBaseline : {
		resets : false,
		why : 'Unless the electrode was moved, the contact is the same contact and its baseline still describes it. Roots being disturbed will move the signal for a while, and that is a real physiological change rather than a reason to throw the baseline away.',
	},
	identity : {
		resets : false,
		why : 'The same plant.',
	},
}

/**
 * Is it settled?
 *
 * Decided on the readings rather than the calendar. A plant that settles in four
 * days should not be treated as fragile for a fortnight, and one still wobbling
 * after three weeks should not be declared fine because the days ran out.
 *
 * @param   {object} plant   - A `SmartPlant`.
 * @param   {object} episode - The open episode.
 * @param   {object} [opts]  - `{ now }`.
 * @returns {object}         `{settled, day, why}`.
 */
export function assess( plant, episode, opts = {} ) {

	if ( !episode || episode.phase !== PHASE.SETTLING ) {

		return {
			settled : false,
			why : 'No transplant is settling.',
		}

	}

	const now = opts?.now ?? Date.now()
	const day = Math.floor( ( now - episode.at ) / 86_400_000 )

	const since = ( plant?.memory?.data?.readings ?? [] )
		.filter( r => new Date( r.t ).getTime() >= episode.boundary )

	if ( day < MIN_SETTLING_DAYS ) {

		return {
			settled : false,
			day,
			why : `Day ${day}. Roots were disturbed and the plant is behaving oddly for reasons that have nothing to do with how it is being looked after — reading that as water stress would be wrong in a way that lasts. Nothing is decided before day ${MIN_SETTLING_DAYS}.`,
		}

	}

	if ( since.length < MIN_READINGS ) {

		return {
			settled : false,
			day,
			readings : since.length,
			why : `Day ${day} with ${since.length} readings in the new pot, and this needs ${MIN_READINGS} before the container has a curve of its own. A plant read four times a day gets there in a week and a half.`,
		}

	}

	// Settled means the readings have stopped lurching. Measured on soil,
	// because that is the thing the new container actually changed.
	const soil = since.map( r => r.soil ).filter( finite )
	const recent = soil.slice( -Math.floor( soil.length / 2 ) )

	if ( recent.length < 8 ) {

		return {
			settled : false,
			day,
			why : `Day ${day}, and there is no usable soil series in the new pot. Without one there is no way to tell settled from unsettled, so it stays cautious.`,
		}

	}

	const mean = recent.reduce( ( a, b ) => a + b, 0 ) / recent.length
	const sd = Math.sqrt( recent.reduce( ( a, b ) => a + ( b - mean ) ** 2, 0 ) / recent.length )

	// A watered pot swings; a settling one swings less each week. Wide is
	// unsettled and there is no absolute number for wide, so this is against
	// the plant's own first days in this container.
	const firstHalf = soil.slice( 0, Math.floor( soil.length / 2 ) )
	const firstMean = firstHalf.reduce( ( a, b ) => a + b, 0 ) / firstHalf.length
	const firstSd = Math.sqrt( firstHalf.reduce( ( a, b ) => a + ( b - firstMean ) ** 2, 0 ) / firstHalf.length )

	const calmer = firstSd > 0 ? sd / firstSd : 1

	if ( calmer > 0.8 && day < MAX_SETTLING_DAYS ) {

		return {
			settled : false,
			day,
			calmer : Number( calmer.toFixed( 2 ) ),
			why : `Day ${day}. Soil is still moving about as much as it was in the first days after the move (${calmer.toFixed( 2 )}× the early spread), so the new pot has not found its rhythm. Caution stays on.`,
		}

	}

	return {
		settled : true,
		day,
		readings : since.length,
		calmer : Number( calmer.toFixed( 2 ) ),
		why : day >= MAX_SETTLING_DAYS && calmer > 0.8
			? `Day ${day}, and soil is still unsettled (${calmer.toFixed( 2 )}× the early spread). Closing anyway at the ${MAX_SETTLING_DAYS}-day limit: staying cautious indefinitely would mean this plant never gets probed or experimented on again, and if it is genuinely still unstable that is a finding for the ordinary machinery rather than a reason to keep a transplant open forever.`
			: `Day ${day}, ${since.length} readings, and soil now moves ${calmer.toFixed( 2 )}× as much as it did in the first days. The pot has found its rhythm — new baselines adopted, and the watering figure shifts from the archetype-and-volume estimate toward what this container has actually done.`,
	}

}

/**
 * A line for the terminal.
 *
 * @param   {object} episode - The episode.
 * @param   {object} status  - From `assess`.
 * @returns {string}         One line.
 */
export function describe( episode, status ) {

	if ( !episode || episode.phase === PHASE.NONE ) return 'No transplant.'

	if ( episode.phase === PHASE.SETTLED ) {

		return `Transplant settled · ${episode.volumeL}L · new baselines adopted`

	}

	return `Transplant settling · day ${status?.day ?? 0} · ${episode.fromL ? `${episode.fromL}L → ` : ''}${episode.volumeL}L · learning this pot`

}
