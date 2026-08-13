/**
 * Per-plant personalization.
 *
 * A generic model says a Monstera wants 200-800 lux. *This* Monstera, in this
 * flat, behind this particular blind, has a spot by the bookshelf where it
 * visibly does better — and no amount of species knowledge will find it.
 *
 * The approach: record every action and what happened after it, then use a
 * contextual bandit to choose among candidate actions with bounded exploration.
 * Bounded matters. Exploration on a living thing is not free, so the explorer
 * here is conservative by construction and every trial is a real experiment with
 * a control and a stopping rule.
 */

import { cosine, HashEmbedder } from '../knowledge/vectors.js'
import { PredictionLedger } from '../prediction/index.js'

/**
 * An episode: what the world looked like, what we did, and what came of it.
 *
 * @typedef {object} Episode
 * @property {string} plantId
 * @property {object} context   - Situation before the action.
 * @property {string} action    - What was done.
 * @property {object} [params]  - Action parameters.
 * @property {number} reward    - Outcome, −1..1.
 * @property {object} [outcome] - Structured result.
 */

/**
 * Reward from a change in plant wellbeing.
 *
 * Deliberately conservative and asymmetric: harm counts double. A system that
 * experiments on a plant should be more afraid of hurting it than eager to
 * improve it.
 *
 * @param   {number} before   - Wellbeing 0-100 before.
 * @param   {number} after    - Wellbeing 0-100 after.
 * @param   {object} [opts]   - Options.
 * @param   {number} [opts.cost] - Action cost, 0-1, subtracted from the reward.
 * @returns {number}          −1..1.
 */
export function wellbeingReward( before, after, opts = {} ) {

	if ( !Number.isFinite( before ) || !Number.isFinite( after ) ) return 0

	const delta = ( after - before ) / 100
	const shaped = delta >= 0 ? delta : delta * 2
	const cost = opts.cost ?? 0

	return Number( Math.min( 1, Math.max( -1, shaped - cost * 0.1 ) ).toFixed( 4 ) )

}

/**
 * Episodic store with similarity retrieval.
 *
 * "The last three times the room looked like this, moving to the window helped"
 * is a far better basis for a decision than a global average.
 */
export class EpisodicMemory {

	/**
	 * @param {object} [opts]           - Options.
	 * @param {object} [opts.embedder]  - Anything with `embed(text)`.
	 * @param {number} [opts.maxEpisodes] - Ring-buffer cap.
	 */
	constructor( opts = {} ) {

		this.embedder = opts.embedder || new HashEmbedder()
		this.maxEpisodes = opts.maxEpisodes ?? 2000
		/** @type {Episode[]} */
		this.episodes = []

	}

	get size() {

		return this.episodes.length

	}

	/**
	 * Record an episode.
	 *
	 * @param   {Episode}          episode - The episode.
	 * @returns {Promise<Episode>}         The stored episode.
	 */
	async record( episode ) {

		const text = describeContext( episode.context )
		const vector = await this.embedder.embed( text )

		const stored = {
			id      : `ep_${this.episodes.length + 1}`,
			at      : new Date().toISOString(),
			plantId : episode.plantId || 'default',
			action  : episode.action,
			params  : episode.params || {},
			reward  : Number( episode.reward ?? 0 ),
			outcome : episode.outcome || {},
			context : episode.context || {},
			text,
			vector,
		}

		this.episodes.push( stored )
		if ( this.episodes.length > this.maxEpisodes ) this.episodes.shift()

		return stored

	}

	/**
	 * Find episodes whose situation resembled this one.
	 *
	 * @param   {object}            context  - Current situation.
	 * @param   {object}            [opts]   - Options.
	 * @param   {number}            [opts.k] - How many.
	 * @param   {string}            [opts.action] - Only this action.
	 * @returns {Promise<object[]>}          Similar episodes with scores.
	 */
	async similar( context, opts = {} ) {

		const k = opts.k ?? 5
		const qv = await this.embedder.embed( describeContext( context ) )

		return this.episodes
			.filter( e => !opts.action || e.action === opts.action )
			.filter( e => !opts.plantId || e.plantId === opts.plantId )
			.map( e => ( {
				...e,
				similarity : Number( cosine( qv, e.vector ).toFixed( 4 ) ),
			} ) )
			.sort( ( a, b ) => b.similarity - a.similarity )
			.slice( 0, k )

	}

	/**
	 * Expected reward for an action in a situation, weighted by similarity.
	 *
	 * @param   {object}          context - Situation.
	 * @param   {string}          action  - Candidate action.
	 * @param   {object}          [opts]  - Options.
	 * @returns {Promise<object>}         `{expected, n, confidence}`.
	 */
	async expectedReward( context, action, opts = {} ) {

		const matches = await this.similar( context, {
			action,
			k : opts.k ?? 10,
			plantId : opts.plantId,
		} )
		const relevant = matches.filter( m => m.similarity >= ( opts.minSimilarity ?? 0.3 ) )

		if ( !relevant.length ) {

			return {
				expected : 0,
				n : 0,
				confidence : 0,
			}

		}

		const totalWeight = relevant.reduce( ( a, m ) => a + m.similarity, 0 )
		const expected = relevant.reduce( ( a, m ) => a + m.reward * m.similarity, 0 ) / totalWeight

		return {
			expected   : Number( expected.toFixed( 4 ) ),
			n          : relevant.length,
			// Confidence grows with evidence but saturates: ten similar episodes
			// is informative, a hundred is not ten times more so.
			confidence : Number( Math.min( 1, relevant.length / 10 ).toFixed( 3 ) ),
		}

	}

	toJSON() {

		return { episodes : this.episodes.map( e => ( {
			...e,
			vector : Array.from( e.vector ),
		} ) ) }

	}

	static fromJSON( data, opts = {} ) {

		const m = new EpisodicMemory( opts )
		for ( const e of data?.episodes || [] ) {

			m.episodes.push( {
				...e,
				vector : Float32Array.from( e.vector ),
			} )

		}
		return m

	}

}

/**
 * Contextual bandit over a fixed set of actions.
 *
 * Uses an upper-confidence-bound rule: prefer actions that look good *or* that
 * we know little about, with the exploration term scaled down hard so a plant is
 * never the subject of an aggressive search.
 */
export class ContextualBandit {

	/**
	 * @param {object}   [opts]              - Options.
	 * @param {string[]} [opts.actions]      - Candidate actions.
	 * @param {number}   [opts.exploration]  - UCB constant. Small on purpose.
	 * @param {object}   [opts.memory]       - An `EpisodicMemory`.
	 * @param {number}   [opts.minTrials]    - Trials before an action is trusted.
	 */
	constructor( opts = {} ) {

		this.actions = opts.actions || []
		this.exploration = opts.exploration ?? 0.3
		this.memory = opts.memory || new EpisodicMemory()
		this.minTrials = opts.minTrials ?? 3

		/** @type {Map<string, {n: number, sum: number}>} */
		this.stats = new Map( this.actions.map( a => [ a, {
			n : 0,
			sum : 0,
		} ] ) )
		this.totalTrials = 0

	}

	addAction( action ) {

		if ( !this.actions.includes( action ) ) {

			this.actions.push( action )
			this.stats.set( action, {
				n : 0,
				sum : 0,
			} )

		}
		return this

	}

	/**
	 * Choose an action for a situation.
	 *
	 * @param   {object}          context - Situation.
	 * @param   {object}          [opts]  - Options.
	 * @param   {boolean}         [opts.explore] - Allow exploration. Default true.
	 * @param   {string[]}        [opts.available] - Restrict the choice set.
	 * @returns {Promise<object>}         `{action, expected, reason, exploring}`.
	 */
	async choose( context, opts = {} ) {

		const candidates = opts.available || this.actions
		if ( !candidates.length ) {

			return {
				action : null,
				reason : 'No candidate actions.',
			}

		}

		const scored = []

		for ( const action of candidates ) {

			const stat = this.stats.get( action ) || {
				n : 0,
				sum : 0,
			}
			const episodic = await this.memory.expectedReward( context, action )

			// Blend the global average with the situation-specific estimate,
			// leaning on the episodic one when it has evidence behind it.
			const globalMean = stat.n ? stat.sum / stat.n : 0
			const blended = episodic.n
				? globalMean * ( 1 - episodic.confidence ) + episodic.expected * episodic.confidence
				: globalMean

			// UCB bonus for under-explored actions.
			const bonus = opts.explore === false
				? 0
				: this.exploration * Math.sqrt( Math.log( this.totalTrials + 1 ) / ( stat.n + 1 ) )

			scored.push( {
				action,
				mean       : Number( blended.toFixed( 4 ) ),
				bonus      : Number( bonus.toFixed( 4 ) ),
				ucb        : Number( ( blended + bonus ).toFixed( 4 ) ),
				trials     : stat.n,
				episodic,
				untested   : stat.n < this.minTrials,
			} )

		}

		scored.sort( ( a, b ) => b.ucb - a.ucb )
		const best = scored[ 0 ]
		const exploring = best.bonus > Math.abs( best.mean ) && best.untested

		return {
			action    : best.action,
			expected  : best.mean,
			confidence: best.episodic.confidence,
			exploring,
			reason    : exploring
				? `Trying "${best.action}" — only ${best.trials} trial(s) so far, so its value is still uncertain.`
				: `"${best.action}" has the best expected outcome (${best.mean >= 0 ? '+' : ''}${best.mean}) from ${best.episodic.n} similar situation(s).`,
			ranked    : scored,
		}

	}

	/**
	 * Record what happened.
	 *
	 * @param   {string}           action  - Action taken.
	 * @param   {number}           reward  - Outcome, −1..1.
	 * @param   {object}           context - Situation before.
	 * @param   {object}           [extra] - Extra episode fields.
	 * @returns {Promise<object>}          The stored episode.
	 */
	async update( action, reward, context, extra = {} ) {

		if ( !this.stats.has( action ) ) this.addAction( action )

		const stat = this.stats.get( action )
		stat.n++
		stat.sum += reward
		this.totalTrials++

		return this.memory.record( {
			...extra,
			action,
			reward,
			context,
		} )

	}

	/** What the bandit currently believes, best first. */
	report() {

		return [ ...this.stats.entries() ]
			.map( ( [ action, s ] ) => ( {
				action,
				trials : s.n,
				mean   : s.n ? Number( ( s.sum / s.n ).toFixed( 4 ) ) : null,
				trusted: s.n >= this.minTrials,
			} ) )
			.sort( ( a, b ) => ( b.mean ?? -Infinity ) - ( a.mean ?? -Infinity ) )

	}

}

/**
 * A controlled experiment with a stopping rule.
 *
 * "Move it 10cm and see" is only knowledge if there is a control period and a
 * criterion decided in advance. Otherwise it is a story told after the fact.
 */
export class Experiment {

	/**
	 * @param {object} [opts]                - Options.
	 * @param {string} [opts.name]           - What is being tested.
	 * @param {string} [opts.treatment]      - The action under test.
	 * @param {number} [opts.periodMs]       - Length of each phase.
	 * @param {number} [opts.minSamples]     - Samples needed per phase.
	 * @param {number} [opts.minEffect]      - Wellbeing points that count as real.
	 */
	constructor( opts = {} ) {

		this.name       = opts.name || 'experiment'
		this.treatment  = opts.treatment || 'treatment'
		this.periodMs   = opts.periodMs ?? 24 * 3600_000
		this.minSamples = opts.minSamples ?? 12
		this.minEffect  = opts.minEffect ?? 5

		this.phase   = 'control'
		this.startedAt = Date.now()
		this.control = []
		this.treated = []
		this.done    = false
		this.result  = null

	}

	/**
	 * Feed a wellbeing observation.
	 *
	 * @param   {number} wellbeing - 0-100.
	 * @returns {object}           `{phase, done, result}`.
	 */
	observe( wellbeing ) {

		if ( this.done || !Number.isFinite( wellbeing ) ) return this.status()

		const bucket = this.phase === 'control' ? this.control : this.treated
		bucket.push( wellbeing )

		const elapsed = Date.now() - this.startedAt
		const enough = bucket.length >= this.minSamples && elapsed >= this.periodMs

		if ( enough && this.phase === 'control' ) {

			this.phase = 'treatment'
			this.startedAt = Date.now()

		}
		else if ( enough && this.phase === 'treatment' ) {

			this._conclude()

		}

		return this.status()

	}

	_conclude() {

		const mean = a => a.reduce( ( x, y ) => x + y, 0 ) / a.length
		const sd = a => {

			const m = mean( a )
			return Math.sqrt( a.reduce( ( x, y ) => x + ( y - m ) ** 2, 0 ) / a.length )

		}

		const controlMean = mean( this.control )
		const treatedMean = mean( this.treated )
		const effect = treatedMean - controlMean

		// Pooled spread, so a noisy plant needs a bigger effect to convince us.
		const pooled = Math.sqrt( ( sd( this.control ) ** 2 + sd( this.treated ) ** 2 ) / 2 ) || 1e-9
		const effectSize = effect / pooled

		this.done = true
		this.phase = 'done'
		this.result = {
			controlMean : Number( controlMean.toFixed( 2 ) ),
			treatedMean : Number( treatedMean.toFixed( 2 ) ),
			effect      : Number( effect.toFixed( 2 ) ),
			effectSize  : Number( effectSize.toFixed( 3 ) ),
			significant : Math.abs( effect ) >= this.minEffect && Math.abs( effectSize ) >= 0.5,
			better      : effect > 0,
			n           : {
				control : this.control.length,
				treated : this.treated.length,
			},
		}

		this.result.verdict = this.result.significant
			? `"${this.treatment}" ${this.result.better ? 'helped' : 'hurt'}: wellbeing ${this.result.better ? '+' : ''}${this.result.effect} points (effect size ${this.result.effectSize}).`
			: `"${this.treatment}" made no clear difference (${this.result.effect} points, within noise). Keep the simpler option.`

	}

	status() {

		return {
			name   : this.name,
			phase  : this.phase,
			done   : this.done,
			samples: {
				control : this.control.length,
				treated : this.treated.length,
			},
			result : this.result,
		}

	}

}

/**
 * The façade: one object that learns what works for one specific plant.
 */
export class PlantPersonalization {

	/**
	 * @param {object}   [opts]          - Options.
	 * @param {string}   [opts.plantId]  - Identity for the profile.
	 * @param {string[]} [opts.actions]  - Candidate actions.
	 */
	constructor( opts = {} ) {

		this.plantId = opts.plantId || 'default'
		this.memory  = new EpisodicMemory( opts.memory || {} )
		this.bandit  = new ContextualBandit( {
			actions : opts.actions || [],
			memory  : this.memory,
			...opts.bandit,
		} )
		/** @type {Map<string, Experiment>} */
		this.experiments = new Map()
		/** What was predicted against what happened. */
		this.predictions = new PredictionLedger( opts.predictions || {} )
		this._pending = null

	}

	/**
	 * Decide what to try, given the situation.
	 *
	 * @param   {object}          context - Plant context.
	 * @param   {object}          [opts]  - Options.
	 * @returns {Promise<object>}         Choice with its reasoning.
	 */
	async suggest( context, opts = {} ) {

		const choice = await this.bandit.choose( summarize( context ), opts )

		this._pending = {
			action    : choice.action,
			context   : summarize( context ),
			wellbeing : context?.happiness,
			// The forecast, written down *before* acting. Without this there is no
			// way to tell "that did not work" from "my model of this plant is wrong".
			expected  : choice.expected,
			at        : Date.now(),
		}

		return choice

	}

	/**
	 * Report the outcome of the last suggestion.
	 *
	 * @param   {object}          context - Situation after.
	 * @param   {object}          [opts]  - `{ cost }`.
	 * @returns {Promise<object>}         `{reward, episode}`.
	 */
	async outcome( context, opts = {} ) {

		if ( !this._pending ) throw new Error( 'No pending suggestion to score. Call suggest() first.' )

		const reward = wellbeingReward( this._pending.wellbeing, context?.happiness, opts )

		const episode = await this.bandit.update(
			this._pending.action,
			reward,
			this._pending.context,
			{
				plantId : this.plantId,
				outcome : {
					before : this._pending.wellbeing,
					after  : context?.happiness,
					elapsedMs : Date.now() - this._pending.at,
				},
			},
		)

		const prediction = this.predictions.record( {
			action   : this._pending.action,
			expected : this._pending.expected,
			observed : reward,
			context  : this._pending.context,
		} )

		this._pending = null
		return {
			reward,
			episode,
			prediction,
			// Whether the model itself is off, which is a separate question from
			// whether the action was any good.
			calibration : this.predictions.calibration( episode?.action || prediction.action ),
		}

	}

	/**
	 * Start a controlled experiment.
	 *
	 * @param   {string}     treatment - Action under test.
	 * @param   {object}     [opts]    - `Experiment` options.
	 * @returns {Experiment}           The experiment.
	 */
	experiment( treatment, opts = {} ) {

		const exp = new Experiment( {
			...opts,
			treatment,
			name : opts.name || treatment,
		} )
		this.experiments.set( exp.name, exp )
		return exp

	}

	/** What has been learned about this plant. */
	profile() {

		return {
			plantId    : this.plantId,
			episodes   : this.memory.size,
			actions    : this.bandit.report(),
			experiments: [ ...this.experiments.values() ].map( e => e.status() ),
			calibration: this.predictions.report(),
		}

	}

	toJSON() {

		return {
			plantId : this.plantId,
			memory  : this.memory.toJSON(),
			stats   : Object.fromEntries( this.bandit.stats ),
			totalTrials : this.bandit.totalTrials,
		}

	}

	static fromJSON( data, opts = {} ) {

		const p = new PlantPersonalization( {
			...opts,
			plantId : data?.plantId,
		} )
		p.memory = EpisodicMemory.fromJSON( data?.memory, opts.memory )
		p.bandit.memory = p.memory
		for ( const [ action, stat ] of Object.entries( data?.stats || {} ) ) {

			p.bandit.addAction( action )
			p.bandit.stats.set( action, stat )

		}
		p.bandit.totalTrials = data?.totalTrials ?? 0
		return p

	}

}

/** Reduce a full context to the fields that define a *situation*. */
function summarize( ctx ) {

	return {
		hour       : new Date().getHours(),
		happiness  : ctx?.happiness,
		deviations : ( ctx?.deviations || [] ).map( d => `${d.metric}_${d.direction}` ),
		light      : ctx?.current?.light,
		soil       : ctx?.current?.soil,
		temperature: ctx?.current?.temperature,
	}

}

/** Render a situation as text, so the embedder can compare situations. */
function describeContext( ctx = {} ) {

	const parts = []
	if ( Number.isFinite( ctx.hour ) ) parts.push( `hour ${ctx.hour}` )
	if ( Number.isFinite( ctx.happiness ) ) parts.push( `wellbeing ${Math.round( ctx.happiness / 10 ) * 10}` )
	for ( const [ k, v ] of Object.entries( ctx ) ) {

		if ( [ 'hour', 'happiness', 'deviations' ].includes( k ) ) continue
		// Bucketed, not exact: 43% and 44% soil are the same situation.
		if ( Number.isFinite( v ) ) parts.push( `${k} ${Math.round( v / 10 ) * 10}` )

	}
	if ( ctx.deviations?.length ) parts.push( ctx.deviations.join( ' ' ) )
	return parts.join( ', ' ) || 'no context'

}
