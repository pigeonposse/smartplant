/**
 * @smartplant/alerts — species-aware alerting.
 *
 * The kernel already emits mechanical threshold events; this plugin adds the
 * judgement layer: which of them actually matter for *this* species right now.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'alerts',
	description : 'Turns raw threshold breaches into species-aware, prioritized alerts.',
	persona     : 'botanist',
	schema      : {
		advice    : '',
		emoji     : '✅',
		severity  : 'low',
		triggered : false,
		actions   : [],
	},

	setup() {

		this.history = []

	},

	on : {
		async alert( event ) {

			// Only escalate to the AI for genuinely bad readings; mild drift is noise.
			if ( !event.critical ) return
			const result = await this.checkAlerts()
			this.history.push( {
				at : new Date().toISOString(),
				...result,
			} )

		},
	},

	methods : {
		/**
		 * Evaluate the current state and decide whether to alert.
		 *
		 * @param   {object}          [input] - Extra facts.
		 * @returns {Promise<object>}         `{advice, emoji, severity, triggered, actions}`.
		 */
		async checkAlerts( input = {} ) {

			const ctx = this.context()

			// No deviations means no alert — don't spend a request to be told so.
			if ( !ctx.deviations.length ) {

				return {
					advice    : 'Everything is within range. No action needed.',
					emoji     : '✅',
					severity  : 'low',
					triggered : false,
					actions   : [],
					offline   : true,
				}

			}

			const result = await this.ask(
				'Which of these out-of-range readings genuinely threaten this plant, and what should be done first? '
				+ 'Set severity to low, medium or high, and triggered to true only if action is needed today.',
				{ extra : input },
			)

			return {
				...result,
				emoji     : result.emoji || severityEmoji( result.severity ),
				triggered : result.triggered ?? true,
			}

		},

		/** Alerts raised in this session. */
		recent( n = 10 ) {

			return this.history.slice( -n )

		},
	},
} )

function severityEmoji( severity ) {

	if ( severity === 'high' ) return '🚨'
	if ( severity === 'medium' ) return '⚠️'
	return '✅'

}
