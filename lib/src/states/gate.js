/**
 * One door every action goes through.
 *
 * The internal states already stop things: watering, spectral probes, lending a
 * plant to a neighbour, moving. Each of those is a separate check written at a
 * separate call site, and that is the problem rather than the achievement.
 *
 * Five hand-written gates means the sixth action somebody adds has none, and
 * nothing anywhere notices. There is no list to be missing from. The states end
 * up governing the actions that happened to be written while somebody was
 * thinking about states, which is not the same as governing behaviour.
 *
 * So: one function. Every action that costs the plant something asks it first,
 * and the answer carries the reason, the override, and a record of having been
 * asked.
 *
 * ## What each state is allowed to stop
 *
 * Not everything stops everything. A plant mounting a defence should not be
 * given a spectral probe and should absolutely still be watered if it is dry —
 * a gate that blocked care because the plant was already struggling would be
 * the worst possible reading of the whole idea.
 *
 * So the table below is explicit about which state governs which action, and
 * `CARE` is the set nothing may block. That is the line: this layer withholds
 * *elective* things, and never the things a plant needs to stay alive.
 *
 * ## Attenuate before refusing
 *
 * A refusal is the blunt version. Where an action has a size — a dose, a
 * duration, a distance — a loaded plant gets a smaller one rather than none,
 * because half a treatment is usually better than none and always better than a
 * full one on a plant with no room for it.
 */

import { StateCalibration } from './calibration.js'
import { LEVEL } from './index.js'

/**
 * Things a plant can be asked to do, and whether they are optional.
 *
 * `elective` is the whole distinction. An elective action is one taken to learn
 * something or to help somebody else; a care action is one the plant needs.
 */
export const ACTION = {
	WATER      : { id : 'water', elective : false, scalable : true },
	FERTILISE  : { id : 'fertilise', elective : false, scalable : true },
	PROBE      : { id : 'probe', elective : true, scalable : true },
	TREAT      : { id : 'treat', elective : true, scalable : true },
	EXPERIMENT : { id : 'experiment', elective : true, scalable : true },
	AID        : { id : 'aid', elective : true, scalable : false },
	MOVE       : { id : 'move', elective : true, scalable : false },
	TEACH      : { id : 'teach', elective : true, scalable : false },
	PRIME      : { id : 'prime', elective : true, scalable : true },
}

/** Actions no internal state may block. A struggling plant still gets looked after. */
export const CARE = new Set( [ ACTION.WATER.id, ACTION.FERTILISE.id ] )

/**
 * Which state governs which action, and how hard.
 *
 * `blocks` refuses outright. `dampens` shrinks whatever has a size. A state not
 * listed against an action has no opinion about it, which is different from
 * approving it.
 */
export const GOVERNS = {
	defense_activation : {
		blocks : [ ACTION.PROBE.id, ACTION.EXPERIMENT.id, ACTION.AID.id, ACTION.MOVE.id, ACTION.TREAT.id ],
		dampens : [ ACTION.PRIME.id ],
		why : 'A plant mounting a defence is already spending. Everything optional waits; nothing it needs does.',
	},
	stress_load : {
		blocks : [ ACTION.EXPERIMENT.id ],
		dampens : [ ACTION.PROBE.id, ACTION.TREAT.id, ACTION.PRIME.id ],
		why : 'Accumulated load means less room to absorb the next thing, which is an argument for a smaller version rather than for nothing at all.',
	},
	water_stress_internal : {
		blocks : [],
		dampens : [],
		// It governs watering through its own `withhold`, which is care and
		// therefore outside this gate by design — the refusal there is about
		// water being the wrong answer, not about the plant being too fragile.
		why : 'Handled at the watering call itself, because withholding water is a claim about the cause rather than about the plant having no capacity.',
	},
	circadian_integrity : {
		blocks : [],
		dampens : [ ACTION.PROBE.id, ACTION.EXPERIMENT.id ],
		why : 'A plant whose clock has degraded gives a less legible answer to anything timed, so a measurement taken now is worth less and should cost less.',
	},
	stress_memory : {
		blocks : [],
		dampens : [],
		why : 'Changes what to expect from an action rather than whether to take it.',
	},
}

/** How much a dampening state shrinks an action. */
const SCALE = {
	[ LEVEL.HIGH ] : 0.5,
	[ LEVEL.MEDIUM ] : 0.75,
}

/**
 * May this plant be asked to do this, and at what size?
 *
 * @param   {object} states  - From `plant.states()`.
 * @param   {string} action  - One of `ACTION`'s ids.
 * @param   {object} [opts]  - `{ calibration, force }`.
 * @returns {object}         `{allowed, scale, blockedBy, why}`.
 */
export function permits( states, action, opts = {} ) {

	states = states ?? {}
	opts = opts ?? {}

	const known = Object.values( ACTION ).find( a => a.id === action )

	if ( !known ) {

		return {
			allowed : true,
			scale : 1,
			why : `"${action}" is not a governed action, so nothing here has an opinion about it. That is not approval — it is an action nobody has thought about yet, and adding it to ACTION is how it starts being considered.`,
		}

	}

	if ( CARE.has( action ) ) {

		return {
			allowed : true,
			scale : 1,
			care : true,
			why : `${action} is care rather than an elective action, and no internal state may block it. A gate that withheld water because the plant was already struggling would be the worst possible reading of this idea.`,
		}

	}

	const blockedBy = []
	const dampenedBy = []
	let scale = 1

	for ( const [ name, state ] of Object.entries( states ) ) {

		const rule = GOVERNS[ name ]
		if ( !rule || !state ) continue

		// Calibration can take a state's authority away when its refusals have a
		// history of turning out to have been unnecessary.
		const acts = opts.calibration
			? opts.calibration.gate( state ).acts
			: state.acts

		if ( !acts ) continue

		if ( rule.blocks?.includes( action ) ) blockedBy.push( {
			state : name,
			level : state.level,
			why : state.why,
		} )

		if ( rule.dampens?.includes( action ) && known.scalable ) {

			const factor = SCALE[ state.level ]

			if ( factor ) {

				scale = Math.min( scale, factor )
				dampenedBy.push( {
					state : name,
					level : state.level,
					factor,
				} )

			}

		}

	}

	if ( blockedBy.length && !opts.force ) {

		return {
			allowed : false,
			scale : 0,
			blockedBy,
			dampenedBy,
			why : `${blockedBy.map( b => `${b.state} is ${b.level}` ).join( ', ' )}. ${GOVERNS[ blockedBy[ 0 ].state ].why} ${blockedBy[ 0 ].why} Pass { force: true } to do it anyway — and if you do, the outcome is recorded, because an override is the only way this system finds out a state has been refusing things that would have been fine.`,
		}

	}

	if ( blockedBy.length ) {

		return {
			allowed : true,
			forced : true,
			scale : 1,
			blockedBy,
			why : `Overridden. ${blockedBy.map( b => b.state ).join( ', ' )} would have refused this. The outcome will be graded: this is the one place a refusal can be checked at all, because the trial the system declined to run has now been run.`,
		}

	}

	return {
		allowed : true,
		scale : Number( scale.toFixed( 2 ) ),
		dampenedBy,
		why : dampenedBy.length
			? `Allowed at ${Math.round( scale * 100 )}% of the usual size. ${dampenedBy.map( d => `${d.state} is ${d.level}` ).join( ', ' )}, and half a treatment on a plant with little room is better than none and better than a full one.`
			: 'No internal state objects to this.',
	}

}

/**
 * Every action, and what the states currently make of it.
 *
 * The view that makes the gate auditable: a person can see at a glance what this
 * plant is currently allowed to be asked for, rather than discovering it one
 * refusal at a time.
 *
 * @param   {object} states - From `plant.states()`.
 * @param   {object} [opts] - `{ calibration }`.
 * @returns {object[]}      One row per action.
 */
export function posture( states, opts = {} ) {

	return Object.values( ACTION ).map( a => ( {
		action : a.id,
		elective : a.elective,
		...permits( states, a.id, opts ),
	} ) )

}

export { StateCalibration }
