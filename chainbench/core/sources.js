'use strict';
// sha256 of every git-tracked file under the selected campaign binding's tracked paths (working tree), for
// provenance records. Output: "sha256  path" lines (sha256sum format), sorted by path.
const path = require('path');
const W = require('./workload');
const C = require('../lib/common');
const files = C.git(['ls-files', '--', ...W.campaign.tracked_paths]).split('\n').filter(Boolean).sort();
for (const f of files) console.log(`${C.sha256File(path.join(C.REPO, f))}  ${f}`);
