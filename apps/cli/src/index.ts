#!/usr/bin/env node
/**
 * neos — NEOS Work CLI entrypoint
 */

import { runCli } from './cli.js';
import { EXIT } from './exit-codes.js';

const code = await runCli(process.argv.slice(2));
process.exit(code ?? EXIT.OK);
