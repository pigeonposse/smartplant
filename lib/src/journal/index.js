/**
 * The record, as a table rather than a diary.
 *
 * A plant that writes "Tuesday: I was watered" has produced prose. What a
 * grower, a researcher, or a spreadsheet needs is a row per moment with every
 * number in it, so that a question nobody thought to ask at the time can still
 * be answered afterwards.
 *
 * The two are not the same artefact and should not be the same function. This
 * one is the instrument trace: one row per interval, every metric the plant
 * actually has, the derived quantities that come from crossing them, and the
 * state of every alarm at that moment.
 *
 * ## Sampling is not the same as recording
 *
 * Sensors are read on their own schedule, which is rarely once a minute and
 * never exactly on the minute. Producing a per-minute table therefore means
 * deciding what a minute with no reading in it contains — and the honest answer
 * is *nothing*, not the previous value repeated.
 *
 * Carrying the last value forward is how a table quietly turns a sensor that
 * stopped reporting into one that is reporting a stable value, which is exactly
 * the failure the maintenance layer exists to catch. Empty cells stay empty, and
 * a `filled` column says how many of the metrics in that row are real.
 */

import { METRICS, METRIC_KEYS } from '../sensors/driver.js'
import { vaporPressureDeficit, vpdBand } from '../memory/context.js'

/** Columns that are computed rather than measured. */
export const DERIVED = {
	wellbeing : {
		unit : '%',
		label : 'Wellbeing',
	},
	vpd       : {
		unit : 'kPa',
		label : 'VPD',
	},
	vpdBand   : {
		unit : '',
		label : 'VPD band',
	},
	dewPoint  : {
		unit : '°C',
		label : 'Dew point',
	},
	alerts    : {
		unit : '',
		label : 'Alerts',
	},
	events    : {
		unit : '',
		label : 'Events',
	},
}

/** Dew point from temperature and humidity (Magnus). */
function dewPoint( t, rh ) {

	if ( !Number.isFinite( t ) || !Number.isFinite( rh ) || rh <= 0 ) return null
	const a = 17.27, b = 237.7
	const g = ( a * t ) / ( b + t ) + Math.log( rh / 100 )
	return Number( ( ( b * g ) / ( a - g ) ).toFixed( 2 ) )

}

/** Round a timestamp down to the start of its bucket. */
const bucketOf = ( ms, minutes ) => Math.floor( ms / ( minutes * 60_000 ) ) * minutes * 60_000

/**
 * Build the table.
 *
 * @param   {object}  plant            - A `SmartPlant`.
 * @param   {object}  [opts]           - Options.
 * @param   {number}  [opts.hours]     - How far back. Default 24.
 * @param   {number}  [opts.everyMinutes] - Row interval. Default 1.
 * @param   {boolean} [opts.sparse]    - Omit rows with no reading. Default true.
 * @returns {object}                   `{columns, rows, coverage}`.
 */
export function journal( plant, opts = {} ) {

	const hours = opts.hours ?? 24
	const every = opts.everyMinutes ?? 1
	const sparse = opts.sparse !== false

	const from = bucketOf( Date.now() - hours * 3_600_000, every )
	const to   = bucketOf( Date.now(), every )

	const readings = ( plant.memory?.data?.readings || [] )
		.filter( r => new Date( r.t ).getTime() >= from )
	const events = ( plant.memory?.data?.events || [] )
		.filter( e => new Date( e.t ).getTime() >= from )

	// Only the metrics this plant has ever actually produced. A table with
	// eighteen permanently empty columns is harder to read than one with four,
	// and implies instruments that are not there.
	const seen = new Set()
	for ( const r of readings ) {

		for ( const k of METRIC_KEYS ) if ( Number.isFinite( r[ k ] ) ) seen.add( k )

	}

	const metrics = METRIC_KEYS.filter( k => seen.has( k ) )

	const columns = [
		{
			key : 't',
			label : 'Timestamp',
			unit : '',
		},
		...metrics.map( k => ( {
			key : k,
			label : METRICS[ k ].label,
			unit : METRICS[ k ].unit,
			layer : METRICS[ k ].layer || 'base',
		} ) ),
		...Object.entries( DERIVED ).map( ( [ key, d ] ) => ( {
			key,
			label : d.label,
			unit : d.unit,
			derived : true,
		} ) ),
		{
			key : 'filled',
			label : 'Filled',
			unit : '',
			derived : true,
		},
	]

	// Index readings and events into buckets.
	const byBucket = new Map()

	for ( const r of readings ) {

		const b = bucketOf( new Date( r.t ).getTime(), every )
		if ( !byBucket.has( b ) ) byBucket.set( b, {
			readings : [],
			events : [],
		} )
		byBucket.get( b ).readings.push( r )

	}

	for ( const e of events ) {

		const b = bucketOf( new Date( e.t ).getTime(), every )
		if ( !byBucket.has( b ) ) byBucket.set( b, {
			readings : [],
			events : [],
		} )
		byBucket.get( b ).events.push( e )

	}

	const rows = []
	let withData = 0

	for ( let b = from; b <= to; b += every * 60_000 ) {

		const bucket = byBucket.get( b )

		if ( !bucket && sparse ) continue

		const row = { t : new Date( b ).toISOString() }
		const rs = bucket?.readings || []

		for ( const k of metrics ) {

			const vals = rs.map( r => r[ k ] ).filter( Number.isFinite )
			// Mean within the bucket, and nothing at all when the bucket is empty.
			// A carried-forward value is indistinguishable from a stuck sensor.
			row[ k ] = vals.length
				? Number( ( vals.reduce( ( a, v ) => a + v, 0 ) / vals.length ).toFixed( 3 ) )
				: null

		}

		if ( rs.length ) {

			withData++
			const last = rs.at( -1 )
			row.wellbeing = Math.round( plant.happiness( last ) )
			row.vpd = vaporPressureDeficit( row.temperature, row.humidity )
			row.vpdBand = row.vpd === null ? null : vpdBand( row.vpd )
			row.dewPoint = dewPoint( row.temperature, row.humidity )

			const devs = plant.deviations?.( last ) || []
			row.alerts = devs.length ? devs.map( d => `${d.metric}:${d.direction}` ).join( ' ' ) : ''

		}
		else {

			for ( const k of Object.keys( DERIVED ) ) row[ k ] = null

		}

		row.events = ( bucket?.events || [] ).map( e => e.type ).join( ' ' ) || ''
		row.filled = metrics.filter( k => row[ k ] !== null ).length

		rows.push( row )

	}

	const expected = Math.max( 1, Math.round( ( to - from ) / ( every * 60_000 ) ) )

	return {
		columns,
		rows,
		metrics,
		coverage : {
			rows : rows.length,
			withReadings : withData,
			expected,
			// How much of the requested window actually has data behind it. A
			// table is only as good as this number, and it belongs next to it.
			ratio : Number( ( withData / expected ).toFixed( 3 ) ),
		},
	}

}

/** Escape a CSV field. */
const csvCell = v => {

	if ( v === null || v === undefined ) return ''
	const s = String( v )
	return /[",\n]/.test( s ) ? `"${s.replace( /"/g, '""' )}"` : s

}

/**
 * The table as CSV, with units in the header.
 *
 * @param   {object} table - From `journal`.
 * @returns {string}       CSV.
 */
export function toCSV( table ) {

	const head = table.columns.map( c => ( c.unit ? `${c.label} (${c.unit})` : c.label ) )
	const lines = [ head.map( csvCell ).join( ',' ) ]

	for ( const row of table.rows ) {

		lines.push( table.columns.map( c => csvCell( row[ c.key ] ) ).join( ',' ) )

	}

	return lines.join( '\n' )

}

/**
 * The table as aligned text, for a terminal.
 *
 * @param   {object} table  - From `journal`.
 * @param   {object} [opts] - `{ limit }`.
 * @returns {string}        The table.
 */
export function toTable( table, opts = {} ) {

	const limit = opts.limit ?? 40
	const rows = table.rows.slice( -limit )

	const head = table.columns.map( c => c.unit ? `${c.label}(${c.unit})` : c.label )
	const cells = rows.map( r => table.columns.map( c => {

		const v = r[ c.key ]
		if ( v === null || v === undefined || v === '' ) return '·'
		if ( c.key === 't' ) return String( v ).slice( 11, 19 )
		return String( v )

	} ) )

	const widths = head.map( ( h, i ) =>
		Math.max( h.length, ...cells.map( c => c[ i ].length ) ) )

	const line = cs => cs.map( ( c, i ) => c.padStart( widths[ i ] ) ).join( '  ' )

	return [
		line( head ),
		widths.map( w => '─'.repeat( w ) ).join( '  ' ),
		...cells.map( line ),
		'',
		`${table.coverage.withReadings}/${table.coverage.expected} intervals have readings (${Math.round( table.coverage.ratio * 100 )}% coverage). Empty cells are gaps, not zeros.`,
	].join( '\n' )

}
