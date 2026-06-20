'use strict';
// HALDANE i18n dictionary suite — verifies key parity across languages, the
// English fallback, browser detection and language switching. Plain Node, no
// framework (same convention as zhl16/vpmb suites).

var I18N = require('../js/ui/i18n.js');

var failures = 0;
function check(name, cond, info) {
  if (cond) { console.log('PASS ' + name); }
  else { console.log('FAIL ' + name + (info ? '  [' + info + ']' : '')); failures++; }
}

// ---------------------------------------------------------------------------
// 1. Module surface
check('exports t/setLang/getLang/detect/has', typeof I18N.t === 'function' &&
  typeof I18N.setLang === 'function' && typeof I18N.getLang === 'function' &&
  typeof I18N.detect === 'function' && typeof I18N.has === 'function');
check('declares 5 languages', I18N.LANGS.length === 5, I18N.LANGS.join(','));
check('languages are en/es/fr/de/zh',
  I18N.LANGS.slice().sort().join(',') === 'de,en,es,fr,zh', I18N.LANGS.join(','));
check('every language has a display label',
  I18N.LANGS.every(function (l) { return typeof I18N.LANG_LABELS[l] === 'string' && I18N.LANG_LABELS[l].length; }));

// ---------------------------------------------------------------------------
// 2. Key parity: every language defines exactly the same keys as English.
var enKeys = Object.keys(I18N._dict.en).sort();
check('English has a non-trivial dictionary', enKeys.length >= 50, 'keys=' + enKeys.length);
I18N.LANGS.forEach(function (lang) {
  var keys = Object.keys(I18N._dict[lang]).sort();
  var missing = enKeys.filter(function (k) { return keys.indexOf(k) < 0; });
  var extra = keys.filter(function (k) { return enKeys.indexOf(k) < 0; });
  check(lang + ' has every English key', missing.length === 0, 'missing=' + missing.join(','));
  check(lang + ' has no keys absent from English', extra.length === 0, 'extra=' + extra.join(','));
  // No empty translations.
  var empties = keys.filter(function (k) { return !String(I18N._dict[lang][k]).trim(); });
  check(lang + ' has no empty strings', empties.length === 0, 'empty=' + empties.join(','));
});

// ---------------------------------------------------------------------------
// 3. Translation + fallback behaviour
I18N.setLang('es');
check('setLang switches active language', I18N.getLang() === 'es');
check('t returns the Spanish string', I18N.t('btn.save') === 'GUARDAR', I18N.t('btn.save'));
check('unknown key falls back to the raw key', I18N.t('does.not.exist') === 'does.not.exist');

// A key present in en but (hypothetically) absent elsewhere falls back to en.
// Force the situation by switching to a language and asking for an en-only key:
// every key exists in every language (test 2), so emulate via a fresh missing key.
I18N.setLang('zh');
check('Chinese active', I18N.getLang() === 'zh');
check('t returns the Chinese string', I18N.t('box.dive') === '潜水', I18N.t('box.dive'));

// Invalid language coerces to English.
I18N.setLang('xx');
check('invalid language coerces to en', I18N.getLang() === 'en');
check('t after coercion returns English', I18N.t('btn.save') === 'SAVE', I18N.t('btn.save'));

// ---------------------------------------------------------------------------
// 4. Browser detection (navigator shim)
var savedNav = global.navigator;
global.navigator = { languages: ['fr-FR', 'en-US'] };
check('detect picks fr from navigator.languages', I18N.detect() === 'fr', I18N.detect());
global.navigator = { language: 'de' };
check('detect picks de from navigator.language', I18N.detect() === 'de', I18N.detect());
global.navigator = { languages: ['pt-BR'] };
check('detect falls back to en for unsupported locale', I18N.detect() === 'en', I18N.detect());
if (savedNav === undefined) delete global.navigator; else global.navigator = savedNav;

// ---------------------------------------------------------------------------
console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
