/**
 * @smartplant/migration — inheritance between plants.
 *
 * A mature plant leaves what it learned to a new plant of the same species.
 * Federated learning pools anonymous statistics from many homes; this is the
 * other shape of it — a directed transfer, one known source to one known
 * receiver, carrying the context needed to check itself on arrival.
 *
 * The plugin's job is to make that a two-line operation and to keep the two
 * refusals visible, because the refusals are where the value is:
 *
 *   · A policy learned in one unchanging spot does not travel, however much
 *     evidence stands behind it. It describes the spot, not the plant.
 *   · A policy about something the two environments disagree on is held back on
 *     arrival — it may be a fix for a problem the new plant does not have.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'migration',
	description : 'Exports what a mature plant learned and grafts it onto a new one of the same species.',
	persona     : 'scientist',
	schema      : {
		advice    : '',
		emoji     : '🧬',
		severity  : 'low',
		condition : '',
		confidence: 0,
	},

	async setup( plant, options ) {

		this.lastBundle = null

		// A bundle handed in at install time means "this plant is the heir".
		if ( options.inherit ) await this.receive( options.inherit, options )

	},

	methods : {

		/**
		 * Package this plant's inheritance.
		 *
		 * @param   {object}          [input] - Options for `exportInheritance`.
		 * @returns {Promise<object>}         `{bundle, shipped, withheld, summary}`.
		 */
		async bequeath( input = {} ) {

			const bundle = await this.plant.exportInheritance( input )
			this.lastBundle = bundle

			const shipped  = bundle.policies.map( p => p.action )
			const withheld = bundle.withheld.map( p => ( {
				action : p.action,
				trials : p.trials,
				why    : p.why,
			} ) )

			return {
				bundle,
				shipped,
				withheld,
				summary : shipped.length
					? `${shipped.length} polic${shipped.length === 1 ? 'y' : 'ies'} worth passing on, ${withheld.length} held back as too tied to this spot.`
					: `Nothing here is transferable yet: every policy was learned in conditions that never changed, so it describes this spot rather than this plant.`,
			}

		},

		/**
		 * Receive an inheritance from another plant.
		 *
		 * @param   {object}          bundle  - From `bequeath()`.
		 * @param   {object}          [input] - Options for `inherit`.
		 * @returns {Promise<object>}         `{compatibility, admitted, held, report}`.
		 */
		async receive( bundle, input = {} ) {

			const { inheritance, compatibility } = await this.plant.inherit( bundle, input )
			const report = inheritance.report()

			await this.plant.events.emit( 'migration:inherited', {
				species : report.species,
				admitted : report.admitted,
				held : report.held.length,
			} )

			return {
				compatibility,
				admitted : report.admitted,
				held     : report.held,
				report,
			}

		},

		/**
		 * What is currently inherited, and how much of it still applies.
		 *
		 * @returns {object} The report, or a note that nothing was inherited.
		 */
		status() {

			const inh = this.plant.inheritance
			if ( !inh ) return {
				inherited : false,
				summary : 'This plant has no inheritance; everything it knows, it measured itself.',
			}

			const report = inh.report()
			const shadow = report.shadow.length

			return {
				inherited : true,
				...report,
				summary : shadow
					? `${report.admitted} inherited polic${report.admitted === 1 ? 'y' : 'ies'}, ${shadow} still advisory until this plant has outcomes of its own.`
					: `${report.admitted} inherited polic${report.admitted === 1 ? 'y' : 'ies'}, all now weighed against this plant's own record.`,
			}

		},

		/**
		 * Record an outcome so the inheritance dilutes as it should.
		 *
		 * @param   {string} action - Action id.
		 * @param   {number} reward - What it was worth here.
		 * @returns {object}        The blended estimate afterwards.
		 */
		outcome( action, reward ) {

			if ( !this.plant.inheritance ) {

				throw new Error( 'Nothing has been inherited, so there is no prior to dilute. Call receive() first.' )

			}

			this.plant.inheritance.recordLocal( action, reward )
			return this.plant.inheritance.blend( action )

		},

		/**
		 * Would this bundle suit this plant at all?
		 *
		 * Answers before anything is changed, which is the question worth asking
		 * first when a bundle arrives from a very different room.
		 *
		 * @param   {object} bundle - A bundle.
		 * @returns {object}        `{compatible, verdict, overlap}`.
		 */
		async wouldSuit( bundle ) {

			const { compareConditions, summarizeConditions } = await import( 'smartplant/migration' )
			const here = summarizeConditions( this.plant.memory.since( 24 * 30 ) )

			return compareConditions( bundle?.conditions || {}, here || {} )

		},

	},
} )
