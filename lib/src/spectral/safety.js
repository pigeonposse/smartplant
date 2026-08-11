/**
 * Spectral safety.
 *
 * Light is the one actuator in this library that can damage a plant *while
 * looking like care*. A pump that runs too long floods visibly; a lamp that
 * forces stomata open on a drought-stressed plant kills it quietly, and the
 * system reports "treatment applied" the whole time.
 *
 * So every treatment passes through here, and the decisions are arithmetic:
 *
 *   1. **Contraindications** — physiological states in which a wavelength is
 *      harmful. Hard blocks. No confidence score overrides them.
 *   2. **Dose ledger** — cumulative daily exposure per band, enforced against
 *      the catalogue's limits.
 *   3. **Human gate** — UV-B and far-red always need a person.
 *   4. **Night protection** — the circadian clock is a health signal the rest of
 *      the library reads; irradiating through the dark period destroys it.
 *
 * Probes are held to the same dose ledger but not to the contraindications: a
 * four-minute blue pulse reads the stomata, it does not force them.
 */

import { BANDS, contraindications } from './wavelengths.js'

export const SPECTRAL_VERDICT = {
	ALLOW  : 'allow',
	MODIFY : 'modify',
	DENY   : 'deny',
}

export class SpectralSafety {

	/**
	 * @param {object}  [opts]                 - Options.
	 * @param {object}  [opts.limits]          - Band → max daily seconds override.
	 * @param {number[]}[opts.darkHours]       - `[start, end]` local hours to protect.
	 * @param {boolean} [opts.protectDark]     - Enforce the dark period. Default true.
	 * @param {number}  [opts.maxSessionSeconds] - Cap on any single emission.
	 */
	constructor( opts = {} ) {

		this.limits    = opts.limits || {}
		this.darkHours = opts.darkHours || [ 22, 6 ]
		this.protectDark = opts.protectDark ?? true
		this.maxSessionSeconds = opts.maxSessionSeconds ?? 4 * 3600

		/** Band → `{ date, seconds }`. Resets at local midnight. */
		this.doses = {}
		/** Bands a human has explicitly authorized today. */
		this.authorized = new Set()
		/** The day the authorizations belong to, tracked independently of any band. */
		this._authDay = new Date().toDateString()
		/** @type {object[]} */
		this.log = []

	}

	/** Daily budget for a band. */
	budget( bandId ) {

		return this.limits[ bandId ] ?? BANDS[ bandId ]?.treat?.maxDailySeconds ?? Infinity

	}

	/** Seconds of this band already used today. */
	used( bandId, now = new Date() ) {

		const entry = this.doses[ bandId ]
		const today = now.toDateString()
		if ( !entry || entry.date !== today ) return 0
		return entry.seconds

	}

	remaining( bandId, now = new Date() ) {

		return Math.max( 0, this.budget( bandId ) - this.used( bandId, now ) )

	}

	/**
	 * Record exposure.
	 *
	 * @param   {string} bandId  - Band.
	 * @param   {number} seconds - Duration.
	 * @param   {number} [level] - Intensity 0-1; the dose is scaled by it.
	 * @returns {number}         Total used today.
	 */
	record( bandId, seconds, level = 1 ) {

		const today = new Date().toDateString()
		const entry = this.doses[ bandId ]

		if ( !entry || entry.date !== today ) {

			this.doses[ bandId ] = {
				date : today,
				seconds : 0,
			}

		}

		// Authorizations expire with the day, not with the first dose of some
		// unrelated band — clearing them here as a side effect of recording green
		// would silently revoke a UV-B authorization the human just gave.
		this._expireAuthorizations( today )

		this.doses[ bandId ].seconds += seconds * Math.min( 1, Math.max( 0, level ) )
		return this.doses[ bandId ].seconds

	}

	/** Drop yesterday's authorizations. */
	_expireAuthorizations( today = new Date().toDateString() ) {

		if ( this._authDay !== today ) {

			this.authorized.clear()
			this._authDay = today

		}

	}

	/** Grant a human authorization for a band, valid until midnight. */
	authorize( bandId ) {

		this._expireAuthorizations()
		this.authorized.add( bandId )
		return this

	}

	revoke( bandId ) {

		this.authorized.delete( bandId )
		return this

	}

	/** Is the clock inside the protected dark period? */
	isDark( now = new Date() ) {

		if ( !this.protectDark ) return false

		const hour = now.getHours()
		const [ start, end ] = this.darkHours
		// The window normally wraps midnight (22 → 6).
		return start > end ? ( hour >= start || hour < end ) : ( hour >= start && hour < end )

	}

	/**
	 * Validate a spectral action.
	 *
	 * @param   {object}  request            - The request.
	 * @param   {string}  request.band       - Band id.
	 * @param   {string}  [request.mode]     - `'probe'` | `'treat'`.
	 * @param   {number}  [request.seconds]  - Duration.
	 * @param   {number}  [request.level]    - Intensity 0-1.
	 * @param   {object}  [ctx]              - Plant context.
	 * @returns {object}                     `{verdict, allowed, reasons, request, explanation}`.
	 */
	validate( request, ctx ) {

		const bandId = request.band
		const mode   = request.mode || 'treat'
		const b      = BANDS[ bandId ]

		this._expireAuthorizations()

		const reasons = []
		let verdict = SPECTRAL_VERDICT.ALLOW
		let adjusted = {
			...request,
			mode,
		}

		const deny = why => {

			verdict = SPECTRAL_VERDICT.DENY
			reasons.push( why )

		}
		const modify = ( why, patch ) => {

			if ( verdict !== SPECTRAL_VERDICT.DENY ) verdict = SPECTRAL_VERDICT.MODIFY
			reasons.push( why )
			adjusted = {
				...adjusted,
				...patch,
			}

		}

		if ( !b ) {

			deny( `Unknown band "${bandId}".` )
			return this._result( verdict, reasons, adjusted )

		}

		const seconds = request.seconds ?? 0
		const level   = request.level ?? 1

		// ── probe-specific ─────────────────────────────────────────────────────
		if ( mode === 'probe' ) {

			if ( !b.probe.usable ) deny( b.probe.why || `${b.label} cannot be used as a probe.` )

		}
		// ── treatment-specific ─────────────────────────────────────────────────
		else {

			// 1. Contraindications: the hard blocks.
			for ( const c of contraindications( bandId, ctx ) ) {

				if ( c.overridable && this.authorized.has( bandId ) ) {

					reasons.push( `Overridden by explicit authorization: ${c.why}` )
					continue

				}
				deny( c.why )

			}

			// 2. Human gate.
			if ( b.treat.requiresHuman && !this.authorized.has( bandId ) ) {

				deny( `${b.label} requires explicit human authorization.${b.treat.humanWarning ? ` ${b.treat.humanWarning}` : ''}` )

			}

		}

		// ── shared limits ──────────────────────────────────────────────────────

		if ( this.isDark() && mode === 'treat' ) {

			deny( `It is the plant's dark period (${this.darkHours[ 0 ]}:00-${this.darkHours[ 1 ]}:00). Light now disrupts the circadian rhythm the system relies on as a health signal.` )

		}

		if ( seconds > this.maxSessionSeconds ) {

			modify(
				`Session capped to ${this.maxSessionSeconds}s (requested ${seconds}s).`,
				{ seconds : this.maxSessionSeconds },
			)

		}

		const remaining = this.remaining( bandId )
		const effective = adjusted.seconds * Math.min( 1, Math.max( 0, level ) )

		if ( remaining <= 0 ) {

			deny( `Daily ${b.label} budget exhausted (${this.budget( bandId )}s). It resets at midnight.` )

		}
		else if ( effective > remaining ) {

			modify(
				`Trimmed to the remaining ${Math.round( remaining )}s of today's ${b.label} budget.`,
				{ seconds : Math.floor( remaining / Math.max( 0.01, level ) ) },
			)

		}

		if ( b.treat.maxIrradiance && level > b.treat.maxIrradiance && mode === 'treat' ) {

			modify(
				`Intensity capped to ${b.treat.maxIrradiance} for ${b.label}.`,
				{ level : b.treat.maxIrradiance },
			)

		}

		return this._result( verdict, reasons, adjusted )

	}

	_result( verdict, reasons, request ) {

		const record = {
			at : new Date().toISOString(),
			band : request.band,
			mode : request.mode,
			verdict,
			reasons,
		}
		this.log.push( record )
		if ( this.log.length > 500 ) this.log.shift()

		return {
			verdict,
			allowed : verdict !== SPECTRAL_VERDICT.DENY,
			reasons,
			request,
			explanation : reasons.length
				? `${verdict.toUpperCase()}: ${reasons.join( ' ' )}`
				: 'ALLOW: within all spectral limits.',
		}

	}

	/** Today's exposure across every band. */
	report( now = new Date() ) {

		return Object.keys( BANDS ).map( id => ( {
			band      : id,
			label     : BANDS[ id ].label,
			emoji     : BANDS[ id ].emoji,
			usedSeconds : Math.round( this.used( id, now ) ),
			budgetSeconds : this.budget( id ),
			remainingSeconds : Math.round( this.remaining( id, now ) ),
			authorized : this.authorized.has( id ),
		} ) ).filter( r => r.usedSeconds > 0 || r.authorized )

	}

}
