/**
 * The documentation site.
 *
 * The Markdown lives in `docs/` at the root of the repository and nowhere else:
 * this package only knows how to turn it into a site. That separation is the
 * point of the arrangement — somebody adding a page writes one `.md` file and
 * touches nothing here.
 */

import { defineConfig } from '@dovenv/core'
import ppTheme          from '@dovenv/theme-pigeonposse'

const sidebar = [
	{
		text  : 'Introduction',
		items : [
			{
				text : 'What is SmartPlant?',
				link : '/guide/',
			},
			{
				text : 'Cyborgplant',
				link : '/guide/cyborgplant',
			},
		],
	},
	{
		text  : 'Core',
		items : [
			{
				text : '🌡 Sensors',
				link : '/guide/core/sensors',
			},
			{
				text : '🤖 AI',
				link : '/guide/core/ai',
			},
			{
				text : '💾 Memory',
				link : '/guide/core/memory',
			},
			{
				text : '🗣 Voice',
				link : '/guide/core/voice',
			},
			{
				text : '⚡ Events',
				link : '/guide/core/events',
			},
		],
	},
	{
		text  : 'Reading the plant',
		items : [
			{
				text : '🧬 Electrophysiology',
				link : '/guide/plant/electrophysiology',
			},
			{
				text : '🪞 On its own terms',
				link : '/guide/plant/on-its-own-terms',
			},
			{
				text : '🧪 The electrome',
				link : '/guide/plant/electrome',
			},
			{
				text : '🫀 Internal states',
				link : '/guide/plant/states',
			},
			{
				text : '👁 Vision',
				link : '/guide/plant/vision',
			},
			{
				text : '🌡 Thermal',
				link : '/guide/plant/thermal',
			},
			{
				text : '🔬 Spectral',
				link : '/guide/plant/spectral',
			},
		],
	},
	{
		text  : 'Looking after it',
		items : [
			{
				text : '🪴 The pot',
				link : '/guide/care/pot',
			},
			{
				text : '💧 How much water',
				link : '/guide/care/water',
			},
			{
				text : '🔎 What worked last time',
				link : '/guide/care/what-worked',
			},
			{
				text : '🌙 Night consolidation',
				link : '/guide/care/night',
			},
			{
				text : '🔁 Learning it is wrong',
				link : '/guide/care/learning',
			},
		],
	},
	{
		text  : 'Knowing whether it works',
		items : [
			{
				text : '🩻 System diagnosis',
				link : '/guide/checks/diagnosis',
			},
			{
				text : '🩺 Looking at itself',
				link : '/guide/checks/checkup',
			},
			{
				text : '🔧 Maintenance',
				link : '/guide/checks/maintenance',
			},
			{
				text : '🔌 What has touched hardware',
				link : '/guide/checks/hardware-truth',
			},
		],
	},
	{
		text  : 'Ecosystem',
		items : [
			{
				text : '🔌 Plugins',
				link : '/guide/ecosystem/plugins',
			},
			{
				text : '🛠 Firmware generation',
				link : '/guide/ecosystem/firmware',
			},
			{
				text : '📡 Integrations',
				link : '/guide/ecosystem/integrations',
			},
			{
				text : '🖥 Dashboard',
				link : '/guide/ecosystem/dashboard',
			},
			{
				text : '⌨️ CLI',
				link : '/guide/ecosystem/cli',
			},
		],
	},
	{
		text      : 'Colony',
		collapsed : false,
		items     : [
			{
				text : '🗨 Plants talking to plants',
				link : '/guide/colony/',
			},
			{
				text : '🫧 Two plants close together',
				link : '/guide/colony/coupling',
			},
			{
				text : '📇 Capability',
				link : '/guide/colony/capability',
			},
			{
				text : '🔦 Beacon mode',
				link : '/guide/colony/beacon',
			},
			{
				text : '🛡 Security priming',
				link : '/guide/colony/priming',
			},
			{
				text : '📮 A second way through',
				link : '/guide/colony/delivery',
			},
			{
				text : '🧬 Inheritance',
				link : '/guide/colony/inheritance',
			},
			{
				text : '🤝 Federated learning',
				link : '/guide/colony/federated',
			},
			{
				text : '🎓 Knowledge transfer',
				link : '/guide/colony/transfer',
			},
		],
	},
	{
		text      : 'Symbiosis',
		collapsed : true,
		items     : [
			{
				text : '🦿 Getting a body',
				link : '/guide/body/',
			},
			{
				text : '🔀 Multirate fusion',
				link : '/guide/body/fusion',
			},
			{
				text : '🧾 Evidence',
				link : '/guide/body/evidence',
			},
			{
				text : '🛡 Safety',
				link : '/guide/body/safety',
			},
			{
				text : '🎚 Hierarchical control',
				link : '/guide/body/control',
			},
			{
				text : '🎯 Personalization',
				link : '/guide/body/personalization',
			},
			{
				text : '🚜 Moving a plant',
				link : '/guide/body/navigation',
			},
			{
				text : '📡 Reading the space',
				link : '/guide/body/space',
			},
		],
	},
	{
		text      : 'More',
		collapsed : true,
		items     : [
			{
				text : '🧠 Knowledge & reasoning',
				link : '/guide/extra/knowledge',
			},
			{
				text : '🔍 Semantic memory',
				link : '/guide/extra/semantic',
			},
			{
				text : '🔎 Hardware autodetection',
				link : '/guide/extra/hardware',
			},
			{
				text : '🦞 OpenClaw',
				link : '/guide/extra/openclaw',
			},
			{
				text : '😊 Emoji scales',
				link : '/guide/extra/emoji',
			},
			{
				text : '📖 Full API surface',
				link : '/guide/extra/api',
			},
			{
				text : '⬆️ Migrating from 1.x',
				link : '/guide/extra/migrating',
			},
		],
	},
]

export default defineConfig(
	ppTheme( {
		docs : async () => ( {
			name      : 'SmartPlant',
			desc      : 'A bridge between AI and plants: read a plant\'s own electrical signals, ask it questions with light, and refuse to guess when nothing is measuring.',
			shortDesc : 'A bridge between AI and plants',
			version   : '3.0.5',
			url       : 'https://smartplant.pigeonposse.com',
			repoURL   : 'https://github.com/pigeonposse/smartplant',
			npmURL    : 'https://www.npmjs.com/package/smartplant',
			bugsURL   : 'https://github.com/pigeonposse/smartplant/issues',
			// The heart beside the GitHub button in the navbar.
			fundingURL : 'https://pigeonposse.com/?popup=donate',
			license   : {
				type : 'MIT',
				url  : 'https://github.com/pigeonposse/smartplant/blob/main/LICENSE',
			},
			docsPath : 'docs',
			logo     : '/logo.png',
			favicon  : '/favicon.png',
			footer   : {
				links : {
					web       : 'https://pigeonposse.com',
					email     : 'dev@pigeonposse.com',
					twitter   : 'https://twitter.com/pigeonposse_',
					instagram : 'https://www.instagram.com/pigeon.posse/',
					medium    : 'https://medium.com/@pigeonposse',
				},
				copy : {
					name : 'PigeonPosse',
					url  : 'https://pigeonposse.com',
				},
			},
			css : `
			:root {
				--sp-green: #82d629;
				--sp-paper: #f1f7eb;
			}

			/* Light only. The dark theme has a background of its own, and painting
			   it would ruin the one mode that was already fine. */
			:root:not(.dark) {
				--vp-c-bg: var(--sp-paper);
				--vp-c-bg-alt: #e8f1de;
				--vp-c-bg-soft: #e8f1de;
				--vp-c-bg-elv: #ffffff;

				/* The brand green is a light one — 1.9:1 against this paper. Fine
				   for the logo and for filled buttons, unreadable as link text, so
				   text and links get a darkened version of the same hue and only
				   the surfaces get the green itself. */
				--vp-c-brand-1: #3f6b13;
				--vp-c-brand-2: #4f851a;
				--vp-c-brand-3: var(--sp-green);
				--vp-c-brand-soft: rgba(130, 214, 41, .16);

				--vp-button-brand-bg: var(--sp-green);
				--vp-button-brand-text: #17300a;
				--vp-button-brand-hover-bg: #74c220;
				--vp-button-brand-hover-text: #17300a;

				--vp-home-hero-name-color: var(--sp-green);

				/* The glow behind the logo. The theme paints it in the brand
				   green, which on a green page reads as a smudge rather than as
				   a halo. White at half opacity lifts the icon off the paper and
				   stays out of the way. */
				--vp-home-hero-image-background-image: linear-gradient(
					150deg,
					rgba(255,255,255,.5),
					rgba(255,255,255,.5)
				);
				--vp-home-hero-image-filter: blur(56px);
			}
			`,
			input    : '../docs',
			output   : 'build',
			sidebar : {
				'/guide/' : sidebar,
				'/todo/'  : sidebar,
			},
			autoSidebar : {
				intro     : false,
				reference : false,
			},
		} ),
	} ),
)
