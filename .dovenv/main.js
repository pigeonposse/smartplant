import { defineConfig }       from '@dovenv/core'
import {lintPlugin}           from '@dovenv/lint'
import {repoPlugin}           from '@dovenv/repo'

import pkg from '../package.json' with { type: "json" }

export default defineConfig(
    {
        const: { pkg }
    },
    lintPlugin({
        staged: { '**/*.{js,ts,jsx,tsx,json}': 'oxlint --fix --silent' }
    }),
    repoPlugin()
)