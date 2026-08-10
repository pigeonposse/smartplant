/**
 * @smartplant/pests — pest risk from conditions, and identification from symptoms.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'pests',
	description : 'Estimates pest risk from environmental conditions and identifies pests from symptoms.',
	persona     : 'botanist',
	schema      : {
		advice    : '',
		emoji     : '🐛',
		severity  : 'low',
		risk      : 'low',
		suspects  : [],
		treatment : '',
	},

	methods : {
		/**
		 * Assess pest risk from current conditions.
		 *
		 * @param   {object}          [input]          - Extra facts.
		 * @param   {string}          [input.symptoms] - Observed symptoms, if any.
		 * @returns {Promise<object>}                  `{advice, risk, suspects, treatment}`.
		 */
		async monitorPests( input = {} ) {

			return this.ask(
				'Assess pest risk for this plant. Warm and humid conditions favour some pests, hot and dry others. '
				+ 'If symptoms are given, name the most likely suspects. risk must be low, medium or high. '
				+ 'Prefer least-toxic treatment first.',
				{ extra : input },
			)

		},

		/**
		 * Identify a pest from a described symptom, and log it to the care history
		 * so later analyses know it happened.
		 *
		 * @param   {string}          symptoms - What the owner sees.
		 * @returns {Promise<object>}          Identification result.
		 */
		async identify( symptoms ) {

			const result = await this.ask(
				`The owner reports these symptoms: "${symptoms}". Identify the most likely cause `
				+ '(pest, disease or care issue) and the first treatment step.',
				{ schema : {
					advice    : '',
					emoji     : '🔍',
					severity  : 'medium',
					suspects  : [],
					treatment : '',
				} },
			)
			await this.plant.log( 'pest-report', {
				symptoms,
				suspects : result.suspects,
			} )
			return result

		},
	},
} )
