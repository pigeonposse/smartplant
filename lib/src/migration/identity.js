/**
 * The same plant, in a new body.
 *
 * Inheritance moves what one plant learned to a *different* plant, and almost
 * everything about it is designed around that being a different plant: the
 * priors fade on a schedule, the compatibility check holds back what does not
 * travel, and the new plant's own experience always wins.
 *
 * This is the other case, and it needs the opposite treatment. The electrode
 * failed, or the Raspberry Pi was replaced, or the process was restarted from a
 * backup, or the pot was changed. Nothing about the plant changed. Fading its
 * own history would be discarding a year of its life because somebody swapped a
 * cable.
 *
 * So: nothing fades, nothing is held back for incompatibility, and the receiver
 * does not get a vote. It is the same plant.
 *
 * ## Except for the parts that were never about the plant
 *
 * That is the whole difficulty, and getting it wrong in the generous direction
 * is worse than being too strict.
 *
 * An electrome fingerprint is not a property of the plant. It is a property of
 * *this plant through this electrode at this contact point*, and a new electrode
 * — even the same model, seated a centimetre away — produces a different one.
 * Carrying the old fingerprint into a new contact means every drift measurement
 * afterwards is computed against a baseline that describes hardware that no
 * longer exists, and the system would spend weeks reporting a plant changing
 * when what changed was the wire.
 *
 * The same goes for anything keyed to the pot: soil ranges belong to the
 * substrate as much as to the roots, and a repot resets them whatever the plant
 * thinks.
 *
 * So a bundle carries three tiers, and the middle one is the honest part:
 *
 *   **Survives** — resolutions, response hysteresis, the prediction record, the
 *   trajectory, the state calibration. All of these are about the plant and the
 *   model of it, and none refers to a specific piece of hardware.
 *
 *   **Must be re-established** — the electrome baseline and fingerprint, and any
 *   drift anchor. Carried across as *history* so the old shape is not lost, and
 *   explicitly not installed as the working baseline.
 *
 *   **Depends what changed** — ranges. They survive a new electrode and do not
 *   survive a repot, and only the person doing the swap knows which happened.
 */

/** What a piece of the record is tied to. */
export const TIED_TO = {
	PLANT     : 'plant',
	ELECTRODE : 'electrode',
	POT       : 'pot',
}

/**
 * Every part of a symbiont's record, and what it belongs to.
 *
 * The table is the thinking. Everything else here is bookkeeping.
 */
export const PARTS = {
	resolutions : {
		tiedTo : TIED_TO.PLANT,
		why : 'What actually resolved each problem for this plant, against the base rate of doing nothing. Nothing about it refers to a wire.',
	},
	hysteresis : {
		tiedTo : TIED_TO.PLANT,
		why : 'How this plant\'s response to a stimulus has changed over its life. A property of the plant, measured through whatever was attached at the time.',
	},
	predictions : {
		tiedTo : TIED_TO.PLANT,
		why : 'How wrong the model has been about this plant. The model is the same model and the plant is the same plant.',
	},
	trajectory : {
		tiedTo : TIED_TO.PLANT,
		why : 'How the coupling has developed. Losing it at a hardware change would lose exactly the record that shows a hardware change happening.',
	},
	calibration : {
		tiedTo : TIED_TO.PLANT,
		why : 'Which of the system\'s own refusals turned out to be unnecessary. Expensive to accumulate — twelve overrides is months — and about the model rather than the sensor.',
	},
	care : {
		tiedTo : TIED_TO.PLANT,
		why : 'What was done to it and when.',
	},
	fingerprint : {
		tiedTo : TIED_TO.ELECTRODE,
		why : 'A property of this plant *through this electrode at this contact point*. A new electrode a centimetre away produces a different one, and installing the old shape as the working baseline would report a plant changing when what changed was the wire.',
	},
	electromeBaseline : {
		tiedTo : TIED_TO.ELECTRODE,
		why : 'The resting state the drift measurement is computed against. Same reason: it describes hardware that no longer exists.',
	},
	driftAnchor : {
		tiedTo : TIED_TO.ELECTRODE,
		why : 'The fixed point continuity is measured from. Anchored to a contact, not to a plant.',
	},
	ranges : {
		tiedTo : TIED_TO.POT,
		why : 'Comfortable bands, learned from where this plant lives. Soil belongs to the substrate as much as to the roots, so these survive a new electrode and do not survive a repot.',
	},
}

const safely = fn => {

	try {

		return fn()

	}
	catch {

		return null

	}

}

/**
 * Take everything this symbiont is, for its next body.
 *
 * @param   {object} plant - A `SmartPlant`.
 * @returns {object}       The bundle.
 */
export function exportIdentity( plant ) {

	const manifest = {
		name : plant?.memory?.plant?.name ?? null,
		species : plant?.memory?.plant?.species ?? null,
		archetype : plant?.archetype?.id ?? null,
		readings : plant?.memory?.data?.readings?.length ?? 0,
		since : plant?.memory?.data?.readings?.[ 0 ]?.t ?? null,
		at : new Date().toISOString(),
	}

	return {
		kind : 'symbiont-identity',
		manifest,

		// Tied to the plant. Restored whole, and never faded — this is not a
		// different plant and treating it as one would discard a year of its life
		// because somebody swapped a cable.
		plant : {
			resolutions : safely( () => plant.resolutions?.toJSON?.() ?? plant.resolutions?.report?.() ),
			predictions : safely( () => plant.body?.personalization?.predictions?.toJSON?.() ),
			trajectory : safely( () => plant._trajectory?.toJSON?.() ),
			calibration : safely( () => ( {
				trials : [ ...( plant.calibration?.trials?.entries?.() ?? [] ) ],
			} ) ),
			hysteresis : safely( () => plant._lastHysteresis ),
			care : safely( () => plant.memory?.data?.events ?? [] ),
		},

		// Tied to the electrode. Carried as history so the old shape is not lost,
		// and deliberately not installed.
		electrode : {
			fingerprint : safely( () => plant.perception?.electro?.fingerprint ),
			baseline : safely( () => plant.electrome?.toJSON?.() ),
			note : 'Kept as a record of what this plant looked like through the old contact. Not installed: a new electrode produces a different signature, and computing drift against this one would report a plant changing when what changed was the wire.',
		},

		// Tied to the pot. Only the person doing the swap knows whether it moved.
		pot : {
			ranges : safely( () => plant.ranges ),
		},
	}

}

/**
 * Put a symbiont back into a body.
 *
 * @param   {object} plant  - The new `SmartPlant`.
 * @param   {object} bundle - From `exportIdentity`.
 * @param   {object} [opts] - `{ sameElectrode, samePot }`.
 * @returns {object}        `{restored, held, why}`.
 */
export function importIdentity( plant, bundle, opts = {} ) {

	if ( bundle?.kind !== 'symbiont-identity' ) {

		return {
			restored : [],
			held : [],
			why : 'That is not a symbiont identity bundle. An inheritance bundle is a different thing and goes through `inherit()` — it comes from another plant, it fades, and it is held back where the environments disagree. None of that applies to a plant returning to itself.',
		}

	}

	const species = plant?.memory?.plant?.species
	const was = bundle.manifest?.species

	if ( species && was && species !== was ) {

		return {
			restored : [],
			held : [],
			why : `This bundle is a ${was} and this plant is a ${species}. Restoring an identity onto a different organism is not a hardware change, it is a mistake — and the way to move what one plant learned to another is \`inherit()\`, which fades it and checks whether it travels.`,
		}

	}

	const restored = []
	const held = []

	for ( const [ key, value ] of Object.entries( bundle.plant ?? {} ) ) {

		if ( value === null || value === undefined ) continue

		plant._restored ??= {}
		plant._restored[ key ] = value
		restored.push( key )

	}

	// The electrode tier. Held unless the caller says the contact is the same
	// one, which only they can know.
	if ( opts.sameElectrode ) {

		plant._restored ??= {}
		plant._restored.electrode = bundle.electrode
		restored.push( 'fingerprint', 'electromeBaseline' )

	}
	else {

		held.push( {
			part : 'fingerprint',
			why : PARTS.fingerprint.why,
		} )
		held.push( {
			part : 'electromeBaseline',
			why : PARTS.electromeBaseline.why,
		} )

	}

	if ( opts.samePot && bundle.pot?.ranges ) {

		plant.ranges = {
			...plant.ranges,
			...bundle.pot.ranges,
		}
		restored.push( 'ranges' )

	}
	else if ( bundle.pot?.ranges ) {

		held.push( {
			part : 'ranges',
			why : PARTS.ranges.why,
		} )

	}

	return {
		restored,
		held,
		why : `${restored.length} part${restored.length === 1 ? '' : 's'} restored whole — nothing faded, because this is the same plant and fading its own history would discard a year of its life over a swapped cable. ${held.length ? `${held.map( h => h.part ).join( ', ' )} held back: ${held[ 0 ].why}` : 'Nothing held back.'}`,
	}

}

/**
 * What a bundle would restore, before restoring it.
 *
 * @param   {object} bundle - From `exportIdentity`.
 * @param   {object} [opts] - `{ sameElectrode, samePot }`.
 * @returns {object}        A description.
 */
export function describeIdentity( bundle, opts = {} ) {

	if ( bundle?.kind !== 'symbiont-identity' ) return { why : 'Not a symbiont identity bundle.' }

	const present = Object.entries( bundle.plant ?? {} ).filter( ( [ , v ] ) => v ).map( ( [ k ] ) => k )

	return {
		of : bundle.manifest?.name,
		species : bundle.manifest?.species,
		readings : bundle.manifest?.readings,
		survives : present,
		reEstablish : opts.sameElectrode ? [] : [ 'fingerprint', 'electromeBaseline' ],
		depends : opts.samePot ? [] : [ 'ranges' ],
		why : `${present.length} parts of ${bundle.manifest?.name ?? 'this plant'} travel whole. ${opts.sameElectrode ? 'The electrode is the same one, so its baseline comes too.' : 'A new electrode means the electrical baseline has to be re-established from scratch — a few days of quiet, and it is worth knowing that up front rather than discovering that drift readings look wrong for a fortnight.'}`,
	}

}
