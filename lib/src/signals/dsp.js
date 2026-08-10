/**
 * Digital signal processing for plant electrophysiology.
 *
 * Plants generate real, measurable electrical signals: action potentials (APs),
 * variation potentials (VPs) and system potentials, on timescales of seconds to
 * minutes and amplitudes of millivolts. Reading them is the closest thing to a
 * direct channel into what a plant is doing.
 *
 * These are the primitives that make such a signal usable: detrending, filtering,
 * and a spectrum. Everything is pure JavaScript over plain arrays — no native
 * build, no Python, so it runs on a Raspberry Pi and in a browser alike.
 *
 * Filters are zero-phase (forward-backward): plant events are located in time,
 * and a filter that shifts them would move an action potential away from the
 * stimulus that caused it.
 */

/**
 * Remove the DC offset.
 *
 * @param   {number[]} x - Samples.
 * @returns {number[]}   Zero-mean samples.
 */
export function removeMean( x ) {

	if ( !x.length ) return []
	const mean = x.reduce( ( a, b ) => a + b, 0 ) / x.length
	return x.map( v => v - mean )

}

/**
 * Remove a linear trend — electrode drift is the dominant artefact in long
 * plant recordings, and it swamps everything below it if left in.
 *
 * @param   {number[]} x - Samples.
 * @returns {number[]}   Detrended samples.
 */
export function detrend( x ) {

	const n = x.length
	if ( n < 2 ) return [ ...x ]

	let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
	for ( let i = 0; i < n; i++ ) {

		sumX  += i
		sumY  += x[ i ]
		sumXY += i * x[ i ]
		sumXX += i * i

	}

	const denom = n * sumXX - sumX * sumX
	if ( denom === 0 ) return removeMean( x )

	const slope     = ( n * sumXY - sumX * sumY ) / denom
	const intercept = ( sumY - slope * sumX ) / n
	return x.map( ( v, i ) => v - ( slope * i + intercept ) )

}

/**
 * Moving average.
 *
 * @param   {number[]} x      - Samples.
 * @param   {number}   window - Window length in samples.
 * @returns {number[]}        Smoothed samples.
 */
export function movingAverage( x, window ) {

	const w = Math.max( 1, Math.floor( window ) )
	if ( w === 1 || x.length < w ) return [ ...x ]

	const out = Array.from( { length : x.length } )
	let sum = 0

	for ( let i = 0; i < x.length; i++ ) {

		sum += x[ i ]
		if ( i >= w ) sum -= x[ i - w ]
		// Ramp up over the first window rather than emitting a partial-sum artefact.
		out[ i ] = sum / Math.min( i + 1, w )

	}
	return out

}

/**
 * Median filter — removes impulsive electrode noise without smearing the sharp
 * leading edge of an action potential, which a moving average would.
 *
 * @param   {number[]} x      - Samples.
 * @param   {number}   window - Odd window length.
 * @returns {number[]}        Filtered samples.
 */
export function medianFilter( x, window = 5 ) {

	let w = Math.max( 1, Math.floor( window ) )
	if ( w % 2 === 0 ) w++
	if ( w === 1 ) return [ ...x ]

	const half = ( w - 1 ) / 2
	const out  = Array.from( { length : x.length } )

	for ( let i = 0; i < x.length; i++ ) {

		const lo = Math.max( 0, i - half )
		const hi = Math.min( x.length - 1, i + half )
		const slice = x.slice( lo, hi + 1 ).sort( ( a, b ) => a - b )
		out[ i ] = slice[ Math.floor( slice.length / 2 ) ]

	}
	return out

}

/** Single-pole IIR coefficients for a given cutoff. */
function onePole( cutoffHz, sampleRate ) {

	const dt  = 1 / sampleRate
	const rc  = 1 / ( 2 * Math.PI * cutoffHz )
	return dt / ( rc + dt )

}

/** Forward pass of a one-pole low-pass. */
function lowPassForward( x, alpha ) {

	const out = Array.from( { length : x.length } )
	let prev = x[ 0 ] ?? 0
	for ( let i = 0; i < x.length; i++ ) {

		prev = prev + alpha * ( x[ i ] - prev )
		out[ i ] = prev

	}
	return out

}

/**
 * Zero-phase low-pass filter.
 *
 * @param   {number[]} x          - Samples.
 * @param   {number}   cutoffHz   - Cutoff frequency.
 * @param   {number}   sampleRate - Samples per second.
 * @returns {number[]}            Filtered samples.
 */
export function lowPass( x, cutoffHz, sampleRate ) {

	if ( !x.length || cutoffHz <= 0 || cutoffHz >= sampleRate / 2 ) return [ ...x ]
	const alpha = onePole( cutoffHz, sampleRate )
	// Forward, then backward over the reversed result: the phase shift of the
	// second pass cancels the first exactly.
	const fwd = lowPassForward( x, alpha )
	const bwd = lowPassForward( [ ...fwd ].reverse(), alpha )
	return bwd.reverse()

}

/**
 * Zero-phase high-pass filter.
 *
 * @param   {number[]} x          - Samples.
 * @param   {number}   cutoffHz   - Cutoff frequency.
 * @param   {number}   sampleRate - Samples per second.
 * @returns {number[]}            Filtered samples.
 */
export function highPass( x, cutoffHz, sampleRate ) {

	if ( !x.length || cutoffHz <= 0 ) return [ ...x ]
	const low = lowPass( x, cutoffHz, sampleRate )
	return x.map( ( v, i ) => v - low[ i ] )

}

/**
 * Zero-phase band-pass filter.
 *
 * @param   {number[]} x          - Samples.
 * @param   {number}   lowHz      - Lower cutoff.
 * @param   {number}   highHz     - Upper cutoff.
 * @param   {number}   sampleRate - Samples per second.
 * @returns {number[]}            Filtered samples.
 */
export function bandPass( x, lowHz, highHz, sampleRate ) {

	return highPass( lowPass( x, highHz, sampleRate ), lowHz, sampleRate )

}

/**
 * Notch filter for mains hum.
 *
 * Any electrode near a wall socket picks up 50 Hz (or 60 Hz) far louder than the
 * plant itself. This is not optional in practice — it is the difference between
 * a readable trace and a sine wave.
 *
 * @param   {number[]} x            - Samples.
 * @param   {number}   sampleRate   - Samples per second.
 * @param   {number}   [mainsHz]    - 50 or 60.
 * @param   {number}   [bandwidth]  - Notch width in Hz.
 * @returns {number[]}              Filtered samples.
 */
export function notch( x, sampleRate, mainsHz = 50, bandwidth = 2 ) {

	if ( !x.length || mainsHz <= 0 || mainsHz >= sampleRate / 2 ) return [ ...x ]

	// A second-order biquad, not a pair of one-poles: a one-pole rolls off at
	// 6 dB/octave, which over a 2 Hz notch at 50 Hz removes only about half the
	// hum. The biquad puts a true zero on the offending frequency.
	const w0    = ( 2 * Math.PI * mainsHz ) / sampleRate
	const q     = mainsHz / Math.max( 0.01, bandwidth )
	const alpha = Math.sin( w0 ) / ( 2 * q )
	const cosW0 = Math.cos( w0 )

	const a0 = 1 + alpha
	const b  = [ 1 / a0, ( -2 * cosW0 ) / a0, 1 / a0 ]
	const a  = [ ( -2 * cosW0 ) / a0, ( 1 - alpha ) / a0 ]

	// Forward then backward, so the notch stays zero-phase like the others.
	const fwd = biquad( x, b, a )
	return biquad( [ ...fwd ].reverse(), b, a ).reverse()

}

/**
 * Direct-form-I biquad.
 *
 * @param   {number[]} x - Samples.
 * @param   {number[]} b - Feed-forward coefficients `[b0, b1, b2]`, pre-normalized.
 * @param   {number[]} a - Feedback coefficients `[a1, a2]`, pre-normalized.
 * @returns {number[]}   Filtered samples.
 */
export function biquad( x, b, a ) {

	const out = Array.from( { length : x.length } )
	let x1 = 0, x2 = 0, y1 = 0, y2 = 0

	for ( let i = 0; i < x.length; i++ ) {

		const xn = x[ i ]
		const yn = b[ 0 ] * xn + b[ 1 ] * x1 + b[ 2 ] * x2 - a[ 0 ] * y1 - a[ 1 ] * y2

		x2 = x1
		x1 = xn
		y2 = y1
		y1 = yn
		out[ i ] = yn

	}

	return out

}

/**
 * Radix-2 Cooley-Tukey FFT, in place on split real/imaginary arrays.
 *
 * @param   {number[]} re - Real parts. Length must be a power of two.
 * @param   {number[]} im - Imaginary parts.
 * @returns {{re: number[], im: number[]}} Transformed arrays.
 */
export function fft( re, im ) {

	const n = re.length
	if ( n <= 1 ) return {
		re,
		im,
	}
	if ( ( n & ( n - 1 ) ) !== 0 ) throw new Error( `FFT length must be a power of two, got ${n}` )

	// Bit-reversal permutation.
	for ( let i = 1, j = 0; i < n; i++ ) {

		let bit = n >> 1
		for ( ; j & bit; bit >>= 1 ) j ^= bit
		j ^= bit
		if ( i < j ) {

			[ re[ i ], re[ j ] ] = [ re[ j ], re[ i ] ];
			[ im[ i ], im[ j ] ] = [ im[ j ], im[ i ] ]

		}

	}

	for ( let len = 2; len <= n; len <<= 1 ) {

		const angle = ( -2 * Math.PI ) / len
		const wRe = Math.cos( angle )
		const wIm = Math.sin( angle )

		for ( let i = 0; i < n; i += len ) {

			let curRe = 1, curIm = 0
			for ( let k = 0; k < len / 2; k++ ) {

				const uRe = re[ i + k ]
				const uIm = im[ i + k ]
				const vRe = re[ i + k + len / 2 ] * curRe - im[ i + k + len / 2 ] * curIm
				const vIm = re[ i + k + len / 2 ] * curIm + im[ i + k + len / 2 ] * curRe

				re[ i + k ] = uRe + vRe
				im[ i + k ] = uIm + vIm
				re[ i + k + len / 2 ] = uRe - vRe
				im[ i + k + len / 2 ] = uIm - vIm

				const nextRe = curRe * wRe - curIm * wIm
				curIm = curRe * wIm + curIm * wRe
				curRe = nextRe

			}

		}

	}

	return {
		re,
		im,
	}

}

/** Hann window — reduces spectral leakage on non-periodic segments. */
export function hann( n ) {

	const w = Array.from( { length : n } )
	for ( let i = 0; i < n; i++ ) w[ i ] = 0.5 * ( 1 - Math.cos( ( 2 * Math.PI * i ) / ( n - 1 ) ) )
	return w

}

/** Largest power of two at or below n. */
function floorPow2( n ) {

	return 2 ** Math.floor( Math.log2( n ) )

}

/**
 * One-sided amplitude spectrum.
 *
 * @param   {number[]} x            - Samples.
 * @param   {number}   sampleRate   - Samples per second.
 * @param   {object}   [opts]       - Options.
 * @param   {boolean}  [opts.window]- Apply a Hann window. Default true.
 * @returns {{freqs: number[], magnitudes: number[]}} Spectrum.
 */
export function spectrum( x, sampleRate, opts = {} ) {

	const n = floorPow2( x.length )
	if ( n < 2 ) return {
		freqs      : [],
		magnitudes : [],
	}

	const seg = detrend( x.slice( 0, n ) )
	const w   = opts.window === false ? null : hann( n )
	const re  = w ? seg.map( ( v, i ) => v * w[ i ] ) : [ ...seg ]
	const im  = Array.from( { length : n }, () => 0 )

	fft( re, im )

	const half       = n / 2
	const freqs      = Array.from( { length : half } )
	const magnitudes = Array.from( { length : half } )

	for ( let i = 0; i < half; i++ ) {

		freqs[ i ] = ( i * sampleRate ) / n
		magnitudes[ i ] = ( 2 * Math.hypot( re[ i ], im[ i ] ) ) / n

	}

	return {
		freqs,
		magnitudes,
	}

}

/**
 * Dominant frequency and its power.
 *
 * @param   {number[]} x          - Samples.
 * @param   {number}   sampleRate - Samples per second.
 * @param   {object}   [opts]     - Options.
 * @param   {number}   [opts.minHz] - Ignore bins below this (drops the DC bin).
 * @returns {{frequency: number, magnitude: number, periodSeconds: number}|null} Peak, or null.
 */
export function dominantFrequency( x, sampleRate, opts = {} ) {

	const { freqs, magnitudes } = spectrum( x, sampleRate )
	if ( !freqs.length ) return null

	const minHz = opts.minHz ?? 0
	let best = -1, bestMag = -Infinity

	for ( let i = 1; i < freqs.length; i++ ) {

		if ( freqs[ i ] < minHz ) continue
		if ( magnitudes[ i ] > bestMag ) {

			bestMag = magnitudes[ i ]
			best = i

		}

	}

	if ( best < 0 ) return null
	return {
		frequency     : freqs[ best ],
		magnitude     : bestMag,
		periodSeconds : freqs[ best ] > 0 ? 1 / freqs[ best ] : Infinity,
	}

}

/**
 * Resample by linear interpolation. Sensor streams arrive at irregular rates;
 * spectral analysis needs a uniform one.
 *
 * @param   {number[]} x       - Samples.
 * @param   {number}   fromHz  - Original rate.
 * @param   {number}   toHz    - Target rate.
 * @returns {number[]}         Resampled samples.
 */
export function resample( x, fromHz, toHz ) {

	if ( !x.length || fromHz === toHz ) return [ ...x ]
	const ratio = toHz / fromHz
	const outLen = Math.max( 1, Math.floor( x.length * ratio ) )
	const out = Array.from( { length : outLen } )

	for ( let i = 0; i < outLen; i++ ) {

		const pos = i / ratio
		const lo  = Math.floor( pos )
		const hi  = Math.min( x.length - 1, lo + 1 )
		const frac = pos - lo
		out[ i ] = x[ lo ] * ( 1 - frac ) + x[ hi ] * frac

	}
	return out

}

/**
 * Normalize to zero mean and unit variance (z-score).
 *
 * @param   {number[]} x - Samples.
 * @returns {number[]}   Standardized samples.
 */
export function zscore( x ) {

	if ( !x.length ) return []
	const mean = x.reduce( ( a, b ) => a + b, 0 ) / x.length
	const sd   = Math.sqrt( x.reduce( ( a, b ) => a + ( b - mean ) ** 2, 0 ) / x.length )
	if ( sd === 0 ) return x.map( () => 0 )
	return x.map( v => ( v - mean ) / sd )

}
