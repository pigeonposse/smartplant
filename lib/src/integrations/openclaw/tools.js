/**
 * The plant's control surface, expressed as tools an agent can call.
 *
 * This is what makes OpenClaw a *brain* rather than a text generator: the model
 * does not receive a paragraph describing the plant and reply with prose, it
 * receives a set of capabilities and decides which to invoke.
 *
 * Every tool declares two things that matter more than its schema:
 *
 *   `acts`  — whether calling it changes the physical world.
 *   `risk`  — how much evidence a change needs before it is allowed.
 *
 * Reading is free. Acting is routed through the safety layers, which are the
 * same ones a human operator would face. An LLM with a water pump is exactly
 * the situation those layers were built for.
 */

import { RISK } from '../../confidence/index.js'

/** @typedef {'read'|'act'} ToolKind */

/**
 * @typedef {object} PlantTool
 * @property {string}   name        - Tool name the model calls.
 * @property {string}   description - What it does, written for the model.
 * @property {object}   parameters  - JSON-Schema-shaped parameter block.
 * @property {boolean}  acts        - True if it changes the world.
 * @property {object}   [risk]      - A `RISK` level, for acting tools.
 * @property {string}   [claim]     - Evidence claim this action rests on.
 * @property {Function} handler     - `(plant, params) => Promise<object>`.
 */

/** @type {PlantTool[]} */
export const PLANT_TOOLS = [

	// ── perception ────────────────────────────────────────────────────────────

	{
		name        : 'plant_status',
		description : 'Current state: wellbeing 0-100, every sensor reading, which metrics are out of range, and days since watering. Call this first — it is cheap and grounds everything else.',
		parameters  : { type : 'object', properties : {} },
		acts        : false,
		async handler( plant ) {

			await plant.read().catch( () => {} )
			const ctx = plant.context()

			return {
				status     : plant.status(),
				wellbeing  : ctx.happiness,
				readings   : ctx.current,
				outOfRange : ctx.deviations.map( d => `${d.metric} ${d.direction} (${d.value}${d.unit}, ideal ${d.range.min}-${d.range.max})` ),
				daysSinceWater : ctx.care?.daysSinceWater ?? null,
				daysSinceFertilizer : ctx.care?.daysSinceFertilizer ?? null,
			}

		},
	},

	{
		name        : 'plant_ask',
		description : 'Ask the plant a question and get its answer in first person, grounded in its real readings and history. Use this when a human wants to hear from the plant rather than read a report.',
		parameters  : {
			type : 'object',
			properties : { question : {
				type : 'string',
				description : 'What to ask.',
			} },
			required : [ 'question' ],
		},
		acts : false,
		async handler( plant, params ) {

			await plant.read().catch( () => {} )
			return { reply : await plant.speak( params.question ) }

		},
	},

	{
		name        : 'plant_history',
		description : 'Statistics and trends over a time window: min, max, average and direction of change per metric.',
		parameters  : {
			type : 'object',
			properties : { hours : {
				type : 'number',
				description : 'Window in hours. Default 24.',
			} },
		},
		acts : false,
		async handler( plant, params ) {

			const hours = params.hours ?? 24
			return {
				hours,
				readings : plant.memory.since( hours ).length,
				stats    : plant.memory.stats( hours ),
				events   : plant.memory.data.events.slice( -10 ),
			}

		},
	},

	{
		name        : 'plant_diagnose',
		description : 'Run the rule-based diagnosis. Returns conditions with a confidence and the exact observations behind each, plus suggested treatments. These are derived from readings, not guessed — trust them over your own inference.',
		parameters  : { type : 'object', properties : {} },
		acts        : false,
		async handler( plant ) {

			await plant.read().catch( () => {} )
			const d = plant.diagnose()

			return {
				conclusions : d.conclusions.map( c => ( {
					condition : c.conclusion,
					confidence : c.confidence,
					because : c.because,
				} ) ),
				treatments : d.treatments.map( t => t.treatment ),
				explanation: d.explanation,
			}

		},
	},

	{
		name        : 'plant_recall',
		description : 'Search this plant\'s own past for situations similar to a description. Use it before recommending anything — what worked here before beats a general rule.',
		parameters  : {
			type : 'object',
			properties : { query : {
				type : 'string',
				description : 'Describe the situation to search for.',
			} },
			required : [ 'query' ],
		},
		acts : false,
		async handler( plant, params ) {

			const hits = await plant.recall( params.query, { k : 5 } )
			return { episodes : hits.map( h => ( {
				when : h.at?.slice( 0, 10 ),
				similarity : h.score,
				what : h.text,
			} ) ) }

		},
	},

	{
		name        : 'plant_explain',
		description : 'Look up what the care ontology knows about a condition: what causes it, what it leads to, how it is detected and how it is treated.',
		parameters  : {
			type : 'object',
			properties : { condition : {
				type : 'string',
				description : 'Condition id, e.g. "root_rot" or "drought_stress".',
			} },
			required : [ 'condition' ],
		},
		acts : false,
		async handler( plant, params ) {

			return plant.knowledge.explain( params.condition )

		},
	},

	{
		name        : 'plant_electro',
		description : 'Read the plant\'s electrical activity: action potentials (something touched it), variation potentials (something is damaging it), and circadian rhythm health.',
		parameters  : {
			type : 'object',
			properties : { seconds : {
				type : 'number',
				description : 'Window length. Default 60.',
			} },
		},
		acts : false,
		async handler( plant, params ) {

			const r = await plant.listen( { seconds : params.seconds ?? 60 } )
			return {
				events    : r.summary,
				damage    : r.summary.damageSignal,
				circadian : r.circadian?.verdict ?? null,
				features  : r.features.time,
			}

		},
	},

	{
		name        : 'plant_vision',
		description : 'Look at the plant with the camera: canopy coverage, visual health, yellowing, browning, and what changed since the last frame.',
		parameters  : { type : 'object', properties : {} },
		acts        : false,
		async handler( plant ) {

			const seen = await plant.see()
			return {
				description : seen.description,
				change      : seen.change?.findings ?? [],
				detections  : seen.detections ?? null,
			}

		},
	},

	{
		name        : 'plant_spectral_scan',
		description : 'Interrogate the plant with light. Blue reads stomatal competence (hydration), red reads photosynthetic capacity, green reads the lower canopy. The pattern across colours separates thirst from malnutrition, which no single reading can. This is a probe, not a treatment — it is safe.',
		parameters  : {
			type : 'object',
			properties : { bands : {
				type : 'string',
				description : 'Comma-separated bands, e.g. "amber,blue,red". Default runs the standard sweep.',
			} },
		},
		acts : false,
		async handler( plant, params ) {

			const bands = params.bands ? params.bands.split( ',' ).map( s => s.trim() ) : undefined
			const sweep = await plant.interrogate( bands ? { bands } : {} )

			return {
				summary   : sweep.summary,
				diagnosis : sweep.diagnosis,
			}

		},
	},

	{
		name        : 'plant_body_state',
		description : 'The fused sensor state: fast channels raw, slow channels summarized, plus a coherence report saying whether the data is fresh enough to act on.',
		parameters  : { type : 'object', properties : {} },
		acts        : false,
		async handler( plant ) {

			if ( !plant.body ) return { available : false, reason : 'The plant has no body. Call embody() to add one.' }

			const snap = plant.body.state.snapshot()
			return {
				fast      : snap.fast,
				slow      : snap.slow,
				coherence : snap.coherence,
				energy    : {
					stateOfCharge : plant.body.safety.energy.stateOfCharge,
					critical      : plant.body.safety.energy.critical,
					idleHoursRemaining : plant.body.safety.energy.idleHoursRemaining(),
				},
			}

		},
	},

	{
		name        : 'plant_check_evidence',
		description : 'Ask whether there is enough independent evidence to justify an action. Call this BEFORE proposing anything irreversible. It returns what is missing if the answer is no.',
		parameters  : {
			type : 'object',
			properties : {
				claim : {
					type : 'string',
					description : 'What you believe, e.g. "soil_low" or "water_stress".',
				},
				risk  : {
					type : 'string',
					description : 'How hard the action is to undo: low, medium, high or critical.',
				},
			},
			required : [ 'claim' ],
		},
		acts : false,
		async handler( plant, params ) {

			if ( !plant.body ) return { available : false, reason : 'Evidence gating needs a body. Call embody().' }

			const level = RISK[ String( params.risk || 'medium' ).toUpperCase() ] || RISK.MEDIUM
			const v = plant.justifies( params.claim, level )

			return {
				allowed : v.allowed,
				score   : v.score,
				sources : v.sources,
				missing : v.missing,
				explanation : v.explanation,
			}

		},
	},

	{
		name        : 'plant_hardware',
		description : 'Scan the host for boards, sensors and cameras, and recommend a configuration.',
		parameters  : { type : 'object', properties : {} },
		acts        : false,
		async handler() {

			const { scan, recommend } = await import( '../../hardware/index.js' )
			const report = await scan()

			return {
				board  : report.board.label,
				serial : report.serial.map( p => `${p.path} (${p.label})` ),
				i2c    : report.i2c.map( d => `${d.address} ${d.name}` ),
				camera : report.camera.available,
				suggestion : recommend( report ),
			}

		},
	},

	// ── action ────────────────────────────────────────────────────────────────

	{
		name        : 'plant_water',
		description : 'Record that the plant was watered, or drive a pump if one is attached. Only call this when the evidence supports it — check plant_check_evidence first.',
		parameters  : {
			type : 'object',
			properties : {
				amountMl : {
					type : 'number',
					description : 'Millilitres.',
				},
				reason   : {
					type : 'string',
					description : 'Why you are watering.',
				},
			},
			required : [ 'amountMl' ],
		},
		acts  : true,
		risk  : RISK.HIGH,
		claim : 'soil_low',
		async handler( plant, params ) {

			// The body's supervisor caps and validates the amount when present;
			// without a body this is a memory record and the cap does not apply.
			if ( plant.body ) {

				const v = plant.body.safety.validate( {
					type : 'water',
					amountMl : params.amountMl,
				} )
				if ( !v.allowed ) return {
					applied : false,
					refused : v.explanation,
				}

				const event = await plant.water( {
					amount : v.mission.amountMl,
					note : params.reason,
				} )
				return {
					applied : true,
					amountMl : v.mission.amountMl,
					adjusted : v.mission.amountMl !== params.amountMl,
					at : event.t,
				}

			}

			const event = await plant.water( {
				amount : params.amountMl,
				note : params.reason,
			} )
			return {
				applied : true,
				amountMl : params.amountMl,
				at : event.t,
			}

		},
	},

	{
		name        : 'plant_fertilize',
		description : 'Record a feeding. Err toward underfeeding: burn is much harder to undo than a deficiency.',
		parameters  : {
			type : 'object',
			properties : {
				product : { type : 'string' },
				reason  : { type : 'string' },
			},
		},
		acts  : true,
		risk  : RISK.HIGH,
		claim : 'nutrient_deficiency',
		async handler( plant, params ) {

			const event = await plant.fertilize( {
				product : params.product,
				note : params.reason,
			} )
			return {
				applied : true,
				at : event.t,
			}

		},
	},

	{
		name        : 'plant_light_treat',
		description : 'Apply a wavelength therapeutically. Blue forces stomata open, red drives photosynthesis, green lights the lower canopy. This is gated by hard physiological interlocks — blue is refused on dry soil because the plant closed its stomata to survive.',
		parameters  : {
			type : 'object',
			properties : {
				band    : {
					type : 'string',
					description : 'blue, green, red, amber, uva, uvb or farRed.',
				},
				seconds : {
					type : 'number',
					description : 'Duration.',
				},
				reason  : {
					type : 'string',
					description : 'Why this wavelength.',
				},
			},
			required : [ 'band', 'seconds' ],
		},
		acts  : true,
		risk  : RISK.MEDIUM,
		async handler( plant, params ) {

			if ( !plant.spectral ) return {
				applied : false,
				refused : 'No light attached. Call useSpectral() first.',
			}

			// SpectralSafety owns this decision, not the model.
			const r = await plant.spectral.treat( params.band, {
				seconds : params.seconds,
				context : plant.context(),
			} )

			return r.applied
				? {
					applied : true,
					band : r.band,
					seconds : r.seconds,
					effect : r.effect,
					remainingToday : r.remainingToday,
				}
				: {
					applied : false,
					refused : r.explanation,
				}

		},
	},

	{
		name        : 'plant_move',
		description : 'Move the plant to a position, if it has a body. Refused outside the geofence, inside a keep-out zone, or when the battery could not cover the return trip.',
		parameters  : {
			type : 'object',
			properties : {
				x      : { type : 'number' },
				y      : { type : 'number' },
				reason : { type : 'string' },
			},
			required : [ 'x', 'y' ],
		},
		acts  : true,
		risk  : RISK.HIGH,
		async handler( plant, params ) {

			if ( !plant.body ) return {
				applied : false,
				refused : 'The plant has no body. Call embody() first.',
			}

			const v = plant.body.safety.validate( {
				type   : 'move',
				from   : plant.body.safety.geofence.home,
				target : [ params.x, params.y ],
			} )

			if ( !v.allowed ) return {
				applied : false,
				refused : v.explanation,
			}

			plant.body.safety.notifyMoved()
			await plant.log( 'move', {
				to : [ params.x, params.y ],
				note : params.reason,
			} )

			return {
				applied : true,
				target : [ params.x, params.y ],
				estimate : v.mission.estimate,
			}

		},
	},

	{
		name        : 'plant_diary',
		description : 'Have the plant write a dated journal entry about the recent period, in its own voice, and store it in its memory.',
		parameters  : {
			type : 'object',
			properties : { hours : {
				type : 'number',
				description : 'Period to cover. Default 24.',
			} },
		},
		acts : true,
		risk : RISK.LOW,
		async handler( plant, params ) {

			await plant.read().catch( () => {} )
			const hours = params.hours ?? 24

			const entry = await plant.speak(
				`Write a short diary entry covering the last ${hours} hours, in your own voice, based on what actually happened.`,
				{ persona : 'plant' },
			)
			await plant.memory.addNote( entry, 'plant' )

			return {
				applied : true,
				entry,
			}

		},
	},

	{
		name        : 'plant_remember',
		description : 'Write something into the plant\'s long-term memory so future reasoning can recall it. Use it for observations the sensors cannot capture.',
		parameters  : {
			type : 'object',
			properties : { note : { type : 'string' } },
			required : [ 'note' ],
		},
		acts : true,
		risk : RISK.LOW,
		async handler( plant, params ) {

			await plant.note( params.note )
			await plant.remember( params.note ).catch( () => {} )
			return { recorded : true }

		},
	},

	{
		name        : 'plant_emergency_stop',
		description : 'Stop every actuator immediately: motion, pumps and lights. Call this the moment anything looks wrong. It is always available and never refused.',
		parameters  : {
			type : 'object',
			properties : { reason : { type : 'string' } },
			required : [ 'reason' ],
		},
		acts : true,
		risk : RISK.LOW,
		async handler( plant, params ) {

			plant.body?.safety?.emergencyStop( `agent: ${params.reason}` )
			await plant.spectral?.allOff().catch( () => {} )
			plant.stopMonitoring()

			return {
				stopped : true,
				reason : params.reason,
			}

		},
	},

]

export const TOOL_NAMES = PLANT_TOOLS.map( t => t.name )

/** Tools that only read. */
export const READ_TOOLS = PLANT_TOOLS.filter( t => !t.acts ).map( t => t.name )

/** Tools that change the physical world. */
export const ACT_TOOLS = PLANT_TOOLS.filter( t => t.acts ).map( t => t.name )

/**
 * Render the toolset in OpenAI tool-calling format, which is what an
 * OpenAI-compatible gateway expects.
 *
 * @param   {object}   [opts]           - Options.
 * @param   {string[]} [opts.only]      - Restrict to these names.
 * @param   {boolean}  [opts.readOnly]  - Drop every acting tool.
 * @returns {object[]}                  Tool definitions.
 */
export function toolSchemas( opts = {} ) {

	return selectTools( opts ).map( t => ( {
		type     : 'function',
		function : {
			name        : t.name,
			description : t.description,
			parameters  : {
				type : 'object',
				properties : t.parameters.properties || {},
				required : t.parameters.required || [],
			},
		},
	} ) )

}

/**
 * Pick the tools a run should have.
 *
 * @param   {object}      [opts] - `{ only, readOnly }`.
 * @returns {PlantTool[]}        Selected tools.
 */
export function selectTools( opts = {} ) {

	return PLANT_TOOLS
		.filter( t => !opts.only || opts.only.includes( t.name ) )
		.filter( t => !opts.readOnly || !t.acts )

}

/**
 * Find a tool by name.
 *
 * @param   {string}         name - Tool name.
 * @returns {PlantTool|null}      The tool.
 */
export function findTool( name ) {

	return PLANT_TOOLS.find( t => t.name === name ) || null

}
