/**
 * Evidence and confidence.
 *
 * The layer that stops the body over-reading or ignoring the plant.
 *
 * Over-reading looks like: one noisy soil sample dips, the robot drives across
 * the room. Ignoring looks like: the plant has been wilting for two days and
 * nothing acts because no single reading crossed a threshold.
 *
 * Both are failures of *evidence*, not of sensing. The fix is to require
 * independent corroboration proportional to how costly the action is, and to
 * keep the reasoning legible so a human can correct it.
 */

/** How much evidence an action needs, by how hard it is to undo. */
export const RISK = {
	// Reversible, cheap, no contact with the plant.
	LOW      : {
		name : 'low',
		minScore : 0.35,
		minCues : 1,
		minPersistenceMs : 0,
	},
	// Costs energy or touches the plant, but recoverable.
	MEDIUM   : {
		name : 'medium',
		minScore : 0.55,
		minCues : 2,
		minPersistenceMs : 5 * 60_000,
	},
	// Hard or impossible to undo: a big watering, a relocation, pruning.
	HIGH     : {
		name : 'high',
		minScore : 0.75,
		minCues : 2,
		minPersistenceMs : 30 * 60_000,
	},
	// Needs a human.
	CRITICAL : {
		name : 'critical',
		minScore : 0.9,
		minCues : 3,
		minPersistenceMs : 60 * 60_000,
		requiresHuman : true,
	},
}

/**
 * A single piece of evidence.
 *
 * @typedef {object} Cue
 * @property {string} source     - Where it came from: `'soil'`, `'vision'`, `'electro'`, `'reasoner'`.
 * @property {string} claim      - What it supports, e.g. `'drought_stress'`.
 * @property {number} strength   - 0-1, how strongly this cue supports the claim.
 * @property {number} [since]    - Epoch ms since when this has held.
 * @property {string} [detail]   - Human-readable justification.
 */

export class EvidenceLedger {

	/**
	 * @param {object} [opts]            - Options.
	 * @param {object} [opts.weights]    - Per-source trust, 0-1.
	 * @param {number} [opts.decayMs]    - Cues older than this stop counting.
	 */
	constructor( opts = {} ) {

		// Independent modalities are weighted by how directly they observe the
		// thing being claimed. Vision sees the plant; a rule only sees numbers.
		this.weights = {
			soil     : 1,
			humidity : 0.8,
			temperature : 0.9,
			light    : 0.9,
			vision   : 1,
			electro  : 0.9,
			reasoner : 0.7,
			ai       : 0.5,
			human    : 1,
			...opts.weights,
		}

		this.decayMs = opts.decayMs ?? 6 * 3600_000
		/** @type {Cue[]} */
		this.cues = []
		/** Human corrections, used to retune weights. */
		this.feedback = []

	}

	/**
	 * Record a cue.
	 *
	 * @param   {Cue}   cue - The cue.
	 * @returns {Cue}       The stored cue.
	 */
	add( cue ) {

		const stored = {
			source   : cue.source || 'unknown',
			claim    : cue.claim,
			strength : Math.min( 1, Math.max( 0, cue.strength ?? 0.5 ) ),
			since    : cue.since ?? Date.now(),
			at       : Date.now(),
			detail   : cue.detail || '',
		}

		// Re-asserting the same claim from the same source updates it rather than
		// stacking, otherwise a chatty sensor manufactures its own consensus.
		const existing = this.cues.findIndex( c => c.source === stored.source && c.claim === stored.claim )
		if ( existing >= 0 ) {

			stored.since = this.cues[ existing ].since
			this.cues[ existing ] = stored

		}
		else this.cues.push( stored )

		return stored

	}

	/** Live cues for a claim, oldest evidence first. */
	forClaim( claim, now = Date.now() ) {

		return this.cues
			.filter( c => c.claim === claim && now - c.at <= this.decayMs )
			.sort( ( a, b ) => a.since - b.since )

	}

	/**
	 * Weighted support for a claim, 0-1.
	 *
	 * Combined with noisy-OR rather than a sum: two independent 0.6 cues should
	 * produce strong support, but no amount of weak evidence should ever reach
	 * certainty.
	 *
	 * @param   {string} claim - The claim.
	 * @returns {object}       `{score, cues, sources, persistenceMs}`.
	 */
	score( claim, now = Date.now() ) {

		const cues = this.forClaim( claim, now )
		if ( !cues.length ) {

			return {
				score : 0,
				cues : [],
				sources : [],
				persistenceMs : 0,
			}

		}

		let inverse = 1
		for ( const cue of cues ) {

			const weight = this.weights[ cue.source ] ?? 0.5
			inverse *= 1 - cue.strength * weight

		}

		const sources = [ ...new Set( cues.map( c => c.source ) ) ]
		const oldest = Math.min( ...cues.map( c => c.since ) )

		return {
			score         : Number( ( 1 - inverse ).toFixed( 4 ) ),
			cues,
			sources,
			persistenceMs : now - oldest,
		}

	}

	/**
	 * Is there enough evidence to act?
	 *
	 * @param   {string} claim  - What is claimed.
	 * @param   {object} [risk] - A `RISK` level. Default MEDIUM.
	 * @returns {object}        `{allowed, score, explanation, missing}`.
	 */
	isEnough( claim, risk = RISK.MEDIUM ) {

		const {
			score, sources, persistenceMs,
		} = this.score( claim )
		const missing = []

		if ( score < risk.minScore ) {

			missing.push( `evidence ${score.toFixed( 2 )} below the ${risk.minScore} needed for ${risk.name}-risk actions` )

		}
		if ( sources.length < risk.minCues ) {

			missing.push( `only ${sources.length} independent source(s), needs ${risk.minCues}` )

		}
		if ( persistenceMs < risk.minPersistenceMs ) {

			const needMin = Math.round( risk.minPersistenceMs / 60_000 )
			const haveMin = Math.round( persistenceMs / 60_000 )
			missing.push( `condition has held ${haveMin}min, needs ${needMin}min` )

		}
		if ( risk.requiresHuman ) missing.push( 'needs human confirmation' )

		const allowed = missing.length === 0

		return {
			allowed,
			score,
			sources,
			persistenceMs,
			missing,
			explanation : this.explain( claim, risk ),
		}

	}

	/**
	 * Plain-language account of why the system does or does not believe a claim.
	 *
	 * This is the artefact a human reads to decide whether to trust the system —
	 * and to correct it when it is wrong.
	 *
	 * @param   {string} claim  - The claim.
	 * @param   {object} [risk] - Risk level.
	 * @returns {string}        Explanation.
	 */
	explain( claim, risk = RISK.MEDIUM ) {

		const {
			score, cues, sources, persistenceMs,
		} = this.score( claim )

		if ( !cues.length ) return `No evidence for "${claim}".`

		const lines = [
			`"${claim}" — confidence ${( score * 100 ).toFixed( 0 )}% from ${sources.length} independent source(s), held for ${Math.round( persistenceMs / 60_000 )}min:`,
		]

		for ( const cue of cues ) {

			const weight = this.weights[ cue.source ] ?? 0.5
			lines.push( `  · ${cue.source} (trust ${weight}): ${cue.detail || cue.claim} [${cue.strength.toFixed( 2 )}]` )

		}

		lines.push( `  → ${risk.name}-risk actions need ${risk.minScore} from ${risk.minCues} source(s)` )

		return lines.join( '\n' )

	}

	/**
	 * Record a human verdict on an action, and nudge the weights of the sources
	 * that argued for it.
	 *
	 * The adjustment is deliberately small: one correction is an opinion, a
	 * pattern of corrections is a signal.
	 *
	 * @param   {string}  claim   - The claim that was acted on.
	 * @param   {boolean} correct - Whether the action was right.
	 * @param   {string}  [note]  - Free text.
	 * @returns {object}          `{adjusted}` — source → new weight.
	 */
	recordFeedback( claim, correct, note = '' ) {

		const cues = this.forClaim( claim )
		const adjusted = {}
		const delta = correct ? 0.02 : -0.05

		for ( const source of new Set( cues.map( c => c.source ) ) ) {

			const current = this.weights[ source ] ?? 0.5
			// Clamped well away from 0: a source that is wrong sometimes should be
			// discounted, never silenced entirely.
			const next = Math.min( 1, Math.max( 0.1, current + delta ) )
			this.weights[ source ] = Number( next.toFixed( 3 ) )
			adjusted[ source ] = this.weights[ source ]

		}

		this.feedback.push( {
			at : new Date().toISOString(),
			claim,
			correct,
			note,
			adjusted,
		} )

		return { adjusted }

	}

	/** Drop expired cues. */
	prune( now = Date.now() ) {

		const before = this.cues.length
		this.cues = this.cues.filter( c => now - c.at <= this.decayMs )
		return before - this.cues.length

	}

	/**
	 * Build cues automatically from a plant context and its reasoning.
	 *
	 * This is what makes corroboration real rather than aspirational: one call
	 * turns every modality into independently-sourced evidence.
	 *
	 * @param   {object} ctx         - Plant context.
	 * @param   {object} [reasoning] - Output of `plant.diagnose()`.
	 * @returns {Cue[]}              The cues added.
	 */
	ingest( ctx, reasoning ) {

		const added = []

		for ( const dev of ctx?.deviations || [] ) {

			const claim = `${dev.metric}_${dev.direction}`
			added.push( this.add( {
				source   : dev.metric,
				claim,
				// A reading barely outside its band is weak evidence; deep outside is strong.
				strength : 1 - dev.score / 100,
				detail   : `${dev.metric} at ${dev.value}${dev.unit} (ideal ${dev.range.min}-${dev.range.max})`,
			} ) )

		}

		if ( ctx?.vision?.phenotype ) {

			const t = ctx.vision.phenotype.tissue
			if ( t?.chlorotic > 0.1 ) {

				added.push( this.add( {
					source   : 'vision',
					claim    : 'chlorosis',
					strength : Math.min( 1, t.chlorotic * 3 ),
					detail   : `${( t.chlorotic * 100 ).toFixed( 0 )}% of canopy yellowing`,
				} ) )

			}
			if ( ctx.vision.change?.droopDelta > 0.02 ) {

				added.push( this.add( {
					source   : 'vision',
					claim    : 'soil_low',
					strength : 0.6,
					detail   : 'canopy dropped between frames',
				} ) )

			}

		}

		if ( ctx?.electro?.summary?.damageSignal ) {

			added.push( this.add( {
				source   : 'electro',
				claim    : 'tissue_damage',
				strength : 0.7,
				detail   : 'variation potential detected',
			} ) )

		}

		for ( const c of reasoning?.conclusions || [] ) {

			added.push( this.add( {
				source   : 'reasoner',
				claim    : c.conclusion,
				strength : c.confidence,
				detail   : c.because[ 0 ] || c.conclusion,
			} ) )

		}

		return added

	}

}

/**
 * Shadow-mode comparator.
 *
 * Runs a candidate policy alongside the live one without letting it act, and
 * reports where they disagree. The only honest way to gain confidence in a new
 * model on a system that can hurt a living thing.
 */
export class ShadowMode {

	constructor( opts = {} ) {

		this.name = opts.name || 'candidate'
		this.maxRecords = opts.maxRecords ?? 500
		this.records = []

	}

	/**
	 * Record a decision pair.
	 *
	 * @param   {*} live      - What the live policy chose.
	 * @param   {*} candidate - What the shadow policy would have chosen.
	 * @param   {object} [ctx] - Context, for later review.
	 * @returns {object}      `{agreed}`.
	 */
	compare( live, candidate, ctx = {} ) {

		const agreed = JSON.stringify( live ) === JSON.stringify( candidate )

		this.records.push( {
			at : new Date().toISOString(),
			agreed,
			live,
			candidate,
			ctx,
		} )
		if ( this.records.length > this.maxRecords ) this.records.shift()

		return { agreed }

	}

	/** Agreement rate and the disagreements worth reviewing. */
	report() {

		const total = this.records.length
		const agreed = this.records.filter( r => r.agreed ).length

		return {
			name         : this.name,
			total,
			agreed,
			agreementRate: total ? Number( ( agreed / total ).toFixed( 3 ) ) : null,
			disagreements: this.records.filter( r => !r.agreed ).slice( -20 ),
		}

	}

}
