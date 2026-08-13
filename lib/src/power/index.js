/**
 * Running on a battery, and deciding what the battery is for.
 *
 * A plant on a windowsill has mains power and none of this matters. A plant on
 * wheels, or in a greenhouse with a panel on the roof, has a fixed amount of
 * energy per day and a set of subsystems that would each happily consume all of
 * it. Something has to choose, and the interesting thing is that the right
 * choice depends on the plant.
 *
 * ## The choice is not generic
 *
 * The obvious power-saving rule is "shut things down at night". For most plants
 * that is right: the camera sees nothing, the light sensor confirms darkness it
 * already knew about, and no spectral probe may run anyway because irradiating
 * through the dark period destroys the circadian signal the rest of the library
 * depends on.
 *
 * For a CAM plant it is exactly wrong. Those open their stomata at night; night
 * is when everything interesting happens, and an energy policy that sleeps
 * through it saves power by discarding the only measurements worth having.
 *
 * So the archetype decides. This is the second place in the library where that
 * single flag inverts a policy rather than adjusting a number, and it is the
 * same reason: the model of the plant is different, not merely tuned.
 *
 * ## Estimating harvest is a guess, and says so
 *
 * A panel's yield depends on irradiance, angle, temperature, dust and shade.
 * None of that is measured by a light sensor pointed at a plant, and lux is not
 * irradiance — the conversion depends on the spectrum, which is exactly the same
 * trap as lux to PAR. So harvest is estimated from panel rating and daylight
 * hours, labelled as an estimate, and the only thing that turns it into a
 * measurement is a current sensor on the panel.
 */

/** What each subsystem costs and what it is worth. */
export const SUBSYSTEMS = {
	sensors : {
		label : 'Environmental sensors',
		draw  : 0.15,
		// Nothing else works without these. The floor, in every mode.
		essential : true,
	},
	electrode : {
		label : 'Electrode and signal chain',
		draw  : 0.4,
		essential : false,
	},
	radio : {
		label : 'Colony radio',
		draw  : 0.25,
		essential : false,
	},
	camera : {
		label : 'Camera',
		draw  : 1.2,
		essential : false,
	},
	spectral : {
		label : 'Spectral lamp',
		draw  : 6,
		essential : false,
	},
	compute : {
		label : 'Compute',
		draw  : 0.8,
		essential : true,
	},
	motion : {
		label : 'Drive motors',
		draw  : 12,
		essential : false,
	},
}

/** How much of the battery each mode is allowed to spend, and on what. */
export const MODES = {
	full : {
		label : 'Full',
		floor : 0.6,
		runs  : [ 'sensors', 'compute', 'electrode', 'radio', 'camera', 'spectral' ],
		why   : 'Enough charge for everything, including the lamp.',
	},
	measuring : {
		label : 'Measuring',
		floor : 0.35,
		runs  : [ 'sensors', 'compute', 'electrode', 'radio' ],
		why   : 'The lamp and the camera are the expensive ones and the least often needed. Everything that listens keeps listening.',
	},
	frugal : {
		label : 'Frugal',
		floor : 0.15,
		runs  : [ 'sensors', 'compute', 'electrode' ],
		why   : 'Off the network, still measuring. The electrode stays on because it is the one channel that sees anything the others cannot.',
	},
	survival : {
		label : 'Survival',
		floor : 0,
		runs  : [ 'sensors', 'compute' ],
		why   : 'Enough to know what is happening and to write it down. Everything else waits for charge.',
	},
}

export const MODE_ORDER = [ 'survival', 'frugal', 'measuring', 'full' ]

/**
 * A solar panel, and what it is likely to give you.
 */
export class SolarSupply {

	/**
	 * @param {object} [opts]              - Options.
	 * @param {number} [opts.wattsPeak]    - Panel rating at full sun.
	 * @param {number} [opts.efficiency]   - Realised fraction of rating. Default 0.55.
	 * @param {number} [opts.daylightHours]- Usable hours per day. Default 5.
	 * @param {string} [opts.orientation]  - Free text, recorded for the report.
	 */
	constructor( opts = {} ) {

		this.wattsPeak = opts.wattsPeak ?? 0
		// Panels indoors or behind glass do far worse than a datasheet suggests,
		// and 0.55 is already optimistic for anything not on a roof.
		this.efficiency = opts.efficiency ?? 0.55
		this.daylightHours = opts.daylightHours ?? 5
		this.orientation = opts.orientation ?? null

		/** Real measurements, when a current sensor provides them. */
		this.measured = []

	}

	/**
	 * Record what the panel actually produced.
	 *
	 * The only thing that turns the estimate below into a fact.
	 *
	 * @param   {number} watts - Measured output.
	 * @param   {object} [opts] - `{ at }`.
	 * @returns {object}       The record.
	 */
	record( watts, opts = {} ) {

		const entry = {
			at : opts.at ?? Date.now(),
			watts,
		}
		this.measured.push( entry )
		if ( this.measured.length > 500 ) this.measured.shift()
		return entry

	}

	/**
	 * Expected energy per day.
	 *
	 * @returns {object} `{wh, measured, why}`.
	 */
	daily() {

		if ( this.measured.length >= 12 ) {

			const mean = this.measured.reduce( ( a, m ) => a + m.watts, 0 ) / this.measured.length

			return {
				wh : Number( ( mean * 24 ).toFixed( 1 ) ),
				measured : true,
				samples : this.measured.length,
				why : `Measured: ${mean.toFixed( 2 )}W average across ${this.measured.length} readings from the panel itself.`,
			}

		}

		if ( !this.wattsPeak ) {

			return {
				wh : 0,
				measured : false,
				why : 'No panel configured. On battery alone, every subsystem is spending a fixed budget that nothing replaces.',
			}

		}

		const wh = this.wattsPeak * this.efficiency * this.daylightHours

		return {
			wh : Number( wh.toFixed( 1 ) ),
			measured : false,
			// Said every time, because the number looks like a measurement.
			why : `Estimated from a ${this.wattsPeak}W panel at ${Math.round( this.efficiency * 100 )}% over ${this.daylightHours}h. This is arithmetic, not a measurement: real yield depends on angle, temperature, dust and shade, and a light sensor pointed at a plant cannot tell you any of them. A current sensor on the panel would replace this guess with a fact.`,
		}

	}

}

/**
 * Deciding what the battery is for.
 */
export class PowerBudget {

	/**
	 * @param {object} [opts]             - Options.
	 * @param {number} [opts.capacityWh]  - Usable capacity.
	 * @param {number} [opts.charge]      - Current state of charge, 0-1.
	 * @param {object} [opts.solar]       - A `SolarSupply` or its options.
	 * @param {object} [opts.draws]       - Per-subsystem overrides, watts.
	 * @param {object} [opts.archetype]   - The plant's archetype, for night policy.
	 */
	constructor( opts = {} ) {

		this.capacityWh = opts.capacityWh ?? 0
		this.charge = opts.charge ?? 1
		this.solar = opts.solar instanceof SolarSupply
			? opts.solar
			: new SolarSupply( opts.solar || {} )
		this.draws = {
			...Object.fromEntries( Object.entries( SUBSYSTEMS ).map( ( [ k, v ] ) => [ k, v.draw ] ) ),
			...opts.draws,
		}
		this.archetype = opts.archetype ?? null

		/** Set while the plant is actually driving somewhere. */
		this.moving = false

	}

	/** Which mode the current charge permits. */
	mode() {

		if ( !this.capacityWh ) return MODES.full

		for ( const id of [ ...MODE_ORDER ].reverse() ) {

			if ( this.charge >= MODES[ id ].floor ) return {
				id,
				...MODES[ id ],
			}

		}

		return {
			id : 'survival',
			...MODES.survival,
		}

	}

	/**
	 * Which subsystems should be running right now.
	 *
	 * @param   {object} [opts] - `{ night, moving }`.
	 * @returns {object}        `{mode, running, asleep, why}`.
	 */
	plan( opts = {} ) {

		const mode = this.mode()
		const night = opts.night ?? false
		const moving = opts.moving ?? this.moving

		const running = new Set( mode.runs )
		const reasons = []

		// Moving is the most expensive thing this plant can do by a wide margin,
		// and it is also the one thing that cannot be done slowly. While the
		// motors are turning, measurement waits.
		if ( moving ) {

			for ( const id of [ 'spectral', 'camera', 'electrode' ] ) running.delete( id )
			running.add( 'motion' )
			reasons.push( 'Moving: the motors take more than everything else combined, so measurement pauses until the plant has arrived. An electrode reading taken while the pot is rolling is measuring the journey anyway.' )

		}

		if ( night ) {

			// The lamp goes off for everybody, and this is not a power decision:
			// irradiating through the dark period destroys the circadian signal the
			// rest of the library reads, and no amount of spare charge makes that a
			// good trade. It matters *most* on a CAM plant, whose active hours these
			// are — the one it would be most tempting to light up is the one where
			// lighting it would do the most harm.
			running.delete( 'spectral' )
			running.delete( 'camera' )

			if ( this.archetype?.nocturnal ) {

				// The inversion. For most plants night is when nothing is worth
				// watching; for a CAM plant it is the only time anything is.
				running.add( 'electrode' )
				running.add( 'sensors' )
				reasons.push( 'Night, and this is a CAM plant: its stomata open now and everything worth measuring happens in the dark, so the electrode stays on even at low charge. The lamp does not — this is precisely the plant that must not be irradiated through its active hours.' )

			}
			else {

				reasons.push( 'Night: the camera sees nothing without a light, and no spectral probe may run through the dark period regardless of charge — irradiating then destroys the circadian signal the rest of the library reads.' )

			}

		}

		// The floor. Nothing takes these away.
		for ( const [ id, s ] of Object.entries( SUBSYSTEMS ) ) {

			if ( s.essential ) running.add( id )

		}

		const asleep = Object.keys( SUBSYSTEMS ).filter( id => !running.has( id ) )
		const drawW = [ ...running ].reduce( ( a, id ) => a + ( this.draws[ id ] ?? 0 ), 0 )

		return {
			mode : mode.id,
			running : [ ...running ],
			asleep,
			drawW : Number( drawW.toFixed( 2 ) ),
			why : [ mode.why, ...reasons ].join( ' ' ),
		}

	}

	/**
	 * How long the current plan lasts, and whether solar covers it.
	 *
	 * @param   {object} [opts] - Passed to `plan`.
	 * @returns {object}        `{hours, sustainable, harvest, why}`.
	 */
	forecast( opts = {} ) {

		const plan = this.plan( opts )
		const harvest = this.solar.daily()

		if ( !this.capacityWh ) {

			return {
				plan,
				unlimited : true,
				why : 'No battery configured, so this is a mains plant and none of this applies.',
			}

		}

		const stored = this.capacityWh * this.charge
		const hours = plan.drawW > 0 ? stored / plan.drawW : Infinity
		const dailyNeed = plan.drawW * 24
		const sustainable = harvest.wh >= dailyNeed

		return {
			plan,
			harvest,
			storedWh : Number( stored.toFixed( 1 ) ),
			hours : Number( hours.toFixed( 1 ) ),
			dailyNeedWh : Number( dailyNeed.toFixed( 1 ) ),
			sustainable,
			why : sustainable
				? `Drawing ${plan.drawW}W needs ${dailyNeed.toFixed( 0 )}Wh a day and the panel ${harvest.measured ? 'is producing' : 'should produce'} ${harvest.wh}Wh, so this runs indefinitely. ${harvest.why}`
				: `Drawing ${plan.drawW}W needs ${dailyNeed.toFixed( 0 )}Wh a day against ${harvest.wh}Wh coming in. The stored ${stored.toFixed( 0 )}Wh covers about ${hours.toFixed( 0 )}h at this rate before the mode has to drop. ${harvest.why}`,
		}

	}

	/**
	 * Can this plant afford to go somewhere?
	 *
	 * @param   {number} metres - Distance one way.
	 * @param   {object} [opts] - `{ speedMs }`.
	 * @returns {object}        `{afford, cost, why}`.
	 */
	canTravel( metres, opts = {} ) {

		if ( !this.capacityWh ) return {
			afford : true,
			why : 'Mains powered.',
		}

		const speed = opts.speedMs ?? 0.1
		// There and back. A plant that spends its last charge arriving somewhere
		// is a plant stranded there.
		const seconds = ( metres * 2 ) / speed
		const cost = ( this.draws.motion * seconds ) / 3600
		const stored = this.capacityWh * this.charge
		const reserve = this.capacityWh * MODES.frugal.floor

		const afford = stored - cost >= reserve

		return {
			afford,
			costWh : Number( cost.toFixed( 1 ) ),
			storedWh : Number( stored.toFixed( 1 ) ),
			reserveWh : Number( reserve.toFixed( 1 ) ),
			why : afford
				? `${metres}m there and back costs about ${cost.toFixed( 1 )}Wh of the ${stored.toFixed( 0 )}Wh stored, leaving enough to keep measuring afterwards.`
				: `${metres}m there and back costs ${cost.toFixed( 1 )}Wh and only ${stored.toFixed( 0 )}Wh is stored, of which ${reserve.toFixed( 0 )}Wh has to stay behind. The return leg is included in that figure on purpose: a plant that spends its last charge arriving somewhere is stranded there.`,
		}

	}

	/** A readable summary. */
	report( opts = {} ) {

		const f = this.forecast( opts )

		return {
			charge : this.charge,
			...f,
			verdict : f.unlimited
				? 'Mains powered.'
				: `${f.plan.mode} mode at ${Math.round( this.charge * 100 )}% charge, running ${f.plan.running.length} subsystem(s), ${f.plan.asleep.length} asleep.`,
		}

	}

}
