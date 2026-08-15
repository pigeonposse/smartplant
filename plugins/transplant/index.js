/**
 * @smartplant/transplant — notices the pot filling up, and guides the move.
 *
 * The container is the physical limit of everything the plant can do, and a
 * person usually notices it has become too small once the plant is already
 * suffering. This watches the one thing that shows earlier: the same plant in
 * the same pot drying faster and wanting water sooner than it used to.
 *
 * It never repots anything and never asks the system to. Repotting is a
 * physical act with real risk to the plant and an afternoon of somebody's time,
 * and the evidence here is indirect by construction — nothing in this library
 * has seen a root.
 */

import { definePlugin } from 'smartplant'

/** Only announce a level change, not the level. */
let announced = null

export default definePlugin( {
	name        : 'transplant',
	description : 'Watches whether the pot is running out and guides the move to a bigger one.',
	persona     : 'botanist',
	schema      : {
		advice   : '',
		emoji    : '🪴',
		severity : 'low',
		index    : 'unknown',
		outlook  : '',
	},

	on : {
		// Cheap, and the only moment the picture can have changed.
		async 'sensor:reading'() {

			const now = this.plant.rootSpace?.()
			if ( !now || now.index === announced ) return

			// A move from high to medium is worth saying once. Saying it every
			// reading is how a person learns to ignore the plugin.
			const was = announced
			announced = now.index

			if ( now.index === 'low' || ( now.index === 'medium' && was === 'high' ) ) {

				await this.plant.events.emit( 'transplant:outlook', {
					index : now.index,
					outlook : now.outlook,
					confidence : now.confidence,
					evidence : now.evidence,
					why : now.why,
				} )

			}

		},
	},

	methods : {
		/**
		 * What the pot looks like from here.
		 *
		 * @returns {object} `{index, outlook, evidence, why}`.
		 */
		space() {

			const r = this.plant.rootSpace?.()

			if ( !r ) return {
				index : 'unknown',
				why : 'This build has no root-space estimate.',
			}

			return r

		},

		/**
		 * Everything worth knowing before tipping a plant out of its pot.
		 *
		 * The advice is deliberately about *checking* rather than about doing.
		 * The system cannot see the roots and the person is about to be holding
		 * them, which makes them the better instrument for the next five minutes.
		 *
		 * @returns {object} `{ready, checks, why}`.
		 */
		plan() {

			const r = this.space()
			const pot = this.plant.config?.pot

			if ( r.settling ) return {
				ready : false,
				why : r.why,
			}

			return {
				ready : r.index === 'low' || r.index === 'medium',
				current : pot?.litres ?? null,
				suggest : pot?.litres ? Number( ( pot.litres * 2.5 ).toFixed( 1 ) ) : null,
				checks : [
					'Look at the rootball before deciding. Roots circling the wall, a solid mat at the bottom, or soil that has turned to root are what this has been inferring from the outside.',
					'If the roots look fine, the drying was something else — a warmer spot, a draught, or a probe that has shifted — and the pot is not the problem.',
					'Roughly two to three times the volume. Much more than that and the substrate stays wet in the parts no root has reached, which drowns more plants than a tight pot ever has.',
					'Tell the system the new volume with `plant.transplant({ volumeL })`. Nothing else: the doses, the baselines and the caution are its job.',
				],
				why : r.index === 'low' || r.index === 'medium'
					? `${r.why} Worth looking. ${pot?.litres ? `Going from ${pot.litres}L to about ${( pot.litres * 2.5 ).toFixed( 1 )}L is the usual step.` : ''}`
					: `Not yet. ${r.why}`,
			}

		},

		/**
		 * Where a move is, if one is in progress.
		 *
		 * @returns {object} From `transplantStatus`.
		 */
		settling() {

			return this.plant.transplantStatus?.() ?? { phase : 'none' }

		},
	},
} )
