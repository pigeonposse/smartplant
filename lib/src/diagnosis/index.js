/**
 * Is this setup actually working?
 *
 * Somebody has just wired a plant: a probe in the soil, maybe an electrode, an
 * API key in a file, a lamp on a relay. Everything *looks* connected. The
 * question they need answered before they walk away for a month is whether it
 * is, and if not, which wire.
 *
 * That is a different question from the two the library already answers.
 * `checkup()` asks how the plant has been changing. `maintenance()` asks whether
 * the instrument can still be believed once it has been running a while. This
 * asks the first question of all — **does any of this work yet** — and it has to
 * be answerable on a plant with no history, no baseline, and nothing recorded.
 *
 * Two rules shape what it reports.
 *
 * **Not configured is not broken.** A setup with no camera is not failing; it
 * simply has no camera, and telling somebody their vision system is down when
 * they never wanted one is noise that trains people to ignore warnings. Absent
 * subsystems are reported as absent, and only what was asked for can fail.
 *
 * **Every red line ends in something to do.** "Electrode: degraded" is a fact
 * with no next step. "The trace is flat — the lead is probably not making
 * contact with the plant; reseat it and run this again" is the same fact with
 * the walk to the windowsill included.
 */

import { CONDITION, electrodeQuality, implausible, stuckReading, PLAUSIBLE } from '../maintenance/index.js'

/** What a single check can come back as. */
export const RESULT = {
	OK      : 'ok',
	WARN    : 'warn',
	FAIL    : 'fail',
	ABSENT  : 'absent',
}

const ICON = {
	ok     : '🟢',
	warn   : '🟡',
	fail   : '🔴',
	absent : '⚪',
}

/** One line of the report. */
const line = ( area, result, says, fix ) => ( {
	area,
	result,
	says,
	fix : fix || null,
} )

/**
 * Run every check that can be run on this setup, right now.
 *
 * @param   {object}  plant           - A `SmartPlant`.
 * @param   {object}  [opts]          - Options.
 * @param   {boolean} [opts.probeAI]  - Actually call the model. Default true.
 * @param   {number}  [opts.electrodeSeconds] - Signal window to judge. Default 30.
 * @returns {Promise<object>}         `{ok, checks, fixes, summary}`.
 */
export async function systemDiagnosis( plant, opts = {} ) {

	const checks = []

	await checkSensors( plant, checks )
	await checkReading( plant, checks )
	await checkElectrode( plant, checks, opts )
	await checkMemory( plant, checks )
	await checkAI( plant, checks, opts )
	await checkSpectral( plant, checks )
	await checkVision( plant, checks )
	await checkColony( plant, checks )
	await checkDelivery( plant, checks )
	await checkArchetype( plant, checks )
	await checkPower( plant, checks )
	await checkInference( plant, checks )
	await checkStates( plant, checks )
	await checkCoadaptation( plant, checks )
	await checkExperiments( plant, checks )
	await checkIdentity( plant, checks )
	await checkIntegrations( plant, checks )
	await checkCoupling( plant, checks )
	await checkOptical( plant, checks )
	await checkSecurity( plant, checks )
	await checkNavigation( plant, checks )
	await checkPresence( plant, checks )
	await checkSpatial( plant, checks )
	await checkDashboard( plant, checks )
	await checkLearning( plant, checks )
	await checkKnowledge( plant, checks )
	await checkSafety( plant, checks )
	await checkVoice( plant, checks )
	await checkPlugins( plant, checks )

	const failed = checks.filter( c => c.result === RESULT.FAIL )
	const warned = checks.filter( c => c.result === RESULT.WARN )
	const absent = checks.filter( c => c.result === RESULT.ABSENT )
	const ok     = checks.filter( c => c.result === RESULT.OK )

	return {
		at      : new Date().toISOString(),
		ok      : failed.length === 0,
		checks,
		counts  : {
			ok : ok.length,
			warn : warned.length,
			fail : failed.length,
			absent : absent.length,
		},
		// Only the things a person can act on, in the order worth doing them.
		fixes   : [ ...failed, ...warned ].filter( c => c.fix ).map( c => ( {
			area : c.area,
			result : c.result,
			fix : c.fix,
		} ) ),
		summary : summarise( ok, warned, failed, absent ),
	}

}

function summarise( ok, warned, failed, absent ) {

	if ( failed.length ) {

		return `${failed.length} thing(s) are not working: ${failed.map( c => c.area ).join( ', ' )}. Nothing downstream of them can be trusted until they are fixed.`

	}

	if ( warned.length ) {

		return `Everything is connected, with ${warned.length} thing(s) worth looking at: ${warned.map( c => c.area ).join( ', ' )}.`

	}

	return `All ${ok.length} configured part(s) are working${absent.length ? `, and ${absent.length} optional one(s) are not set up` : ''}. This plant is ready.`

}

// ── the checks ──────────────────────────────────────────────────────────────

async function checkSensors( plant, checks ) {

	const drivers = plant._drivers || []

	if ( !drivers.length ) {

		checks.push( line( 'sensors', RESULT.FAIL,
			'No sensor is attached, so this plant cannot perceive anything at all.',
			'Add one: { sensor: { driver: "mock" } } to try it with no hardware, or "serial" / "mqtt" / "http" for a real probe. `smartplant sensors` lists them.' ) )
		return

	}

	for ( const driver of drivers ) {

		const id = driver.id || 'sensor'

		if ( !driver.connected ) {

			checks.push( line( `sensor:${id}`, RESULT.FAIL,
				'The driver is not connected.',
				`Check the wiring and settings for "${id}". If it is a serial device, confirm the port with \`smartplant hardware\`.` ) )
			continue

		}

		checks.push( line( `sensor:${id}`, RESULT.OK,
			`Connected, providing ${( driver.provides || [] ).join( ', ' ) || 'no declared metrics'}.` ) )

	}

}

async function checkReading( plant, checks ) {

	let reading

	try {

		reading = await plant.read()

	}
	catch ( err ) {

		checks.push( line( 'reading', RESULT.FAIL,
			`Reading the sensors failed: ${err.message}`,
			'Fix the sensor above first — everything else in this report depends on a reading.' ) )
		return

	}

	// Every number the drivers actually produced, not only the ones with a known
	// physical range. An electrode-only rig reports voltage and activity and has
	// nothing else — calling that "no usable numbers" would fail a setup that is
	// working exactly as configured.
	const metrics = Object.entries( reading ).filter( ( [ k, v ] ) =>
		Number.isFinite( v ) && k !== 'timestamp' )

	if ( !metrics.length ) {

		checks.push( line( 'reading', RESULT.FAIL,
			'The sensors answered but produced no usable numbers.',
			'The driver is connected but is not returning values. Check that the probe is actually powered and that the pins match the config.' ) )
		return

	}

	// A value outside physical possibility is not a plant in trouble, it is a
	// sensor that is not measuring — and it must not be read as the former.
	// Only the metrics with a known physical range can be judged impossible.
	const impossible = metrics.filter( ( [ k ] ) => PLAUSIBLE[ k ] && implausible( [ reading ], k ).found )

	if ( impossible.length ) {

		const [ k, v ] = impossible[ 0 ]
		checks.push( line( 'reading', RESULT.FAIL,
			`${k} reads ${v}, which is outside what it can physically be (${PLAUSIBLE[ k ].join( '–' )}). That is a wiring or calibration fault, not a plant in distress.`,
			`Check the ${k} probe: wrong pin, wrong voltage reference, or a sensor that needs calibrating.` ) )
		return

	}

	const stuck = []
	const recent = plant.memory.recent( 30 )

	if ( recent.length >= 12 ) {

		for ( const [ k ] of metrics ) {

			const s = stuckReading( recent.map( r => r[ k ] ) )
			if ( s.stuck ) stuck.push( k )

		}

	}

	if ( stuck.length ) {

		checks.push( line( 'reading', RESULT.WARN,
			`${stuck.join( ' and ' )} ${stuck.length === 1 ? 'has' : 'have'} returned exactly the same value for the last dozen readings. A real measurement moves in its last digit even in a still room.`,
			`That sensor has probably latched. Power-cycle it; if it comes back the same, treat ${stuck.join( ' and ' )} as unmeasured until it is replaced.` ) )
		return

	}

	checks.push( line( 'reading', RESULT.OK,
		`Read ${metrics.map( ( [ k, v ] ) => `${k} ${v}` ).join( ', ' )}.` ) )

}

async function checkElectrode( plant, checks, opts ) {

	const electrode = plant.sensors?.peek?.( 'electrode' )

	if ( !electrode ) {

		checks.push( line( 'electrode', RESULT.ABSENT,
			'No electrode. Everything electrophysiological is unavailable, which is fine if that was the intention.' ) )
		return

	}

	const seconds = opts.electrodeSeconds ?? 30
	const samples = electrode.window( seconds )

	if ( !samples?.length ) {

		checks.push( line( 'electrode', RESULT.FAIL,
			'The electrode is attached but has recorded nothing.',
			'Check the amplifier has power and the transport is right. With the synthetic transport, call `advance()` first.' ) )
		return

	}

	const quality = electrodeQuality( samples, electrode.sampleRate, { mainsHz : electrode.mainsHz } )

	if ( quality.condition === CONDITION.FAILED ) {

		checks.push( line( 'electrode', RESULT.FAIL, quality.why,
			quality.flat
				? 'A flat trace means the lead is not making contact with living tissue. Reseat the electrode against damp stem or leaf tissue and run this again.'
				: 'Check the electrode connection.' ) )
		return

	}

	if ( quality.condition === CONDITION.DEGRADED || quality.condition === CONDITION.SUSPECT ) {

		checks.push( line( 'electrode', quality.condition === CONDITION.DEGRADED ? RESULT.FAIL : RESULT.WARN, quality.why,
			quality.aliased
				? `Raise the electrode sample rate above ${( electrode.mainsHz || 50 ) * 2}Hz, or set { mainsHz: 0 } if this rig genuinely has no mains nearby.`
				: 'Improve grounding: a shorter lead, a shielded cable, or moving the amplifier away from a power supply usually does it.' ) )
		return

	}

	const sites = electrode.sites?.length ?? 0

	if ( sites < 1 ) {

		// Worth saying up front rather than three months later when the drift
		// report has to refuse to attribute anything.
		checks.push( line( 'electrode', RESULT.WARN,
			`Signal looks healthy, but there is only one electrode. ${quality.why}`,
			'A second electrode is what separates a changing plant from a tiring contact. Without it, long-term drift can be measured but never attributed. Add one with { sites: [ { id: "stem", distanceMm: 50 } ] }.' ) )
		return

	}

	checks.push( line( 'electrode', RESULT.OK, `${quality.why} ${sites + 1} sites, so events can be corroborated.` ) )

}

async function checkMemory( plant, checks ) {

	if ( !plant.memory.path ) {

		checks.push( line( 'memory', RESULT.WARN,
			'Memory is in-process only, so everything this plant learns is lost when the process ends.',
			'Give it somewhere to live: { memory: { path: "./my-plant.json" } }. Without it, baselines, drift and inheritance can never accumulate.' ) )
		return

	}

	try {

		await plant.memory.save()
		checks.push( line( 'memory', RESULT.OK, `Persisting to ${plant.memory.path} (${plant.memory.data.readings.length} readings stored).` ) )

	}
	catch ( err ) {

		checks.push( line( 'memory', RESULT.FAIL,
			`Cannot write to ${plant.memory.path}: ${err.message}`,
			'Check the directory exists and the process can write to it. Nothing longitudinal works without this.' ) )

	}

}

async function checkAI( plant, checks, opts ) {

	if ( !plant.ai ) {

		checks.push( line( 'ai', RESULT.ABSENT, 'No AI configured. The plant still measures, reasons and speaks offline.' ) )
		return

	}

	const provider = plant.ai.provider

	if ( provider === 'mock' ) {

		checks.push( line( 'ai', RESULT.WARN,
			'The mock provider is configured, which returns canned text rather than reasoning about this plant.',
			'Fine for trying things out. For real answers, set a provider and key — `smartplant providers` lists them.' ) )
		return

	}

	if ( opts.probeAI === false ) {

		checks.push( line( 'ai', RESULT.OK, `Provider "${provider}" configured (not contacted).` ) )
		return

	}

	try {

		await plant.ai.generate( 'Reply with the single word: ok', { maxTokens : 8 } )
		checks.push( line( 'ai', RESULT.OK, `Provider "${provider}" answered.` ) )

	}
	catch ( err ) {

		checks.push( line( 'ai', RESULT.FAIL,
			`Provider "${provider}" did not answer: ${err.message}`,
			/key/i.test( err.message )
				? 'Set the API key in the environment, or pass it as { ai: { apiKey } }.'
				: 'Check the provider is reachable from this machine. Everything else keeps working — the plant falls back to its offline voice.' ) )

	}

}

async function checkSpectral( plant, checks ) {

	if ( !plant.spectral || plant.spectral.enabled === false ) {

		checks.push( line( 'spectral', RESULT.ABSENT, 'No lamp attached, so the plant is listened to but never interrogated.' ) )
		return

	}

	try {

		// Turning it off is the test: a lamp that cannot be turned off is worse
		// than no lamp, because the safety interlocks depend on being able to.
		if ( typeof plant.spectral.light.allOff === 'function' ) await plant.spectral.light.allOff()
		else await plant.spectral.light.off()

		const bands = ( plant.spectral.light.channels || [] ).filter( b => plant.spectral.light.supports( b ) )

		// If the fixture is a catalogued one, say what it can and cannot ask.
		if ( plant.spectral.fixture ) {

			const { fixtureCapability } = await import( '../spectral/fixtures.js' )
			const cap = fixtureCapability( plant.spectral.fixture )

			if ( cap && !cap.probes.length ) {

				checks.push( line( 'spectral', RESULT.WARN, cap.verdict,
					'This fixture grows plants and cannot interrogate one. A broad white pulse drives every photoreceptor at once, so no response can be attributed to any of them. A multi-channel fixture is what makes the spectral system diagnostic.' ) )
				return

			}

		}

		if ( !bands.length ) {

			checks.push( line( 'spectral', RESULT.FAIL,
				'A light is attached but declares no usable channels.',
				'Check the driver config names the channels your fixture actually has.' ) )
			return

		}

		const electrode = plant.sensors?.peek?.( 'electrode' )

		checks.push( line( 'spectral', electrode ? RESULT.OK : RESULT.WARN,
			`Lamp responds, channels: ${bands.join( ', ' )}.`,
			electrode ? null : 'A lamp with no electrode can illuminate but cannot probe: there is nothing to record the response. Add an electrode to make the spectral system diagnostic rather than decorative.' ) )

	}
	catch ( err ) {

		checks.push( line( 'spectral', RESULT.FAIL,
			`The lamp did not respond: ${err.message}`,
			'Check the relay or driver wiring. A lamp that cannot be turned off is worse than none — the safety interlocks rely on it.' ) )

	}

}

async function checkVision( plant, checks ) {

	if ( !plant.vision ) {

		checks.push( line( 'vision', RESULT.ABSENT, 'No camera. Visible symptoms will not be seen.' ) )
		return

	}

	try {

		await plant.see()
		checks.push( line( 'vision', RESULT.OK, 'Camera captured and analysed a frame.' ) )

	}
	catch ( err ) {

		checks.push( line( 'vision', RESULT.FAIL,
			`Vision failed: ${err.message}`,
			'Check the camera source. `ffmpeg` sources need ffmpeg on PATH; file sources need the path to exist.' ) )

	}

}

async function checkColony( plant, checks ) {

	if ( !plant.colony || plant.colony.enabled === false ) {

		checks.push( line( 'colony', RESULT.ABSENT, 'Not in a colony. This plant is on its own, which is the normal case for one plant.' ) )
		return

	}

	try {

		const peers = await plant.colony.peers()

		checks.push( line( 'colony', peers.length ? RESULT.OK : RESULT.WARN,
			peers.length ? `Connected, ${peers.length} neighbour(s): ${peers.join( ', ' )}.` : 'The transport is up but no neighbour is reachable.',
			peers.length ? null : 'Check the other plants are running and pointing at the same address. A colony of one behaves exactly like no colony.' ) )

	}
	catch ( err ) {

		checks.push( line( 'colony', RESULT.FAIL,
			`The colony transport failed: ${err.message}`,
			'Check the host and port, and that the listening node is running.' ) )

	}

}

async function checkArchetype( plant, checks ) {

	const a = plant.archetype

	if ( !a ) {

		const { ARCHETYPE_IDS } = await import( '../archetypes/index.js' )

		checks.push( line( 'archetype', RESULT.WARN,
			`No archetype, so this plant is being judged against generic thresholds that fit nothing in particular.`,
			`Set one — { archetype: '${ARCHETYPE_IDS.join( "' | '" )}' } — or give a species this library recognises. A cactus and a fern currently get told the same soil is too dry.` ) )
		return

	}

	// The one that changes interpretation rather than numbers, and the one worth
	// saying out loud.
	if ( a.nocturnal ) {

		checks.push( line( 'archetype', RESULT.OK,
			`${a.label}. Stomata open at night, so daytime blue probes and the circadian expectation are inverted for this plant — and the library knows.`,
			'Probe after dark if you want a stomatal reading from this one; a midday probe finds closed stomata and that is correct behaviour, not stress.' ) )
		return

	}

	checks.push( line( 'archetype', RESULT.OK, `${a.label}. ${a.summary}` ) )

}

async function checkPower( plant, checks ) {

	if ( !plant.power ) {

		checks.push( line( 'power', RESULT.ABSENT,
			'Mains powered, so nothing has to be rationed.' ) )
		return

	}

	const hour = new Date().getHours()
	const report = plant.power.report( { night : hour >= 21 || hour < 6 } )
	const harvest = report.harvest

	if ( report.sustainable === false && !harvest?.wh ) {

		checks.push( line( 'power', RESULT.FAIL,
			`Running on battery with no supply: ${report.storedWh}Wh stored, about ${report.hours}h at the current draw.`,
			'Add a panel, or reduce what is running. Without a supply this stops rather than degrades, and the record simply ends.' ) )
		return

	}

	if ( report.sustainable === false ) {

		checks.push( line( 'power', RESULT.WARN,
			`Drawing more than the panel brings in: ${report.dailyNeedWh}Wh needed against ${harvest.wh}Wh coming in.`,
			`${harvest.measured ? 'Measured at the panel.' : 'That figure is an estimate — a current sensor on the panel would replace it with a fact.'} Either a bigger panel, or accept that the mode drops overnight.` ) )
		return

	}

	checks.push( line( 'power', RESULT.OK,
		`${report.verdict} ${harvest?.measured ? 'Panel output measured.' : ''}`.trim(),
		harvest && !harvest.measured
			? 'The harvest figure is arithmetic, not a measurement. A current sensor on the panel is what makes it real.'
			: null ) )

}

async function checkInference( plant, checks ) {

	const { inferAll } = await import( '../inference/index.js' )
	const { suggest } = await import( '../devices/index.js' )

	const r = inferAll( plant )
	const have = Object.keys( plant.memory?.lastReading || {} )

	if ( !r.known.length ) {

		const next = suggest( have )[ 0 ]

		checks.push( line( 'inference', RESULT.ABSENT,
			`None of the ${r.blocked.length} cross-metric readings can be computed from what is connected. Each of them needs a sensor this plant does not have.`,
			next
				? `Nothing is broken — this is what a starter kit looks like. The single most useful addition is ${next.label} (${next.id}), which adds ${next.adds.join( ' and ' )}. ${r.unlock[ 0 ] ? `That unlocks ${r.unlock[ 0 ].unlocks} inference(s).` : ''}`
				: null ) )
		return

	}

	checks.push( line( 'inference', RESULT.OK,
		`${r.known.length} of ${r.known.length + r.blocked.length} cross-metric readings available: ${r.known.map( k => k.label ).join( ', ' )}.`,
		r.unlock.length
			? `Adding ${r.unlock[ 0 ].metric} would unlock ${r.unlock[ 0 ].unlocks} more.`
			: null ) )

}

/**
 * The five internal states, and which instrument each is waiting on.
 *
 * The most useful check on a new rig, because it turns "you could add sensors"
 * into a specific list of what each one would switch on. A state stuck at
 * `unknown` is not a fault — it is a question nothing here can answer yet, and
 * naming the missing instrument is the whole point.
 */
async function checkStates( plant, checks ) {

	let states

	try {

		states = plant.states?.()

	}
	catch ( err ) {

		checks.push( line( 'states', RESULT.FAIL,
			`The internal states could not be computed: ${err.message}`,
			'This is a bug rather than a missing sensor. The states are pure functions over what is already measured, so nothing here should be able to throw.' ) )
		return

	}

	if ( !states ) {

		checks.push( line( 'states', RESULT.ABSENT, 'No internal states on this object.' ) )
		return

	}

	const entries = Object.entries( states )
	const unknown = entries.filter( ( [ , st ] ) => st.level === 'unknown' )
	const acting = entries.filter( ( [ , st ] ) => st.acts )

	if ( unknown.length === entries.length ) {

		checks.push( line( 'states', RESULT.WARN,
			`None of the ${entries.length} internal states can be assessed. This plant is being cared for entirely from environmental readings, with no view of what it is doing.`,
			`An electrode is the single addition that changes the most here — it is the primary evidence for three of the five. Specifically: ${unknown.map( ( [ n, st ] ) => `${n} needs ${( st.missing ?? [ 'more history' ] ).join( ' or ' )}` ).join( '; ' )}.` ) )
		return

	}

	if ( unknown.length ) {

		// Said on the line rather than as a fix: an OK line's fix is not printed,
		// and "which sensor would switch this on" is the useful half.
		checks.push( line( 'states', RESULT.OK,
			`${entries.length - unknown.length} of ${entries.length} internal states assessable${acting.length ? `, ${acting.length} changing a decision` : ''}. Waiting on an instrument: ${unknown.map( ( [ n, st ] ) => `${n} (${( st.missing ?? [ 'more history' ] ).join( ' or ' )})` ).join( ', ' )}.` ) )
		return

	}

	checks.push( line( 'states', RESULT.OK,
		`All ${entries.length} internal states assessable${acting.length ? `, ${acting.length} currently changing a decision` : ''}.` ) )

}

/**
 * Whether anything this plant says can actually leave.
 */
async function checkDelivery( plant, checks ) {

	if ( plant.colony?.enabled !== true ) {

		checks.push( line( 'delivery', RESULT.ABSENT, 'Not in a colony, so nothing has to be delivered anywhere.' ) )
		return

	}

	const health = plant.colony.deliveryHealth()
	const undelivered = plant.colony.undelivered ?? []

	if ( !health.ok ) {

		checks.push( line( 'delivery', RESULT.FAIL, health.why,
			'Every link is down or resting. Messages are being held rather than lost, and they go off — a pest warning keeps for twelve hours and a live aid frame for thirty seconds. Fix a link or add one with `colony.addLink()`.' ) )
		return

	}

	if ( undelivered.length ) {

		checks.push( line( 'delivery', RESULT.WARN,
			`${undelivered.length} message${undelivered.length === 1 ? '' : 's'} did not arrive. Most recent: ${undelivered.at( -1 ).kind}.`,
			'`colony.retryUndelivered()` tries the spool again and drops what has gone off. Worth knowing this is visible at all: it used to disappear into an empty catch, so a colony could be entirely broken and look like it was working.' ) )
		return

	}

	const links = health.links.length

	checks.push( line( 'delivery', links > 1 ? RESULT.OK : RESULT.WARN,
		`${links} link${links === 1 ? '' : 's'}, ${health.spool?.held ?? 0} held.`,
		links > 1 ? null : 'One transport is one point of failure. `colony.addLink()` registers another, and a message goes out over every one worth trying — which is what stops a broken link meaning a warning nobody hears.' ) )

}

/**
 * The reasoner, and whether it has anything to reason about.
 */
async function checkKnowledge( plant, checks ) {

	if ( !plant.knowledge ) {

		checks.push( line( 'knowledge', RESULT.ABSENT, 'No knowledge layer, so conclusions come from thresholds and the model rather than from rules anybody can audit.' ) )
		return

	}

	const species = plant.memory?.plant?.species

	checks.push( line( 'knowledge', species ? RESULT.OK : RESULT.WARN,
		species ? `Reasoner attached, species profile for ${species}.` : 'Reasoner attached with no species set.',
		species ? null : 'Pass { species } to createPlant(). Without it the ranges start from nothing and every rule that keys on the species is inert.' ) )

}

/**
 * The limits on a plant that can act.
 */
async function checkSafety( plant, checks ) {

	if ( !plant.body ) {

		checks.push( line( 'safety', RESULT.ABSENT, 'Not embodied, so nothing here can act and there is nothing to limit.' ) )
		return

	}

	const limits = plant.body.safety ?? plant.body.limits

	checks.push( line( 'safety', limits ? RESULT.OK : RESULT.FAIL,
		limits ? 'Safety limits are in place on an embodied plant.' : 'This plant is embodied and has no safety layer.',
		limits ? null : 'An embodied plant can water, light and move. `embody()` normally attaches the limits with it — if they are missing, every one of those is ungated, and the whole point of the arrangement was that autonomy cannot kill the plant.' ) )

}

/**
 * Whether it can say anything, and in what.
 */
async function checkVoice( plant, checks ) {

	const language = plant.language ?? plant.config?.language

	checks.push( line( 'voice', RESULT.OK,
		`Speaks ${language ?? 'en'}${plant.persona ? ` as "${plant.persona}"` : ''}. Offline phrasing works with no model attached.` ) )

}

/**
 * Whether anything can be concluded about plants standing close together.
 *
 * Two failures worth catching separately: nobody said how far apart they are,
 * and there is nothing outside the pair to compare against. Both produce a
 * coupling layer that runs and concludes nothing.
 */
async function checkCoupling( plant, checks ) {

	const neighbours = plant.colony?.neighbours

	if ( !plant.colony?.enabled || !neighbours?.size ) {

		checks.push( line( 'coupling', RESULT.ABSENT,
			'No neighbours, so nothing is coupled to anything.' ) )
		return

	}

	const known = [ ...neighbours.values() ].filter( n => Number.isFinite( n?.metres ) ).length
	const total = neighbours.size
	const hasRange = Boolean( plant.rangefinder )

	if ( !known && !hasRange ) {

		checks.push( line( 'coupling', RESULT.WARN,
			`${total} neighbour${total === 1 ? '' : 's'} and no distance to ${total === 1 ? 'it' : 'any of them'}. Every shared-humidity and CO2-competition conclusion depends on that number, so none of them can be drawn.`,
			'Declare `metres` per neighbour, or fit a time-of-flight rangefinder — a VL53L0X is a couple of euros and turns a figure somebody typed into a measurement that stays true when a pot is moved.' ) )
		return

	}

	// The reference problem: two plants agreeing is not evidence of a pocket.
	const reference = plant.sensors?.peek?.( 'room' ) || plant.roomSensor

	if ( !reference ) {

		checks.push( line( 'coupling', RESULT.WARN,
			'Distances are known but there is no reading from outside the pair.',
			'Two neighbours both reporting 68% humidity is exactly what a humid room looks like. A room sensor, or one plant beyond 0.4m, is what turns their agreement into an attributable effect — without it every benefit comes back unverifiable rather than absent.' ) )
		return

	}

	checks.push( line( 'coupling', RESULT.OK,
		`${known} neighbour distances known and a reference outside the pair, so shared-humidity and CO2 effects are attributable.` ) )

}

/**
 * Can the optical channel actually reach anyone?
 *
 * The check that matters is on the *receiving* side, and it is the one nobody
 * thinks of until a plant has spent its last charge blinking at a lux sensor.
 */
async function checkOptical( plant, checks ) {

	if ( !plant.spectral || !plant.colony?.enabled ) {

		checks.push( line( 'optical', RESULT.ABSENT,
			plant.spectral
				? 'No colony, so there is nobody to signal.'
				: 'No lamp, so there is nothing to signal with.' ) )
		return

	}

	const peers = plant.colony.opticalPeers?.()

	if ( !peers?.who?.length ) {

		checks.push( line( 'optical', RESULT.WARN,
			'This plant can emit, and nobody in the colony can decode it.',
			'An ambient light sensor integrates over hundreds of milliseconds and cannot follow a pulsed message — that is what makes it good at daylight. Beacon mode needs a photodiode on a fast ADC (≥1kHz) on the *receiving* plant. Without one, a plant on its last charge is blinking at a wall and believes it called for help.' ) )
		return

	}

	checks.push( line( 'optical', RESULT.OK,
		`${peers.who.length} neighbour${peers.who.length === 1 ? '' : 's'} could decode a pulsed message, so beacon mode has somewhere to go if the radio dies.` ) )

}

/**
 * The state of the one emission that can hurt a person.
 */
async function checkSecurity( plant, checks ) {

	const channels = plant.spectral?.light?.channels

	if ( !channels?.includes?.( 'uvb' ) ) {

		checks.push( line( 'security', RESULT.ABSENT,
			'No UV-B channel, so security priming runs on airflow alone. That is the phase that costs the plant almost nothing and it is the one safe to run on a plant already struggling.' ) )
		return

	}

	checks.push( line( 'security', RESULT.WARN,
		'This fixture has a UV-B channel.',
		'UV-B burns skin and eyes and a plant on a shelf is at eye height. It stays off unless `allowUvb` is passed per call, and it refuses when the room is occupied — which this library can only know if you tell it, or fit a rangefinder. Check the fixture cannot be driven by anything outside this library, because none of these interlocks apply to a lamp somebody switches on by hand.' ) )

}

/**
 * Whether a plant that can move knows enough about itself to move safely.
 */
async function checkNavigation( plant, checks ) {

	if ( !plant.body?.drive && !plant.drive ) {

		checks.push( line( 'navigation', RESULT.ABSENT,
			'This plant does not move, so nothing has to be planned.' ) )
		return

	}

	const chassis = plant.chassis ?? plant
	const geometry = Number.isFinite( chassis.heightM ) && Number.isFinite( chassis.baseM )

	if ( !geometry ) {

		checks.push( line( 'navigation', RESULT.FAIL,
			'This plant can move and has not declared its height and base width, so how easily it tips cannot be worked out.',
			'Two numbers with a tape measure: `chassis: { heightM, baseM, wheelbaseM }`. Until they are there every move is refused, which is correct — a tipped plant is not a manoeuvre to retry, it is soil across a floor and a broken stem.' ) )
		return

	}

	if ( !plant.surveyor ) {

		checks.push( line( 'navigation', RESULT.WARN,
			'Geometry declared, and there is no map.',
			'This library defines the constraints and delegates the planning. Attach a `Surveyor` — `ros2Surveyor( bridge )` onto Nav2 is the intended one. Until then every move is refused after all the plant-side checks have passed, which is the safe answer rather than a useful one.' ) )
		return

	}

	checks.push( line( 'navigation', RESULT.OK,
		`Chassis declared (${chassis.heightM}m on a ${chassis.baseM}m base) and a surveyor is attached.` ) )

}

/**
 * Whether an experiment running on this plant can stop itself.
 */
async function checkExperiments( plant, checks ) {

	const running = plant.body?.personalization?.experiments ?? plant._experiments ?? []
	const live = [ ...running ].filter( e => e && !e.done )

	if ( !live.length ) {

		checks.push( line( 'experiments', RESULT.ABSENT, 'Nothing is being tested on this plant.' ) )
		return

	}

	const unarmed = live.filter( e => !e.baseline )

	if ( unarmed.length ) {

		checks.push( line( 'experiments', RESULT.FAIL,
			`${unarmed.length} of ${live.length} running experiments recorded no baseline.`,
			'An experiment without a baseline cannot tell that its subject has deteriorated, so its kill switch is not armed — it will run to completion on a plant that is declining and report a clean result. Pass { baseline: { wellbeing, states } } when starting one.' ) )
		return

	}

	checks.push( line( 'experiments', RESULT.OK,
		`${live.length} running, each able to abandon itself if the plant gets worse than it was when they started.` ) )

}

/**
 * Whether a restored symbiont is running on a baseline it does not have.
 */
async function checkIdentity( plant, checks ) {

	const restored = plant._restored

	if ( !restored ) {

		checks.push( line( 'identity', RESULT.ABSENT,
			'This plant has not been restored from a bundle, so it is living its own history rather than resuming one.' ) )
		return

	}

	const hasBaseline = Boolean( restored.electrode || plant.electrome?.settled )

	if ( !hasBaseline && plant.electrode ) {

		checks.push( line( 'identity', RESULT.WARN,
			`Restored ${Object.keys( restored ).length} parts, and the electrical baseline was not among them.`,
			'That is correct — a new electrode produces a different signature and carrying the old one across would report a plant changing when what changed was the wire. But until a fresh baseline settles, every drift and continuity reading is measured against nothing. A few days of quiet, and it is worth knowing now rather than wondering why continuity looks wrong for a fortnight.' ) )
		return

	}

	checks.push( line( 'identity', RESULT.OK,
		`Resumed from a bundle: ${Object.keys( restored ).join( ', ' )}.` ) )

}

/**
 * Whether anything this plant was told to publish to is reachable.
 */
async function checkIntegrations( plant, checks ) {

	const wired = [
		plant.homeassistant && 'home-assistant',
		plant.mqttBridge && 'mqtt-bridge',
		plant.openclaw && 'openclaw',
	].filter( Boolean )

	if ( !wired.length ) {

		checks.push( line( 'integrations', RESULT.ABSENT, 'Nothing is published anywhere outside this process.' ) )
		return

	}

	checks.push( line( 'integrations', RESULT.OK,
		`${wired.join( ', ' )} configured. Reachability is not tested here — a bridge that was up at startup and is down now looks identical from inside.` ) )

}

/**
 * Whether this pairing is learning anything about itself.
 */
async function checkCoadaptation( plant, checks ) {

	const calibration = plant.calibration?.report?.()
	const trajectory = plant._trajectory
	const grounded = calibration?.states?.some( s => s.known )

	if ( !trajectory?.entries?.length ) {

		checks.push( line( 'coadaptation', RESULT.ABSENT,
			'No trajectory recorded yet, so how this pairing has developed is not being tracked.',
			'`plant.trajectory()` takes an entry weekly. It is the one thing here that can tell an ageing electrode from a declining plant — they are indistinguishable in any snapshot and completely different over a season — and it cannot be reconstructed later.' ) )
		return

	}

	const eager = calibration?.states?.filter( s => s.tooEager ) ?? []

	if ( eager.length ) {

		checks.push( line( 'coadaptation', RESULT.WARN,
			`${eager.map( s => s.name ).join( ', ' )} refuse things that turn out to have been fine.`,
			'These now need high confidence before they gate anything. Worth reading the refusals: a state that is too eager withholds good care indefinitely and looks exactly like one that is working.' ) )
		return

	}

	const shape = trajectory.compare()

	if ( shape.verdict === 'degrading' ) {

		checks.push( line( 'coadaptation', RESULT.WARN, shape.why,
			'Several axes moving the same way is the signature of something real, and it shows here long before it shows in a reading. Worth looking at the plant rather than at the code.' ) )
		return

	}

	if ( shape.verdict === 'instrument' ) {

		checks.push( line( 'coadaptation', RESULT.WARN, shape.why,
			'This is the electrode rather than the plant. Reseat it, or replace it and restore the identity bundle with { sameElectrode: false } so the baseline is re-established rather than carried across.' ) )
		return

	}

	checks.push( line( 'coadaptation', RESULT.OK,
		`${trajectory.entries.length} trajectory entries${shape.known ? ` over ${shape.spanDays} days, ${shape.verdict}` : ''}. ${grounded ? 'The calibration record has something in it, so adaptation is grounded.' : 'No refusal has ever been overridden, so nothing has told this system it was wrong — and adaptation stays off, which is correct.'}` ) )

}

/**
 * Whether the plant can measure the space rather than be told about it.
 */
async function checkSpatial( plant, checks ) {

	const lidar = plant.sensors?.peek?.( 'lidar' )

	if ( !lidar ) {

		const coupled = plant.colony?.neighbours?.size > 0

		checks.push( line( 'spatial', RESULT.ABSENT,
			'No rangefinder, so distances are whatever was typed in.',
			coupled
				? 'This plant has neighbours, and every shared-humidity and CO2 conclusion rests on how far away they are — a number nobody measured. A time-of-flight sensor pointed at one neighbour, or a scanning lidar for all of them, turns that into a measurement that stays true when a pot is moved.'
				: null ) )
		return

	}

	const fresh = lidar.freshness()

	if ( !fresh.fresh ) {

		checks.push( line( 'spatial', RESULT.WARN, fresh.why,
			'Take a scan before acting on one. Nothing here will answer from a stale scan, so the effect is that spatial reasoning is simply off rather than wrong — which is the right failure, and still a failure.' ) )
		return

	}

	const { points } = await import( '../spatial/index.js' )

	checks.push( line( 'spatial', RESULT.OK,
		`Rangefinder scanning, ${points( lidar.latest ).length} returns, ${fresh.why.toLowerCase()}` ) )

}

/**
 * Whether anything can tell if somebody is in the room.
 */
async function checkPresence( plant, checks ) {

	const sensor = plant.sensors?.peek?.( 'presence' )

	if ( !sensor ) {

		checks.push( line( 'presence', RESULT.ABSENT,
			'Nothing can tell whether somebody is in the room.',
			plant.spectral?.light?.channels?.includes?.( 'uvb' )
				? 'This rig can emit UV-B, and the interlock that refuses while the room is occupied can only be told, never answered. A WiFi radio reporting RSSI is enough, and an ESP32-S3 with CSI firmware is better.'
				: null ) )
		return

	}

	const state = sensor.state?.()

	if ( state?.stuck ) {

		checks.push( line( 'presence', RESULT.FAIL,
			'The radio is returning the same number every time.',
			'Real measurement carries noise in its last digit even in an empty room, so this is a sample function returning a constant rather than a very still house. Until it varies, nothing about presence can be concluded — and an interlock resting on it is resting on nothing.' ) )
		return

	}

	if ( state?.settled === false ) {

		checks.push( line( 'presence', RESULT.WARN,
			`Settling: ${state.samples} samples so far.`,
			'Presence here is a departure from this room\'s own quiet, so it needs a quiet to depart from before it will answer. This fills in on its own.' ) )
		return

	}

	checks.push( line( 'presence', RESULT.OK,
		`${sensor.sensing.toUpperCase()} presence sensing, settled. ${state?.occupancy ? 'Somebody is in the room.' : 'Room reads as empty.'}` ) )

}

/**
 * Where the dashboard is listening, if it is.
 */
async function checkDashboard( plant, checks ) {

	const servers = plant._servers ?? []

	if ( !servers.length ) {

		checks.push( line( 'dashboard', RESULT.ABSENT,
			'Not serving. `await plant.serve()` puts the vitals in a browser.' ) )
		return

	}

	const exposed = servers.filter( s => s.host !== '127.0.0.1' && s.host !== 'localhost' )

	if ( exposed.length ) {

		checks.push( line( 'dashboard', RESULT.WARN,
			`Serving on ${exposed.map( s => `${s.host}:${s.port}` ).join( ', ' )} — beyond loopback.`,
			'This page is a live feed of a room: when the lights go on, when a window opens, and whether anybody is home. There is no authentication, deliberately. If that exposure is intended it is fine; if it was copied from an example, pass no host and it returns to loopback.' ) )
		return

	}

	checks.push( line( 'dashboard', RESULT.OK,
		`Serving read-only on ${servers.map( s => `${s.host}:${s.port}` ).join( ', ' )}.` ) )

}

async function checkLearning( plant, checks ) {

	// Whether this plant is in a position to learn anything from its own history,
	// which is a setup question as much as a physiological one: with no persisted
	// memory it starts from nothing every time the process restarts.
	const ledger = plant._resolutions
	const problems = ledger ? [ ...ledger.history.keys() ] : []

	if ( !problems.length ) {

		checks.push( line( 'learning', RESULT.ABSENT,
			'Nothing has gone wrong yet, so there is nothing to have learned from. This fills in on its own.' ) )
		return

	}

	const summary = ledger.report()
	const noControl = problems.filter( p => !ledger.baseRate( p ).known )

	if ( noControl.length === problems.length ) {

		// Without episodes where nothing was done, every action taken during a
		// problem that was going to pass anyway looks like a cure.
		checks.push( line( 'learning', RESULT.WARN,
			`${problems.length} problem(s) recorded, but something was done in every single episode, so none of them can credit anything.`,
			'This is not a fault, it is a consequence of always intervening. When a mild problem appears and the plant is in no danger, letting it pass once gives everything else something to be measured against.' ) )
		return

	}

	const muddled = problems.filter( p => ledger.whatWorked( p ).unattributable )

	checks.push( line( 'learning', RESULT.OK,
		`${summary.verdict}${muddled.length ? ` ${muddled.length} had several things done at once and cannot attribute.` : ''}${summary.open.length ? ` Open right now: ${summary.open.join( ', ' )}.` : ''}`,
		muddled.length ? 'Change one thing at a time when you can — episodes with three simultaneous actions teach nothing.' : null ) )

}

async function checkPlugins( plant, checks ) {

	const names = [ ...plant.plugins.keys() ]

	if ( !names.length ) {

		checks.push( line( 'plugins', RESULT.ABSENT, 'No plugins installed.' ) )
		return

	}

	checks.push( line( 'plugins', RESULT.OK, `${names.length} installed: ${names.join( ', ' )}.` ) )

}

/**
 * Render a report for a terminal.
 *
 * @param   {object}  report  - From `systemDiagnosis`.
  * @returns {string}          The report.
 */
export function formatDiagnosis( report ) {

	const out = [ '', 'System diagnosis', '' ]

	for ( const c of report.checks ) {

		out.push( `  ${ICON[ c.result ]}  ${c.area.padEnd( 16 )} ${c.says}` )

	}

	const { ok, warn, fail, absent } = report.counts
	out.push( '', `  ${ok} working · ${warn} to look at · ${fail} broken · ${absent} not set up`, '' )
	out.push( `  ${report.summary}` )

	if ( report.fixes.length ) {

		out.push( '', 'What to change', '' )
		report.fixes.forEach( ( f, i ) => {

			out.push( `  ${i + 1}. [${f.area}] ${f.fix}` )

		} )

	}

	out.push( '' )
	return out.join( '\n' )

}
