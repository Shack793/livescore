'use strict';
// server/providers/failover.js — one football feed at a time with automatic failover.
//
// Primary is API-Football (huge coverage, 7,500 calls/day). When its daily quota
// runs out, the feed silently switches to the secondary (Sportmonks) so live
// scores keep flowing instead of freezing. The feed is switched back to the
// primary automatically on the next UTC day (when API-Football's quota resets).
//
// Only ONE feed is active at any moment, so the same match can never appear twice:
// sync.js clears the outgoing feed's rows whenever this wrapper reports a switch
// (see provider.takeSwitch()).
const createApiFootball = require('./apifootball');
const createSportmonks = require('./sportmonks');

const BUILDERS = { apifootball: createApiFootball, sportmonks: createSportmonks };
// Ref prefix each feed uses, so we never hand one feed the other feed's ids.
const PREFIX = { apifootball: 'af:', sportmonks: 'sm:', apibasketball: 'ab:', mock: '' };
// Errors that mean "this feed is out of daily quota, try the other one".
// A per-minute rate limit is NOT a quota exhaustion — we stay on the same feed
// and retry later, otherwise one burst would park the site on the other feed
// for the rest of the UTC day.
const QUOTA = /(request limit for the day|requests? per day|daily (request )?limit|daily quota)/i;
const RATE = /(per minute|ratelimit|too many requests|\b429\b)/i;
const dayIndex = () => Math.floor(Date.now() / 86400000);

module.exports = function createFailover(cfg, log) {
  const logf = log || (() => {});
  const primaryName = String(cfg.failoverPrimary || 'apifootball').toLowerCase();
  const secondaryName = String(cfg.failoverSecondary || 'sportmonks').toLowerCase();
  const build = (n) => {
    const b = BUILDERS[n];
    if (!b) throw new Error('failover: unknown provider "' + n + '" (use apifootball or sportmonks)');
    return b(cfg, log);
  };
  const primary = build(primaryName);
  const secondary = build(secondaryName);
  let active = primary;
  let switched = null;    // { from, to } awaiting sync to clear the old feed
  let switchedDay = -1;   // UTC day the current failover happened
  let retryAt = 0;        // retry the primary after a transient failure, not a full day

  function toSecondary(e) {
    if (active !== primary) return false;
    const msg = String((e && e.message) || e);
    // Temporary per-minute limit: keep the primary feed and let the next job retry.
    if (RATE.test(msg) && !QUOTA.test(msg)) {
      logf('failover: ' + primary.name + ' per-minute rate limit; staying on ' + primary.name);
      return false;
    }
    if (!QUOTA.test(msg)) return false;
    active = secondary;
    switched = { from: primary.name, to: secondary.name };
    switchedDay = dayIndex();
    retryAt = 0;
    logf('failover: ' + primary.name + ' out of daily quota, switching to ' + secondary.name);
    return true;
  }

  // Run a provider method on the active feed. If the primary is active and hits
  // its quota, switch to the secondary and retry the same call once.
  async function run(method, args) {
    // New UTC day after a failover: give the primary (bigger feed) another chance.
    // A transient failure must not park the site on the secondary for another day.
    if (active === secondary && retryAt && Date.now() < retryAt) return secondary[method](args);
    if (active === secondary && switchedDay !== dayIndex()) {
      try {
        const r = await primary[method](args);
        active = primary;
        retryAt = 0;
        switched = { from: secondary.name, to: primary.name };
        switchedDay = dayIndex();
        logf('failover: ' + primary.name + ' quota reset, switching back from ' + secondary.name);
        return r;
      } catch (e) {
        const msg = String((e && e.message) || e);
        if (QUOTA.test(msg)) {
          switchedDay = dayIndex();
          retryAt = 0;
          logf('failover: ' + primary.name + ' still out of daily quota; retrying after UTC reset');
        } else {
          retryAt = Date.now() + 5 * 60 * 1000;
          logf('failover: ' + primary.name + ' retry failed (' + msg + '); retrying in 5 min');
        }
      }
    }
    if (active === primary) {
      try { return await primary[method](args); }
      catch (e) {
        const msg = String((e && e.message) || e);
        if (RATE.test(msg) && !QUOTA.test(msg)) {
          await new Promise((r) => setTimeout(r, 2000));
          try { return await primary[method](args); }
          catch (e2) { if (!toSecondary(e2)) throw e2; }
        } else if (!toSecondary(e)) throw e;
      }
    }
    return secondary[method](args);
  }

  return {
    name: 'failover',
    isMock: false,
    sports: ['football'],
    activeFeed() { return active.name; },
    // sync.js calls this before each job: non-null means the feed changed and the
    // outgoing feed's rows must be purged.
    takeSwitch() { const s = switched; switched = null; return s; },
    lowBudget() { return active.lowBudget ? active.lowBudget() : false; },
    status() {
      return { mode: 'failover', active: active.name, retryAt: retryAt ? new Date(retryAt).toISOString() : null, primary: primary.status ? primary.status() : null, secondary: secondary.status ? secondary.status() : null };
    },
    referenceData() { return run('referenceData'); },
    feedBookmakers() { return run('feedBookmakers'); },
    fixtures(a) { return run('fixtures', a); },
    live(a) { return run('live', a); },
    matchDetail(a) { return run('matchDetail', a); },
    standings(a) { return run('standings', a); },
    squad(a) { return run('squad', a); },
    odds(a) {
      // Never ask the active feed about the other feed's matches (ids would 422):
      // until sync clears the outgoing feed, drop any foreign-ref matches.
      const pre = PREFIX[active.name];
      if (pre && a && Array.isArray(a.matches)) a = Object.assign({}, a, { matches: a.matches.filter((m) => String(m.ref).indexOf(pre) === 0) });
      return run('odds', a);
    }
  };
};
