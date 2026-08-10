/**
 * Federated learning of care profiles.
 *
 * The useful thing to learn across many plants is what a species actually wants
 * — the comfort ranges and watering interval that produced healthy plants, as
 * opposed to what a model guessed once. But sensor histories are private, often
 * revealing when a home is occupied, and nobody should have to upload them.
 *
 * So only *statistics* leave the device: a small update vector plus a sample
 * count, aggregated by weighted averaging (FedAvg). The raw readings never move.
 */

/**
 * Derive a local update from one plant's own history.
 *
 * The update encodes "the conditions this plant was healthiest in", which is the
 * quantity actually worth pooling.
 *
 * @param   {object} plant             - A `SmartPlant` instance.
 * @param   {object} [opts]            - Options.
 * @param   {number} [opts.minWellbeing] - Only learn from readings at or above this.
 * @param   {number} [opts.hours]      - History window.
 * @returns {object|null}              The update, or null with too little data.
 */
export function computeLocalUpdate( plant, opts = {} ) {

	const minWellbeing = opts.minWellbeing ?? 75
	const hours = opts.hours ?? 24 * 30

	const species = plant.memory.plant.species
	if ( !species ) return null

	const rows = plant.memory.since( hours ).filter( r => plant.happiness( r ) >= minWellbeing )

	// A handful of good readings is noise, not evidence.
	if ( rows.length < 20 ) return null

	const metrics = {}
	for ( const metric of [ 'temperature', 'humidity', 'soil', 'light' ] ) {

		const values = rows.map( r => r[ metric ] ).filter( Number.isFinite )
		if ( values.length < 20 ) continue

		const sorted = [ ...values ].sort( ( a, b ) => a - b )
		metrics[ metric ] = {
			// Percentiles rather than min/max: one bad reading should not define
			// the comfort band for everyone who later pulls this profile.
			min : round( sorted[ Math.floor( sorted.length * 0.1 ) ] ),
			max : round( sorted[ Math.floor( sorted.length * 0.9 ) ] ),
			n   : values.length,
		}

	}

	if ( !Object.keys( metrics ).length ) return null

	const waterings = plant.memory.data.events.filter( e => e.type === 'water' )
	const intervals = []
	for ( let i = 1; i < waterings.length; i++ ) {

		const days = ( new Date( waterings[ i ].t ) - new Date( waterings[ i - 1 ].t ) ) / 86_400_000
		if ( days > 0 && days < 90 ) intervals.push( days )

	}

	return {
		species    : String( species ).toLowerCase().trim(),
		metrics,
		wateringDays : intervals.length >= 2
			? round( intervals.reduce( ( a, b ) => a + b, 0 ) / intervals.length, 1 )
			: null,
		samples    : rows.length,
		// Deliberately absent: readings, timestamps, plant name, location.
		producedAt : new Date().toISOString(),
		version    : 1,
	}

}

/**
 * Aggregate updates from many plants into one profile (FedAvg).
 *
 * @param   {object[]} updates - Local updates for the same species.
 * @param   {object}   [opts]  - Options.
 * @param   {number}   [opts.minContributors] - Refuse to publish below this.
 * @returns {object|null}      Aggregated profile, or null.
 */
export function aggregate( updates, opts = {} ) {

	const minContributors = opts.minContributors ?? 3

	const valid = updates.filter( u => u?.species && u.metrics && u.samples > 0 )
	if ( valid.length < minContributors ) return null

	const species = valid[ 0 ].species
	if ( !valid.every( u => u.species === species ) ) {

		throw new Error( 'aggregate() requires every update to be for the same species.' )

	}

	const ranges = {}
	for ( const metric of [ 'temperature', 'humidity', 'soil', 'light' ] ) {

		const contributions = valid.filter( u => u.metrics[ metric ] )
		if ( contributions.length < minContributors ) continue

		// Weight by sample count so a plant monitored for a month counts for more
		// than one monitored for a day — that is the whole point of FedAvg.
		const totalWeight = contributions.reduce( ( a, u ) => a + u.metrics[ metric ].n, 0 )
		const min = contributions.reduce( ( a, u ) => a + u.metrics[ metric ].min * u.metrics[ metric ].n, 0 ) / totalWeight
		const max = contributions.reduce( ( a, u ) => a + u.metrics[ metric ].max * u.metrics[ metric ].n, 0 ) / totalWeight

		ranges[ metric ] = {
			min : round( min ),
			max : round( max ),
			contributors : contributions.length,
			samples      : totalWeight,
		}

	}

	if ( !Object.keys( ranges ).length ) return null

	const wateringUpdates = valid.filter( u => Number.isFinite( u.wateringDays ) )

	return {
		species,
		ranges,
		wateringDays : wateringUpdates.length >= minContributors
			? round( wateringUpdates.reduce( ( a, u ) => a + u.wateringDays, 0 ) / wateringUpdates.length, 1 )
			: null,
		contributors : valid.length,
		samples      : valid.reduce( ( a, u ) => a + u.samples, 0 ),
		aggregatedAt : new Date().toISOString(),
		source       : 'federated',
	}

}

/**
 * In-memory aggregation server.
 *
 * Enough to run a community profile registry: collect updates per species and
 * publish an aggregate once enough independent contributors exist. Persist
 * `toJSON()` behind whatever HTTP layer you prefer.
 */
export class FederatedRegistry {

	/**
	 * @param {object} [opts]                 - Options.
	 * @param {number} [opts.minContributors] - Publication threshold.
	 * @param {number} [opts.maxPerSpecies]   - Cap on retained updates.
	 */
	constructor( opts = {} ) {

		this.minContributors = opts.minContributors ?? 3
		this.maxPerSpecies   = opts.maxPerSpecies ?? 500
		/** @type {Map<string, object[]>} */
		this.updates = new Map()

	}

	/**
	 * Accept a local update.
	 *
	 * @param   {object} update - From `computeLocalUpdate`.
	 * @returns {object}        `{species, contributors}`.
	 */
	submit( update ) {

		if ( !update?.species || !update.metrics ) throw new Error( 'Invalid federated update.' )

		// Reject anything carrying raw history: an update that grew a `readings`
		// field somewhere upstream must not be silently accepted.
		for ( const forbidden of [ 'readings', 'events', 'notes', 'name' ] ) {

			if ( forbidden in update ) throw new Error( `Federated updates must not contain "${forbidden}".` )

		}

		const list = this.updates.get( update.species ) || []
		list.push( update )
		if ( list.length > this.maxPerSpecies ) list.splice( 0, list.length - this.maxPerSpecies )
		this.updates.set( update.species, list )

		return {
			species      : update.species,
			contributors : list.length,
		}

	}

	/**
	 * Current aggregate for a species.
	 *
	 * @param   {string} species - Species name.
	 * @returns {object|null}    Profile, or null below the threshold.
	 */
	profile( species ) {

		const list = this.updates.get( String( species ).toLowerCase().trim() )
		if ( !list ) return null
		return aggregate( list, { minContributors : this.minContributors } )

	}

	/** Every species with a publishable profile. */
	published() {

		return [ ...this.updates.keys() ]
			.map( s => this.profile( s ) )
			.filter( Boolean )

	}

	toJSON() {

		return { updates : Object.fromEntries( this.updates ) }

	}

	static fromJSON( data, opts ) {

		const r = new FederatedRegistry( opts )
		for ( const [ species, list ] of Object.entries( data?.updates || {} ) ) r.updates.set( species, list )
		return r

	}

}

/**
 * Apply a federated profile to a plant's comfort ranges.
 *
 * Blended rather than replaced: a community average is evidence, not authority,
 * and an individual plant in an unusual spot should not be dragged to the mean.
 *
 * @param   {object} plant           - A `SmartPlant` instance.
 * @param   {object} profile         - Aggregated profile.
 * @param   {object} [opts]          - Options.
 * @param   {number} [opts.weight]   - How much to trust it, 0-1. Default 0.5.
 * @returns {object}                 The updated ranges.
 */
export function applyProfile( plant, profile, opts = {} ) {

	const weight = Math.min( 1, Math.max( 0, opts.weight ?? 0.5 ) )

	for ( const [ metric, range ] of Object.entries( profile.ranges || {} ) ) {

		const current = plant.ranges[ metric ]
		if ( !current ) {

			plant.ranges[ metric ] = {
				min : range.min,
				max : range.max,
			}
			continue

		}

		plant.ranges[ metric ] = {
			min : round( current.min * ( 1 - weight ) + range.min * weight ),
			max : round( current.max * ( 1 - weight ) + range.max * weight ),
		}

	}

	return plant.ranges

}

function round( v, digits = 2 ) {

	if ( !Number.isFinite( v ) ) return 0
	return Number( v.toFixed( digits ) )

}
