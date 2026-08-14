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
 * await ivy.joinColony( { transport : bus.endpoint( 'ivy' ) } )
 * await hazel.joinColony( { transport : bus.endpoint( 'hazel' ) } )
 *
 * await ivy.colony.ask( 'hazel', 'sense.vpd-perception' )
 * await ivy.colony.report( { to : 'hazel' } )
 *
 * // A person watches; they never write.
 * ivy.on( 'colony:message', line => console.log( line.from, '→', line.text ) )
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

import { manifest, opticalLink, opticalPeers, whoCanRead } from './capability.js'
import { deliver, drainSpool, health, link, Seen, Spool } from './delivery.js'
import { answerSkill, capabilitiesOf, lexiconOf } from './skills.js'
import { LoopbackBus } from './transport.js'

const KIND = {
	CHAT       : 'chat',
	ASK        : 'ask',
	REPLY      : 'reply',
	HELLO      : 'hello',
	LESSON     : 'lesson',
	ASK_LESSON : 'ask-lesson',
	AID        : 'aid',
	AID_OPEN   : 'aid-open',
	AID_FRAME  : 'aid-frame',
	AID_CLOSE  : 'aid-close',
	PRIMING    : 'priming',
}

/**
 * Kinds worth spending a receiving plant's own budget on.
 *
 * A link that costs the recipient — the optical one puts light on a resting
 * plant — is not a cheaper route, it is a bill somebody else pays. Only these
 * are worth handing them.
 */
const URGENT = new Set( [ 'sos', 'priming' ] )

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
		/** Peer id to declared equipment. Claims about themselves, never verified. */
		this.manifests = new Map()

		// Delivery. One transport was the whole story until now: if it failed,
		// messages went nowhere and six call sites swallowed the failure, so a
		// colony could be entirely broken and look like it was working.
		this.links = []
		this.spool = new Spool( opts.spool )
		this.seen = new Seen()
		/** Every send that did not arrive, kept so it can be asked about. */
		this.undelivered = []
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
			// What this plant is equipped with, so neighbours can plan around it
			// rather than discovering it one refusal at a time.
			manifest : manifest( this.plant ),
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
	async ask( peer, skillId, payload ) {

		this._record( {
			from : this.id,
			to : peer,
			kind : KIND.ASK,
			skill : skillId,
		} )

		return this._sendAwaiting( peer, KIND.ASK, {
			skill : skillId,
			payload,
		} )

	}

	/**
	 * Ask everyone the same question and collect whoever can answer.
	 *
	 * @param   {string} skillId - Skill.
	 * @returns {Promise<object>} `{answers, refusals}`.
	 */
	async askAll( skillId, payload ) {

		const peers = await this.peers()
		const results = await Promise.all( peers.map( async p => {

			try {

				return {
					peer : p,
					...await this.ask( p, skillId, payload ),
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

	/**
	 * The colony's shared electrical state, and whether it just moved as one.
	 *
	 * Dormant rather than absent: with nobody else here there is no collective to
	 * have a state, and the honest answer is to say so and keep the wiring in
	 * place for the moment a second plant arrives. A mechanism that only exists
	 * once its preconditions are met is a mechanism nobody remembers to connect.
	 *
	 * @param   {object} [opts] - `{ tightness }`.
	 * @returns {Promise<object>} `{dormant}` or the collective reading.
	 */
	async collectiveReading( opts = {} ) {

		const { collectiveState, collectiveShift } = await import( '../signals/index.js' )

		const peers = await this.peers()

		if ( !peers.length ) {

			return {
				dormant : true,
				members : 1,
				why : 'A collective state needs somebody else to be collective with. This is dormant, not broken — it starts working the moment a second plant joins.',
			}

		}

		const { answers } = await this.askAll( 'sense.electrome-fingerprint' )

		const members = [
			{
				id : this.id,
				fingerprint : this.plant.perception?.electro?.fingerprint,
			},
			...answers.map( a => ( {
				id : a.peer,
				fingerprint : a.data?.fingerprint,
			} ) ),
		].filter( m => m.fingerprint )

		if ( members.length < 2 ) {

			return {
				dormant : true,
				members : members.length,
				why : `${peers.length} neighbour(s) are here but ${members.length < 1 ? 'nobody has' : 'only one has'} an electrode, so there is no shared electrical state to read. Attach electrodes to at least two plants.`,
			}

		}

		const state = collectiveState( members, opts )

		// A simultaneous shift across separate pots is the room, not contagion —
		// and it is caught more sensitively than any one plant could manage.
		const shift = this._lastCollective
			? collectiveShift( this._lastCollective, members, opts )
			: null

		this._lastCollective = members

		if ( shift?.shared && this.plant.body?.evidence ) {

			this.plant.body.evidence.add( {
				claim    : 'environmental_event',
				source   : 'colony',
				strength : 0.5,
				detail   : shift.verdict,
			} )

		}

		return {
			dormant : false,
			...state,
			shift,
		}

	}

	/**
	 * Ask the colony what resolved this problem for them.
	 *
	 * Useful in exactly the situation this plant cannot help itself with: a
	 * problem it has met once or twice, next to a neighbour that has met it
	 * twenty times.
	 *
	 * Three things make the difference between this being useful and it being a
	 * rumour mill.
	 *
	 * **Same species only.** What resolves drought in a succulent is not what
	 * resolves it in a fern, and a confident answer from the wrong species is
	 * worse than no answer.
	 *
	 * **The base rate travels with the answer.** "Watering worked every time" is
	 * not information. "Watering worked every time, and it cleared on its own
	 * nine times in ten anyway" is the same sentence meaning the opposite, and
	 * without the second half a neighbour's routine gets adopted as a cure.
	 *
	 * **The room is one witness.** Three neighbours agreeing is one room agreeing
	 * with itself — they share a window, a watering can and a human. They are
	 * pooled into a single finding rather than counted three times.
	 *
	 * @param   {string} problem - Claim id.
	 * @param   {object} [opts]  - `{ like }` conditions to match on.
	 * @returns {Promise<object>} `{known, action, lift, from, why}`.
	 */
	async askColonyWhatWorked( problem, opts = {} ) {

		const mySpecies = String( this.plant.memory.plant.species || '' ).toLowerCase().trim()

		if ( !mySpecies ) {

			return {
				known : false,
				why : 'This plant has no species set, so there is no way to know whose experience applies to it.',
			}

		}

		const { answers } = await this.askAll( 'consensus.what-worked', {
			problem,
			like : opts.like,
		} )

		const usable = answers
			.map( a => a.data )
			.filter( d => d?.known
				&& String( d.species || '' ).toLowerCase().trim() === mySpecies
				&& d.base?.known )

		if ( !usable.length ) {

			const wrongSpecies = answers.filter( a => a.data?.known
				&& String( a.data.species || '' ).toLowerCase().trim() !== mySpecies ).length

			return {
				known : false,
				asked : answers.length,
				why : wrongSpecies
					? `${wrongSpecies} neighbour(s) have met this problem, but none of them is a ${mySpecies}. What resolves it in another species is not evidence about this one.`
					: 'No neighbour has enough history with this problem — and enough episodes where nothing was done — to say anything useful about it.',
			}

		}

		// Pool every neighbour's episodes into one finding. Summing counts across
		// the room is the whole trap: it turns one shared routine into what looks
		// like independent replication.
		const pooled = new Map()
		let baseResolved = 0, baseTotal = 0

		for ( const d of usable ) {

			baseTotal += d.base.n
			baseResolved += Math.round( d.base.rate * d.base.n )

			for ( const a of d.actions ) {

				if ( !a.enough ) continue
				const prev = pooled.get( a.action ) || {
					n : 0,
					resolved : 0,
				}
				prev.n += a.n
				prev.resolved += Math.round( a.rate * a.n )
				pooled.set( a.action, prev )

			}

		}

		const baseRate = baseTotal ? baseResolved / baseTotal : 0

		const ranked = [ ...pooled.entries() ]
			.map( ( [ action, v ] ) => ( {
				action,
				n : v.n,
				rate : Number( ( v.resolved / v.n ).toFixed( 3 ) ),
				lift : Number( ( v.resolved / v.n - baseRate ).toFixed( 3 ) ),
			} ) )
			.sort( ( a, b ) => b.lift - a.lift )

		const best = ranked[ 0 ]

		if ( !best || best.lift < 0.25 ) {

			return {
				known : true,
				recommend : false,
				from : usable.length,
				baseRate : Number( baseRate.toFixed( 3 ) ),
				candidates : ranked,
				why : best
					? `${usable.length} neighbour(s) of the same species have met this. Their best was "${best.action}" at ${Math.round( best.rate * 100 )}%, against ${Math.round( baseRate * 100 )}% for doing nothing — they were mostly recovering anyway.`
					: `${usable.length} neighbour(s) have met this problem but none of them ever tried one thing on its own, so nothing can be credited.`,
			}

		}

		return {
			known      : true,
			recommend  : true,
			action     : best.action,
			lift       : best.lift,
			n          : best.n,
			from       : usable.length,
			baseRate   : Number( baseRate.toFixed( 3 ) ),
			candidates : ranked,
			// Capped hard and below what this plant's own history earns. It is
			// another pot, another drainage, another window.
			confidence : Number( Math.min( 0.45, best.lift ).toFixed( 3 ) ),
			why : `${usable.length} neighbour(s) of the same species pooled: "${best.action}" resolved it ${Math.round( best.rate * 100 )}% of the time against ${Math.round( baseRate * 100 )}% for waiting. This is another plant's pot, in another spot — worth trying, not worth trusting over this plant's own record.`,
		}

	}

	// ── helping each other ────────────────────────────────────────────────────

	/**
	 * Ask the colony for help.
	 *
	 * @param   {string} kind   - One of `AID`.
	 * @param   {object} [opts] - `{ metres }`.
	 * @returns {Promise<object>} `{offers, refusals}`.
	 */
	async askForHelp( kind, opts = {} ) {

		const { bioticStatus } = await import( './aid.js' )
		const mine = bioticStatus( this.plant )

		const peers = await this.peers()
		const replies = await Promise.all( peers.map( async peer => {

			const r = await this._sendAwaiting( peer, KIND.AID, {
				kind,
				from : this.id,
				// The asker declares its own state honestly, because the helper
				// cannot see it and the risk runs both ways.
				biotic : mine.biotic,
				canSee : mine.canSee,
				...opts,
			} ).catch( err => ( {
				accept : false,
				why : err.message,
			} ) )

			return {
				peer,
				...r,
			}

		} ) )

		return {
			offers   : replies.filter( r => r.accept ),
			refusals : replies.filter( r => !r.accept ),
		}

	}

	/**
	 * Is this plant in a colony?
	 *
	 * It always is — a `ColonyMember` only exists once `joinColony()` has run —
	 * but the flag was only ever tested for `=== false`, so reading it as a
	 * boolean returned `undefined` and every truthiness check quietly reported a
	 * connected plant as being on its own. It is a real property now, so both
	 * forms agree.
	 *
	 * @returns {boolean} Whether membership is live.
	 */
	get enabled() {

		return this._enabled !== false

	}

	set enabled( on ) {

		this._enabled = on

	}

	/** What this plant advertises about its own equipment. */
	get manifest() {

		return manifest( this.plant )

	}

	/**
	 * Which neighbours can answer a question about a given metric.
	 *
	 * @param   {string} metric - Metric name.
	 * @returns {object}        `{who, blind, unknown, why}`.
	 */
	whoCanRead( metric ) {

		return whoCanRead( this.manifests, metric )

	}

	/**
	 * Which neighbours could decode a pulsed optical message from this plant.
	 *
	 * @returns {object} `{who, why}`.
	 */
	opticalPeers() {

		return opticalPeers( this.manifest, this.manifests )

	}

	/**
	 * Could this plant signal that one with light?
	 *
	 * @param   {string} peer - Peer id.
	 * @returns {object}      `{can, why}`.
	 */
	canSignal( peer ) {

		return opticalLink( this.manifest, this.manifests.get( peer ) )

	}

	/**
	 * Tell the colony this plant has found something.
	 *
	 * The stand-in for a volatile. A plant that has found a pest cannot release
	 * methyl jasmonate that its neighbours will smell, so it says so over the
	 * channel and they look at themselves sooner.
	 *
	 * It goes out on suspicion rather than confirmation, which is the opposite of
	 * how the rest of this library treats uncertain findings. The asymmetry is the
	 * point: a false alarm costs a few unnecessary inspections and a missed one
	 * costs every plant in the room.
	 *
	 * @param   {object} [opts] - `{ near }`, a map of peer id to metres.
	 * @returns {Promise<object>} `{sent, alert, why}`.
	 */
	async warnNeighbours( opts = {} ) {

		const { primingAlert } = await import( './coupling.js' )
		const { bioticStatus } = await import( './aid.js' )

		const mine = bioticStatus( this.plant )
		const watch = this.plant._lastInfectionWatch

		const alert = primingAlert( {
			suspected : mine.biotic === true || Boolean( watch?.suspected ),
			confirmed : Boolean( this.plant.perception?.vision?.findings?.pests ),
			what : watch?.what ?? this.plant.perception?.vision?.findings?.pests ? 'pests' : null,
			from : this.id,
		} )

		if ( !alert ) return {
			sent : [],
			alert : null,
			why : mine.canSee
				? 'Nothing found on this plant, so there is nothing to warn anyone about.'
				: 'This plant has no camera. It cannot warn the colony about something it has no way to see, and a warning it cannot substantiate would train everyone to ignore the next one.',
		}

		const peers = ( await this.peers() ).filter( p => p !== this.id )
		const sent = []

		for ( const peer of peers ) {

			const metres = opts.near?.[ peer ]
			const forPeer = primingAlert( {
				suspected : true,
				confirmed : alert.confirmed,
				what : alert.what,
				from : this.id,
			}, { metres } )

			await this._send( peer, KIND.PRIMING, { alert : forPeer } ).catch( () => {} )
			sent.push( peer )

		}

		return {
			sent,
			alert,
			why : `Warned ${sent.length} plant${sent.length === 1 ? '' : 's'}. ${alert.why}`,
		}

	}

	/** Whether this plant has been warned by a neighbour, and how recently. */
	get primed() {

		return this._primed ?? null

	}

	/**
	 * What being close to a given peer is measurably doing to both of them.
	 *
	 * @param   {object} peer      - `{ reading, metres }` for the other plant.
	 * @param   {object} reference - A reading from outside the pair.
	 * @returns {Promise<object>}  From `couplingState`.
	 */
	async coupling( peer = {}, reference = null ) {

		const { couplingState } = await import( './coupling.js' )

		return couplingState( {
			a : this.plant.memory.lastReading ?? {},
			b : peer.reading ?? {},
			metres : peer.metres,
			sharedSubstrate : peer.sharedSubstrate,
		}, reference )

	}

	/**
	 * This plant's current value for whatever a session is judged on.
	 *
	 * Returns `undefined` rather than a substitute when the metric is not
	 * instrumented — a session with no way to check itself must not start, and a
	 * stand-in number would let it.
	 *
	 * @param   {object} session - An `AidSession`.
	 * @returns {number|undefined} The reading.
	 */
	_aidMetric( session ) {

		return this.plant.memory.lastReading?.[ session.metric ]

	}

	/**
	 * Open a live session for a piece of help that was accepted.
	 *
	 * From here until it closes the two plants are not acting separately: the
	 * helper streams what it is emitting, this plant streams what it is
	 * measuring, and this plant decides when enough has arrived.
	 *
	 * @param   {string} peer   - The helper.
	 * @param   {object} opts   - `{ kind, band, target, maxSeconds }`.
	 * @returns {Promise<object>} The session.
	 */
	async openAidSession( peer, opts = {} ) {

		const { AidSession } = await import( './session.js' )
		const { aidEffect } = await import( './aid.js' )

		const effect = opts.effect ?? aidEffect( opts.kind )

		const session = new AidSession( {
			...opts,
			effect,
			helper : peer,
			receiver : this.id,
		} )

		this.sessions ??= new Map()
		this.sessions.set( session.id, session )

		// The baseline has to come first, or nothing measured afterwards can be
		// told apart from the weather. Which metric depends on the kind of help.
		session.baseline( this._aidMetric( session ) )

		await this._sendAwaiting( peer, KIND.AID_OPEN, {
			session : session.id,
			kind : opts.kind,
			band : opts.band,
			maxSeconds : session.maxSeconds,
		} ).catch( () => null )

		return session

	}

	/**
	 * Push this plant's current measurement into a live session, and decide.
	 *
	 * @param   {string} id     - Session id.
	 * @param   {object} [opts] - `{ target, satisfied }`.
	 * @returns {Promise<object>} `{stop, delivered, why}`.
	 */
	async streamAid( id, opts = {} ) {

		const session = this.sessions?.get( id )
		if ( !session ) return {
			stop : true,
			why : `No open session "${id}".`,
		}

		session.measuring( { value : this._aidMetric( session ) } )

		// Tell the other side what arrived, so it is not acting blind either.
		await this._send( session.helper, KIND.AID_FRAME, {
			session : id,
			metric : session.metric,
			delivered : session.delivered,
			change : session.frames.at( -1 )?.change ?? null,
		} ).catch( () => {} )

		const verdict = session.shouldStop( opts )

		if ( verdict.stop ) {

			session.close( verdict.because, { why : verdict.why } )

			await this._send( session.helper, KIND.AID_CLOSE, {
				session : id,
				because : verdict.because,
				why : verdict.why,
			} ).catch( () => {} )

			this._record( {
				from : this.id,
				to : session.helper,
				kind : KIND.AID_CLOSE,
				text : `session ended (${verdict.because}): ${verdict.why}`,
			} )

		}

		return {
			...verdict,
			delivered : session.delivered,
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

			// Say who is asking, so the teacher can work out what it is entitled
			// to pass on rather than sending everything and hoping.
			const reply = await this._sendAwaiting( peer, KIND.ASK_LESSON, {
				species : this.plant.memory.plant.species,
				archetype : this.plant.archetype?.id,
			} ).catch( () => null )
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

		// Fan-out means a message can arrive twice, and here a duplicate acts: a
		// second copy of a request opens a second aid session, and a second pest
		// warning shortens an already shortened inspection interval again.
		if ( this.seen.duplicate( env ) ) return

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
			if ( env.body?.manifest ) this.manifests.set( env.from, env.body.manifest )
			this._record( {
				from : env.from,
				to : '*',
				kind : KIND.HELLO,
				text : `${env.body.name || env.from} joined, offering ${env.body.offers?.length ?? 0} skills`,
			} )
			return

		}

		if ( env.kind === KIND.AID_OPEN ) {

			const { AidSession } = await import( './session.js' )

			this.sessions ??= new Map()
			const session = new AidSession( {
				...env.body,
				helper : this.id,
				receiver : env.from,
			} )
			session.id = env.body.session
			// The helper has no ambient of its own to take: it is not the one
			// being lit. It starts running and reports what it emits.
			session.phase = 'running'
			session.startedAt = Date.now()
			this.sessions.set( session.id, session )

			this._record( {
				from : this.id,
				to : env.from,
				kind : KIND.AID_OPEN,
				text : `session ${session.id} open for ${env.body.kind}`,
			} )

			return this._reply( env, {
				ok : true,
				session : session.id,
			} )

		}

		if ( env.kind === KIND.AID_FRAME ) {

			const session = this.sessions?.get( env.body.session )
			// The emitter learns what actually arrived, which is the only way it
			// finds out its lamp is aimed at the wrong plant.
			if ( session ) session.emitting( { emitting : true } )
			return

		}

		if ( env.kind === KIND.AID_CLOSE ) {

			const session = this.sessions?.get( env.body.session )

			if ( session ) {

				session.close( env.body.because, { why : env.body.why } )
				this._record( {
					from : env.from,
					to : this.id,
					kind : KIND.AID_CLOSE,
					text : `asked to stop (${env.body.because}): ${env.body.why}`,
				} )

			}

			return

		}

		if ( env.kind === KIND.AID ) {

			const { considerRequest } = await import( './aid.js' )
			const decision = considerRequest( this.plant, env.body )

			this._record( {
				from : this.id,
				to : env.from,
				kind : KIND.AID,
				text : `${decision.accept ? 'offers' : 'declines'} ${env.body?.kind}: ${decision.why}`,
			} )

			return this._reply( env, decision )

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
				lesson : prepareLesson( this.plant, { for : {
					species : env.body?.species,
					archetype : env.body?.archetype,
				} } ),
			} )

		}

		if ( env.kind === KIND.PRIMING ) {

			const { receivePriming } = await import( './coupling.js' )
			const response = receivePriming( env.body?.alert )

			this._record( {
				from : env.from,
				to : this.id,
				kind : KIND.PRIMING,
				text : `warned of ${env.body?.alert?.what ?? 'something biotic'} nearby; looking within ${response.inspectWithin}h`,
			} )

			// Held rather than acted on. The plant raises how soon it looks at
			// itself; it does not treat itself for a neighbour's problem.
			this._primed = {
				...response,
				from : env.from,
				at : Date.now(),
			}

			return this._reply( env, {
				primed : response.prime,
				inspectWithin : response.inspectWithin,
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

			const answer = answerSkill( this.plant, env.body.skill, env.body.payload )
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

	async _send( to, kind, body, opts = {} ) {

		const env = {
			id   : nextId(),
			from : this.id,
			to,
			kind,
			body,
			at   : Date.now(),
		}

		// Until a second link is registered this behaves exactly as it did, with
		// one difference that matters: a failure is now reported instead of
		// disappearing into an empty catch.
		const report = await deliver( this._links(), env, {
			spool : this.spool,
			urgent : opts.urgent ?? URGENT.has( kind ),
		} )

		if ( !report.ok ) {

			this.undelivered.push( {
				at : env.at,
				kind,
				to,
				why : report.why,
			} )
			if ( this.undelivered.length > 50 ) this.undelivered.shift()

		}

		return report

	}

	/**
	 * The links this plant can speak over.
	 *
	 * The primary transport is always one. Anything added with `addLink` joins
	 * it, and a message goes out over every one worth trying.
	 *
	 * @returns {object[]} Links.
	 */
	_links() {

		if ( !this._primary ) {

			this._primary = link( this.transport, {
				name : 'primary',
				priority : 1,
			} )

		}

		return [ this._primary, ...this.links ]

	}

	/**
	 * Register another way of reaching the colony.
	 *
	 * @param   {object} transport - A `ColonyTransport`.
	 * @param   {object} [opts]    - `{ name, priority, costsSender, costsReceiver, emulated }`.
	 * @returns {object}           The link.
	 */
	addLink( transport, opts = {} ) {

		const l = link( transport, opts )
		this.links.push( l )
		return l

	}

	/**
	 * Try again with everything that could not be sent.
	 *
	 * Messages that have gone off are dropped rather than delivered — a "I am
	 * thirsty" two hours late waters a plant that was watered ninety minutes ago.
	 * What survives arrives marked late, carrying the time it was written.
	 *
	 * @returns {Promise<object>} `{sent, stillHeld, why}`.
	 */
	async retryUndelivered() {

		return drainSpool( this._links(), this.spool )

	}

	/** How the delivery layer is doing. */
	deliveryHealth() {

		return health( this._links(), this.spool )

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
export {
	capable, FACULTY, manifest, opticalLink, opticalPeers, RECEIVE_HZ, whoCanRead,
} from './capability.js'
export {
	BEACON, beaconMode, CARRIER, CRITICAL_CHARGE, decode, distress, frame,
	onDistress, prepare as prepareBeacon,
} from './beacon.js'
export {
	Breaker, candidates, DEFAULT_SHELF_LIFE, deliver, drainSpool, health as deliveryHealth,
	LINK, link, Seen, SHELF_LIFE, Spool, stillWorthIt,
} from './delivery.js'
export {
	considerAlert, PHASE as SECURITY_PHASE, protocol, relevance, RING, ringFor,
	UVB, uvbGate,
} from './security.js'
export { ColonyTransport, LoopbackBus } from './transport.js'
export { ColonyClient, ColonyServer } from './net.js'
export { AidSession, CLOSED, PHASE } from './session.js'
export {
	acceptLight, AID, AID_EFFECT, aidEffect, bioticStatus, canOffer, considerRequest,
	CONTACT_AID, crowdingRisk, proximitySafe, RECIPROCAL_AID,
} from './aid.js'
export {
	ACTIVE_LIGHT, airVpd, co2Depletion, COUPLING, COUPLING_RANGE, coupled,
	couplingState, pocket, primingAlert, receivePriming, shadeAvoidance, STAGNANT,
	substrateNotes,
} from './coupling.js'
export { LoopbackBus as Bus }
