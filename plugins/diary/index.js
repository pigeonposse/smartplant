/**
 * @smartplant/diary — the plant writes its own journal.
 *
 * The most direct expression of the "closer communication" goal: a daily entry
 * in the plant's own voice, grounded in the day's real readings and events.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'diary',
	description : 'Writes dated journal entries in the plant\'s own voice from real readings.',
	persona     : 'plant',
	schema      : {
		advice  : '',
		entry   : '',
		emoji   : '📔',
		mood    : 'content',
	},

	methods : {
		/**
		 * Write and store a journal entry for the period.
		 *
		 * @param   {object}          [input]         - Options.
		 * @param   {number}          [input.hours]   - Period to cover. Default 24.
		 * @returns {Promise<object>}                 `{entry, mood, emoji}`.
		 */
		async logAndSummarize( input = {} ) {

			const hours  = input.hours ?? 24
			const rows   = this.plant.memory.since( hours )
			const events = ( this.plant.memory.data.events || [] )
				.filter( e => Date.now() - new Date( e.t ).getTime() < hours * 3600_000 )

			const result = await this.ask(
				`Write a short diary entry (2-4 sentences) covering the last ${hours} hours, in first person, `
				+ 'as the plant. Mention what actually happened — what you felt, what was done for you. '
				+ 'mood is one word.',
				{
					extra : {
						readings : rows.length,
						stats    : this.plant.memory.stats( hours ),
						events,
					},
				},
			)

			const entry = result.entry || result.advice
			await this.plant.memory.addNote( entry, 'plant' )

			return {
				...result,
				entry,
			}

		},

		/** Stored entries written by the plant, newest first. */
		entries( n = 10 ) {

			return this.plant.memory.notes.filter( x => x.author === 'plant' ).slice( -n ).reverse()

		},
	},
} )
