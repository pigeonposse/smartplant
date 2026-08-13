/**
 * Colony — a conversation between plants.
 *
 * Two plants on the same bus can talk. Most of it is ordinary conversation: one
 * asks, the other answers in its own voice, grounded in its own readings. Skills
 * are the fast path — a named request that returns the fact directly, with no
 * model in the loop.
 *
 * ```js
 * const bus = new LoopbackBus()
 * await rosa.joinColony( { transport : bus.endpoint( 'rosa' ) } )
 * await lila.joinColony( { transport : bus.endpoint( 'lila' ) } )
 *
 * await rosa.colony.ask( 'lila', 'sense.vpd-perception' )
 * await rosa.colony.report( { to : 'lila' } )
 *
 * // A person watches; they never write.
 * rosa.on( 'colony:message', line => console.log( line.from, '→', line.text ) )
 * ```
 *
 * **The channel is closed to people.** A human can watch everything said — the
 * transcript is open, and every line raises `colony:message` — but there is no
 * way to write into it. Nothing here takes a sentence from a person and puts it
 * in a plant's mouth. What a plant says is composed from its own readings.
 *
 * That is also why there is no persona here. Personas exist so a plant can
 * address its owner as a poet, a botanist or a child; they are a human-facing
 * register, and `speak()` is the human-facing channel — it raises `plant:spoke`,
 * which means "the plant said something to you". A plant answering another plant
 * is not doing that, and routing colony talk through it would file plant-to-plant
 * speech as speech to the owner.
 *
 * Two more rules hold the layer together.
 *
 * **A plant only says what it can measure.** Its vocabulary is derived from the
 * drivers actually attached to it, so a plant with no electrode cannot report an
 * electrical spike, and a request for one comes back refused with the reason.
 * The refusal is itself useful: the asker learns what this neighbour is blind to.
 *
 * **The colony is one source of evidence, never many.** Plants in a room share a
 * window, a radiator, a watering can and a human, so their observations are
 * strongly correlated. The evidence ledger combines cues with noisy-OR and counts
 * distinct sources toward its corroboration threshold; registering five
 * neighbours as five independent sources would let one observation, counted five
 * times, walk a high-risk action through that gate. So everything heard enters
 * under the single source `colony`, with its strength set by how much the
 * neighbours actually agree.
 */

import { answerSkill, capabilitiesOf, lexiconOf } from './skills.js'
import { LoopbackBus } from './transport.js'

const KIND = {
	CHAT       : 'chat',
	ASK        : 'ask',
	REPLY      : 'reply',
	HELLO      : 'hello',
	LESSON     : 'lesson',
	ASK_LESSON : 'ask-lesson',
}

let counter = 0
const nextId = () => `msg_${++counter}_${Date.now().toString( 36 )}`

/**
 * One plant's membership of a colony.
 */
export class ColonyMember {

	/**
	 * @param {object} plant             - The `SmartPlant` this speaks for.
	 * @param {object} opts              - Options.
	 * @param {object} opts.transport    - A `ColonyTransport`.
	 * @param {number} [opts.timeoutMs]  - How long to wait for a reply. Default 5000.
	 * @param {number} [opts.maxTranscript] - Conversation lines kept. Default 200.
	 */
	constructor( plant, opts = {} ) {

		if ( !opts.transport ) throw new Error( 'A colony member needs a transport. Try { transport: new LoopbackBus().endpoint( "name" ) }.' )

		this.plant     = plant
		this.transport = opts.transport
		this.id        = opts.transport.id
		this.timeoutMs = opts.timeoutMs ?? 5000
		this.maxTranscript = opts.maxTranscript ?? 200

		/** Everything said, in order. The colony's shared memory of the talk. */
		this.transcript = []
		/** What each neighbour has told us about itself. */
		this.neighbours = new Map()
		/** @type {Map<string, {resolve: Function, reject: Function}>} */
		this._pending = new Map()

		this._off = this.transport.onMessage( env => this._handle( env ) )

	}

	/** The vocabulary this plant can actually speak. */
	get lexicon() {

		return lexiconOf( this.plant )

	}

	get capabilities() {

		return [ ...capabilitiesOf( this.plant ) ].sort()

	}

	async peers() {

		return this.transport.peers()

	}

	/** Announce ourselves and what we can be asked about. */
	async introduce() {

		return this._send( '*', KIND.HELLO, {
			name    : this.plant.memory.plant.name,
			species : this.plant.memory.plant.species,
			offers  : this.lexicon.speakable,
		} )

	}

	// ── talking ───────────────────────────────────────────────────────────────

	/**
	 * Tell a neighbour how this plant is, in its own words.
	 *
	 * The line is composed from this plant's own readings — there is deliberately
	 * no parameter for putting words in its mouth. A person can read every
	 * exchange but cannot author one.
	 *
	 * @param   {object} [opts]        - Options.
	 * @param   {string} [opts.to]     - Peer id. Omit to address the colony.
	 * @returns {Promise<object|null>} The reply, or null for a broadcast.
	 */
	async report( opts = {} ) {

		return this._utter( await this._composeFromState(), opts )

	}

	/**
	 * Put a composed line onto the channel.
	 *
	 * Internal on purpose: everything that reaches it originates in a plant's
	 * own state, never in a string typed by a person.
	 *
	 * @param   {string} text          - The composed line.
	 * @param   {object} [opts]        - Options.
	 * @param   {string} [opts.to]     - Peer id. Omit to address the colony.
	 * @param   {boolean} [opts.expectReply] - Wait for an answer.
	 * @returns {Promise<object|null>} The reply, or null for a broadcast.
	 */
	async _utter( text, opts = {} ) {

		const to = opts.to ?? '*'
		const expectReply = opts.expectReply ?? to !== '*'

		this._record( {
			from : this.id,
			to,
			kind : KIND.CHAT,
			text,
		} )

		if ( !expectReply ) {

			await this._send( to, KIND.CHAT, { text } )
			return null

		}

		return this._sendAwaiting( to, KIND.CHAT, { text } )

	}

	/**
	 * Ask a neighbour a named question — the fast path.
	 *
	 * @param   {string} peer    - Peer id.
	 * @param   {string} skillId - Skill.
	 * @returns {Promise<object>} `{ok, data}` or `{ok: false, reason}`.
	 */
	async ask( peer, skillId ) {

		this._record( {
			from : this.id,
			to : peer,
			kind : KIND.ASK,
			skill : skillId,
		} )

		return this._sendAwaiting( peer, KIND.ASK, { skill : skillId } )

	}

	/**
	 * Ask everyone the same question and collect whoever can answer.
	 *
	 * @param   {string} skillId - Skill.
	 * @returns {Promise<object>} `{answers, refusals}`.
	 */
	async askAll( skillId ) {

		const peers = await this.peers()
		const results = await Promise.all( peers.map( async p => {

			try {

				return {
					peer : p,
					...await this.ask( p, skillId ),
				}

			}
			catch ( err ) {

				return {
					peer : p,
					ok : false,
					reason : err.message,
				}

			}

		} ) )

		return {
			answers  : results.filter( r => r.ok ),
			refusals : results.filter( r => !r.ok ),
		}

	}

	// ── teaching the newcomer ─────────────────────────────────────────────────

	/**
	 * Which neighbours have not been here long enough to know the room.
	 *
	 * @returns {Promise<object[]>} `{peer, experience, novice, why}`.
	 */
	async newcomers() {

		const { isNovice } = await import( '../migration/teaching.js' )
		const { answers } = await this.askAll( 'consensus.experience' )

		return answers
			.map( a => ( {
				peer : a.peer,
				experience : a.data,
				...isNovice( a.data ),
			} ) )
			.filter( r => r.novice )

	}

	/**
	 * Offer what this plant knows about the room to a newcomer.
	 *
	 * @param   {string} peer   - Who to teach.
	 * @param   {object} [opts] - `{ modules }`.
	 * @returns {Promise<object>} `{taught, lesson}` or `{taught: false, why}`.
	 */
	async teach( peer, opts = {} ) {

		const { canTeach, experienceOf, prepareLesson } = await import( '../migration/teaching.js' )

		const mine = experienceOf( this.plant )
		const theirs = await this.ask( peer, 'consensus.experience' )

		if ( !theirs.ok ) return {
			taught : false,
			why : `Could not ask ${peer} how experienced it is: ${theirs.reason}`,
		}

		const verdict = canTeach( mine, theirs.data, opts )
		if ( !verdict.qualified ) return {
			taught : false,
			why : verdict.why,
		}

		const lesson = prepareLesson( this.plant, opts )

		this._record( {
			from : this.id,
			to : peer,
			kind : KIND.LESSON,
			text : `offers what it has learned about this room (${lesson.lesson.modules.join( ', ' )})`,
		} )

		const accepted = await this._sendAwaiting( peer, KIND.LESSON, { lesson } )

		return {
			taught : Boolean( accepted?.ok ),
			lesson,
			response : accepted,
			why : verdict.why,
		}

	}

	/**
	 * Ask the experienced neighbours what they know about this room.
	 *
	 * Every lesson received is merged into **one** inheritance. Neighbours share
	 * a window, a radiator and a watering can, so several of them agreeing is one
	 * room agreeing with itself — grafting each separately would leave this plant
	 * several times as sure as the evidence allows.
	 *
	 * @param   {object} [opts] - Passed to the graft.
	 * @returns {Promise<object>} `{learned, teachers, merged, result}`.
	 */
	async learnFromColony( opts = {} ) {

		const { mergeLessons } = await import( '../migration/teaching.js' )
		const { importBundle } = await import( '../migration/index.js' )

		const peers = await this.peers()
		const lessons = []

		for ( const peer of peers ) {

			const reply = await this._sendAwaiting( peer, KIND.ASK_LESSON, {} ).catch( () => null )
			if ( reply?.ok && reply.lesson ) lessons.push( reply.lesson )

		}

		if ( !lessons.length ) {

			return {
				learned : false,
				teachers : 0,
				why : 'No neighbour here has enough local experience to teach anything about this room yet.',
			}

		}

		const merged = mergeLessons( lessons )
		const result = importBundle( this.plant, merged, opts )

		this._record( {
			from : this.id,
			to : '*',
			kind : KIND.LESSON,
			text : `learned about this room from ${lessons.length} neighbour(s), merged into one lesson`,
		} )

		return {
			learned : true,
			teachers : lessons.length,
			merged,
			result,
		}

	}

	// ── being talked to ───────────────────────────────────────────────────────

	async _handle( env ) {

		if ( env.to !== '*' && env.to !== this.id ) return

		if ( env.kind === KIND.REPLY ) {

			const waiting = this._pending.get( env.replyTo )
			if ( waiting ) {

				this._pending.delete( env.replyTo )
				waiting.resolve( env.body )

			}
			return

		}

		if ( env.kind === KIND.HELLO ) {

			this.neighbours.set( env.from, env.body )
			this._record( {
				from : env.from,
				to : '*',
				kind : KIND.HELLO,
				text : `${env.body.name || env.from} joined, offering ${env.body.offers?.length ?? 0} skills`,
			} )
			return

		}

		if ( env.kind === KIND.ASK_LESSON ) {

			const { canTeach, experienceOf, prepareLesson } = await import( '../migration/teaching.js' )
			const mine = experienceOf( this.plant )

			// Only a plant that actually knows the room has a lesson to give.
			if ( mine.level === 'newcomer' ) {

				return this._reply( env, {
					ok : false,
					reason : canTeach( mine, mine ).why,
				} )

			}

			return this._reply( env, {
				ok : true,
				lesson : prepareLesson( this.plant ),
			} )

		}

		if ( env.kind === KIND.LESSON ) {

			const { importBundle } = await import( '../migration/index.js' )

			this._record( {
				from : env.from,
				to : this.id,
				kind : KIND.LESSON,
				text : 'was offered what a neighbour knows about this room',
			} )

			try {

				// The lesson arrives as a proposal. The graft's own compatibility
				// check decides how much of it applies here, exactly as it would for
				// a bundle handed over by a person.
				const result = importBundle( this.plant, env.body.lesson )

				return this._reply( env, {
					ok : true,
					admitted : result.inheritance.report().admitted,
					compatibility : result.compatibility.verdict,
				} )

			}
			catch ( err ) {

				return this._reply( env, {
					ok : false,
					reason : err.message,
				} )

			}

		}

		if ( env.kind === KIND.ASK ) {

			const answer = answerSkill( this.plant, env.body.skill )
			this._record( {
				from : this.id,
				to : env.from,
				kind : KIND.REPLY,
				skill : env.body.skill,
				text : answer.ok ? answer.says : answer.reason,
			} )
			return this._reply( env, answer )

		}

		if ( env.kind === KIND.CHAT ) {

			this._record( {
				from : env.from,
				to : env.to,
				kind : KIND.CHAT,
				text : env.body.text,
			} )

			const reply = await this._composeFromState( env )

			this._record( {
				from : this.id,
				to : env.from,
				kind : KIND.CHAT,
				text : reply,
			} )

			// A broadcast is not a question; nobody is waiting on an answer.
			if ( env.to === '*' ) return
			return this._reply( env, {
				ok : true,
				text : reply,
			} )

		}

	}

	/** The register for talking to another plant. Not a human persona. */
	_colonyPrompt( who ) {

		return [
			'You are a plant, speaking directly to another plant in your colony.',
			`You are answering ${who}. No person is in this conversation and none will read it as if addressed to them.`,
			'Speak plainly and briefly, in the first person, about your own condition.',
			'Base every statement strictly on the CONTEXT provided. If the data does not support a claim, say what you do not know instead of guessing.',
			'Never invent a reading you were not given.',
		].join( '\n' )

	}

	/** Compose a line about this plant's own state. */
	async _composeFromState( heard ) {

		const { renderContext } = await import( '../memory/context.js' )
		const { offlineVoice }  = await import( '../voice/persona.js' )
		const ctx = this.plant.context()

		// With no model configured the colony still talks: the offline voice is
		// deterministic and only ever says things the readings support.
		if ( !this.plant.ai?.ready ) return offlineVoice( ctx )

		const who = heard ? ( this.neighbours.get( heard.from )?.name || heard.from ) : 'the colony'

		const prompt = [
			'CONTEXT',
			renderContext( ctx ),
			'',
			heard
				? `${who} said to you: "${heard.body.text}"`
				: 'Tell the colony how you are right now, in one or two sentences.',
		].join( '\n' )

		try {

			return await this.plant.ai.generate( prompt, { system : this._colonyPrompt( who ) } )

		}
		catch {

			return offlineVoice( ctx )

		}

	}

	// ── plumbing ──────────────────────────────────────────────────────────────

	async _send( to, kind, body ) {

		return this.transport.send( {
			id   : nextId(),
			from : this.id,
			to,
			kind,
			body,
		} )

	}

	async _sendAwaiting( to, kind, body ) {

		const id = nextId()

		const waiting = new Promise( ( resolve, reject ) => {

			this._pending.set( id, {
				resolve,
				reject,
			} )

			// A neighbour that has gone quiet must not hang the conversation.
			setTimeout( () => {

				if ( this._pending.has( id ) ) {

					this._pending.delete( id )
					reject( new Error( `${to} did not answer within ${this.timeoutMs}ms.` ) )

				}

			}, this.timeoutMs ).unref?.()

		} )

		await this.transport.send( {
			id,
			from : this.id,
			to,
			kind,
			body,
		} )

		return waiting

	}

	async _reply( env, body ) {

		return this.transport.send( {
			id      : nextId(),
			from    : this.id,
			to      : env.from,
			kind    : KIND.REPLY,
			replyTo : env.id,
			body,
		} )

	}

	_record( line ) {

		const entry = {
			at : new Date().toISOString(),
			...line,
		}

		this.transcript.push( entry )
		if ( this.transcript.length > this.maxTranscript ) this.transcript.shift()

		// The human's only window onto the channel: they see everything and can
		// put nothing in. Deliberately not `plant:spoke`, which means the plant
		// addressed its owner — nothing here is addressed to a person.
		this.plant.events.emit( 'colony:message', entry ).catch( () => {} )

		return entry

	}

	// ── what the colony is worth as evidence ──────────────────────────────────

	/**
	 * Turn what the neighbours said into cues for the evidence ledger.
	 *
	 * Deliberately one cue per claim under the single source `colony`, with its
	 * strength set by agreement. Five plants on one shelf are five views of one
	 * room, and the ledger's corroboration gate must not be walked through by
	 * counting that room five times.
	 *
	 * @param   {object[]} answers - Results from `askAll`.
	 * @param   {string}   claim   - What the agreement would support.
	 * @returns {object[]}         Cues, at most one.
	 */
	static cuesFrom( answers, claim ) {

		const ok = answers.filter( a => a.ok )
		if ( ok.length < 2 ) return []

		// Agreement across neighbours raises confidence, but it saturates: the
		// tenth plant in the same room adds almost nothing the second did not.
		const strength = Math.min( 0.55, 0.25 + 0.1 * ( ok.length - 1 ) )

		return [ {
			claim,
			source   : 'colony',
			strength : Number( strength.toFixed( 3 ) ),
			detail   : `${ok.length} neighbours agree, but they share a room — counted once, not ${ok.length} times`,
		} ]

	}

}

export { answerSkill, capabilitiesOf, lexiconOf } from './skills.js'
export {
	allSkills, FAMILIES, getSkill, registerSkill,
} from './skills.js'
export { ColonyTransport, LoopbackBus } from './transport.js'
export { ColonyClient, ColonyServer } from './net.js'
export { LoopbackBus as Bus }
