/**
 * The page itself.
 *
 * One string. No build step, no framework, nothing fetched from anywhere — the
 * whole thing has to work on a Raspberry Pi with no internet connection, which
 * is where most of these will actually run, and a CDN link would make the page
 * blank exactly when the network is the thing that broke.
 *
 * ## A terminal, not a dashboard
 *
 * Three regions, fixed to the viewport, nothing scrolls: a short banner, a
 * console down the left, and the instrument report down the right.
 *
 * The console is the part that changes how the thing reads. A panel of gauges
 * that overwrites itself shows you the present and destroys the past — you
 * cannot tell a plant that has been at 5% humidity for an hour from one that
 * dropped there a minute ago, and that difference is most of what matters. So
 * the vitals line is *appended* once a minute and the previous lines stay. It
 * accumulates into a record you can read down, which is what a console is for.
 *
 * The right column never moves. It is the inventory: what this plant can
 * measure, what it cannot, and which layers are attached. It is deliberately
 * static, because a list that flickers invites you to watch it, and there is
 * nothing there to watch.
 */

/**
 * Render the page.
 *
 * @param   {object} opts - `{ name, everyMs }`.
 * @returns {string}      HTML.
 */
export function page( opts = {} ) {

	const name = String( opts.name ?? 'plant' )
	const everyMs = opts.everyMs ?? 5000

	const esc = s => String( s ).replace( /[<>&"]/g, c => ( {
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
<title>${esc( name )}</title>
<style>
:root {
	--bg:#07080a; --panel:#0c0e11; --line:#1b1f25; --fg:#c8d0cc; --dim:#5d6670;
	--ok:#5fbf72; --low:#4ea3d6; --high:#e0894a; --none:#454c55; --accent:#7fd18a;
	--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing:border-box; margin:0; padding:0 }
html, body { height:100%; overflow:hidden }
body {
	background:var(--bg); color:var(--fg); font:13px/1.5 var(--mono);
	display:grid; grid-template-rows:auto 1fr; height:100vh;
	-webkit-font-smoothing:antialiased;
}

/* ── banner ─────────────────────────────────────────────────────────────── */
header {
	display:flex; align-items:center; gap:1rem;
	padding:.55rem 1rem; border-bottom:1px solid var(--line); background:var(--panel);
}
header .brand { font-weight:600; letter-spacing:.16em; font-size:.7rem;
	color:var(--dim); text-transform:uppercase }
header .spacer { flex:1 }
header .id { text-align:right; line-height:1.25 }
header .id .n { font-size:.95rem; color:var(--fg); font-weight:600 }
header .id .a { font-size:.72rem; color:var(--dim) }
header img { width:30px; height:30px; display:block; image-rendering:auto }
.dot { width:7px; height:7px; border-radius:50%; background:var(--ok); flex:none }
.dot.stale { background:var(--high) }

/* ── two columns, neither scrolls the page ──────────────────────────────── */
main { display:grid; grid-template-columns:1fr 22rem; min-height:0 }
section { min-height:0; display:flex; flex-direction:column }
section + section { border-left:1px solid var(--line) }
h2 { font-size:.63rem; text-transform:uppercase; letter-spacing:.14em; color:var(--dim);
	font-weight:600; padding:.6rem 1rem .45rem; border-bottom:1px solid var(--line) }

/* ── console ────────────────────────────────────────────────────────────── */
#console { flex:1; min-height:0; overflow-y:auto; padding:.6rem 1rem 1rem;
	scrollbar-width:thin; scrollbar-color:var(--line) transparent }
#console::-webkit-scrollbar { width:6px }
#console::-webkit-scrollbar-thumb { background:var(--line); border-radius:3px }
#console p { white-space:pre-wrap; word-break:break-word; padding:.1rem 0 }
#console .ts { color:var(--dim) }
#console .boot { color:var(--dim) }
#console .sep { color:var(--none) }

/* ── inventory ──────────────────────────────────────────────────────────── */
#report { flex:1; min-height:0; overflow-y:auto; padding:.35rem 0 1rem;
	scrollbar-width:thin; scrollbar-color:var(--line) transparent }
#report::-webkit-scrollbar { width:6px }
#report::-webkit-scrollbar-thumb { background:var(--line); border-radius:3px }
.grp { font-size:.62rem; text-transform:uppercase; letter-spacing:.12em;
	color:var(--none); padding:.75rem 1rem .3rem }
.item { display:flex; align-items:baseline; gap:.5rem; padding:.16rem 1rem }
.item .k { flex:1; color:var(--fg) }
.item .v { font-variant-numeric:tabular-nums; color:var(--dim) }
.item.off .k, .item.off .v { color:var(--none) }
.item .s { width:.55rem; text-align:center }
.s.ok{color:var(--ok)} .s.low{color:var(--low)} .s.high{color:var(--high)}
.s.none{color:var(--none)} .s.unknown{color:var(--none)}
footer { border-top:1px solid var(--line); padding:.5rem 1rem; color:var(--none);
	font-size:.68rem; line-height:1.45 }
</style>
</head>
<body>

<header>
	<span class="dot" id="dot"></span>
	<span class="brand">smartplant</span>
	<span class="spacer"></span>
	<span class="id">
		<div class="n" id="pname">${esc( name )}</div>
		<div class="a" id="paddr">—</div>
	</span>
	<img src="/logo.png" alt="">
</header>

<main>
	<section>
		<h2>Vitals · one line a minute</h2>
		<div id="console"></div>
	</section>
	<section>
		<h2>Instrument</h2>
		<div id="report"></div>
		<footer>Read-only. Nothing on this page can act on the plant.</footer>
	</section>
</main>

<script>
const $ = id => document.getElementById( id )
const esc = s => String( s ).replace( /[<>&]/g, c => ( { '<':'&lt;', '>':'&gt;', '&':'&amp;' } )[ c ] )
const pad = n => String( n ).padStart( 2, '0' )
const clock = d => pad( d.getHours() ) + ':' + pad( d.getMinutes() ) + ':' + pad( d.getSeconds() )

/* One line a minute. A gauge that overwrites itself shows the present and
   destroys the past, and "at 5% for an hour" and "dropped to 5% just now" are
   the same picture on it. Appending keeps the difference. */
let lastMinute = null
const MAX_LINES = 400

function log( text, cls ) {
	const el = document.createElement( 'p' )
	el.innerHTML = '<span class="ts">' + clock( new Date() ) + '</span>  ' +
		( cls ? '<span class="' + cls + '">' + esc( text ) + '</span>' : esc( text ) )
	const box = $( 'console' )
	box.appendChild( el )
	while ( box.childElementCount > MAX_LINES ) box.removeChild( box.firstChild )
	box.scrollTop = box.scrollHeight
}

function onData( d ) {
	$( 'dot' ).classList.remove( 'stale' )
	$( 'pname' ).textContent = d.plant.name
	$( 'paddr' ).textContent = [ d.net && d.net.address, d.plant.species ].filter( Boolean ).join( '  ·  ' )

	const now = new Date()
	const minute = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate() +
		'-' + now.getHours() + '-' + now.getMinutes()

	if ( minute !== lastMinute ) {
		lastMinute = minute
		log( d.says || 'no reading yet' )
	}

	report( d )
}

/* The right column is the inventory and it does not move. A list that flickers
   invites you to watch it, and there is nothing here to watch. */
let reportSig = null
function report( d ) {
	const sig = JSON.stringify( [ d.vitals.map( v => [ v.metric, v.measured, v.band ] ), d.layers ] )
	if ( sig === reportSig ) return
	reportSig = sig

	const mark = { ok:'●', low:'▼', high:'▲', unknown:'·' }
	const measured = d.vitals.filter( v => v.measured )
	const absent = d.vitals.filter( v => !v.measured )

	let html = '<div class="grp">sensors reporting · ' + measured.length + '</div>'
	html += measured.map( v =>
		'<div class="item"><span class="s ' + v.band + '">' + mark[ v.band ] + '</span>' +
		'<span class="k">' + esc( v.metric ) + '</span>' +
		'<span class="v">' + v.value + '</span></div>' ).join( '' )

	html += '<div class="grp">not measured · ' + absent.length + '</div>'
	html += absent.length
		? absent.map( v => '<div class="item off"><span class="s none">·</span>' +
			'<span class="k">' + esc( v.metric ) + '</span>' +
			'<span class="v">no sensor</span></div>' ).join( '' )
		: '<div class="item off"><span class="s none">·</span><span class="k">—</span></div>'

	html += '<div class="grp">layers</div>'
	html += Object.entries( d.layers ).map( ( [ k, v ] ) =>
		'<div class="item' + ( v ? '' : ' off' ) + '"><span class="s ' + ( v ? 'ok' : 'none' ) + '">' +
		( v ? '●' : '·' ) + '</span><span class="k">' + esc( k ) + '</span>' +
		'<span class="v">' + ( v ? ( v === true ? 'attached' : esc( v ) ) : 'none' ) + '</span></div>'
	).join( '' )

	$( 'report' ).innerHTML = html
}

/* A page still showing the last numbers after the stream died is the most
   misleading thing it can do — the plant may have been dark for hours. */
let src
function connect() {
	src = new EventSource( '/live' )
	src.onmessage = e => onData( JSON.parse( e.data ) )
	src.onerror = () => {
		$( 'dot' ).classList.add( 'stale' )
		log( 'connection lost — nothing below this line is current', 'boot' )
		src.close()
		setTimeout( connect, ${everyMs} )
	}
}

log( 'smartplant · read-only monitor', 'boot' )
fetch( '/vitals.json' ).then( r => r.json() ).then( onData ).catch( () => {} )
connect()
</script>
</body>
</html>`

}
