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
	await checkArchetype( plant, checks )
	await checkPower( plant, checks )
	await checkInference( plant, checks )
	await checkLearning( plant, checks )
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
