/**
 * Whether the coupling is getting better or worse.
 *
 * Everything else here measures the plant. This measures the *pairing* — how
 * well the system and the plant have come to fit each other — and it is the only
 * thing in the library that can answer "is this working better than it was three
 * months ago", which is the question somebody actually has after three months.
 *
 * ## It has to change something, or it is a diary
 *
 * This library's rule is that a state only exists if it changes a decision, and
 * a log of how things have been going does not obviously qualify. It earns its
 * place two ways.
 *
 * A trajectory that is **degrading on every axis at once** is the signature of a
 * plant that is genuinely declining, and it is visible here months before it is
 * visible in any single reading — that is the whole reason for keeping a slow
 * record rather than a fast one.
 *
 * A trajectory that is degrading on the *instrument* axes while the plant's own
 * axes hold steady is the opposite finding, and it is the more common one: the
 * electrode is ageing, not the plant. Those two look identical in any single
 * snapshot and completely different over a season.
 *
 * ## What is deliberately not in it
 *
 * Anything that can be recomputed. This stores conclusions, not readings — the
 * readings are already stored, and a second copy that drifts out of step with
 * the first is worse than no copy. Each entry is what the system believed about
 * itself at that moment, which is exactly the thing that cannot be recomputed
 * later because the code will have changed.
 */

/** The axes, and which side of the pairing each one is about. */
export const AXIS = {
	states : {
		side : 'plant',
		better : 'down',
		why : 'How much of the time the plant was in a raised internal state. Lower is a plant with less going on.',
	},
	predictionError : {
		side : 'model',
		better : 'down',
		why : 'How wrong the system was about what would happen. The clearest single measure of the model fitting this particular plant.',
	},
	refusalRate : {
		side : 'model',
		better : 'down',
		why : 'How often the system declined to do something. A rising refusal rate on a healthy plant is a system becoming timid rather than a plant becoming fragile.',
	},
	falsePositives : {
		side : 'model',
		better : 'down',
		why : 'How often a refusal was overridden and nothing went wrong. The only direct measure of the system being wrong about itself.',
	},
	electrodeDrift : {
		side : 'instrument',
		better : 'down',
		why : 'Drift attributed to the electrode rather than to the plant. Rises as a contact ages, and says nothing about the plant.',
	},
	assessable : {
		side : 'instrument',
		better : 'up',
		why : 'How many internal states could be assessed at all. Falls when an instrument stops reporting, which is the quietest way a rig degrades.',
	},
}

const finite = Number.isFinite

/**
 * One entry: what the system believed about itself at a moment.
 *
 * @param   {object} plant - A `SmartPlant`.
 * @returns {object}       The entry.
 */
export function snapshotTrajectory( plant ) {

	plant = plant ?? {}

	const states = safely( () => plant.states?.() ) ?? {}
	const values = Object.values( states )

	const raised = values.filter( s => s.level === 'medium' || s.level === 'high' ).length
	const assessable = values.filter( s => s.level !== 'unknown' ).length

	const predictions = safely( () => plant.body?.personalization?.predictions?.report?.() )
	const calibration = safely( () => plant.calibration?.report?.() )
	const drift = safely( () => plant.continuity?.attribute?.() )

	const falsePositives = calibration?.states?.filter( s => s.known )
	const fpRate = falsePositives?.length
		? falsePositives.reduce( ( a, s ) => a + ( s.rate ?? 0 ), 0 ) / falsePositives.length
		: null

	return {
		at : Date.now(),
		readings : plant.memory?.data?.readings?.length ?? 0,

		states : values.length ? Number( ( raised / values.length ).toFixed( 3 ) ) : null,
		assessable : values.length ? Number( ( assessable / values.length ).toFixed( 3 ) ) : null,
		predictionError : finite( predictions?.meanAbsolute ) ? Number( predictions.meanAbsolute.toFixed( 3 ) ) : null,
		refusalRate : finite( plant._refusalRate ) ? Number( plant._refusalRate.toFixed( 3 ) ) : null,
		falsePositives : finite( fpRate ) ? Number( fpRate.toFixed( 3 ) ) : null,
		electrodeDrift : drift?.cause === 'electrode' ? 1 : drift?.cause ? 0 : null,
	}

}

function safely( fn ) {

	try {

		return fn()

	}
	catch {

		return null

	}

}

/**
 * The log itself.
 */
export class Trajectory {

	/**
	 * @param {object} [opts] - `{ everyMs, max }`.
	 */
	constructor( opts = {} ) {

		// Weekly by default. A trajectory sampled daily is a reading; the point of
		// this one is that it is slower than anything it describes.
		this.everyMs = opts.everyMs ?? 7 * 86_400_000
		this.max = opts.max ?? 260
		this.entries = opts.entries ?? []

	}

	/** Whether enough time has passed to take another. */
	due( at = Date.now() ) {

		const last = this.entries.at( -1 )
		return !last || at - last.at >= this.everyMs

	}

	/**
	 * Take one, if it is time.
	 *
	 * @param   {object} plant - A `SmartPlant`.
	 * @param   {object} [opts] - `{ force }`.
	 * @returns {object|null}  The entry, or null if it was not due.
	 */
	record( plant, opts = {} ) {

		if ( !opts.force && !this.due() ) return null

		const entry = snapshotTrajectory( plant )
		this.entries.push( entry )
		if ( this.entries.length > this.max ) this.entries.shift()

		return entry

	}

	/**
	 * Then against now.
	 *
	 * @param   {object} [opts] - `{ span }` how many entries back. Default 12.
	 * @returns {object}        `{known, axes, verdict, why}`.
	 */
	compare( opts = {} ) {

		const span = opts.span ?? 12

		if ( this.entries.length < 4 ) {

			return {
				known : false,
				entries : this.entries.length,
				why : `${this.entries.length} entries. This is the one part of the library that cannot be hurried — a trajectory is the shape of months, and four points is not a shape.`,
			}

		}

		const now = this.entries.slice( -Math.max( 2, Math.floor( span / 4 ) ) )
		const then = this.entries.slice( 0, Math.max( 2, Math.floor( span / 4 ) ) )

		const axes = {}

		for ( const [ name, axis ] of Object.entries( AXIS ) ) {

			const a = mean( then.map( e => e[ name ] ) )
			const b = mean( now.map( e => e[ name ] ) )

			if ( !finite( a ) || !finite( b ) ) {

				axes[ name ] = {
					known : false,
					why : `Never recorded on both ends — ${axis.why.split( '.' )[ 0 ].toLowerCase()} was not measurable then, now, or either.`,
				}
				continue

			}

			const delta = b - a
			const improving = axis.better === 'down' ? delta < -0.02 : delta > 0.02
			const worsening = axis.better === 'down' ? delta > 0.02 : delta < -0.02

			axes[ name ] = {
				known : true,
				side : axis.side,
				from : Number( a.toFixed( 3 ) ),
				to : Number( b.toFixed( 3 ) ),
				direction : improving ? 'better' : worsening ? 'worse' : 'flat',
			}

		}

		const known = Object.entries( axes ).filter( ( [ , v ] ) => v.known )
		const worse = known.filter( ( [ , v ] ) => v.direction === 'worse' )
		const bySide = side => worse.filter( ( [ , v ] ) => v.side === side ).length
		const totalSide = side => known.filter( ( [ , v ] ) => v.side === side ).length

		// The distinction the whole log exists for.
		const instrumentOnly = totalSide( 'instrument' ) > 0
			&& bySide( 'instrument' ) === totalSide( 'instrument' )
			&& bySide( 'plant' ) === 0

		let verdict = 'steady'
		let why = 'Nothing has moved much in either direction. Which is what most of them look like, and is not a failure of the record.'

		if ( instrumentOnly ) {

			verdict = 'instrument'
			why = 'The instrument axes are degrading and the plant\'s own are not. This is an electrode ageing rather than a plant declining — the two are indistinguishable in any single snapshot and completely different over a season, and telling them apart is the reason for keeping this at all.'

		}
		else if ( worse.length >= Math.ceil( known.length / 2 ) ) {

			verdict = 'degrading'
			why = `${worse.map( ( [ n ] ) => n ).join( ', ' )} have all gone the wrong way. Several axes moving together is the signature of something real, and it is visible here long before it is visible in any single reading.`

		}
		else if ( worse.length === 0 ) {

			verdict = 'deepening'
			why = 'Nothing has got worse, and the model is fitting this plant at least as well as it did. Which is what a pairing settling in looks like.'

		}

		return {
			known : true,
			entries : this.entries.length,
			spanDays : Math.round( ( this.entries.at( -1 ).at - this.entries[ 0 ].at ) / 86_400_000 ),
			axes,
			verdict,
			why,
		}

	}

	toJSON() {

		return {
			everyMs : this.everyMs,
			entries : this.entries,
		}

	}

}

function mean( xs ) {

	const v = xs.filter( finite )
	return v.length ? v.reduce( ( a, b ) => a + b, 0 ) / v.length : null

}
