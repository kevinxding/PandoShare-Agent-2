#!/usr/bin/env node
import { runSmoke } from './productization-smoke-lib.mjs'
await runSmoke('patch-verifier')

