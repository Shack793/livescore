'use strict';
// server/geo/countries.js — ISO 3166-1 alpha-2 codes (+ XK Kosovo) and the starter region groups.
// Names come from the runtime's Intl.DisplayNames, so there's no big name table to maintain.

const ISO = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK').split(' ');

let _names = null;
function names() {
  if (_names) return _names;
  const dn = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  _names = {};
  ISO.forEach((c) => {
    let n;
    try { n = dn.of(c); } catch (e) { /* ignore */ }
    _names[c] = n && n !== c ? n : c === 'XK' ? 'Kosovo' : c;
  });
  return _names;
}
function list() { const n = names(); return ISO.map((c) => ({ code: c, name: n[c] })).sort((a, b) => a.name.localeCompare(b.name)); }
function isValid(code) { return ISO.indexOf(String(code || '').toUpperCase()) !== -1; }
function nameOf(code) { return names()[String(code || '').toUpperCase()] || code; }

const W = (s) => s.split(' ');
const REGIONS = [
  { code: 'AFRICA', name: 'Africa', countries: W('AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW') },
  { code: 'WEST_AFRICA', name: 'West Africa', countries: W('BJ BF CV CI GM GH GN GW LR ML MR NE NG SN SL TG') },
  { code: 'EUROPE', name: 'Europe', countries: W('AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK') },
  { code: 'EU27', name: 'European Union', countries: W('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE') },
  { code: 'UKI', name: 'UK & Ireland', countries: W('GB IE') },
  { code: 'NORDICS', name: 'Nordics', countries: W('DK FI IS NO SE') },
  { code: 'ASIA', name: 'Asia', countries: W('AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE') },
  { code: 'GCC', name: 'Gulf (GCC)', countries: W('AE BH KW OM QA SA') },
  { code: 'NORTH_AMERICA', name: 'North & Central America', countries: W('AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI') },
  { code: 'SOUTH_AMERICA', name: 'South America', countries: W('AR BO BR CL CO EC FK GF GY PE PY SR UY VE') },
  { code: 'LATAM', name: 'Latin America', countries: W('AR BO BR CL CO CR CU DO EC SV GT HN HT MX NI PA PY PE UY VE') },
  { code: 'OCEANIA', name: 'Oceania', countries: W('AS AU CC CK CX FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV VU WF WS') }
];

// Countries where visitors should see a consent notice before ads/cookies load (EEA + UK + Switzerland).
const CONSENT_COUNTRIES = W('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH');

module.exports = { ISO, list, isValid, nameOf, REGIONS, CONSENT_COUNTRIES };
