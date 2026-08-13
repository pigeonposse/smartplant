/**
 * @smartplant/colony — plants talking to plants.
 *
 * A conversation channel over Bluetooth, or any transport. Two plants in the
 * same colony can simply talk: one asks, the other answers in its own voice,
 * from its own readings. Skills are the fast path through that conversation — a
 * named request that returns the fact itself instead of a sentence.
 *
 * The rule that keeps it honest is that a plant only says what it can measure.
 * Its vocabulary is derived from the drivers actually attached to it, so a plant
 * with no electrode does not report an electrical spike quietly or with low
 * confidence: the skill is not in its vocabulary, and the request comes back
 * refused with the reason. The refusal is itself informative — the asker learns
 * what this neighbour is blind to.
 *
 * And a room full of plants is one witness, not many. Neighbours share a window,
 * a radiator, a watering can and a human, so what they say enters the evidence
 * ledger under one source, never as N independent ones.
 *
 * **No person can speak here.** The channel is between plants; a human watches it
 * through `transcript()` and the `colony:message` event, and there is no method
 * that takes a sentence from someone and sends it as a plant. That is also why
 * this plugin declares no persona: personas are the register a plant uses to
 * address its owner, and nothing on this channel is addressed to an owner.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'colony',
	description : 'A conversation channel between plants, with 71 skills as the fast path for asking each other things.',
	schema      : {
		advice    : '',
		emoji     : '🗨',
		severity  : 'low',
		condition : '',
		confidence: 0,
	},

	async setup( plant, options ) {

		if ( !options.transport ) {

			throw new Error( 'The colony plugin needs a transport: use( colony, { transport: bus.endpoint( "ivy" ) } ). A LoopbackBus works with no radio at all.' )

		}

		await plant.joinColony( options )

	},

	async teardown() {

		// Leaving quietly is better than a peer waiting on a plant that is gone.
		await this.plant?.leaveColony().catch( () => {} )

	},

	methods : {

		/** Who else is in this colony right now. */
		async peers() {

			return this.plant.colony.peers()

		},

		/**
		 * Have this plant tell the colony how it is, in its own words.
		 *
		 * Takes no message: the line is composed from this plant's own readings.
		 * There is no way to hand it a sentence to say.
		 *
		 * @param   {object} [opts]    - `{ to }`. Omit `to` to address everyone.
		 * @returns {Promise<object|null>} The reply, or null for a broadcast.
		 */
		async report( opts = {} ) {

			return this.plant.colony.report( opts )

		},

		/**
		 * Ask a neighbour a named question.
		 *
		 * Named `askPeer` rather than `ask` because every plugin already has an
		 * `ask()` that puts a question to the AI. This one crosses the colony.
		 *
		 * @param   {string} peer    - Peer id.
		 * @param   {string} skill   - Skill id.
		 * @returns {Promise<object>} `{ok, data}` or `{ok: false, reason}`.
		 */
		async askPeer( peer, skill ) {

			return this.plant.colony.ask( peer, skill )

		},

		/**
		 * Ask everyone the same question.
		 *
		 * @param   {string} skill - Skill id.
		 * @returns {Promise<object>} `{answers, refusals}`.
		 */
		async askAll( skill ) {

			return this.plant.colony.askAll( skill )

		},

		/**
		 * What this plant can and cannot say, and why.
		 *
		 * @returns {object} `{speakable, mute, capabilities}`.
		 */
		lexicon() {

			return this.plant.colony.lexicon

		},

		/**
		 * Everything said so far, in order — the human's window onto the channel.
		 *
		 * A copy, because watching must not be a way to edit the record.
		 *
		 * @returns {object[]} The transcript.
		 */
		transcript() {

			return this.plant.colony.transcript.map( line => ( { ...line } ) )

		},

		/**
		 * Ask the colony something and turn the agreement into evidence.
		 *
		 * The one cue this returns is deliberate. Neighbours in a room are
		 * correlated observers of that room, so counting each as an independent
		 * source would let a single observation, repeated, walk a high-risk action
		 * through the ledger's corroboration gate.
		 *
		 * @param   {string}          skill   - What to ask.
		 * @param   {string}          claim   - What agreement would support.
		 * @returns {Promise<object>}         `{answers, refusals, cues}`.
		 */
		async corroborate( skill, claim ) {

			const { ColonyMember } = await import( 'smartplant/colony' )
			const { answers, refusals } = await this.plant.colony.askAll( skill )

			return {
				answers,
				refusals,
				cues : ColonyMember.cuesFrom( answers, claim ),
			}

		},

		/**
		 * A readable summary of who is here and what they can be asked.
		 *
		 * @returns {Promise<object>} `{peers, offers, blindSpots}`.
		 */
		async roll() {

			const peers = await this.plant.colony.peers()
			const mine  = this.plant.colony.lexicon

			return {
				peers,
				offers : Object.fromEntries(
					[ ...this.plant.colony.neighbours ].map( ( [ id, info ] ) => [ id, info.offers?.length ?? 0 ] ),
				),
				speak  : mine.speakable.length,
				// What this plant itself cannot answer, which is worth knowing
				// before relying on it as anybody's source.
				blindSpots : mine.mute.length,
			}

		},

	},
} )
