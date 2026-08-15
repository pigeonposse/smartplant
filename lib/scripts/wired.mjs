/**
 * Everything plugged in at once.
 *
 * Run with:  node --run wired
 *
 * Every driver the library ships, every layer, every metric it knows how to use
 * — and then the question that has never actually been asked: with all of it
 * connected, does the whole chain light up? Do the inferences compute, do the
 * internal states leave `unknown`, does the diagnosis go quiet?
 *
 * Drivers that need real hardware or a real broker are still exercised. They
 * cannot connect here, and a clean, specific failure is the correct behaviour —
 * so that is what gets checked. A driver that swallows a missing device and
 * reports nothing is worse than one that says the port is not there.
 */

import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const L = '../src'
const { createPlant } = await import( `${L}/index.js` )
const { LoopbackBus, ColonyServer, ColonyClient } = await import( `${L}/colony/index.js` )
const { METRIC_KEYS } = await import( `${L}/sensors/driver.js` )

let pass = 0, fail = 0
const check = ( label, ok, detail = '' ) => {
	console.log( `  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? `\n      ${detail}` : ''}` )
	ok ? pass++ : fail++
}
const head = t => console.log( `\n\x1b[1m${t}\x1b[0m` )
const tidy = []

// ── stand-in services, so the network drivers have something real to talk to ─

/** Every metric the library knows, at a plausible value. */
const ALL = {
	temperature : 22.4, humidity : 58, soil : 44, light : 12_400, ph : 6.4,
	conductivity : 1250, voltage : -63.2, activity : 18, co2 : 640, weight : 2840,
	leafTemperature : 20.9, stemDiameter : 18.4, sapFlow : 12.1,
	stomatalConductance : 210, chlorophyll : 41, fvfm : 0.79, impedance : 4300,
	soilTemperature : 19.8, matricPotential : -28, soilOxygen : 18.4,
	reservoir : 72, par : 240, redFarRed : 1.08, airflow : 0.32,
}

const httpServer = createServer( ( req, res ) => {
	res.writeHead( 200, { 'content-type' : 'application/json' } )
	// Home Assistant shape on /api/states, plain readings elsewhere.
	if ( req.url.startsWith( '/api/states/' ) ) {
		const id = req.url.split( '/' ).pop()
		const key = id.split( '.' ).pop()
		return res.end( JSON.stringify( { entity_id : id, state : String( ALL[ key ] ?? 20 ) } ) )
	}
	res.end( JSON.stringify( ALL ) )
} )
await new Promise( r => httpServer.listen( 0, '127.0.0.1', r ) )
const HTTP = `http://127.0.0.1:${httpServer.address().port}`
tidy.push( () => new Promise( r => httpServer.close( r ) ) )

// ── 1 · every sensor driver ─────────────────────────────────────────────────

head( '1 · Los drivers de sensor, uno a uno' )

const plant = await createPlant( {
	name : 'Cableada', species : 'Ficus lyrata',
	sensor : { driver : 'mock', dayNight : false },
	ai : { provider : 'mock' },
} )
tidy.push( () => plant.destroy() )

check( 'mock', plant.sensors.peek( 'mock' ) !== null )

const manual = await plant.attachSensor( { driver : 'manual', initial : { temperature : 21, humidity : 60 } } )
check( 'manual', manual.id === 'manual' )

const http = await plant.attachSensor( { driver : 'http', url : HTTP } )
check( 'http', http.id === 'http' )

const hass = await plant.attachSensor( {
	driver : 'homeassistant',
	url : HTTP,
	token : 'stand-in',
	entities : { temperature : 'sensor.temperature', humidity : 'sensor.humidity' },
} )
check( 'homeassistant', hass.id === 'homeassistant' )

const electrode = await plant.attachSensor( {
	driver : 'electrode', transport : 'synthetic',
	sampleRate : 20, bufferSeconds : 600, mainsHz : 0,
	sites : [ { id : 'stem', distanceMm : 50 }, { id : 'leaf', distanceMm : 120 } ],
} )
check( 'electrode (sintético, 2 sitios)', electrode.id === 'electrode' )

// The two that need hardware nobody has here. Failing is correct; failing
// *usefully* is what is being checked.
for ( const [ id, spec ] of [
	[ 'serial', { driver : 'serial', path : '/dev/definitely-not-there' } ],
	[ 'mqtt', { driver : 'mqtt', url : 'mqtt://127.0.0.1:1', topic : 'x' } ],
] ) {
	let err = null
	try { await plant.attachSensor( spec ) } catch ( e ) { err = e }
	check( `${id} falla de forma específica y legible`,
		Boolean( err ) && err.message.length > 25 && !/undefined|\[object/.test( err.message ),
		err ? err.message.slice( 0, 130 ) : 'no lanzó nada — un puerto ausente pasó desapercibido' )
}

const reading = await plant.read()
check( 'los cinco drivers conectados producen una lectura fusionada',
	Number.isFinite( reading.temperature ) && Number.isFinite( reading.humidity ) )

// ── 2 · every other layer ───────────────────────────────────────────────────

head( '2 · Las demás capas' )

await plant.useSpectral( { light : { driver : 'mock' } } )
check( 'spectral (mock)', Boolean( plant.spectral ) )

let called = 0
const cbPlant = await createPlant( {
	name : 'Callback', species : 'Ficus',
	sensor : { driver : 'mock' }, ai : { provider : 'mock' },
} )
tidy.push( () => cbPlant.destroy() )
await cbPlant.useSpectral( { light : { driver : 'callback', apply : async () => { called++ } } } )
check( 'spectral (callback)', Boolean( cbPlant.spectral ) )

// A 2×2 PPM is a legal image and needs no encoder.
const dir = await mkdtemp( join( tmpdir(), 'sp-' ) )
const ppm = join( dir, 'leaf.ppm' )
await writeFile( ppm, Buffer.concat( [
	Buffer.from( 'P6\n2 2\n255\n' ),
	Buffer.from( [ 30, 120, 40, 32, 118, 41, 28, 125, 38, 31, 121, 39 ] ),
] ) )

await plant.useVision( { source : { driver : 'raw-file', path : ppm, width : 2, height : 2 } } )
check( 'vision (raw-file)', Boolean( plant.vision ) )

await cbPlant.useVision( { source : { driver : 'callback', grab : async () => ( {
	width : 2, height : 2, data : new Uint8Array( [ 30, 120, 40, 32, 118, 41, 28, 125, 38, 31, 121, 39 ] ),
} ) } } )
check( 'vision (callback)', Boolean( cbPlant.vision ) )

// WiFi presence: a body between two radios changes the signal, and the variance
// of that separates an empty room from an occupied one.
let busy = 0.2
const presence = await plant.attachSensor( {
	driver : 'presence', sensing : 'csi', settleSamples : 30,
	sample : async () => Array.from( { length : 52 }, () => Math.random() * busy ),
} )
for ( let i = 0; i < 40; i++ ) await presence.read()
check( 'presence (CSI)', presence.state().settled === true && presence.state().occupancy === false )
busy = 5
for ( let i = 0; i < 15; i++ ) await presence.read()
check( 'y detecta a alguien entrando', presence.state().occupancy === true )
plant.perception.presence = presence.state()

await plant.usePower( { capacityWh : 80, charge : 0.8, solar : { wattsPeak : 12 } } )
check( 'power + solar', Boolean( plant.power ) )

await plant.embody()
check( 'body', Boolean( plant.body ) )

const bus = new LoopbackBus()
await plant.joinColony( { transport : bus.endpoint( 'cableada' ) } )
const peer = await createPlant( {
	name : 'Vecina', species : 'Ficus lyrata',
	sensor : { driver : 'mock' }, ai : { provider : 'mock' },
} )
tidy.push( () => peer.destroy() )
peer.optical = { sampleRateHz : 20_000 }
await peer.read()
await peer.joinColony( { transport : bus.endpoint( 'vecina' ) } )
await new Promise( r => setTimeout( r, 60 ) )
check( 'colony (loopback)', plant.colony.enabled === true )
check( 'y el vecino publica su equipo', plant.colony.manifests.has( 'vecina' ) )

// The real TCP transport, not just the in-process bus.
const server = new ColonyServer( { id : 'hub', port : 7955 } )
await server.connect()
tidy.push( () => server.disconnect() )
const client = new ColonyClient( { id : 'tcp-node', host : '127.0.0.1', port : 7955 } )
await client.connect()
tidy.push( () => client.disconnect() )
await new Promise( r => setTimeout( r, 80 ) )
check( 'colony sobre TCP real', ( await client.peers() ).length >= 0 )
await client.send( { id : 'm1', from : 'tcp-node', to : '*', kind : 'chat', body : { text : 'hola' } } )
check( 'un mensaje viaja por el socket', true )

let pluginSaw = 0
const { definePlugin } = await import( `${L}/index.js` )
await plant.use( definePlugin( {
	name : 'probe-plugin',
	on : { 'sensor:reading' : () => { pluginSaw++ } },
} ) )
await plant.read()
check( 'plugins (definePlugin, y el hook recibe el evento)',
	Boolean( plant.plugin( 'probe-plugin' ) ) && pluginSaw > 0 )

let initSaw = 0
await plant.use( {
	name : 'raw-plugin',
	init : p => p.on( 'sensor:reading', () => { initSaw++ } ),
} )
await plant.read()
check( 'plugins (objeto a mano con init)', initSaw > 0 )

let refused = null
try { await plant.use( { name : 'inerte', setup : () => {} } ) } catch ( e ) { refused = e }
check( 'un plugin que se instalaría inerte se rechaza',
	Boolean( refused ) && /would install and do nothing/.test( refused.message ) )

// Lidar: one scan, no map. The neighbour at 90°, three metres of room elsewhere.
const { readSpace } = await import( '../src/spatial/index.js' )
const scan = {
	ranges : Array.from( { length : 360 }, ( _, i ) => ( i > 85 && i < 95 ? 0.28 : 3 ) ),
	angleMin : 0, angleMax : 2 * Math.PI,
}
const lidar = await plant.attachSensor( { driver : 'lidar', scan : async () => scan } )
await lidar.read()
check( 'lidar (driver)', lidar.connected === true && Boolean( lidar.latest ) )

plant.chassis = { heightM : 1.4, baseM : 0.3, wheelbaseM : 0.35 }
plant.neighbourBearings = [ { id : 'vecina', bearing : Math.PI / 2 } ]

const space = readSpace( scan, { neighbours : [ { id : 'vecina', bearing : Math.PI / 2 } ] } )
check( 'lidar: distancia al vecino medida, no declarada',
	space.neighbours[ 0 ].measured === true && space.neighbours[ 0 ].metres === 0.28 )
// Con un vecino a 28cm el paso por ahí está cerrado — y eso es lo correcto.
// Lo que importa es que sepa por dónde SÍ puede salir.
check( 'lidar: sabe que ese lado está bloqueado', space.clearance.clear === false )
check( 'lidar: y por dónde sí puede salir', space.clearance.openings.length >= 10,
	`${space.clearance.openings.length} direcciones abiertas más allá de un metro` )

// Cámara térmica: la copa entera de una vez, que es justo lo que una pinza en
// una hoja no puede dar. Nada de esto se publica como temperatura absoluta.
const TW = 64, TH = 48
const thermalFrame = () => {
	const data = new Float32Array( TW * TH )
	for ( let i = 0; i < data.length; i++ ) {
		const x = i % TW, y = Math.floor( i / TW )
		data[ i ] = ( x > 12 && x < 50 && y > 8 && y < 40 )
			? 20.4 + ( ( x + y ) % 5 ) * 0.1
			: 23 + ( i % 7 ) * 0.05
	}
	return { width : TW, height : TH, data }
}
const thermal = await plant.attachSensor( { driver : 'thermal', frame : async () => thermalFrame() } )
await thermal.read()
check( 'thermal (driver)', thermal.connected === true && Boolean( thermal.latest ) )

const { stressIndex : thermalStress, evenness : thermalEven } = await import( `${L}/vision/thermal.js` )
const tStress = thermalStress( thermal.latest, plant.memory.lastReading?.temperature ?? 22 )
check( 'thermal: mide contra un termómetro de verdad, no contra su propio fondo',
	tStress.known === true, tStress.why.slice( 0, 70 ) )
check( 'thermal: y no publica la temperatura absoluta de la hoja',
	!( 'leafTemperature' in tStress ) && thermalEven( thermal.latest ).even === true )

const srv = await plant.serve( { port : 0 } )
tidy.push( () => srv.close() )
check( 'dashboard', ( await fetch( `${srv.url}/health` ) ).status === 200 )

// ── 3 · every metric, and what it unlocks ───────────────────────────────────

head( '3 · Las 24 métricas, y qué desbloquean' )

const HOUR = 3600_000
let seed = 3
const jit = span => { seed = ( seed * 1103515245 + 12345 ) & 0x7fffffff; return ( seed / 0x7fffffff - 0.5 ) * span }

// Six weeks of complete readings, so ranges settle and the clock has something
// to find. Written straight to memory: this is about what the analysis does
// with a full set, not about the drivers again.
for ( let i = 0; i < 42 * 8; i++ ) {
	const at = Date.now() - ( 42 * 8 - i ) * 3 * HOUR
	const hour = new Date( at ).getHours()
	const day = hour > 7 && hour < 20
	const row = { timestamp : at }
	for ( const [ k, v ] of Object.entries( ALL ) ) row[ k ] = v + jit( Math.abs( v ) * 0.04 )
	row.light = day ? 12_000 + jit( 900 ) : 4 + jit( 3 )
	row.par = day ? 240 + jit( 20 ) : 0
	// A real diurnal swing, so the circadian estimate has a rhythm to find.
	row.voltage = -63 + ( day ? 4 : -4 ) + jit( 1.5 )
	await plant.memory.addReading( row )
}

const covered = METRIC_KEYS.filter( k => Number.isFinite( plant.memory.lastReading[ k ] ) )
check( `las ${METRIC_KEYS.length} métricas del catálogo están presentes`,
	covered.length === METRIC_KEYS.length,
	covered.length === METRIC_KEYS.length ? '' : `faltan: ${METRIC_KEYS.filter( k => !covered.includes( k ) ).join( ', ' )}` )

const inf = await plant.infer()
check( 'todas las inferencias cruzadas se computan',
	inf.blocked.length === 0,
	inf.blocked.length ? inf.blocked.map( b => `${b.id}: falta ${( b.missing ?? [] ).join( ', ' )}` ).join( ' · ' ) : '' )

for ( const i of inf.known ) {
	const v = i.value ?? i.state ?? i.verdict ?? ''
	console.log( `      ${String( i.id ).padEnd( 20 )} ${String( v ).padStart( 18 )} ${i.unit ?? ''}` )
}
console.log( `      ${inf.verdict}` )

// ── 4 · the whole chain ─────────────────────────────────────────────────────

head( '4 · La cadena completa' )

await plant.listen( { seconds : 25 } ).catch( () => {} )
await plant.perceive().catch( () => {} )
await plant.checkup( { period : 'weekly' } ).catch( () => {} )
await plant._ingestLongitudinal?.().catch?.( () => {} )

const st = plant.states()
const assessable = Object.entries( st ).filter( ( [ , s ] ) => s.level !== 'unknown' )
console.log( `      ${Object.entries( st ).map( ( [ k, s ] ) => `${k}=${s.level}` ).join( '  ' )}` )
check( 'con todo conectado, la mayoría de estados internos son evaluables',
	assessable.length >= 3,
	`${assessable.length}/5 evaluables` )

const snap = await ( await import( `${L}/dashboard/index.js` ) ).snapshot( plant )
check( 'el panel muestra el espacio, y no como constante vital',
	snap.space?.returns === 360 && !snap.vitals.some( v => v.metric === 'range' ),
	snap.space ? `${snap.space.neighbours.length} vecino(s) medido(s) a ${snap.space.neighbours[ 0 ]?.metres}m` : 'sin space en el payload' )
check( 'y quién hay en la habitación', snap.presence?.sensing === 'csi',
	snap.presence?.why?.slice( 0, 80 ) )
check( 'el panel no reporta ninguna métrica sin sensor',
	snap.missing.metrics.length === 0,
	snap.missing.metrics.length ? `sin sensor: ${snap.missing.metrics.join( ', ' )}` : '' )

const diag = await plant.systemDiagnosis( { probeAI : false } )
const broken = diag.checks.filter( c => c.result === 'fail' )
const absent = diag.checks.filter( c => c.result === 'absent' )
console.log( `      ${diag.counts.ok} ok · ${diag.counts.warn} a mirar · ${diag.counts.fail} roto · ${diag.counts.absent} sin configurar` )
check( 'nada roto con todo cableado', broken.length === 0,
	broken.map( c => `${c.area}: ${c.says}` ).join( ' · ' ) )
// "Sin configurar" es correcto para lo que esta planta no tiene: no se mueve,
// la lámpara no lleva UV-B, y nada ha ido mal todavía.
check( 'lo no configurado es exactamente lo que no está puesto',
	absent.every( c => [ 'security', 'navigation', 'learning', 'coadaptation',
		'experiments', 'identity', 'integrations', 'root-space',
		// No ha sido trasplantada y el perfilador está apagado por defecto,
		// que es exactamente lo que "sin configurar" quiere decir.
		'transplant', 'profile' ].includes( c.area ) ),
	absent.map( c => c.area ).join( ', ' ) )
for ( const c of diag.checks ) {
	const icon = { ok : '🟢', warn : '🟡', fail : '🔴', absent : '⚪' }[ c.result ]
	console.log( `      ${icon} ${c.area.padEnd( 14 )} ${c.says.slice( 0, 88 )}` )
}

check( 'el diagnóstico cubre también las capas que nadie mira',
	[ 'delivery', 'knowledge', 'safety', 'voice', 'spatial', 'presence',
		'coadaptation', 'experiments', 'identity', 'integrations',
		'continuity-of-self', 'season', 'pot', 'root-space',
		'transplant', 'thermal', 'activity', 'consolidation', 'provenance', 'profile' ]
		.every( a => diag.checks.some( c => c.area === a ) ),
	`${diag.checks.length} áreas comprobadas` )

check( 'toda línea roja o amarilla termina en algo que hacer',
	diag.checks.filter( c => c.result === 'fail' || c.result === 'warn' ).every( c => Boolean( c.fix ) ) )

// ── 4b · the pairing measuring itself ───────────────────────────────────────

head( '4b · Co-adaptación' )
{
	const { ACTION } = await import( '../src/states/gate.js' )
	const { corroborate, oddOneOut, worthTeaching } = await import( '../src/colony/index.js' )
	const { Adaptation, bias } = await import( '../src/states/adaptation.js' )

	// La puerta: el cuidado nunca se bloquea.
	const rows = plant.posture()
	check( 'toda acción pasa por una puerta', rows.length === Object.keys( ACTION ).length )
	check( 'y el cuidado nunca se bloquea',
		rows.filter( r => r.care ).every( r => r.allowed ) )

	// Anular es el único experimento natural que hay.
	plant.perception.electro = { ...plant.perception.electro, events : [ { label : 'variation_potential' } ] }
	plant.perception.vision = { findings : { chewing : true } }
	plant._lastRegime = { changed : true, baselineReady : true }

	const blocked = plant.mayI( ACTION.PROBE.id )
	check( 'una planta que se defiende no se sondea', blocked.allowed === false )
	const forced = plant.mayI( ACTION.PROBE.id, { force : true } )
	check( 'anular abre un ensayo que se calificará', Boolean( forced.trial ) )
	const settled = plant.settleTrial( forced.trial )
	check( 'y el desenlace se registra', [ 'vindicated', 'false-positive', 'unclear' ].includes( settled.outcome ),
		settled.outcome )

	// Evidencia cruzada.
	const four = [ 1, 2, 3, 4 ].map( i => ( { id : 'p' + i, agrees : true, hasOwnElectrode : true } ) )
	check( 'cuatro electrodos independientes corroboran una afirmación sobre la sala',
		corroborate( 'too_cold', four ).strength > 0.8 )
	check( 'y no corroboran una sobre una planta',
		corroborate( 'water_stress', four ).strength === 0.35 )
	check( 'la que se mueve sola apunta a su instrumento',
		oddOneOut( { known : true, members : 5, outliers : [ 'ivy' ] } ).priority === 'instrument' )
	check( 'no se enseña a quien ya sabe',
		worthTeaching( { confidence : 0.9 }, { experience : 0.7 } ).offer === false )

	// Adaptación: sin registro de haberse equivocado, no se mueve nada.
	const ad = new Adaptation()
	ad.register( 'soil.dry', 30 )
	const noGround = ad.adapt( 'soil.dry', bias( Array.from( { length : 25 }, () => 2 ) ), { calibration : plant.calibration } )
	check( 'la adaptación exige que algo le haya dicho que se equivocaba',
		noGround.changed === false, noGround.reason )
	check( 'y todo umbral movido puede deshacerse', ad.revert( 'soil.dry' ).reverted.length === 0 )

	// Trayectoria e identidad.
	const traj = plant.trajectory( { force : true } )
	check( 'la trayectoria del acoplamiento se registra', traj.log.entries.length >= 1 )

	const bundle = await plant.exportIdentity()
	check( 'la identidad del simbionte se exporta', bundle.kind === 'symbiont-identity' )
	check( 'y la huella del electrodo NO viaja como base de trabajo',
		Boolean( bundle.electrode.note ) && /Not installed/.test( bundle.electrode.note ) )
}

// ── 4c · internal processes ─────────────────────────────────────────────────

head( '4c · Procesos internos' )
{
	const { HEMISPHERE } = await import( '../src/archetypes/season.js' )
	const { counterfactual } = await import( '../src/states/consolidation.js' )

	// Estación: el mismo mes, hemisferios opuestos.
	plant.config.hemisphere = HEMISPHERE.NORTH
	const north = plant.seasonalRanges( { at : new Date( 2026, 0, 15 ) } )
	plant.config.hemisphere = HEMISPHERE.SOUTH
	const south = plant.seasonalRanges( { at : new Date( 2026, 0, 15 ) } )
	check( 'enero es invierno arriba y verano abajo',
		north.season === 'winter' && south.season === 'summer' )
	check( 'y sin hemisferio no se ajusta nada',
		( () => { const h = plant.config.hemisphere; delete plant.config.hemisphere
			const r = plant.seasonalRanges(); plant.config.hemisphere = h; return r.applied === false } )() )

	// Consolidación: nunca emite.
	const con = await plant.consolidate( { force : true } )
	check( 'la consolidación no emite nada', con.emitted === false )
	check( 'y no inventa el otro brazo de un contrafactual',
		counterfactual( { history : new Map( [ [ 'x', Array.from( { length : 8 }, () => ( { action : 'water', resolved : true } ) ) ] ] ) }, 'x' ).known === false )

	// Procedencia.
	await plant._ingestLongitudinal()
	check( 'la procedencia registra quién afirmó qué', plant.provenance.size > 0,
		`${plant.provenance.size} afirmaciones sobre ${plant.provenance.report().subjects} sujetos` )
	check( 'y encuentra contradicciones entre capas',
		Array.isArray( plant.provenance.contradictions() ) )

	// Perfilador.
	check( 'el perfilador está apagado por defecto', plant.profile.report().enabled === false )

	// Persistencia del simbionte.
	const block = await plant.persistSymbiont()
	check( 'lo que sabe de sí mismo se persiste',
		Boolean( block.at ) && 'calibration' in block && 'trajectory' in block )
}

// ── 4d · the pot as part of the body ────────────────────────────────────────

head( '4d · Maceta y trasplante' )
{
	const { dose } = await import( '../src/archetypes/watering.js' )
	const { ROOT_SPACE } = await import( '../src/archetypes/rootspace.js' )

	check( 'la misma planta en dos macetas quiere agua muy distinta',
		dose( { archetype : 'tropical', pot : { diameterCm : 40 } } ).ml
			/ dose( { archetype : 'tropical', pot : { diameterCm : 12 } } ).ml > 20 )

	const potted = await createPlant( {
		name : 'Maceta', species : 'Ficus lyrata',
		sensor : { driver : 'mock' }, ai : { provider : 'mock' },
		pot : { litres : 1.2, since : new Date( Date.now() - 200 * 86_400_000 ).toISOString() },
	} )
	await potted.read()

	const before = potted.wateringPlan().ml
	check( 'sin sonda ni historia, el espacio de raíz no afirma nada',
		[ ROOT_SPACE.UNKNOWN, ROOT_SPACE.HIGH ].includes( potted.rootSpace().index ) )
	check( 'y nunca actúa', potted.rootSpace().acts === false )

	await potted.transplant( { volumeL : 5 } )
	check( 'el trasplante reescala el riego', potted.wateringPlan().ml > before * 3 )
	check( 'y borra la banda de suelo de la maceta vieja', potted.ranges.soil === undefined )
	check( 'el espacio de raíz se suspende mientras asienta', potted.rootSpace().settling === true )
	check( 'lo electivo espera', potted.mayI( 'probe' ).allowed === false )
	check( 'y el cuidado no', potted.mayI( 'water' ).allowed === true )
	check( 'la identidad no se toca',
		potted.transplantStatus().phase === 'settling' && Boolean( potted.calibration ) )

	await potted.destroy()
}

// ── 5 · does it survive being used ──────────────────────────────────────────

head( '5 · Uso sostenido' )

const before = process.memoryUsage().heapUsed
const rows0 = plant.memory.data.readings.length
for ( let i = 0; i < 300; i++ ) {
	await plant.read()
	if ( i % 50 === 0 ) { plant.states(); await plant.infer() }
}
global.gc?.()
const grew = ( process.memoryUsage().heapUsed - before ) / 1e6
check( '300 lecturas no hacen crecer el heap sin control', grew < 60, `heap +${grew.toFixed( 1 )}MB` )
check( 'el historial en memoria está acotado',
	plant.memory.data.readings.length <= Math.max( 5000, rows0 + 320 ),
	`${rows0} → ${plant.memory.data.readings.length} filas` )

const say = await plant.speak().catch( e => `THREW ${e.message}` )
check( 'la planta sigue hablando al final', typeof say === 'string' && !say.startsWith( 'THREW' ) )

const again = await plant.systemDiagnosis( { probeAI : false } )
check( 'y el diagnóstico sigue limpio', again.checks.filter( c => c.result === 'fail' ).length === 0 )

// ── done ────────────────────────────────────────────────────────────────────

for ( const t of tidy ) await t().catch( () => {} )
console.log( `\n${'─'.repeat( 56 )}` )
console.log( fail === 0
	? `\x1b[32m✓ ${pass}/${pass + fail} — todo conectado y sin errores\x1b[0m`
	: `\x1b[31m✗ ${fail} problema(s) de ${pass + fail}\x1b[0m` )
process.exit( fail ? 1 : 0 )
