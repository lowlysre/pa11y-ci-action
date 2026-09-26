import * as core from '@actions/core';
import {installPa11yCi} from './lib/install.js';

try {
	core.setOutput('bin-path', await installPa11yCi(process.env.PA11Y_CI_VERSION));
} catch (error) {
	core.setFailed(error.message);
}
