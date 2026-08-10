/**
 * Plant care ontology.
 *
 * The domain vocabulary the reasoner and the AI share. Keeping it explicit means
 * "the plant is stressed" has one definition across the whole system rather than
 * one per plugin, and that a conclusion can be traced to the facts behind it.
 *
 * Deliberately small and legible: this is a working ontology for plant care, not
 * an attempt at a botanical upper ontology.
 */

import { TripleStore } from './triples.js'

/** Predicates the reasoner understands. */
export const PREDICATES = {
	IS_A        : 'isA',
	CAUSES      : 'causes',
	INDICATES   : 'indicates',
	TREATED_BY  : 'treatedBy',
	MEASURED_BY : 'measuredBy',
	AFFECTS     : 'affects',
	PRECEDES    : 'precedes',
	HAS_RANGE   : 'hasRange',
	HAS_VALUE   : 'hasValue',
	OBSERVED_AT : 'observedAt',
	CONFLICTS   : 'conflictsWith',
}

/**
 * Core domain knowledge, asserted once at startup.
 *
 * Each row is `[subject, predicate, object]`. Sources are marked `ontology` so
 * they are distinguishable from facts observed about a specific plant.
 */
const CORE = [
	// Taxonomy of conditions
	[ 'drought_stress', PREDICATES.IS_A, 'stress' ],
	[ 'overwatering', PREDICATES.IS_A, 'stress' ],
	[ 'heat_stress', PREDICATES.IS_A, 'stress' ],
	[ 'cold_stress', PREDICATES.IS_A, 'stress' ],
	[ 'light_deficit', PREDICATES.IS_A, 'stress' ],
	[ 'light_excess', PREDICATES.IS_A, 'stress' ],
	[ 'nutrient_deficiency', PREDICATES.IS_A, 'stress' ],
	[ 'root_rot', PREDICATES.IS_A, 'disease' ],
	[ 'spider_mites', PREDICATES.IS_A, 'pest' ],
	[ 'fungus_gnats', PREDICATES.IS_A, 'pest' ],
	[ 'aphids', PREDICATES.IS_A, 'pest' ],
	[ 'powdery_mildew', PREDICATES.IS_A, 'disease' ],

	// Causal chains — what leads to what
	[ 'low_soil_moisture', PREDICATES.CAUSES, 'drought_stress' ],
	[ 'high_soil_moisture', PREDICATES.CAUSES, 'overwatering' ],
	[ 'overwatering', PREDICATES.CAUSES, 'root_rot' ],
	[ 'overwatering', PREDICATES.CAUSES, 'fungus_gnats' ],
	[ 'high_temperature', PREDICATES.CAUSES, 'heat_stress' ],
	[ 'low_temperature', PREDICATES.CAUSES, 'cold_stress' ],
	[ 'low_light', PREDICATES.CAUSES, 'light_deficit' ],
	[ 'high_light', PREDICATES.CAUSES, 'light_excess' ],
	[ 'low_humidity', PREDICATES.CAUSES, 'spider_mites' ],
	[ 'high_humidity', PREDICATES.CAUSES, 'powdery_mildew' ],
	[ 'drought_stress', PREDICATES.CAUSES, 'wilting' ],
	[ 'drought_stress', PREDICATES.CAUSES, 'leaf_drop' ],
	[ 'root_rot', PREDICATES.CAUSES, 'wilting' ],
	[ 'light_deficit', PREDICATES.CAUSES, 'etiolation' ],
	[ 'light_excess', PREDICATES.CAUSES, 'leaf_scorch' ],
	[ 'nutrient_deficiency', PREDICATES.CAUSES, 'chlorosis' ],
	[ 'overwatering', PREDICATES.CAUSES, 'chlorosis' ],
	[ 'heat_stress', PREDICATES.CAUSES, 'leaf_scorch' ],

	// Observable signs → what they suggest
	[ 'wilting', PREDICATES.INDICATES, 'drought_stress' ],
	[ 'wilting', PREDICATES.INDICATES, 'root_rot' ],
	[ 'chlorosis', PREDICATES.INDICATES, 'nutrient_deficiency' ],
	[ 'chlorosis', PREDICATES.INDICATES, 'overwatering' ],
	[ 'necrosis', PREDICATES.INDICATES, 'leaf_scorch' ],
	[ 'etiolation', PREDICATES.INDICATES, 'light_deficit' ],
	[ 'webbing', PREDICATES.INDICATES, 'spider_mites' ],
	[ 'white_powder', PREDICATES.INDICATES, 'powdery_mildew' ],
	[ 'canopy_droop', PREDICATES.INDICATES, 'wilting' ],
	[ 'variation_potential', PREDICATES.INDICATES, 'tissue_damage' ],
	[ 'action_potential', PREDICATES.INDICATES, 'stimulus_response' ],
	[ 'weak_circadian_rhythm', PREDICATES.INDICATES, 'stress' ],

	// Treatments
	[ 'drought_stress', PREDICATES.TREATED_BY, 'water_thoroughly' ],
	[ 'overwatering', PREDICATES.TREATED_BY, 'let_soil_dry' ],
	[ 'overwatering', PREDICATES.TREATED_BY, 'improve_drainage' ],
	[ 'root_rot', PREDICATES.TREATED_BY, 'repot_fresh_substrate' ],
	[ 'root_rot', PREDICATES.TREATED_BY, 'trim_affected_roots' ],
	[ 'heat_stress', PREDICATES.TREATED_BY, 'increase_airflow' ],
	[ 'heat_stress', PREDICATES.TREATED_BY, 'move_from_direct_sun' ],
	[ 'cold_stress', PREDICATES.TREATED_BY, 'move_away_from_draft' ],
	[ 'light_deficit', PREDICATES.TREATED_BY, 'move_closer_to_window' ],
	[ 'light_deficit', PREDICATES.TREATED_BY, 'add_grow_light' ],
	[ 'light_excess', PREDICATES.TREATED_BY, 'diffuse_the_light' ],
	[ 'nutrient_deficiency', PREDICATES.TREATED_BY, 'balanced_fertilizer' ],
	[ 'spider_mites', PREDICATES.TREATED_BY, 'raise_humidity' ],
	[ 'spider_mites', PREDICATES.TREATED_BY, 'insecticidal_soap' ],
	[ 'fungus_gnats', PREDICATES.TREATED_BY, 'let_soil_dry' ],
	[ 'powdery_mildew', PREDICATES.TREATED_BY, 'increase_airflow' ],
	[ 'aphids', PREDICATES.TREATED_BY, 'insecticidal_soap' ],

	// Which sensor sees which condition
	[ 'low_soil_moisture', PREDICATES.MEASURED_BY, 'soil' ],
	[ 'high_soil_moisture', PREDICATES.MEASURED_BY, 'soil' ],
	[ 'high_temperature', PREDICATES.MEASURED_BY, 'temperature' ],
	[ 'low_temperature', PREDICATES.MEASURED_BY, 'temperature' ],
	[ 'low_light', PREDICATES.MEASURED_BY, 'light' ],
	[ 'high_light', PREDICATES.MEASURED_BY, 'light' ],
	[ 'low_humidity', PREDICATES.MEASURED_BY, 'humidity' ],
	[ 'high_humidity', PREDICATES.MEASURED_BY, 'humidity' ],
	[ 'canopy_droop', PREDICATES.MEASURED_BY, 'vision' ],
	[ 'chlorosis', PREDICATES.MEASURED_BY, 'vision' ],
	[ 'necrosis', PREDICATES.MEASURED_BY, 'vision' ],
	[ 'variation_potential', PREDICATES.MEASURED_BY, 'electrode' ],
	[ 'action_potential', PREDICATES.MEASURED_BY, 'electrode' ],
	[ 'weak_circadian_rhythm', PREDICATES.MEASURED_BY, 'electrode' ],

	// Treatments that must not be combined
	[ 'water_thoroughly', PREDICATES.CONFLICTS, 'let_soil_dry' ],
	[ 'move_closer_to_window', PREDICATES.CONFLICTS, 'diffuse_the_light' ],
	[ 'increase_airflow', PREDICATES.CONFLICTS, 'raise_humidity' ],
]

/**
 * Build a store preloaded with the core ontology.
 *
 * @param   {TripleStore} [store] - Store to populate. A new one is made if omitted.
 * @returns {TripleStore}         The store.
 */
export function loadOntology( store = new TripleStore() ) {

	for ( const [ s, p, o ] of CORE ) {

		store.add( s, p, o, {
			source     : 'ontology',
			confidence : 1,
		} )

	}
	return store

}

/**
 * Everything the ontology knows about a condition, ready for a prompt or a UI.
 *
 * @param   {TripleStore} store     - The store.
 * @param   {string}      condition - Condition id.
 * @returns {object}                Explanation.
 */
export function explainCondition( store, condition ) {

	return {
		condition,
		kind        : store.get( condition, PREDICATES.IS_A ),
		causedBy    : store.query( undefined, PREDICATES.CAUSES, condition ).map( t => t.subject ),
		leadsTo     : store.query( condition, PREDICATES.CAUSES ).map( t => String( t.object ) ),
		indicatedBy : store.query( undefined, PREDICATES.INDICATES, condition ).map( t => t.subject ),
		treatments  : store.query( condition, PREDICATES.TREATED_BY ).map( t => String( t.object ) ),
		sensors     : store.query( condition, PREDICATES.MEASURED_BY ).map( t => String( t.object ) ),
	}

}

/**
 * Drop treatments that contradict each other, keeping the first of each pair.
 *
 * Without this the system happily recommends watering thoroughly *and* letting
 * the soil dry out, which is how automated advice loses trust.
 *
 * @param   {TripleStore} store      - The store.
 * @param   {string[]}    treatments - Candidate treatments, best first.
 * @returns {{kept: string[], dropped: object[]}} Resolved set.
 */
export function resolveConflicts( store, treatments ) {

	const kept = []
	const dropped = []

	for ( const candidate of treatments ) {

		const conflict = kept.find( k =>
			store.has( k, PREDICATES.CONFLICTS, candidate )
			|| store.has( candidate, PREDICATES.CONFLICTS, k ) )

		if ( conflict ) dropped.push( {
			treatment : candidate,
			conflictsWith : conflict,
		} )
		else kept.push( candidate )

	}

	return {
		kept,
		dropped,
	}

}
