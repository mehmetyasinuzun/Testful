import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, render } from '../ci/firebase-summary.mjs';

test('firebase: çıkış kodu kararları — altyapı hatası kırmızı yapmaz', () => {
  assert.equal(decide(0).red, false);
  assert.equal(decide(10).red, true);
  assert.equal(decide(10, 'never').red, false);
  assert.equal(decide(15).verdict, 'infra');
  assert.equal(decide(15).red, false);
  assert.equal(decide(20).red, false);
  assert.equal(decide(18).red, true);
  assert.equal(decide(99).verdict, 'error');
});

test('firebase: özet cihaz tablosu, konsol linki ve kapanış notu içerir', () => {
  const r = render({
    code: 10,
    outcomes: [
      { axis_value: 'MediumPhone.arm-33-en-portrait', outcome: 'Failed', test_details: 'App crashed | NPE' },
      { axis_value: 'oriole-33-en-portrait', outcome: 'Passed', test_details: '--' },
    ],
    consoleUrl: 'https://console.firebase.google.com/project/p/testlab/histories/h/matrices/1',
    gcsPath: 'gs://test-lab-x/2026',
    artifact: 'testful-firebase',
  });
  assert.match(r.md, /❌ Failed \| App crashed \\\| NPE/);
  assert.match(r.md, /✅ Passed/);
  assert.match(r.md, /console\.firebase\.google\.com/);
  assert.match(r.md, /2027/);
  assert.equal(r.verdict, 'fail');
});
