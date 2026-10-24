const test = require('node:test');
const assert = require('node:assert');

const afPath = require.resolve('../server/providers/apifootball');
const smPath = require.resolve('../server/providers/sportmonks');
const foPath = require.resolve('../server/providers/failover');
const state = { apifootball: 'ok', sportmonks: 'ok' };
const calls = [];

function install() {
  const make = (name) => () => ({
    name,
    status: () => ({ name }),
    lowBudget: () => false,
    async live() {
      calls.push(name);
      if (state[name] === 'quota') throw new Error('request limit for the day');
      if (state[name] === 'transient') throw new Error('socket hang up');
      return [name];
    }
  });
  const stub = (file, name) => {
    require.cache[file] = { id: file, filename: file, loaded: true, exports: make(name) };
  };
  stub(afPath, 'apifootball');
  stub(smPath, 'sportmonks');
  delete require.cache[foPath];
  return require(foPath);
}

function dayLater() {
  const real = Date.now;
  const now = real();
  Date.now = () => now + 86400000;
  return () => { Date.now = real; };
}

test('failover switches back to the primary after the UTC day resets', async () => {
  calls.length = 0;
  state.apifootball = 'quota'; state.sportmonks = 'ok';
  const create = install();
  const f = create({ failoverPrimary: 'apifootball', failoverSecondary: 'sportmonks' }, () => {});
  assert.deepStrictEqual(await f.live(), ['sportmonks']);
  assert.strictEqual(f.activeFeed(), 'sportmonks');
  assert.deepStrictEqual(f.takeSwitch(), { from: 'apifootball', to: 'sportmonks' });
  const restore = dayLater();
  try {
    state.apifootball = 'ok';
    assert.deepStrictEqual(await f.live(), ['apifootball']);
    assert.strictEqual(f.activeFeed(), 'apifootball');
    assert.deepStrictEqual(f.takeSwitch(), { from: 'sportmonks', to: 'apifootball' });
  } finally { restore(); }
});

test('a transient primary failure after reset retries in 5 minutes, not the next day', async () => {
  calls.length = 0;
  state.apifootball = 'quota'; state.sportmonks = 'ok';
  const create = install();
  const f = create({ failoverPrimary: 'apifootball', failoverSecondary: 'sportmonks' }, () => {});
  await f.live();
  f.takeSwitch();
  const restore = dayLater();
  try {
    state.apifootball = 'transient';
    assert.deepStrictEqual(await f.live(), ['sportmonks']);
    assert.strictEqual(f.activeFeed(), 'sportmonks');
    const retryAt = Date.parse(f.status().retryAt);
    assert.ok(retryAt > Date.now());
    assert.ok(retryAt - Date.now() <= 5 * 60 * 1000);
    Date.now = () => retryAt + 1;
    state.apifootball = 'ok';
    assert.deepStrictEqual(await f.live(), ['apifootball']);
    assert.strictEqual(f.activeFeed(), 'apifootball');
  } finally { restore(); }
});
