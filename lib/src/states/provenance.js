/**
 * Who said what, on the strength of what, and when.
 *
 * There is no single place in this library that knows why the system currently
 * believes anything. Memory holds readings, the states hold conclusions, the
 * resolution ledger holds outcomes, continuity holds drift, the colony holds
 * what neighbours said — and each is a good record of its own half of the story.
 * Asking "what is the evidence for `defense_activation` right now, and where did
 * every piece of it come from" means going to five places and joining them by
 * hand.
 *
 * This is that join, kept as it happens rather than reconstructed afterwards.
 *
 * ## An index, not a graph database
 *
 * The tempting version is a general graph: nodes for everything, edges for every
 * relation, a query language over the top. It would be a rewrite of the spine of
 * the library, and it would be **slower** on the path that matters — with a few
 * thousand readings a linear scan is microseconds, and an index with node
 * objects and edge lists is not.
 *
 * So this is deliberately small: an append-only list of claims, with maps from
 * subject and source to positions in it. Two lookups are constant time and the
 * rest is a filter over a bounded list. It adds a place to write, not a new way
 * to store everything.
 *
 * ## What a claim is
 *
 * Something a layer concluded, plus what it concluded it from. Not a reading —
 * readings live in memory and this points at them. The distinction matters: a
 * second copy of the readings that drifts out of step with the first is worse
 * than no copy.
 *
 * The one thing this gets that nothing else has is **contradiction**. Two layers
 * concluding opposite things about the same subject is invisible today, because
 * each is right within its own view. Here they sit next to each other.
 */

/** What kind of thing a claim is about. */
export const SUBJECT = {
	STATE     : 'state',
	METRIC    : 'metric',
	PROBLEM   : 'problem',
	INSTRUMENT : 'instrument',
	NEIGHBOUR : 'neighbour',
}

const finite = Number.isFinite

/**
 * An append-only record of what each layer concluded and why.
 */
export class Provenance {

	/**
	 * @param {object} [opts] - `{ max }`.
	 */
	constructor( opts = {} ) {

		// Bounded, because this runs for months on a Pi. Old claims fall off the
		// front; the conclusions they supported live in their own layers.
		this.max = opts.max ?? 2000
		this.claims = []
		/** subject → indices into `claims`. */
		this.bySubject = new Map()
		/** source layer → indices. */
		this.bySource = new Map()
		this._dropped = 0

	}

	get size() {

		return this.claims.length

	}

	/**
	 * Record that a layer concluded something.
	 *
	 * @param   {object} claim - `{subject, kind, source, says, confidence, because, at}`.
	 * @returns {object|null}  The stored claim.
	 */
	add( claim ) {

		if ( !claim?.subject || !claim?.source ) return null

		const entry = {
			subject : String( claim.subject ),
			kind : claim.kind ?? SUBJECT.STATE,
			source : String( claim.source ),
			says : claim.says ?? null,
			confidence : finite( claim.confidence ) ? claim.confidence : null,
			// What it was concluded from. Pointers, not copies — a second copy of
			// the readings that drifts out of step is worse than none.
			because : Array.isArray( claim.because ) ? claim.because : [],
			at : claim.at ?? Date.now(),
		}

		this.claims.push( entry )
		this._index( entry, this.claims.length - 1 )

		if ( this.claims.length > this.max ) this._trim()

		return entry

	}

	_index( entry, at ) {

		for ( const [ map, key ] of [ [ this.bySubject, entry.subject ], [ this.bySource, entry.source ] ] ) {

			const list = map.get( key ) ?? []
			list.push( at )
			map.set( key, list )

		}

	}

	_trim() {

		// Drop the oldest tenth in one go rather than one at a time, so the
		// reindex happens rarely instead of on every append.
		const cut = Math.floor( this.max / 10 )
		this.claims = this.claims.slice( cut )
		this._dropped += cut

		this.bySubject = new Map()
		this.bySource = new Map()
		this.claims.forEach( ( c, i ) => this._index( c, i ) )

	}

	/**
	 * Everything currently claimed about one subject.
	 *
	 * @param   {string} subject - What to ask about.
	 * @param   {object} [opts]  - `{ since, source }`.
	 * @returns {object[]}       Claims, newest last.
	 */
	about( subject, opts = {} ) {

		opts = opts ?? {}

		const idx = this.bySubject.get( String( subject ) ) ?? []
		let out = idx.map( i => this.claims[ i ] ).filter( Boolean )

		if ( finite( opts.since ) ) out = out.filter( c => c.at >= opts.since )
		if ( opts.source ) out = out.filter( c => c.source === opts.source )

		return out

	}

	/** Everything one layer has said. */
	from( source, opts = {} ) {

		const idx = this.bySource.get( String( source ) ) ?? []
		const out = idx.map( i => this.claims[ i ] ).filter( Boolean )

		return finite( opts?.since ) ? out.filter( c => c.at >= opts.since ) : out

	}

	/**
	 * Where two layers disagree about the same subject.
	 *
	 * The one thing this index has that no individual layer can: each of them is
	 * right within its own view, and nothing has ever put them side by side.
	 *
	 * @param   {object} [opts] - `{ since }`. Default the last six hours.
	 * @returns {object[]}      Disagreements.
	 */
	contradictions( opts = {} ) {

		const since = opts?.since ?? Date.now() - 6 * 3600_000
		const out = []

		for ( const subject of this.bySubject.keys() ) {

			const recent = this.about( subject, { since } )
			if ( recent.length < 2 ) continue

			// Latest claim per source, so a layer that changed its mind is not
			// counted as disagreeing with itself.
			const latest = new Map()
			for ( const c of recent ) latest.set( c.source, c )

			const values = [ ...latest.values() ]
			if ( values.length < 2 ) continue

			const said = new Set( values.map( v => JSON.stringify( v.says ) ) )
			if ( said.size < 2 ) continue

			out.push( {
				subject,
				sources : values.map( v => ( {
					source : v.source,
					says : v.says,
					confidence : v.confidence,
					at : v.at,
				} ) ),
				why : `${values.map( v => `${v.source} says ${JSON.stringify( v.says )}` ).join( ' and ' )}. Each is right within its own view — that is why this is invisible from inside either of them — and one of them is working from something the other has not got.`,
			} )

		}

		return out

	}

	/**
	 * The case for something, as it currently stands.
	 *
	 * @param   {string} subject - What to ask about.
	 * @param   {object} [opts]  - `{ since }`.
	 * @returns {object}         `{subject, claims, sources, why}`.
	 */
	caseFor( subject, opts = {} ) {

		const claims = this.about( subject, opts )

		if ( !claims.length ) {

			return {
				subject,
				claims : [],
				sources : [],
				why : `Nothing has been recorded about "${subject}". Which is different from nothing being true about it — this only holds what a layer bothered to write down.`,
			}

		}

		const sources = [ ...new Set( claims.map( c => c.source ) ) ]
		const latest = claims.at( -1 )

		return {
			subject,
			claims,
			sources,
			latest,
			why : `${claims.length} claim${claims.length === 1 ? '' : 's'} from ${sources.length} source${sources.length === 1 ? '' : 's'} (${sources.join( ', ' )}). Most recent: ${latest.source} says ${JSON.stringify( latest.says )}${latest.because.length ? `, on ${latest.because.join( ', ' )}` : ''}.`,
		}

	}

	report() {

		return {
			claims : this.claims.length,
			subjects : this.bySubject.size,
			sources : [ ...this.bySource.keys() ],
			dropped : this._dropped,
			contradictions : this.contradictions().length,
			why : this.claims.length
				? `${this.claims.length} claims about ${this.bySubject.size} subjects from ${this.bySource.size} layers.`
				: 'Nothing recorded yet. This fills in as the layers reach conclusions.',
		}

	}

	toJSON() {

		return {
			max : this.max,
			claims : this.claims,
		}

	}

}

/**
 * Write everything the current states and inferences concluded.
 *
 * Called once per cycle rather than at every conclusion, so the index is a
 * snapshot of what was believed at a moment rather than a stream of everything
 * that crossed anybody's mind.
 *
 * @param   {object} plant       - A `SmartPlant`.
 * @param   {object} provenance  - A `Provenance`.
 * @returns {number}             How many claims were written.
 */
export function record( plant, provenance ) {

	if ( !provenance ) return 0

	let n = 0
	const at = Date.now()

	const states = safely( () => plant?.states?.() ) ?? {}

	for ( const [ name, state ] of Object.entries( states ) ) {

		if ( !state?.level ) continue

		provenance.add( {
			subject : name,
			kind : SUBJECT.STATE,
			source : 'states',
			says : state.level,
			confidence : state.confidence === 'high' ? 0.85 : state.confidence === 'medium' ? 0.6 : 0.3,
			because : ( state.evidence ?? [] ).map( e => e?.signal ?? e?.detail ).filter( Boolean ),
			at,
		} )
		n++

	}

	const drift = safely( () => plant?.continuity?.attribute?.() )

	if ( drift?.cause ) {

		provenance.add( {
			subject : 'electrode',
			kind : SUBJECT.INSTRUMENT,
			source : 'continuity',
			says : drift.cause,
			because : [ 'multi-site agreement' ],
			at,
		} )
		n++

	}

	const maintenance = safely( () => plant?.maintenance?.() )

	if ( maintenance?.condition ) {

		provenance.add( {
			subject : 'electrode',
			kind : SUBJECT.INSTRUMENT,
			source : 'maintenance',
			says : maintenance.condition,
			because : ( maintenance.findings ?? [] ).map( f => f?.what ).filter( Boolean ),
			at,
		} )
		n++

	}

	return n

}

function safely( fn ) {

	try {

		return fn()

	}
	catch {

		return null

	}

}
