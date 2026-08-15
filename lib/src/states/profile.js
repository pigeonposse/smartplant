/**
 * What actually costs anything.
 *
 * The reason this exists rather than an optimiser: on this machine the whole
 * decision loop measures
 *
 *     states()  0.0045 ms
 *     mayI()    0.0032 ms
 *     read()    0.016  ms
 *
 * and a plant is read four times a day. Even twenty times slower on a Pi, the
 * loop costs under half a millisecond a day. Building two implementations of
 * that — one fast, one auditable, both obliged to agree forever — would trade a
 * saving nobody can measure for a class of bug no test finds, because the
 * failure is the two versions quietly diverging.
 *
 * So: measure, report, and do nothing else. If a genuinely expensive path ever
 * appears — a vision model, a long electrode analysis, a colony with forty
 * members — this will say so, with numbers, and then optimising is a decision
 * made on evidence rather than on the feeling that a framework ought to be fast.
 *
 * Off by default. A profiler that costs something to run on a plant that does
 * not need one is the same mistake in miniature.
 */

/** Above this a path is worth looking at rather than merely noting. */
export const SLOW_MS = 50

/**
 * Timings, kept as a running summary rather than a log of every call.
 */
export class Profile {

	/**
	 * @param {object} [opts] - `{ enabled }`.
	 */
	constructor( opts = {} ) {

		this.enabled = opts.enabled ?? false
		/** name → {calls, totalMs, maxMs} */
		this.paths = new Map()

	}

	/**
	 * Time one call.
	 *
	 * @param   {string}   name - What is being timed.
	 * @param   {Function} fn   - The work.
	 * @returns {*}             Whatever `fn` returned.
	 */
	async time( name, fn ) {

		if ( !this.enabled ) return fn()

		const started = process.hrtime.bigint()

		try {

			return await fn()

		}
		finally {

			const ms = Number( process.hrtime.bigint() - started ) / 1e6
			const entry = this.paths.get( name ) ?? {
				calls : 0,
				totalMs : 0,
				maxMs : 0,
			}

			entry.calls++
			entry.totalMs += ms
			entry.maxMs = Math.max( entry.maxMs, ms )
			this.paths.set( name, entry )

		}

	}

	/**
	 * What everything cost, worst mean first.
	 *
	 * @returns {object} `{paths, slow, why}`.
	 */
	report() {

		if ( !this.enabled ) {

			return {
				enabled : false,
				paths : [],
				why : 'Profiling is off. It is off by default because a profiler running on a plant that does not need one is the same mistake as optimising a path nobody measured — turn it on with { profile: true } when something feels slow.',
			}

		}

		const paths = [ ...this.paths.entries() ]
			.map( ( [ name, e ] ) => ( {
				name,
				calls : e.calls,
				meanMs : Number( ( e.totalMs / e.calls ).toFixed( 4 ) ),
				maxMs : Number( e.maxMs.toFixed( 4 ) ),
				totalMs : Number( e.totalMs.toFixed( 2 ) ),
			} ) )
			.sort( ( a, b ) => b.meanMs - a.meanMs )

		const slow = paths.filter( p => p.meanMs >= SLOW_MS )

		return {
			enabled : true,
			paths,
			slow,
			why : !paths.length
				? 'Nothing has been timed yet.'
				: slow.length
					? `${slow.map( p => `${p.name} averages ${p.meanMs}ms` ).join( ', ' )}. Past ${SLOW_MS}ms a path is worth looking at — and worth looking at means finding out why it is slow, not wrapping it in a faster copy that has to agree with it forever.`
					: `Slowest is ${paths[ 0 ].name} at ${paths[ 0 ].meanMs}ms mean over ${paths[ 0 ].calls} calls. Nothing is near the ${SLOW_MS}ms worth-investigating line, which is the expected answer: a plant is read a few times a day and the decision loop is microseconds.`,
		}

	}

	reset() {

		this.paths.clear()

	}

}
