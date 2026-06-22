// afterpack-sign.js — electron-builder afterPack hook.
//
// Ad-hoc signs the assembled macOS .app bundle (`codesign --sign -`) before the
// dmg is built. electron-builder@24 with no Apple identity leaves the Electron
// binary's signature in place, which does NOT cover the app's own
// Info.plist/resources — and recent macOS then reports the bundle as "damaged"
// (a broken signature, which right-click→Open cannot bypass). A proper ad-hoc
// signature makes it a normal "unidentified developer" app instead.
//
// No-op on Linux/Windows packing. No Apple Developer cert / notarization needed.
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return; // mac only

  const appName = context.packager.appInfo.productFilename; // "HALDANE"
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[afterpack-sign] ad-hoc signing ${appPath}`);
  try {
    // --force replaces the existing adhoc/linker signature; --deep covers the
    // Electron helper apps + frameworks; --sign - is the ad-hoc identity.
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit',
    });
    // Fail the build if the result isn't actually valid, rather than ship a
    // bundle that still says "damaged".
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
      stdio: 'inherit',
    });
    console.log('[afterpack-sign] ad-hoc signature verified.');
  } catch (err) {
    console.error('[afterpack-sign] codesign failed: ' + err.message);
    throw err;
  }
};
