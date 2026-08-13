/**
 * The page itself.
 *
 * One string. No build step, no framework, nothing fetched from anywhere — the
 * whole thing has to work on a Raspberry Pi with no internet connection, which
 * is where most of these will actually run, and a CDN link would make the page
 * blank exactly when the network is the thing that broke.
 *
 * The layout follows the same rule as the payload: what is *not* known gets as
 * much room as what is. Unmeasured metrics are drawn greyed with their reason
 * rather than left out, because a tidy screen showing four healthy gauges and a
 * plant nobody can see look identical, and one of them is a plant nobody can
 * see.
 */

/**
 * Render the page.
 *
 * @param   {string} name    - The plant's name.
 * @param   {number} everyMs - How often the server pushes.
 * @returns {string}         HTML.
 */
export function page( name, everyMs ) {

	const safe = String( name ).replace( /[<>&"]/g, c => ( {
		'<' : '&lt;',
		'>' : '&gt;',
		'&' : '&amp;',
		'"' : '&quot;',
	} )[ c ] )

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safe}</title>
<style>
:root {
	color-scheme: light dark;
	--bg: #fbfaf7; --fg: #1b1c19; --dim: #6b6f66; --line: #e3e1da;
	--card: #fff; --ok: #4a7c3f; --low: #2f6b8f; --high: #a8562a; --unknown: #9a9a94;
}
@media (prefers-color-scheme: dark) {
	:root { --bg:#14150f; --fg:#e8e7e0; --dim:#8d9186; --line:#2a2c24;
		--card:#1c1e17; --ok:#87b878; --low:#7bb0d4; --high:#d99a6c; --unknown:#5d605a; }
}
* { box-sizing: border-box }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif }
main { max-width: 68ch; margin: 0 auto; padding: 2rem 1.25rem 5rem }
h1 { font-size:1.6rem; margin:0 0 .15rem; font-weight:600 }
h2 { font-size:.78rem; text-transform:uppercase; letter-spacing:.09em; color:var(--dim);
	margin:2.4rem 0 .75rem; font-weight:600 }
.sub { color:var(--dim); margin:0 0 .4rem }
.says { font-size:1.05rem; margin:1.2rem 0 0; padding:.9rem 1.1rem; background:var(--card);
	border:1px solid var(--line); border-radius:.6rem }
.card { background:var(--card); border:1px solid var(--line); border-radius:.6rem;
	padding:.85rem 1rem; margin-bottom:.55rem }
.row { display:flex; align-items:baseline; gap:.6rem }
.row .k { font-weight:600; flex:1 }
.row .v { font-variant-numeric:tabular-nums; font-size:1.15rem }
.row .u { color:var(--dim); font-size:.85rem }
.bar { height:5px; background:var(--line); border-radius:3px; margin-top:.55rem; position:relative; overflow:hidden }
.bar i { position:absolute; top:0; bottom:0; width:3px; border-radius:3px; background:var(--fg) }
.bar.ok i { background:var(--ok) } .bar.low i { background:var(--low) } .bar.high i { background:var(--high) }
.why { color:var(--dim); font-size:.86rem; margin:.45rem 0 0 }
.unmeasured { opacity:.62 }
.unmeasured .v { color:var(--unknown) }
.tag { font-size:.7rem; text-transform:uppercase; letter-spacing:.06em; padding:.12rem .45rem;
	border-radius:.3rem; border:1px solid currentColor }
.tag.ok{color:var(--ok)} .tag.low{color:var(--low)} .tag.high{color:var(--high)} .tag.unknown{color:var(--unknown)}
.state .lvl { font-weight:600 }
.state.high .lvl { color:var(--high) } .state.medium .lvl { color:var(--low) }
.state.unknown .lvl { color:var(--unknown) }
.muted { color:var(--dim); font-size:.86rem }
.chips { display:flex; flex-wrap:wrap; gap:.35rem; margin-top:.3rem }
.chip { font-size:.78rem; padding:.15rem .5rem; border-radius:.3rem; border:1px solid var(--line); color:var(--dim) }
.chip.on { color:var(--ok); border-color:currentColor }
footer { margin-top:3rem; color:var(--dim); font-size:.8rem; border-top:1px solid var(--line); padding-top:1rem }
#stale { display:none; background:var(--high); color:#fff; padding:.5rem 1rem; font-size:.85rem }
#stale.show { display:block }
</style>
</head>
<body>
<div id="stale">The live connection dropped. What follows is the last thing this plant said, not what it is saying now.</div>
<main>
	<h1 id="name">${safe}</h1>
	<p class="sub" id="species"></p>
	<p class="says" id="says"></p>

	<h2>Vitals</h2>
	<div id="vitals"></div>

	<h2>What it is doing</h2>
	<div id="states"></div>

	<h2>The instrument</h2>
	<div id="instrument"></div>

	<h2>What is attached</h2>
	<div class="chips" id="layers"></div>

	<footer>
		<p id="foot"></p>
		<p>Read-only. Watering, probing and moving stay in code, where the safety layers already gate them.</p>
	</footer>
</main>
<script>
const $ = id => document.getElementById( id )
const esc = s => String( s ).replace( /[<>&]/g, c => ( { '<':'&lt;', '>':'&gt;', '&':'&amp;' } )[ c ] )
const UNITS = { temperature:'°C', humidity:'%', soil:'%', light:'lux', co2:'ppm',
	airflow:'m/s', ph:'', conductivity:'µS/cm', voltage:'mV', leafTemperature:'°C',
	par:'µmol/m²/s', redFarRed:'' }

function render( d ) {
	$( 'name' ).textContent = d.plant.name
	$( 'species' ).textContent = [ d.plant.species, d.plant.archetype,
		d.plant.readings + ' readings' ].filter( Boolean ).join( ' · ' )
	$( 'says' ).textContent = d.says || 'This plant has nothing to say yet — it has not been read.'

	$( 'vitals' ).innerHTML = d.vitals.map( v => {
		if ( !v.measured ) return '<div class="card unmeasured"><div class="row">' +
			'<span class="k">' + esc( v.metric ) + '</span>' +
			'<span class="v">not measured</span></div>' +
			'<p class="why">' + esc( v.why ) + '</p></div>'
		const pct = v.fraction === null ? null : Math.round( v.fraction * 100 )
		return '<div class="card"><div class="row">' +
			'<span class="k">' + esc( v.metric ) + '</span>' +
			'<span class="tag ' + v.band + '">' + v.band + '</span>' +
			'<span class="v">' + v.value + '</span>' +
			'<span class="u">' + ( UNITS[ v.metric ] ?? '' ) + '</span></div>' +
			( pct === null ? '' : '<div class="bar ' + v.band + '"><i style="left:' +
				Math.min( 98, Math.max( 0, pct ) ) + '%"></i></div>' ) +
			( v.range ? '<p class="why">comfortable between ' + v.range.min + ' and ' + v.range.max + '</p>'
				: '<p class="why">' + esc( v.why || '' ) + '</p>' )
	} ).join( '' )

	const states = Object.entries( d.states || {} )
	$( 'states' ).innerHTML = states.length ? states.map( ( [ k, s ] ) =>
		'<div class="card state ' + s.level + '"><div class="row">' +
		'<span class="k">' + esc( k.replace( /_/g, ' ' ) ) + '</span>' +
		'<span class="lvl">' + s.level + '</span></div>' +
		'<p class="why">' + esc( s.why ) + '</p>' +
		( s.acts ? '' : '<p class="why"><em>Not changing any decision — either nothing is happening, ' +
			'or the evidence is too weak to be allowed to.</em></p>' )
	+ '</div>' ).join( '' ) : '<p class="muted">No internal states available.</p>'

	const inst = d.instrument
	$( 'instrument' ).innerHTML = inst
		? '<div class="card"><div class="row"><span class="k">condition</span>' +
			'<span class="lvl">' + esc( inst.condition ) + '</span></div>' +
			( inst.findings || [] ).map( f => '<p class="why">' + esc( f.why ) + '</p>' ).join( '' ) +
			'</div>'
		: '<p class="muted">No inspection available.</p>'

	$( 'layers' ).innerHTML = Object.entries( d.layers ).map( ( [ k, v ] ) =>
		'<span class="chip' + ( v ? ' on' : '' ) + '">' + esc( k ) + ( v && v !== true ? ': ' + esc( v ) : '' ) + '</span>'
	).join( '' ) + ( d.missing.metrics.length
		? '<span class="chip">' + d.missing.metrics.length + ' metrics unmeasured</span>' : '' )

	$( 'foot' ).textContent = d.missing.why + ' Last read ' +
		( d.lastReadingAt ? new Date( d.lastReadingAt ).toLocaleString() : 'never' ) + '.'
}

// The staleness banner matters more than it looks. A dashboard that keeps
// showing the last numbers after the connection dies is the single most
// misleading thing it can do — the plant may have been dark for hours.
let src
function connect() {
	src = new EventSource( '/live' )
	src.onmessage = e => { $( 'stale' ).classList.remove( 'show' ); render( JSON.parse( e.data ) ) }
	src.onerror = () => { $( 'stale' ).classList.add( 'show' ); src.close(); setTimeout( connect, ${everyMs} ) }
}
fetch( '/vitals.json' ).then( r => r.json() ).then( render ).catch( () => {} )
connect()
</script>
</body>
</html>`

}
