#!/usr/bin/env node
/*
 * bump-version.js — set the release version across the repo. Zero dependencies.
 *
 * Usage:
 *   node scripts/bump-version.js 1.2.0     # rewrite the version everywhere
 *   node scripts/bump-version.js --check   # run the self-test (no files touched)
 *
 * Rewrites the version in four places, idempotently. Refuses to write (exit 1)
 * if any anchor is missing — a half-bumped release is worse than a failed one.
 *
 *   js/engine/zhl16.js   const VERSION = '1.0.0';
 *   js/ui/charts.js      var   VERSION = '1.0.0';
 *   js/engine/vpmb.js    const VERSION = 'VPM-B 1.0.0 (... 4.5 ... 6500 ... 1.2)';
 *   desktop/package.json "version": "1.0.0"
 *
 * The vpmb.js string carries four numbers (the semver plus the Subsurface
 * parameterization 4.5 / 6500 / 1.2). The regex anchors on the literal
 * `'VPM-B ` prefix and the ` (` that opens the descriptor, so ONLY the leading
 * semver is replaced — the parameterization numbers are never matched.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var SEMVER = '\\d+\\.\\d+\\.\\d+';
var ROOT = path.resolve(__dirname, '..');

// Each edit: a file (relative to repo root), the anchor regex, and the
// replacement using $1/$2 to preserve everything around the semver token.
function edits(version) {
  return [
    {
      file: 'js/engine/zhl16.js',
      re: new RegExp("(const VERSION = ')" + SEMVER + "(';)"),
      to: '$1' + version + '$2',
    },
    {
      file: 'js/ui/charts.js',
      re: new RegExp("(var VERSION = ')" + SEMVER + "(';)"),
      to: '$1' + version + '$2',
    },
    {
      // Anchor on "VPM-B <semver> (" so 4.5 / 6500 / 1.2 deeper in the string
      // are outside the match.
      file: 'js/engine/vpmb.js',
      re: new RegExp("(const VERSION = 'VPM-B )" + SEMVER + "( \\()"),
      to: '$1' + version + '$2',
    },
    {
      // Edit the JSON by regex (not parse/stringify) to preserve field order
      // and formatting. The "version" key is unique in this file.
      file: 'desktop/package.json',
      re: new RegExp('("version":\\s*")' + SEMVER + '(")'),
      to: '$1' + version + '$2',
    },
  ];
}

function applyEdits(version, baseDir) {
  var base = baseDir || ROOT;
  var failed = false;
  edits(version).forEach(function (e) {
    var p = path.join(base, e.file);
    var src = fs.readFileSync(p, 'utf8');
    if (!e.re.test(src)) {
      console.error('bump-version: pattern not found in ' + e.file + ' (refusing to write)');
      failed = true;
      return;
    }
    var out = src.replace(e.re, e.to);
    if (out !== src) fs.writeFileSync(p, out);
    console.log('bump-version: ' + e.file + ' -> ' + version);
  });
  return !failed;
}

/*
 * Self-test: copy the four real files into a temp tree, bump them, and assert
 * (a) every version landed and (b) the vpmb parameterization numbers survive.
 * Runs against the actual repo files so it catches drift if a line is reworded.
 */
function selfTest() {
  var os = require('os');
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-test-'));
  try {
    // Stage the four files (with their dir structure) under tmp.
    ['js/engine/zhl16.js', 'js/ui/charts.js', 'js/engine/vpmb.js', 'desktop/package.json'].forEach(
      function (rel) {
        var dest = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), dest);
      }
    );

    var assertions = [];
    function check(name, cond) {
      assertions.push((cond ? 'PASS' : 'FAIL') + '  ' + name);
      if (!cond) selfTest.failed = true;
    }

    var ok = applyEdits('9.8.7', tmp);
    check('all anchors matched', ok);

    var zhl = fs.readFileSync(path.join(tmp, 'js/engine/zhl16.js'), 'utf8');
    check("zhl16 -> '9.8.7'", /const VERSION = '9\.8\.7';/.test(zhl));

    var charts = fs.readFileSync(path.join(tmp, 'js/ui/charts.js'), 'utf8');
    check("charts -> '9.8.7'", /var VERSION = '9\.8\.7';/.test(charts));

    var vpmb = fs.readFileSync(path.join(tmp, 'js/engine/vpmb.js'), 'utf8');
    check('vpmb semver bumped', /'VPM-B 9\.8\.7 \(/.test(vpmb));
    check('vpmb Subsurface 4.5 preserved', /Subsurface 4\.5 /.test(vpmb));
    check('vpmb lambda=6500 preserved', /lambda=6500 /.test(vpmb));
    check('vpmb factor 1.2 preserved', /factor 1\.2\)/.test(vpmb));
    check('vpmb has no stray 9.8.7 elsewhere', (vpmb.match(/9\.8\.7/g) || []).length === 1);

    var pkg = fs.readFileSync(path.join(tmp, 'desktop/package.json'), 'utf8');
    check('desktop package version bumped', /"version":\s*"9\.8\.7"/.test(pkg));

    // Idempotency: a second run must produce identical bytes.
    var before = fs.readFileSync(path.join(tmp, 'js/engine/vpmb.js'), 'utf8');
    applyEdits('9.8.7', tmp);
    var after = fs.readFileSync(path.join(tmp, 'js/engine/vpmb.js'), 'utf8');
    check('idempotent (second run is a no-op)', before === after);

    console.log(assertions.join('\n'));
    return !selfTest.failed;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  var arg = process.argv[2];

  if (arg === '--check' || arg === '--self-test') {
    var passed = selfTest();
    console.log(passed ? '\nALL TESTS PASSED' : '\nTESTS FAILED');
    process.exit(passed ? 0 : 1);
  }

  if (!/^\d+\.\d+\.\d+$/.test(arg || '')) {
    console.error('Usage: node scripts/bump-version.js <major.minor.patch>');
    console.error('       node scripts/bump-version.js --check');
    process.exit(1);
  }

  var success = applyEdits(arg);
  process.exit(success ? 0 : 1);
}

main();
