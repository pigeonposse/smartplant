/**
 * Internal states: what the plant is doing, rather than what is around it.
 *
 * Every other layer in this library reads the environment and reasons about it.
 * These read the *plant* — not a measurement of a hormone, which no sensor here
 * can make, but a qualitative estimate of a physiological state, built only from
 * signals that were actually measured and carrying its own evidence with it.
 *
 * ## The rule that decides what gets to exist
 *
 * A state is only worth creating if it changes a decision. Not if it is
 * interesting, not if it sounds sophisticated — if the system would behave
 * identically with and without it, it is decoration, and decoration in a system
 * that people trust with a living thing is worse than nothing because it buys
 * credibility it did not earn.
 *
 * So every state here declares a `decides` field naming what changes, and there
 * is a test that fails if any state ships without one.
 *
 * ## Four rules, applied to all of them
 *
 *   1. **Measured origin only.** A state activates on detected events, sensor
 *      readings, vision findings or logged care. Never on a model that supposes
 *      what the plant is probably doing.
 *
 *   2. **Evidence is auditable.** Each state carries the list of signals that
 *      raised it, specific enough to check: which event, at what time, how far
 *      from this plant's own baseline.
 *
 *   3. **Confidence is explicit and it bites.** Low confidence does not merely
 *      annotate the state — it removes its authority. `acts` is false whenever
 *      confidence is low, and every gate in this library checks `acts` rather
 *      than `level`. A weak signal can inform a person; it cannot change what
 *      the system does.
 *
 *   4. **Never chemistry.** "Evidence of defence activation" is a claim about
 *      behaviour the instruments support. "MeJA is high" is a claim about
 *      chemistry that would be false. The second phrasing appears nowhere.
 *
 * And where evidence is insufficient the answer is `unknown`, not a weak guess.
 * Missing an instrument is a fact worth reporting; filling the gap with an
 * estimate hides it.
 *
 * ## What is deliberately absent
 *
 * Abscisic acid, ethylene, salicylic acid, cytokinins. All real, all central to
 * plant physiology, none of them anchored to anything this library measures.
 * Estimating them would mean inventing the link, and an invented link is exactly
 * the failure these rules exist to prevent. If an electrical or visual anchor
 * for one of them ever becomes measurable here, it can be added under the same
 * rules as everything else.
 */

/** How strongly a state appears to be running. */
export const LEVEL = {
	UNKNOWN : 'unknown',
	LOW     : 'low',
	MEDIUM  : 'medium',
	HIGH    : 'high',
}

/** How much the estimate should be trusted. Moves independently of the level. */
export const CONFIDENCE = {
	LOW    : 'low',
	MEDIUM : 'medium',
	HIGH   : 'high',
}

/**
 * Build a state in the shape every consumer expects.
 *
 * The `acts` field is computed here rather than passed in, so no individual
 * state can decide to be authoritative on weak evidence.
 *
 * @param   {object} s - `{name, level, confidence, evidence, decides, why}`.
 * @returns {object}   The state.
 */
export function state( s ) {

	// The one function here that throws rather than refusing. It is a builder,
	// and a state with no name and no level is not a degraded state — it is a
	// programming mistake that would otherwise travel silently into a decision.
	// Better a clear message here than a nameless object gating a watering.
	if ( !s || typeof s !== 'object' || !s.name || !s.level ) {

		throw new TypeError( 'state() needs at least { name, level, confidence, decides, why }. It builds an internal state, and one with no name or level cannot be reported, gated on, or explained.' )

	}

	const confident = s.confidence !== CONFIDENCE.LOW
	const known = s.level !== LEVEL.UNKNOWN

	return {
		name : s.name,
		level : s.level,
		confidence : s.confidence,
		evidence : s.evidence ?? [],
		decides : s.decides,
		// The single gate. Everything downstream asks this, never `level`.
		acts : confident && known && s.level !== LEVEL.LOW,
		why : s.why,
		...s.extra,
	}

}

/**
 * The honest answer when the instruments cannot support one.
 *
 * @param   {string}   name    - State name.
 * @param   {string[]} missing - What would be needed.
 * @param   {string}   why     - What that means here.
 * @returns {object}           The state.
 */
export function unknown( name, missing, why ) {

	return state( {
		name,
		level : LEVEL.UNKNOWN,
		confidence : CONFIDENCE.LOW,
		evidence : [],
		missing,
		decides : 'nothing',
		why,
		extra : { missing },
	} )

}

const finite = Number.isFinite

/**
 * Is this plant water-stressed in a way the soil probe does not show?
 *
 * The soil probe answers a question about the pot. Whether the plant is getting
 * water is a different question, and the two come apart in exactly the cases
 * that matter most: roots that have rotted cannot drink from wet soil, a
 * root-bound plant runs dry hours after the probe says it is fine, and a plant
 * in high VPD loses water faster than roots can supply it however wet the pot is.
 *
 * Every one of those looks like thirst and none of them is fixed by watering.
 * The most damaging one — wet soil, stressed plant — is made *worse* by it.
 *
 * So this fires only on a genuine discrepancy: the soil and the plant disagree.
 * Agreement is not a state, it is just a reading.
 *
 * @param   {object}  input             - What is known.
 * @param   {number}  [input.soil]      - Soil moisture, 0-100.
 * @param   {object}  [input.stomata]   - From `stomatalOpening`.
 * @param   {object}  [input.shift]     - Electrome against this plant's baseline.
 * @param   {object}  [input.hysteresis] - Watering response history.
 * @param   {number}  [input.vpd]       - Leaf VPD in kPa, if known.
 * @param   {object}  [input.ranges]    - This plant's own soil range.
 * @param   {object}  [input.presence]  - Who has been in the room, from a radio.
 * @returns {object}                    A state.
 */
export function waterStressInternal( input = {} ) {

	// A default only covers an omitted argument. An explicit null — which is what
	// arrives from JSON, from an optional field, from a `?.` that found nothing —
	// walks straight past it, and this library refuses with a reason rather than
	// throwing at whoever passed it.
	input = input ?? {}

	const name = 'water_stress_internal'

	// The plant-side signals. Without at least one, there is nothing to disagree
	// with the soil — and "the soil is not the whole story" is the entire point,
	// so a soil reading alone cannot produce this state.
	const plantSide = []

	if ( input.stomata?.known && input.stomata.closing === true ) {

		plantSide.push( {
			signal : 'stomatal-closure',
			detail : input.stomata.why ?? 'Stomata are closing.',
		} )

	}

	if ( input.shift?.shifted === true && input.shift?.baselineReady !== false ) {

		plantSide.push( {
			signal : 'electrome-shift',
			detail : input.shift.why ?? 'Electrome is away from this plant\'s own resting state.',
		} )

	}

	if ( input.hysteresis?.known === true && input.hysteresis.changed === true ) {

		plantSide.push( {
			signal : 'watering-response-changed',
			detail : input.hysteresis.verdict ?? 'The response to watering is not what it used to be.',
		} )

	}

	if ( !finite( input.soil ) ) {

		return unknown( name, [ 'soil' ],
			'This state is a disagreement between the pot and the plant, and without a soil reading there is only one side of it. A plant-side stress signal on its own is just stress; what makes this worth having is knowing the soil says otherwise.' )

	}

	// ── soil that rose with nobody home ─────────────────────────────────────
	// Checked before anything is asked of the plant, because this is a fact
	// about the pot and the room rather than about the plant: it holds whether
	// or not there is a leaf probe to corroborate it.
	//
	// Somebody watered it is the ordinary explanation for a jump in moisture,
	// and it is the only one that requires somebody to have been there. A pot
	// that got wetter in an empty house did not get watered — it is a leak, rain
	// through an open window, or a probe losing contact and drifting up. All
	// three want looking at, and none of them wants the watering schedule
	// adjusted as though the plant had just been given a drink.
	if ( input.presence?.settled === true && input.soilRose === true && input.presence.seenSince === false ) {

		return state( {
			name,
			level : LEVEL.MEDIUM,
			confidence : CONFIDENCE.MEDIUM,
			evidence : [ {
				signal : 'soil-rose-unattended',
				detail : `Soil moisture rose while the radio reported nobody in the room.`,
			}, ...plantSide ],
			decides : 'watering',
			why : 'The pot got wetter and nobody was here to water it. That leaves a leak, rain through an open window, or a probe drifting up as it loses contact — and all three want looking at rather than being folded into the watering record as a drink the plant was given.',
			extra : {
				pattern : 'unattended-rise',
				withhold : 'water',
			},
		} )

	}

	if ( !plantSide.length ) {

		return unknown( name, [ 'leafTemperature or porometer', 'electrode' ],
			'Nothing is being read from the plant itself — only from the pot it is standing in. The soil probe cannot tell a plant that is drinking from one that cannot, and that distinction is the only reason this state exists. A leaf temperature probe or an electrode would supply the missing side.' )

	}

	const range = input.ranges?.soil
	const wet = finite( range?.max ) ? input.soil > range.max * 0.8 : input.soil > 55
	const dry = finite( range?.min ) ? input.soil < range.min : input.soil < 25

	// ── the dangerous case ──────────────────────────────────────────────────
	if ( wet ) {

		const level = plantSide.length >= 2 ? LEVEL.HIGH : LEVEL.MEDIUM

		return state( {
			name,
			level,
			confidence : plantSide.length >= 2 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
			evidence : [ {
				signal : 'soil',
				detail : `Soil is at ${input.soil}, which is not short of water.`,
			}, ...plantSide ],
			decides : 'watering',
			why : `The pot is wet and the plant is behaving as though it is not getting water. That combination is not thirst, and watering is the one response that would make every cause of it worse — roots that cannot drink from wet soil drown faster, and a plant losing water to the air faster than roots can supply it needs the air changed, not the pot. ${level === LEVEL.HIGH ? 'Two independent plant-side signals agree.' : 'One plant-side signal, so this is a reason to look rather than to act.'}`,
			extra : {
				pattern : 'wet-soil-stressed-plant',
				withhold : 'water',
			},
		} )

	}

	// ── the ordinary case, and it is not a state ────────────────────────────
	if ( dry ) {

		return state( {
			name,
			level : LEVEL.LOW,
			confidence : CONFIDENCE.MEDIUM,
			evidence : [ {
				signal : 'soil',
				detail : `Soil is at ${input.soil}, which is genuinely low.`,
			}, ...plantSide ],
			decides : 'watering',
			why : 'The plant is showing water stress and the soil is dry. The two agree, so there is nothing hidden here — this is ordinary thirst and ordinary watering answers it. This state exists to catch disagreement, and there is none.',
			extra : { pattern : 'agreed-thirst' },
		} )

	}

	return state( {
		name,
		level : LEVEL.MEDIUM,
		confidence : CONFIDENCE.LOW,
		evidence : [ {
			signal : 'soil',
			detail : `Soil is at ${input.soil}, mid-range.`,
		}, ...plantSide ],
		decides : 'watering',
		why : 'Plant-side stress with the soil neither wet nor dry. Not enough to withhold water and not enough to give it — worth a look at whether something other than supply is the problem.',
		extra : { pattern : 'unclear' },
	} )

}

/**
 * How much this plant has been through lately.
 *
 * A single episode is an event. Several in a row, with the plant not fully
 * returning to its own baseline between them, is a different situation: the
 * capacity to absorb the next one is lower, and an intervention that would be
 * routine for a rested plant is not routine for this one.
 *
 * The load is built from three measured things — how often physiological
 * electrical events are firing, whether the baseline has moved, and whether
 * recovery after past interventions has been getting slower.
 *
 * The important refusal is in the middle one. Baseline drift is the single most
 * common artefact in plant electrophysiology: an electrode dries out, corrodes,
 * or loses contact, and produces a slow steady wander that looks exactly like a
 * plant declining. So drift only counts here when the continuity tracker
 * attributed it to physiology across multiple sites. Drift blamed on the
 * electrode, or unattributable, contributes nothing — it is a hardware problem
 * wearing a physiology costume.
 *
 * @param   {object} input               - What is known.
 * @param   {object} [input.events]      - `summarizeEvents` output for a recent window.
 * @param   {object} [input.drift]       - `ContinuityTracker.attribute()` output.
 * @param   {number} [input.episodes]    - Distinct stress episodes in the recent past.
 * @param   {object} [input.recovery]    - `{slowing, why}` from intervention history.
 * @param   {number} [input.disturbances] - Times somebody was moving near it recently.
 * @returns {object}                     A state.
 */
export function stressLoad( input = {} ) {

	input = input ?? {}

	const name = 'stress_load'
	const evidence = []

	const rate = input.events?.ratePerHour

	if ( !finite( rate ) && !input.drift && !finite( input.episodes ) ) {

		return unknown( name, [ 'electrode', 'care-log' ],
			'Accumulated load is a statement about a history, and there is no history here — no electrical event record, no drift tracking, no episodes logged. This cannot be estimated from a current reading, and it should not be guessed from one.' )

	}

	// ── how busy the plant has been electrically ────────────────────────────
	let busy = 0

	if ( finite( rate ) ) {

		// A resting plant fires occasionally. Several an hour, sustained, is a
		// plant repeatedly responding to something.
		busy = rate > 6 ? 2 : rate > 2 ? 1 : 0

		if ( busy ) evidence.push( {
			signal : 'event-rate',
			detail : `${rate} physiological electrical events per hour${input.events?.damageSignal ? ', including variation potentials' : ''}.`,
		} )

	}

	// ── the baseline, but only when it is the plant that moved ──────────────
	let drifted = 0

	if ( input.drift?.cause === 'physiology' ) {

		drifted = 1
		evidence.push( {
			signal : 'baseline-drift',
			detail : input.drift.why ?? 'The resting baseline has moved, and multiple sites agree it is the plant rather than an electrode.',
		} )

	}
	else if ( input.drift && input.drift.cause !== 'physiology' ) {

		evidence.push( {
			signal : 'drift-discounted',
			detail : `Baseline drift was found and attributed to ${input.drift.cause}, so it is not counted as accumulated stress. An ageing electrode produces exactly this pattern and it is not a fact about the plant.`,
		} )

	}

	// ── the history ─────────────────────────────────────────────────────────
	let repeated = 0

	if ( finite( input.episodes ) && input.episodes >= 2 ) {

		repeated = input.episodes >= 4 ? 2 : 1
		evidence.push( {
			signal : 'repeated-episodes',
			detail : `${input.episodes} distinct stress episodes recorded recently.`,
		} )

	}

	// Being handled is a real load. Every touch is a mechanical stimulus with an
	// electrical cost, and a plant on a busy worktop is asked to respond dozens
	// of times a day for no reason of its own. Counted lightly: it is a nuisance
	// rather than an injury, and it is only knowable where there is a radio.
	if ( Number.isFinite( input.disturbances ) && input.disturbances >= 20 ) {

		repeated += 1
		evidence.push( {
			signal : 'handled-often',
			detail : `Somebody was moving next to this plant ${input.disturbances} times recently. Each touch is a mechanical stimulus the plant answers electrically, and a plant on a busy worktop spends on that all day for no reason of its own.`,
		} )

	}

	if ( input.recovery?.slowing === true ) {

		repeated += 1
		evidence.push( {
			signal : 'slower-recovery',
			detail : input.recovery.why ?? 'Return to baseline after interventions has been taking longer than it used to.',
		} )

	}

	const total = busy + drifted + repeated
	const level = total >= 4 ? LEVEL.HIGH : total >= 2 ? LEVEL.MEDIUM : LEVEL.LOW

	// Independent lines, not independent signals. Event rate and drift both come
	// off the same electrode; the episode log is a separate record entirely.
	const lines = new Set()
	if ( busy || drifted ) lines.add( 'electrode' )
	if ( repeated ) lines.add( 'history' )

	return state( {
		name,
		level,
		confidence : level === LEVEL.LOW
			? CONFIDENCE.MEDIUM
			: lines.size >= 2 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
		evidence,
		decides : 'elective actions and intervention size',
		why : level === LEVEL.HIGH
			? 'This plant has been working hard for a while and has not been getting all the way back between episodes. Nothing here is an emergency on its own; together they say the next thing done to it lands on a plant with less room to absorb it. Elective actions wait and interventions get smaller.'
			: level === LEVEL.MEDIUM
				? 'Some accumulated load. Enough to prefer the gentler version of whatever is planned, not enough to stop.'
				: 'Nothing much has happened to this plant lately. Full capacity to absorb whatever comes next.',
		extra : {
			// The dose modifier is the concrete consequence, and it is only
			// applied when the state has the confidence to act.
			scale : level === LEVEL.HIGH ? 0.6 : level === LEVEL.MEDIUM ? 0.8 : 1,
		},
	} )

}

/**
 * Has this plant learned something from what happened to it?
 *
 * The one state here that is a claim about the past rather than the present. If
 * the same stimulus produces a measurably different response after an episode
 * than before it — under comparable starting conditions — then the plant is not
 * the same responder it was, and predicting its behaviour from the old profile
 * will be wrong.
 *
 * The whole assessment is delegated to `hysteresis()`, which already refuses on
 * mismatched conditions and already carries the caveat that matters most: the
 * plant was younger and smaller at the first measurement, growth changes the
 * response too, and nothing in a reading record separates growth from memory.
 * That caveat is carried forward rather than dropped, because a state that
 * quietly loses its own limitation is worse than no state.
 *
 * @param   {object} input             - What is known.
 * @param   {object} [input.hysteresis] - From `hysteresis()`.
 * @param   {string} [input.stimulus]   - What the history is about.
 * @returns {object}                   A state.
 */
export function stressMemory( input = {} ) {

	input = input ?? {}

	const name = 'stress_memory'
	const h = input.hysteresis
	const stimulus = input.stimulus ?? 'the stimulus'

	if ( !h || h.known !== true ) {

		return unknown( name, [ 'repeated responses either side of an episode' ],
			`Not enough comparable occurrences to compare. ${h?.reason ?? 'No response history has been built.'} This is the state most likely to stay unknown for a long time, because it needs the same thing to have happened several times before an episode and several times after it, under conditions close enough to compare.` )

	}

	if ( !h.changed ) {

		return state( {
			name,
			level : LEVEL.LOW,
			confidence : CONFIDENCE.MEDIUM,
			evidence : [ {
				signal : 'hysteresis',
				detail : h.verdict,
			} ],
			decides : 'expected response to interventions',
			why : `This plant answers ${stimulus} the same way it did before the episode. The comparison was made and it came back negative, which is a real finding rather than an absence of one — the old response profile can still be trusted.`,
		} )

	}

	return state( {
		name,
		level : LEVEL.MEDIUM,
		confidence : CONFIDENCE.MEDIUM,
		evidence : [ {
			signal : 'hysteresis',
			detail : h.verdict,
		}, {
			signal : 'caveat',
			detail : h.caveat,
		} ],
		decides : 'expected response to interventions',
		why : `This plant no longer answers ${stimulus} the way it used to. Predictions built on the older responses will be wrong in a known direction, so the newer profile is the one to use. Held at medium and never higher: ${h.caveat}`,
		extra : {
			direction : h.direction,
			useProfile : 'after',
			caveat : h.caveat,
		},
	} )

}

/**
 * Is this plant's internal clock still keeping time?
 *
 * A plant runs a circadian oscillator, it is visible in the electrome, and it
 * degrades under sustained stress and under inconsistent light. That makes it
 * useful twice over: as a slow health indicator, and — more practically — as a
 * check on whether the timing advice this library gives is worth anything.
 *
 * The second use is an inversion worth being explicit about. Everywhere else a
 * degraded signal means the plant needs attention. Here it *also* means the
 * system should stop deferring to its own clock: advice like "wait four hours,
 * the plant is in its rest phase" is built on a rhythm estimate, and when the
 * rhythm is weak or off-period that advice is noise being treated as insight.
 * A state that can tell the system to trust itself less is worth more than one
 * that only ever raises alarms.
 *
 * @param   {object} input             - What is known.
 * @param   {object} [input.health]    - From `circadianHealth()` on the electrome.
 * @param   {object} [input.lightCycle] - `{consistent, why}` about the light schedule.
 * @returns {object}                   A state.
 */
export function circadianIntegrity( input = {} ) {

	input = input ?? {}

	const name = 'circadian_integrity'
	const h = input.health

	if ( !h || h.healthy === null || h.detected === false ) {

		return unknown( name, [ 'electrode', 'several days of continuous recording' ],
			`No rhythm could be estimated. ${h?.verdict ?? 'This needs an electrode and several days of unbroken recording — a rhythm cannot be found in a few hours of data.'} Timing advice should not be given at all while this is unknown, because there is no clock behind it.` )

	}

	const evidence = [ {
		signal : 'electrome-rhythm',
		detail : `Period ${h.periodHours}h, strength ${h.strength}. ${h.verdict}`,
	} ]

	if ( input.lightCycle?.consistent === false ) evidence.push( {
		signal : 'light-cycle',
		detail : input.lightCycle.why ?? 'The light schedule itself has been inconsistent.',
	} )

	if ( h.healthy ) {

		return state( {
			name,
			level : LEVEL.LOW,
			confidence : CONFIDENCE.MEDIUM,
			evidence,
			decides : 'whether timing advice is trusted',
			why : `The clock is keeping time: a ${h.periodHours}h period at strength ${h.strength}. Timing advice built on it can be acted on, and a plant with an intact rhythm is one whose slow-stress indicators are all in order.`,
			extra : { trustTiming : true },
		} )

	}

	// A rhythm that is off-period but strong usually means the room is at fault,
	// not the plant. Worth separating: one is fixed by a timer, the other is not.
	const external = input.lightCycle?.consistent === false || ( h.strength >= 0.4 && h.offByHours > 3 )

	return state( {
		name,
		level : h.strength < 0.25 ? LEVEL.HIGH : LEVEL.MEDIUM,
		confidence : CONFIDENCE.MEDIUM,
		evidence,
		decides : 'whether timing advice is trusted',
		why : external
			? `The rhythm is strong but running at ${h.periodHours}h rather than 24h, which points at the light schedule rather than at the plant. A timer fixes this; nothing done to the plant will. Timing advice is not trustworthy until it is fixed, because the clock it is built on is tracking something other than a day.`
			: `The rhythm has weakened to ${h.strength}. This degrades under sustained stress and it usually degrades before anything is visible, so it is worth treating as an early indicator. It also means this library should stop deferring to its own timing advice: that advice is derived from this rhythm, and a weak rhythm makes it noise presented as insight.`,
		extra : {
			trustTiming : false,
			external,
		},
	} )

}

/**
 * Every internal state at once.
 *
 * @param   {object} input - Signals, as accepted by each state above.
 * @returns {object}       Keyed by state name.
 */
export function internalStates( input = {} ) {

	input = input ?? {}

	return {
		water_stress_internal : waterStressInternal( input.water ?? {} ),
		stress_load : stressLoad( input.load ?? {} ),
		stress_memory : stressMemory( input.memory ?? {} ),
		circadian_integrity : circadianIntegrity( input.circadian ?? {} ),
	}

}

/**
 * Lines for the reasoner and the AI, from any state.
 *
 * States that are not acting still get reported when they are unknown, because
 * a missing instrument is a fact worth surfacing. States that are low and known
 * say nothing: that is the plant being fine.
 *
 * @param   {object} s - A state.
 * @returns {string[]} Cues.
 */
export function stateCues( s ) {

	// Cues are advisory and they are the last thing that should be able to bring
	// a caller down, so anything that is not a state produces no lines rather
	// than an exception.
	//
	// The level check is the part that matters. Without it an empty object gets
	// as far as "undefined = undefined (confidence undefined)", which is worse
	// than throwing: it is a line of nonsense entering the evidence ledger, where
	// it will be read back later as though the plant said it.
	if ( !s || typeof s !== 'object' || !s.level || !s.name ) return []

	if ( s.level === LEVEL.UNKNOWN ) {

		return [ `${s.name}: not assessable. ${s.why}` ]

	}

	if ( s.level === LEVEL.LOW ) return []

	const cues = [ `${s.name} = ${s.level} (confidence ${s.confidence}). ${s.why}` ]

	if ( Array.isArray( s.evidence ) && s.evidence.length ) {

		cues.push( `Because: ${s.evidence.map( e => e?.detail ?? e ).join( ' ' )}` )

	}

	if ( !s.acts ) {

		cues.push( `Confidence is too low for this to change what the system does — it decides ${s.decides ?? 'something'}, and it is not being allowed to. Worth a person looking.` )

	}

	return cues

}
