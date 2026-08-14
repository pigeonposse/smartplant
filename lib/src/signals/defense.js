/**
 * Whether this plant is mounting a defence.
 *
 * Wound a plant and a well-described cascade follows: a variation potential
 * travels out from the damage, jasmonic acid accumulates, methyl jasmonate goes
 * volatile, defence genes switch on, and neighbours taking that volatile up
 * through their stomata raise their own guard before anything has touched them.
 * It is one of the better-understood things a plant does, and it is a dimension
 * of physiology every other layer in this library ignores completely.
 *
 * ## This does not measure methyl jasmonate
 *
 * It cannot. Measuring MeJA needs gas chromatography and mass spectrometry, and
 * this library has an electrode, a camera and some environmental sensors. Any
 * number presented as a hormone concentration here would be invented.
 *
 * What *is* available is the electrical half of the same cascade. The variation
 * potential that precedes jasmonate accumulation is exactly the kind of slow
 * graded event an electrode sees well, and a plant's electrome shifting away
 * from its own established baseline is a real, personal, measurable thing. So
 * this estimates **activation of the defence pathway**, on the evidence that
 * the pathway usually runs, and says nothing about how much of any molecule is
 * present.
 *
 * The distinction is not pedantry. "MeJA is high" is a claim about chemistry
 * that would be false. "This plant is behaving as if it has been wounded, and
 * the weather does not explain it" is a claim about behaviour that the
 * instruments can actually support, and it is enough to act on.
 *
 * ## Absent is not low
 *
 * The most dangerous failure here would be reporting `LOW` for a plant with no
 * electrode. A variation potential is the primary evidence; without the
 * instrument that sees it, the plant could be in full defence and look
 * identical to one that is fine. So a missing electrode returns `UNKNOWN`, and
 * `LOW` is only ever returned when the thing that would have shown activation
 * was watching and saw none.
 *
 * ## The negative control is what makes it worth anything
 *
 * Cold shock produces variation potentials. So does a light change, a knock, a
 * cold draught from an opened window. Every one of them looks like the opening
 * move of a wound response, and a system that counted them would spend its life
 * announcing attacks on a plant nobody has touched.
 *
 * So the environment gets checked *against* the evidence, and when it explains
 * the electrical event the level comes down. This is the only part of the
 * assessment that can lower a conclusion rather than raise it, and it does most
 * of the work.
 *
 * ## What it is for
 *
 * Not an alarm. The point is that the rest of the system stops treating the
 * plant as a set of environmental readings and starts knowing when it is busy.
 * A plant mounting a defence should not also be getting spectral probes, elective
 * light experiments or a move across the room. `posture()` says what to hold off
 * on, and it is deliberately about *not* doing things.
 */

/** How strongly the defence pathway appears to be running. */
export const DEFENSE = {
	UNKNOWN : 'unknown',
	LOW     : 'low',
	MEDIUM  : 'medium',
	HIGH    : 'high',
}

/** How much the assessment should be trusted, which moves independently. */
export const CONFIDENCE = {
	LOW    : 'low',
	MEDIUM : 'medium',
	HIGH   : 'high',
}

/**
 * The lines of evidence, and what each is actually worth.
 *
 * `primary` evidence can raise the level on its own. `supporting` evidence can
 * only confirm something the primary evidence already suggested — it is either
 * too ambiguous or too slow to lead.
 */
export const EVIDENCE = {
	VARIATION_POTENTIAL : {
		id : 'variation-potential',
		rank : 'primary',
		needs : 'electrode',
		why : 'The slow graded depolarisation that spreads from damaged tissue. It is the electrical event that precedes jasmonate accumulation, and it is the closest thing to a direct observation of this pathway that any sensor here can make.',
	},
	ELECTROME_SHIFT : {
		id : 'electrome-shift',
		rank : 'primary',
		needs : 'electrode-baseline',
		why : 'The plant\'s electrical signature moving away from its own established resting state. Not specific to defence, but it says the plant is doing something different, and it is measured against this individual rather than against a species average.',
	},
	VISIBLE_DAMAGE : {
		id : 'visible-damage',
		rank : 'primary',
		needs : 'camera',
		why : 'Chewing, necrosis, holes. The cause rather than the response, and the one line of evidence that is not electrical at all — which is exactly why it is worth so much when it agrees with the electrode.',
	},
	WOUND_EVENT : {
		id : 'wound-event',
		rank : 'primary',
		needs : 'care-log',
		why : 'Someone recorded a cut, a repot, a broken stem. Pruning is wounding, and a plant that has just been pruned is mounting a defence for entirely mundane reasons.',
	},
	STOMATAL_CLOSURE : {
		id : 'unexplained-stomatal-closure',
		rank : 'supporting',
		needs : 'leafTemperature or porometer',
		why : 'Jasmonate and abscisic acid signalling overlap, and closure that VPD and soil moisture do not account for is weakly consistent with defence. Weakly: a dozen other things close stomata, and this should never lead.',
	},
	SUSTAINED_ACTIVITY : {
		id : 'sustained-activity',
		rank : 'supporting',
		needs : 'electrode',
		why : 'Electrical activity staying elevated well past the event that started it. Consistent with a systemic response still running, and equally consistent with a drifting electrode.',
	},
}

/** What the environment is allowed to explain away. */
const EXPLAINERS = {
	temperature : {
		swing : 4,
		why : 'A drop of several degrees produces variation potentials by itself. Cold shock and wounding look much the same on an electrode over the first few minutes.',
	},
	light : {
		swing : 5000,
		why : 'A large light change triggers electrical events with no damage involved. A blind being opened is enough.',
	},
	soil : {
		swing : 15,
		why : 'Watering is a mechanical and osmotic event at the roots, and it produces electrical signatures of its own.',
	},
}

/**
 * Does the environment account for the electrical event?
 *
 * The part that stops this being an alarm generator. Every entry in `EXPLAINERS`
 * is something that produces the same electrical signature as a wound, and any
 * of them moving sharply around the time of the event is grounds to stop calling
 * it a defence response.
 *
 * The readings passed in *are* the window, and choosing it matters more than
 * anything in here. A window that stops short of the event misses the draught
 * that caused it and hands back a confident "the room was steady"; one that
 * spans a whole day finds a swing in everything and explains away every real
 * wound. The caller knows when the event happened and this function does not,
 * so the slicing belongs to the caller.
 *
 * @param   {object[]} readings - Readings spanning the event, newest last.
 * @param   {object}   [opts]   - `{ window }` to trim to the most recent N.
 * @returns {object}            `{explains, by, why}`.
 */
export function environmentExplains( readings = [], opts = {} ) {

	if ( !Array.isArray( readings ) ) {

		return {
			explains : null,
			why : 'The environmental window has to be an array of readings spanning the event. Without it the electrical evidence cannot be separated from a draught, and the assessment stays low-confidence for exactly that reason.',
		}

	}

	const window = opts?.window ? readings.slice( -opts.window ) : readings

	if ( window.length < 3 ) {

		return {
			explains : null,
			why : 'Not enough recent readings to tell whether the weather moved at the same time. Without that check an electrical event cannot be separated from a draught, and the assessment stays low-confidence for exactly that reason.',
		}

	}

	const by = []

	for ( const [ metric, rule ] of Object.entries( EXPLAINERS ) ) {

		const xs = window.map( r => r?.[ metric ] ).filter( Number.isFinite )
		if ( xs.length < 3 ) continue

		const swing = Math.max( ...xs ) - Math.min( ...xs )

		if ( swing >= rule.swing ) by.push( {
			metric,
			swing : Number( swing.toFixed( 1 ) ),
			why : rule.why,
		} )

	}

	return {
		explains : by.length > 0,
		by,
		why : by.length
			? `${by.map( b => `${b.metric} moved ${b.swing}` ).join( ', ' )} over the same window. ${by[ 0 ].why} The electrical evidence is real; attributing it to defence is what stops being justified.`
			: 'Temperature, light and soil were all steady across the window, so whatever the electrode saw did not come from the room.',
	}

}

/**
 * Estimate how strongly this plant is mounting a defence.
 *
 * @param   {object}   input             - What is known.
 * @param   {object[]} [input.events]    - Classified electrical events, from `classifyEvent`.
 * @param   {object}   [input.shift]     - Electrome shift against this plant's own baseline.
 * @param   {object}   [input.vision]    - Vision findings.
 * @param   {object}   [input.wound]     - `{at, what}` a recorded wounding.
 * @param   {object[]} [input.readings]  - Recent environmental readings.
 * @param   {object}   [input.stomata]   - From `stomatalOpening`.
 * @param   {boolean}  [input.electrode] - Whether an electrode is present at all.
 * @returns {object}                     `{level, confidence, evidence, posture, why}`.
 */
export function defenseActivation( input = {} ) {

	// An explicit null gets past a default parameter, and it is what an optional
	// field or a `?.` that found nothing actually hands over.
	input = input ?? {}

	const electrode = input.electrode ?? Boolean( input.events || input.shift )

	// Absent is not low. Without the instrument that would have seen it, a plant
	// in full defence and a plant that is fine produce identical output.
	if ( !electrode && !input.vision && !input.wound ) {

		return {
			name : 'defense_activation',
			level : DEFENSE.UNKNOWN,
			confidence : CONFIDENCE.LOW,
			acts : false,
			decides : 'elective actions — probes, experiments, aid, relocation',
			missing : [ 'electrode', 'camera' ],
			evidence : [],
			posture : posture( DEFENSE.UNKNOWN ),
			why : 'No electrode, no camera and no record of anything having been done to this plant. The variation potential that would show a defence response has nothing watching for it, so the honest answer is that this is unknown rather than that it is low. A plant being eaten right now would look exactly like this.',
		}

	}

	const evidence = []
	const note = ( def, detail ) => evidence.push( {
		...def,
		detail,
	} )

	// ── primary: the electrical event itself ────────────────────────────────
	const vps = ( input.events ?? [] ).filter( e =>
		( e.label ?? e.classification?.label ) === 'variation_potential' )

	if ( vps.length ) note( EVIDENCE.VARIATION_POTENTIAL, `${vps.length} variation potential${vps.length === 1 ? '' : 's'} in this window.` )

	// ── primary: the plant against its own baseline ─────────────────────────
	const shifted = input.shift?.shifted === true || input.shift?.beyondBaseline === true

	if ( shifted ) note( EVIDENCE.ELECTROME_SHIFT, input.shift.why ?? 'Electrome is outside this plant\'s own established range.' )

	// ── primary: the cause, seen directly ───────────────────────────────────
	const damaged = Boolean( input.vision?.pests || input.vision?.chewing || input.vision?.necrosis )

	if ( damaged ) note( EVIDENCE.VISIBLE_DAMAGE, 'Damage or a pest is visible on the plant.' )
	if ( input.wound ) note( EVIDENCE.WOUND_EVENT, `${input.wound.what ?? 'A wounding'} was recorded.` )

	// ── supporting: too ambiguous to lead ───────────────────────────────────
	if ( input.stomata?.known && input.stomata.unexplained === true ) {

		note( EVIDENCE.STOMATAL_CLOSURE, 'Stomata are more closed than VPD and soil moisture account for.' )

	}

	if ( input.sustainedActivity === true ) note( EVIDENCE.SUSTAINED_ACTIVITY, 'Electrical activity has stayed elevated past the event.' )

	const primary = evidence.filter( e => e.rank === 'primary' )
	const control = environmentExplains( input.readings ?? [] )
	const cause = damaged || Boolean( input.wound )

	// ── the level ───────────────────────────────────────────────────────────
	// Stated as rules rather than as a score, because a score would invite
	// arithmetic between quantities that have no common unit.
	let level = DEFENSE.LOW
	let why = 'The electrode was watching and saw no variation potential, the electrome is where it usually sits, and nothing visible is wrong. This is a plant that is not defending itself against anything.'

	if ( primary.length === 1 ) {

		level = DEFENSE.MEDIUM
		why = `One line of primary evidence — ${primary[ 0 ].id} — and nothing corroborating it. Enough to stop poking this plant, not enough to conclude it has been attacked.`

	}

	if ( primary.length >= 2 ) {

		level = cause ? DEFENSE.HIGH : DEFENSE.MEDIUM
		why = cause
			? `${primary.map( e => e.id ).join( ' and ' )} together: the electrical signature of a wound response, alongside something that would actually cause one.`
			: `${primary.map( e => e.id ).join( ' and ' )} agree that this plant is doing something out of the ordinary, but nothing has been seen or recorded that would have wounded it. Held at medium: the response is real, its cause is not established.`

	}

	// ── the negative control, which is allowed to lower the answer ──────────
	let downgraded = null

	if ( control.explains === true && !cause && level !== DEFENSE.LOW ) {

		downgraded = level
		level = level === DEFENSE.HIGH ? DEFENSE.MEDIUM : DEFENSE.LOW
		why = `${control.why} Lowered from ${downgraded} on that basis.`

	}

	const confidence = confidenceIn( {
		primary,
		control,
		cause,
		shift : input.shift,
	} )

	return {
		name : 'defense_activation',
		level,
		confidence,
		// The same gate every other internal state uses: a weak signal informs a
		// person and does not change what the system does.
		acts : confidence !== CONFIDENCE.LOW && level !== DEFENSE.LOW && level !== DEFENSE.UNKNOWN,
		decides : 'elective actions — probes, experiments, aid, relocation',
		evidence : evidence.map( e => ( {
			id : e.id,
			rank : e.rank,
			detail : e.detail,
		} ) ),
		control,
		downgradedFrom : downgraded,
		posture : posture( level ),
		why,
		// Said in full, every time, so it cannot be quoted as something it is not.
		statement : level === DEFENSE.UNKNOWN
			? 'Defence pathway activation could not be assessed.'
			: `Estimated activation of the defence pathway (jasmonate signalling likely): ${level}. This is an inference from electrical and visual evidence, not a measurement of methyl jasmonate, which nothing in this system can measure.`,
	}

}

/**
 * How much to trust the level.
 *
 * Moves independently of it on purpose. A confident `low` and an unreliable
 * `high` are both useful, and collapsing them into one number would lose the
 * difference.
 *
 * @param   {object} ctx - `{primary, control, cause, shift}`.
 * @returns {string}     One of `CONFIDENCE`.
 */
function confidenceIn( ctx = {} ) {

	const { primary = [], control = {}, cause, shift } = ctx

	// Nothing to compare against. A shift claim needs a personal baseline, and
	// without one this is a species-average judgement pretending to be personal.
	if ( shift && shift.baselineReady === false ) return CONFIDENCE.LOW

	// The environment was never checked, so nothing has been ruled out.
	if ( control.explains === null ) return CONFIDENCE.LOW

	const independent = new Set( primary.map( e =>
		e.id === EVIDENCE.VISIBLE_DAMAGE.id || e.id === EVIDENCE.WOUND_EVENT.id ? 'non-electrical' : 'electrical' ) )

	// Two electrical lines from the same electrode are one instrument agreeing
	// with itself. Agreement across instruments is what earns high confidence.
	if ( independent.size >= 2 && control.explains === false && cause ) return CONFIDENCE.HIGH

	if ( primary.length >= 2 || ( primary.length === 0 && control.explains === false ) ) return CONFIDENCE.MEDIUM

	return CONFIDENCE.LOW

}

/**
 * What the rest of the system should stop doing.
 *
 * Deliberately phrased as restraint rather than as action. There is nothing
 * useful to *do* to a plant mounting a defence — the value is in not adding to
 * what it is already handling.
 *
 * @param   {string} level - One of `DEFENSE`.
 * @returns {object}       `{hold, allowElective, why}`.
 */
export function posture( level ) {

	if ( level === DEFENSE.HIGH ) return {
		level,
		allowElective : false,
		hold : [ 'spectral-probe', 'aid-session', 'relocation', 'experiment' ],
		warnColony : true,
		why : 'This plant is already spending on a defence. Spectral probing, elective light, being moved, or being asked to help a neighbour all add load to a plant that is busy. Care that keeps it stable continues; everything optional waits. The colony is told, because whatever caused this is probably still in the room.',
	}

	if ( level === DEFENSE.MEDIUM ) return {
		level,
		allowElective : false,
		hold : [ 'spectral-probe', 'experiment' ],
		warnColony : false,
		why : 'Something is happening that the room does not explain. Watch more closely and hold off on anything that deliberately stresses the plant to learn from it — an experiment run now would be measuring the response to the experiment plus whatever this is. Not warning the colony: one unexplained electrical event is not a reason to put every plant on alert.',
	}

	if ( level === DEFENSE.UNKNOWN ) return {
		level,
		allowElective : true,
		hold : [],
		warnColony : false,
		why : 'Nothing is being withheld, because nothing is known. Worth saying plainly: this plant is being cared for without any view of whether it is under attack, and an electrode would change that more than any other addition.',
	}

	return {
		level : DEFENSE.LOW,
		allowElective : true,
		hold : [],
		warnColony : false,
		why : 'Nothing to hold back. The plant is not defending itself, so this is the moment for anything elective — probes, experiments, being moved, helping a neighbour.',
	}

}

/**
 * Lines for the reasoner and the AI.
 *
 * @param   {object} state - From `defenseActivation`.
 * @returns {string[]}     Cues.
 */
export function defenseCues( state ) {

	// A quiet plant needs no comment — but a plant that showed a real electrical
	// event the weather then accounted for is a different thing from one that
	// never showed anything, and the record should be able to tell them apart.
	// A level is what makes it a state. Without one the lines below are built
	// from undefined and would enter the evidence ledger looking like something
	// the plant reported.
	if ( !state || typeof state !== 'object' || !state.level ) return []
	if ( state.level === DEFENSE.LOW && !state.downgradedFrom ) return []

	const cues = [ state.statement ]

	if ( Array.isArray( state.evidence ) && state.evidence.length ) {

		cues.push( `Evidence: ${state.evidence.map( e => e?.detail ?? e ).join( ' ' )}` )

	}

	if ( state.downgradedFrom ) {

		cues.push( `This was lowered from ${state.downgradedFrom} because the environment accounts for it: ${state.control?.why ?? 'the room moved at the same time'}` )

	}

	if ( state.confidence === CONFIDENCE.LOW ) {

		cues.push( 'Confidence is low, so treat this as a reason to look rather than a reason to conclude.' )

	}

	if ( state.posture?.hold?.length ) {

		cues.push( `Holding off on: ${state.posture.hold.join( ', ' )}. ${state.posture.why}` )

	}

	return cues

}
