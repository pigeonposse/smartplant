/**
 * Safety supervisor.
 *
 * The layer that makes autonomy survivable. A mobile plant that drives itself
 * flat, or into a wall, or waters until the pot overflows, is worse than one
 * that never moved — so this layer holds hard limits that no planner, no model
 * and no plugin can talk its way past.
 *
 * The rule throughout: **the safe action is the default, and it is chosen by
 * arithmetic, not by a model.** Energy reserve, geofence and watchdog decisions
 * are all deterministic and auditable.
 */

import { EventBus } from '../core/events.js'
import { SmartPlantError } from '../core/errors.js'

/** Verdict kinds returned by `validate`. */
export const VERDICT = {
	ALLOW   : 'allow',
	MODIFY  : 'modify',
	DENY    : 'deny',
}

/**
 * Energy manager.
 *
 * Answers one question honestly: *if I start this, can I still get home?*
 * The reserve is not a percentage of the battery, it is the measured cost of
 * returning plus a margin — because "20% left" means nothing if home is 40%
 * of a battery away.
 */
export class EnergyManager {

	/**
	 * @param {object} [opts]                  - Options.
	 * @param {number} [opts.capacityWh]       - Usable battery capacity.
	 * @param {number} [opts.reserveFraction]  - Fraction always held back.
	 * @param {number} [opts.idleDrawW]        - Baseline draw when parked.
	 * @param {number} [opts.moveDrawW]        - Draw while moving.
	 * @param {number} [opts.speedMs]          - Travel speed, m/s.
	 * @param {number} [opts.criticalFraction] - Below this, only survival actions.
	 */
	constructor( opts = {} ) {

		this.capacityWh      = opts.capacityWh ?? 50
		this.reserveFraction = opts.reserveFraction ?? 0.15
		this.idleDrawW       = opts.idleDrawW ?? 0.5
		this.moveDrawW       = opts.moveDrawW ?? 12
		this.speedMs         = opts.speedMs ?? 0.15
		this.criticalFraction = opts.criticalFraction ?? 0.1

		/** @type {number} 0-1 */
		this.stateOfCharge = opts.stateOfCharge ?? 1
		this.charging = false
		this.lastUpdate = Date.now()

	}

	/**
	 * Report the current battery state.
	 *
	 * @param   {object} state             - `{ stateOfCharge, charging, voltage }`.
	 * @returns {EnergyManager}            this
	 */
	update( state = {} ) {

		if ( Number.isFinite( state.stateOfCharge ) ) {

			this.stateOfCharge = Math.min( 1, Math.max( 0, state.stateOfCharge ) )

		}
		if ( state.charging !== undefined ) this.charging = !!state.charging
		this.lastUpdate = Date.now()
		return this

	}

	get availableWh() {

		return this.capacityWh * this.stateOfCharge

	}

	get reserveWh() {

		return this.capacityWh * this.reserveFraction

	}

	get critical() {

		return !this.charging && this.stateOfCharge <= this.criticalFraction

	}

	/**
	 * Estimate what a mission costs, including getting back.
	 *
	 * @param   {object} mission                 - Mission description.
	 * @param   {number} [mission.distanceM]     - One-way distance.
	 * @param   {number} [mission.returnDistanceM] - Distance home afterwards.
	 * @param   {number} [mission.durationS]     - Non-travel duration.
	 * @param   {number} [mission.extraW]        - Extra load during the mission.
	 * @returns {object}                         `{travelWh, idleWh, returnWh, totalWh}`.
	 */
	estimate( mission = {} ) {

		const distance = mission.distanceM ?? 0
		// If no explicit return leg is given, assume it is as far back as it was out.
		const returnDistance = mission.returnDistanceM ?? distance
		const durationS = mission.durationS ?? 0
		const extraW = mission.extraW ?? 0

		const travelS = this.speedMs > 0 ? distance / this.speedMs : 0
		const returnS = this.speedMs > 0 ? returnDistance / this.speedMs : 0

		const wh = ( watts, seconds ) => ( watts * seconds ) / 3600

		const travelWh = wh( this.moveDrawW + extraW, travelS )
		const returnWh = wh( this.moveDrawW, returnS )
		const idleWh   = wh( this.idleDrawW + extraW, durationS )

		return {
			travelWh : round( travelWh ),
			idleWh   : round( idleWh ),
			returnWh : round( returnWh ),
			totalWh  : round( travelWh + idleWh + returnWh ),
			travelS  : Math.round( travelS + returnS ),
		}

	}

	/**
	 * Can this mission run without stranding the plant?
	 *
	 * @param   {object} mission - Mission description.
	 * @returns {object}         `{ok, reason, estimate, marginWh}`.
	 */
	afford( mission = {} ) {

		const estimate = this.estimate( mission )
		const usable = this.availableWh - this.reserveWh
		const marginWh = round( usable - estimate.totalWh )

		if ( this.critical ) {

			return {
				ok : false,
				reason : `Battery critical (${Math.round( this.stateOfCharge * 100 )}%). Only survival actions allowed.`,
				estimate,
				marginWh,
			}

		}

		if ( marginWh < 0 ) {

			return {
				ok : false,
				reason : `Needs ${estimate.totalWh}Wh including the return leg, but only ${round( usable )}Wh is available above the ${round( this.reserveWh )}Wh reserve.`,
				estimate,
				marginWh,
			}

		}

		return {
			ok : true,
			reason : `${marginWh}Wh margin after the return leg.`,
			estimate,
			marginWh,
		}

	}

	/**
	 * How long the plant can sit still on what is left.
	 *
	 * @returns {number} Hours.
	 */
	idleHoursRemaining() {

		if ( this.idleDrawW <= 0 ) return Infinity
		return round( ( this.availableWh - this.reserveWh ) / this.idleDrawW )

	}

}

/**
 * Geofence over a polygon, with optional keep-out zones.
 *
 * Coordinates are plain metres in a room frame — a home robot does not have GPS
 * and does not need it. Keeping this in a local Cartesian frame avoids a whole
 * class of projection bugs.
 */
export class Geofence {

	/**
	 * @param {object}   [opts]         - Options.
	 * @param {number[][]} [opts.bounds]  - Allowed polygon `[[x,y], …]`.
	 * @param {object[]} [opts.keepOut] - `[{ polygon, name }]`.
	 * @param {number}   [opts.maxDistanceM] - Max distance from home.
	 */
	constructor( opts = {} ) {

		this.bounds = opts.bounds || null
		this.keepOut = opts.keepOut || []
		this.maxDistanceM = opts.maxDistanceM ?? null
		this.home = opts.home || [ 0, 0 ]

	}

	/**
	 * Is a point allowed?
	 *
	 * @param   {number[]} point - `[x, y]` in metres.
	 * @returns {object}         `{ok, reason}`.
	 */
	contains( point ) {

		const [ x, y ] = point

		if ( !Number.isFinite( x ) || !Number.isFinite( y ) ) {

			return {
				ok : false,
				reason : 'Position is unknown — refusing to move without localization.',
			}

		}

		if ( this.bounds && !pointInPolygon( point, this.bounds ) ) {

			return {
				ok : false,
				reason : `Target (${x.toFixed( 2 )}, ${y.toFixed( 2 )}) is outside the allowed area.`,
			}

		}

		for ( const zone of this.keepOut ) {

			if ( pointInPolygon( point, zone.polygon ) ) {

				return {
					ok : false,
					reason : `Target is inside keep-out zone "${zone.name || 'unnamed'}".`,
				}

			}

		}

		if ( this.maxDistanceM !== null ) {

			const d = Math.hypot( x - this.home[ 0 ], y - this.home[ 1 ] )
			if ( d > this.maxDistanceM ) {

				return {
					ok : false,
					reason : `Target is ${d.toFixed( 2 )}m from home, beyond the ${this.maxDistanceM}m limit.`,
				}

			}

		}

		return {
			ok : true,
			reason : 'Inside the allowed area.',
		}

	}

	/** Straight-line distance from home to a point. */
	distanceFromHome( point ) {

		return Math.hypot( point[ 0 ] - this.home[ 0 ], point[ 1 ] - this.home[ 1 ] )

	}

}

/** Ray-casting point-in-polygon. */
export function pointInPolygon( point, polygon ) {

	const [ x, y ] = point
	let inside = false

	for ( let i = 0, j = polygon.length - 1; i < polygon.length; j = i++ ) {

		const [ xi, yi ] = polygon[ i ]
		const [ xj, yj ] = polygon[ j ]

		const intersects = ( yi > y ) !== ( yj > y )
			&& x < ( ( xj - xi ) * ( y - yi ) ) / ( yj - yi ) + xi

		if ( intersects ) inside = !inside

	}

	return inside

}

/**
 * Watchdog.
 *
 * If the control loop stops feeding it, everything stops. This is the last line
 * of defence against a hung process leaving a pump running or a motor driving.
 * In a real build the same signal should also gate a hardware relay, because a
 * watchdog inside the process that died cannot save you.
 */
export class Watchdog {

	/**
	 * @param {object}   [opts]           - Options.
	 * @param {number}   [opts.timeoutMs] - Time without a heartbeat before tripping.
	 * @param {Function} [opts.onTrip]    - Called when it trips.
	 */
	constructor( opts = {} ) {

		this.timeoutMs = opts.timeoutMs ?? 5000
		this.onTrip = opts.onTrip || null
		this.lastBeat = null
		this.tripped = false
		this._timer = null

	}

	start() {

		if ( this._timer ) return this
		this.lastBeat = Date.now()
		this.tripped = false

		this._timer = setInterval( () => {

			if ( this.tripped ) return
			if ( Date.now() - this.lastBeat > this.timeoutMs ) this.trip( 'heartbeat timeout' )

		}, Math.max( 100, Math.floor( this.timeoutMs / 4 ) ) )

		this._timer.unref?.()
		return this

	}

	/** Feed it. Call from the control loop. */
	beat() {

		this.lastBeat = Date.now()
		return this

	}

	trip( reason = 'unknown' ) {

		if ( this.tripped ) return this
		this.tripped = true
		this.onTrip?.( reason )
		return this

	}

	reset() {

		this.tripped = false
		this.lastBeat = Date.now()
		return this

	}

	stop() {

		if ( this._timer ) clearInterval( this._timer )
		this._timer = null
		return this

	}

}

/**
 * The supervisor: every mission passes through here, and it can say no.
 *
 * Deliberately not pluggable in the way the rest of the library is. A safety
 * layer that a plugin can replace is not a safety layer.
 */
export class SafetySupervisor {

	/**
	 * @param {object} [opts]           - Options.
	 * @param {object} [opts.energy]    - `EnergyManager` options or instance.
	 * @param {object} [opts.geofence]  - `Geofence` options or instance.
	 * @param {object} [opts.watchdog]  - `Watchdog` options.
	 * @param {object} [opts.limits]    - `{ maxSpeedMs, maxWaterMl, minMoveIntervalMs }`.
	 */
	constructor( opts = {} ) {

		this.energy = opts.energy instanceof EnergyManager
			? opts.energy
			: new EnergyManager( opts.energy || {} )

		this.geofence = opts.geofence instanceof Geofence
			? opts.geofence
			: new Geofence( opts.geofence || {} )

		this.events = new EventBus()

		this.watchdog = new Watchdog( {
			...opts.watchdog,
			onTrip : reason => {

				this.emergencyStop( `watchdog: ${reason}` )

			},
		} )

		this.limits = {
			maxSpeedMs        : 0.4,
			maxWaterMl        : 500,
			minMoveIntervalMs : 60_000,
			...opts.limits,
		}

		this.stopped = false
		this.stopReason = null
		this.lastMoveAt = null
		/** @type {object[]} */
		this.log = []

	}

	/**
	 * Validate a mission against every hard limit.
	 *
	 * @param   {object} mission               - Mission.
	 * @param   {string} mission.type          - `'move'` | `'water'` | `'idle'` | …
	 * @param   {number[]} [mission.target]    - `[x, y]` for a move.
	 * @param   {number[]} [mission.from]      - Current position.
	 * @param   {number} [mission.amountMl]    - For a watering.
	 * @param   {number} [mission.speedMs]     - Requested speed.
	 * @returns {object}                       `{verdict, reasons, mission, estimate}`.
	 */
	validate( mission = {} ) {

		const reasons = []
		let verdict = VERDICT.ALLOW
		let adjusted = { ...mission }

		const deny = reason => {

			verdict = VERDICT.DENY
			reasons.push( reason )

		}
		const modify = ( reason, patch ) => {

			if ( verdict !== VERDICT.DENY ) verdict = VERDICT.MODIFY
			reasons.push( reason )
			adjusted = {
				...adjusted,
				...patch,
			}

		}

		if ( this.stopped ) deny( `Emergency stop is active: ${this.stopReason}` )

		if ( mission.type === 'move' ) {

			const from = mission.from || this.geofence.home
			const target = mission.target

			if ( !target ) deny( 'Move mission has no target.' )
			else {

				const fence = this.geofence.contains( target )
				if ( !fence.ok ) deny( fence.reason )

				const distanceM = Math.hypot( target[ 0 ] - from[ 0 ], target[ 1 ] - from[ 1 ] )
				const returnDistanceM = this.geofence.distanceFromHome( target )

				const afford = this.energy.afford( {
					distanceM,
					returnDistanceM,
					durationS : mission.durationS,
				} )
				if ( !afford.ok ) deny( afford.reason )
				adjusted.estimate = afford.estimate

				if ( ( mission.speedMs ?? 0 ) > this.limits.maxSpeedMs ) {

					modify(
						`Speed capped to ${this.limits.maxSpeedMs} m/s.`,
						{ speedMs : this.limits.maxSpeedMs },
					)

				}

				// Rate-limit relocations: a plant shuffled every minute is being
				// harassed, not cared for, and each move costs energy.
				if ( this.lastMoveAt && Date.now() - this.lastMoveAt < this.limits.minMoveIntervalMs ) {

					const waitS = Math.ceil( ( this.limits.minMoveIntervalMs - ( Date.now() - this.lastMoveAt ) ) / 1000 )
					deny( `Moved too recently — ${waitS}s until another move is allowed.` )

				}

			}

		}

		if ( mission.type === 'water' ) {

			const amount = mission.amountMl ?? 0
			if ( amount > this.limits.maxWaterMl ) {

				modify(
					`Watering capped to ${this.limits.maxWaterMl}ml (requested ${amount}ml).`,
					{ amountMl : this.limits.maxWaterMl },
				)

			}
			if ( amount <= 0 ) deny( 'Watering amount must be positive.' )

		}

		const record = {
			at      : new Date().toISOString(),
			type    : mission.type,
			verdict,
			reasons,
		}
		this.log.push( record )
		if ( this.log.length > 500 ) this.log.shift()

		return {
			verdict,
			allowed : verdict !== VERDICT.DENY,
			reasons,
			mission : adjusted,
			explanation : reasons.length
				? `${verdict.toUpperCase()}: ${reasons.join( ' ' )}`
				: 'ALLOW: within all limits.',
		}

	}

	/** Record that a move actually happened, for rate limiting. */
	notifyMoved() {

		this.lastMoveAt = Date.now()
		return this

	}

	/**
	 * Stop everything. Idempotent.
	 *
	 * @param   {string} reason - Why.
	 * @returns {SafetySupervisor} this
	 */
	emergencyStop( reason = 'manual' ) {

		if ( this.stopped ) return this
		this.stopped = true
		this.stopReason = reason
		this.events.emit( 'safety:stop', { reason } )
		return this

	}

	/** Clear an emergency stop. Deliberately explicit — never automatic. */
	clearStop() {

		this.stopped = false
		this.stopReason = null
		this.events.emit( 'safety:cleared', {} )
		return this

	}

	/**
	 * The action to take when there is not enough energy or confidence to do
	 * anything else. Staying put and conserving is always available.
	 *
	 * @returns {object} A survival mission.
	 */
	safeMode() {

		return {
			type   : 'idle',
			reason : this.energy.critical
				? `Battery at ${Math.round( this.energy.stateOfCharge * 100 )}% — conserving.`
				: 'No safe action available; holding position.',
			idleHoursRemaining : this.energy.idleHoursRemaining(),
		}

	}

	on( event, fn ) {

		return this.events.on( event, fn )

	}

}

function round( v ) {

	return Number.isFinite( v ) ? Number( v.toFixed( 3 ) ) : 0

}

export { SmartPlantError }
