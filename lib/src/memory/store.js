/**
 * PlantMemory — persistent state for one plant.
 *
 * This is what turns per-question prompting into a relationship. Without it the
 * AI meets the plant for the first time on every call; with it, "you watered me
 * 9 days ago and I've been drying since" becomes expressible.
 *
 * Storage is a single JSON file, written atomically. No database, no daemon —
 * the point is that a user can back it up, read it, and delete it.
 */

import {
	mkdir, readFile, rename, writeFile,
} from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { METRIC_KEYS } from '../sensors/driver.js'

const SCHEMA_VERSION = 2

/** Kept small enough to stay a human-readable file, long enough for real trends. */
const DEFAULT_MAX_READINGS = 2000
const DEFAULT_MAX_EVENTS   = 500

export class PlantMemory {

	/**
	 * @param {object}  [opts]              - Options.
	 * @param {string}  [opts.path]         - JSON file path. Omit for in-memory only.
	 * @param {number}  [opts.maxReadings]  - Ring-buffer size for sensor history.
	 * @param {number}  [opts.maxEvents]    - Ring-buffer size for the care log.
	 * @param {boolean} [opts.autosave]     - Persist after every mutation.
	 */
	constructor( opts = {} ) {

		this.path        = opts.path ? resolve( opts.path ) : null
		this.maxReadings = opts.maxReadings ?? DEFAULT_MAX_READINGS
		this.maxEvents   = opts.maxEvents ?? DEFAULT_MAX_EVENTS
		this.autosave    = opts.autosave ?? true

		this.data = {
			version  : SCHEMA_VERSION,
			plant    : {
				name    : null,
				species : null,
				type    : null,
				since   : null,
			},
			profile  : null,
			readings : [],
			events   : [],
			notes    : [],
			meta     : {
				created : new Date().toISOString(),
				updated : null,
			},
		}

		// Serializes concurrent saves so two fast ticks can't interleave writes.
		this._writeChain = Promise.resolve()

	}

	/** Load from disk. Missing or corrupt files start a fresh memory rather than throwing. */
	async load() {

		if ( !this.path ) return this

		try {

			const text   = await readFile( this.path, 'utf-8' )
			const parsed = JSON.parse( text )
			this.data = migrate( parsed )

		}
		catch ( err ) {

			if ( err.code !== 'ENOENT' ) {

				// A corrupt file must not lose the user's history silently: keep it aside.
				try {

					await rename( this.path, `${this.path}.corrupt-${Date.now()}` )

				}
				catch { /* best effort */ }

			}

		}

		return this

	}

	/** Atomic write: temp file + rename, so a crash mid-save can't truncate history. */
	async save() {

		if ( !this.path ) return this

		this._writeChain = this._writeChain.then( async () => {

			this.data.meta.updated = new Date().toISOString()
			await mkdir( dirname( this.path ), { recursive : true } )
			const tmp = `${this.path}.${process.pid}.tmp`
			await writeFile( tmp, JSON.stringify( this.data, null, 2 ), 'utf-8' )
			await rename( tmp, this.path )

		} ).catch( () => {} )

		await this._writeChain
		return this

	}

	async _touch() {

		if ( this.autosave ) await this.save()

	}

	// ── plant identity ────────────────────────────────────────────────────────

	async setPlant( {
		name, species, type,
	} = {} ) {

		if ( name !== undefined ) this.data.plant.name = name
		if ( species !== undefined ) this.data.plant.species = species
		if ( type !== undefined ) this.data.plant.type = type
		if ( !this.data.plant.since ) this.data.plant.since = new Date().toISOString()
		await this._touch()
		return this.data.plant

	}

	get plant() {

		return this.data.plant

	}

	/** Care profile (comfort ranges + species knowledge), usually AI-generated once. */
	async setProfile( profile ) {

		this.data.profile = {
			...profile,
			generatedAt : new Date().toISOString(),
		}
		await this._touch()
		return this.data.profile

	}

	get profile() {

		return this.data.profile

	}

	// ── readings ──────────────────────────────────────────────────────────────

	/**
	 * Append a sensor reading.
	 *
	 * @param   {import('../sensors/driver.js').Reading} reading - The reading.
	 * @returns {object}                                         Stored record.
	 */
	async addReading( reading ) {

		const record = { t : new Date( reading.timestamp || Date.now() ).toISOString() }
		for ( const k of METRIC_KEYS ) if ( Number.isFinite( reading[ k ] ) ) record[ k ] = reading[ k ]
		if ( reading.source ) record.src = reading.source

		this.data.readings.push( record )
		if ( this.data.readings.length > this.maxReadings ) {

			this.data.readings.splice( 0, this.data.readings.length - this.maxReadings )

		}
		await this._touch()
		return record

	}

	/** Most recent readings, oldest first. */
	recent( n = 10 ) {

		return this.data.readings.slice( -n )

	}

	get lastReading() {

		return this.data.readings.at( -1 ) || null

	}

	/** Readings inside the last `hours`. */
	since( hours ) {

		const cutoff = Date.now() - hours * 3600_000
		return this.data.readings.filter( r => new Date( r.t ).getTime() >= cutoff )

	}

	/**
	 * Simple stats per metric over a window.
	 *
	 * @param   {number} [hours] - Window size in hours.
	 * @returns {object}         Metric → `{min,max,avg,trend,n}`.
	 */
	stats( hours = 24 ) {

		const rows = this.since( hours )
		const out  = {}

		for ( const key of METRIC_KEYS ) {

			const vals = rows.map( r => r[ key ] ).filter( Number.isFinite )
			if ( !vals.length ) continue
			out[ key ] = {
				n     : vals.length,
				min   : Math.min( ...vals ),
				max   : Math.max( ...vals ),
				avg   : Number( ( vals.reduce( ( a, b ) => a + b, 0 ) / vals.length ).toFixed( 2 ) ),
				trend : linearTrend( vals ),
			}

		}
		return out

	}

	// ── care log ──────────────────────────────────────────────────────────────

	/**
	 * Record a care event (watering, fertilizing, repotting, an observed problem).
	 *
	 * @param   {string} type     - Event type, e.g. `'water'`.
	 * @param   {object} [detail] - Arbitrary structured detail.
	 * @returns {object}          Stored event.
	 */
	async addEvent( type, detail = {} ) {

		const event = {
			t : new Date().toISOString(),
			type,
			...detail,
		}
		this.data.events.push( event )
		if ( this.data.events.length > this.maxEvents ) {

			this.data.events.splice( 0, this.data.events.length - this.maxEvents )

		}
		await this._touch()
		return event

	}

	/** Events of a type, newest first. */
	eventsOf( type, limit = 10 ) {

		return this.data.events.filter( e => e.type === type ).slice( -limit ).reverse()

	}

	/** The most recent event of a type, or null. */
	lastEvent( type ) {

		return [ ...this.data.events ].reverse().find( e => e.type === type ) || null

	}

	/** Whole days since the last event of a type, or null if it never happened. */
	daysSince( type ) {

		const e = this.lastEvent( type )
		if ( !e ) return null
		return Math.floor( ( Date.now() - new Date( e.t ).getTime() ) / 86_400_000 )

	}

	/** Free-text note from the human ("moved it next to the window"). */
	async addNote( text, author = 'human' ) {

		const note = {
			t : new Date().toISOString(),
			text,
			author,
		}
		this.data.notes.push( note )
		if ( this.data.notes.length > this.maxEvents ) this.data.notes.shift()
		await this._touch()
		return note

	}

	get notes() {

		return this.data.notes

	}

	/** Erase everything. The user owns this data and must be able to drop it. */
	async forget( { keepIdentity = true } = {} ) {

		const plant = this.data.plant
		this.data.readings = []
		this.data.events   = []
		this.data.notes    = []
		this.data.profile  = null
		if ( !keepIdentity ) {

			this.data.plant = {
				name : null,
				species : null,
				type : null,
				since : null,
			}

		}
		else this.data.plant = plant
		await this._touch()
		return this

	}

	toJSON() {

		return this.data

	}

}

/**
 * Least-squares slope over evenly-spaced samples. Positive means rising.
 *
 * @param   {number[]} values - Samples, oldest first.
 * @returns {number}          Slope per sample.
 */
export function linearTrend( values ) {

	const n = values.length
	if ( n < 2 ) return 0
	const sumX  = ( n * ( n + 1 ) ) / 2
	const sumY  = values.reduce( ( a, b ) => a + b, 0 )
	const sumXY = values.reduce( ( acc, y, i ) => acc + y * ( i + 1 ), 0 )
	const sumXX = ( n * ( n + 1 ) * ( 2 * n + 1 ) ) / 6
	const denom = n * sumXX - sumX * sumX
	if ( denom === 0 ) return 0
	return Number( ( ( n * sumXY - sumX * sumY ) / denom ).toFixed( 4 ) )

}

/** Bring an older on-disk shape up to the current schema. */
function migrate( parsed ) {

	const data = {
		version  : SCHEMA_VERSION,
		plant    : {
			name : null,
			species : null,
			type : null,
			since : null,
		},
		profile  : null,
		readings : [],
		events   : [],
		notes    : [],
		meta     : {
			created : new Date().toISOString(),
			updated : null,
		},
		...parsed,
	}

	// v1 stored `historicalData` with full Date objects and `moisture` naming.
	if ( Array.isArray( parsed?.historicalData ) ) {

		data.readings = parsed.historicalData.map( r => ( {
			t           : new Date( r.timestamp || Date.now() ).toISOString(),
			temperature : num( r.temperature ),
			humidity    : num( r.humidity ),
			soil        : num( r.soil ?? r.moisture ),
			light       : num( r.light ),
		} ) ).map( stripUndefined )
		delete data.historicalData

	}

	data.version = SCHEMA_VERSION
	return data

}

const num = v => ( Number.isFinite( Number( v ) ) ? Number( v ) : undefined )

function stripUndefined( obj ) {

	return Object.fromEntries( Object.entries( obj ).filter( ( [ , v ] ) => v !== undefined ) )

}
