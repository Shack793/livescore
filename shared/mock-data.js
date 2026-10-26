// shared/mock-data.js — static definitions used ONLY by the demo/mock data provider.
// Team lists are sample data (ordered roughly strongest -> weakest) and may not match
// the real current season. Real data arrives through a provider adapter (see server/providers).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.LSN = root.LSN || {}; root.LSN.mockData = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SPORTS = [
    { id: 'football', name: 'Football', icon: '⚽' },
    { id: 'basketball', name: 'Basketball', icon: '🏀' },
    { id: 'tennis', name: 'Tennis', icon: '🎾' },
    { id: 'volleyball', name: 'Volleyball', icon: '🏐' },
    { id: 'handball', name: 'Handball', icon: '🤾' },
    { id: 'american-football', name: 'American Football', icon: '🏈' },
    { id: 'baseball', name: 'Baseball', icon: '⚾' },
    { id: 'hockey', name: 'Ice Hockey', icon: '🏒' },
    { id: 'rugby', name: 'Rugby', icon: '🏉' }
  ];

  function L(s) { return s.split('|'); }

  // country: code used for flag (ISO-2, or ENG/SCO/WAL/NIR, or EUR/AFR/INT for pseudo-countries)
  var FOOTBALL = [
    { code: 'ENG', country: 'England', name: 'Premier League', top: 1, period: 3, offset: 0, season: '2026/27', slots: ['12:30', '15:00', '15:00', '15:00', '17:30', '18:45', '20:00'],
      teams: L('Manchester City|Arsenal|Liverpool|Chelsea|Manchester United|Tottenham Hotspur|Newcastle United|Aston Villa|Brighton & Hove Albion|West Ham United|Crystal Palace|Fulham|Brentford|Everton|Wolverhampton Wanderers|Nottingham Forest|Bournemouth|Leeds United|Burnley|Sunderland') },
    { code: 'ES', country: 'Spain', name: 'LaLiga', top: 1, period: 3, offset: 1, season: '2026/27', slots: ['14:00', '16:15', '18:30', '19:45', '21:00'],
      teams: L('Real Madrid|Barcelona|Atlético Madrid|Athletic Club|Real Sociedad|Villarreal|Real Betis|Sevilla|Valencia|Girona|Celta Vigo|Osasuna|Getafe|Rayo Vallecano|Mallorca|Alavés|Espanyol|Elche|Levante|Real Oviedo') },
    { code: 'IT', country: 'Italy', name: 'Serie A', top: 1, period: 3, offset: 2, season: '2026/27', slots: ['12:30', '15:00', '18:00', '19:15', '20:45'],
      teams: L('Inter|Napoli|Juventus|AC Milan|Atalanta|Roma|Lazio|Fiorentina|Bologna|Torino|Genoa|Udinese|Cagliari|Como|Parma|Sassuolo|Lecce|Verona|Cremonese|Pisa') },
    { code: 'DE', country: 'Germany', name: 'Bundesliga', top: 1, period: 3, offset: 1, season: '2026/27', slots: ['14:30', '14:30', '17:30', '19:30'],
      teams: L('Bayern Munich|Borussia Dortmund|Bayer Leverkusen|RB Leipzig|Eintracht Frankfurt|VfB Stuttgart|SC Freiburg|Borussia Mönchengladbach|VfL Wolfsburg|Werder Bremen|Mainz 05|Union Berlin|FC Augsburg|Hoffenheim|Hamburger SV|Köln|Heidenheim|St. Pauli') },
    { code: 'FR', country: 'France', name: 'Ligue 1', top: 1, period: 3, offset: 0, season: '2026/27', slots: ['13:00', '15:00', '17:00', '19:00', '20:45'],
      teams: L('Paris Saint-Germain|Marseille|Monaco|Lyon|Lille|Nice|Lens|Rennes|Strasbourg|Toulouse|Nantes|Brest|Auxerre|Angers|Le Havre|Lorient|Metz|Paris FC') },
    { code: 'NL', country: 'Netherlands', name: 'Eredivisie', top: 0, period: 3, offset: 2, season: '2026/27', slots: ['12:15', '14:30', '16:45', '18:15', '20:00'],
      teams: L('PSV Eindhoven|Feyenoord|Ajax|AZ Alkmaar|FC Twente|FC Utrecht|Sparta Rotterdam|Go Ahead Eagles|NEC Nijmegen|Heerenveen|Fortuna Sittard|PEC Zwolle|Groningen|Heracles Almelo|NAC Breda|Excelsior|Telstar|Volendam') },
    { code: 'PT', country: 'Portugal', name: 'Primeira Liga', top: 0, period: 3, offset: 1, season: '2026/27', slots: ['13:00', '15:30', '18:00', '20:30'],
      teams: L('Benfica|Porto|Sporting CP|Braga|Vitória Guimarães|Famalicão|Gil Vicente|Estoril|Moreirense|Santa Clara|Arouca|Casa Pia|Rio Ave|Nacional|Alverca|Tondela|Estrela Amadora|AVS') },
    { code: 'GH', country: 'Ghana', name: 'Premier League', top: 1, period: 2, offset: 1, season: '2026/27', slots: ['15:00', '15:00', '15:00', '16:00', '17:00', '18:30'],
      teams: L('Asante Kotoko|Hearts of Oak|Medeama|Samartex|Bibiani Gold Stars|Dreams FC|Aduana Stars|Bechem United|Berekum Chelsea|Nsoatreman|Legon Cities|Karela United|Basake Holy Stars|Heart of Lions|Vision FC|Accra Lions|Great Olympics|Real Tamale United') },
    { code: 'NG', country: 'Nigeria', name: 'NPFL', top: 0, period: 2, offset: 0, season: '2026/27', slots: ['16:00', '16:00', '17:00', '18:00', '19:30'],
      teams: L('Enyimba|Rangers International|Remo Stars|Rivers United|Shooting Stars|Kano Pillars|Plateau United|Bendel Insurance|Lobi Stars|Heartland|Katsina United|Kwara United|El-Kanemi Warriors|Sunshine Stars|Niger Tornadoes|Abia Warriors|Bayelsa United|Wikki Tourists|Doma United|Nasarawa United') },
    { code: 'BR', country: 'Brazil', name: 'Serie A', top: 1, period: 2, offset: 1, season: '2026', slots: ['16:00', '18:30', '19:00', '21:30'],
      teams: L('Palmeiras|Flamengo|Botafogo|Fluminense|Corinthians|São Paulo|Cruzeiro|Atlético Mineiro|Internacional|Grêmio|Bahia|Vasco da Gama|Santos|Fortaleza|Red Bull Bragantino|Vitória|Juventude|Ceará|Sport Recife|Mirassol') },
    { code: 'SA', country: 'Saudi Arabia', name: 'Pro League', top: 0, period: 3, offset: 0, season: '2026/27', slots: ['17:00', '19:00', '21:00'],
      teams: L('Al Hilal|Al Nassr|Al Ittihad|Al Ahli|Al Shabab|Al Taawoun|Al Fateh|Al Ettifaq|Al Fayha|Al Khaleej|Damac|Al Raed|Al Okhdood|Al Riyadh|Al Kholood|Al Najma|NEOM SC|Al Qadsiah') }
  ];

  // Clubs that only appear in cups (not in the leagues above): [name, country code]
  var EXTRA_CLUBS = [
    ['Al Ahly', 'EG'], ['Zamalek', 'EG'], ['Pyramids FC', 'EG'], ['Mamelodi Sundowns', 'ZA'], ['Orlando Pirates', 'ZA'],
    ['Wydad Casablanca', 'MA'], ['Raja Casablanca', 'MA'], ['ES Tunis', 'TN'], ['CR Belouizdad', 'DZ'], ['TP Mazembe', 'CD']
  ];

  var CUPS = [
    { code: 'EUR', country: 'Europe', name: 'Champions League', top: 1, period: 7, offset: 1, season: '2026/27', slots: ['18:45', '21:00', '21:00'],
      teams: L('Manchester City|Arsenal|Liverpool|Chelsea|Real Madrid|Barcelona|Atlético Madrid|Inter|Napoli|Juventus|AC Milan|Atalanta|Bayern Munich|Borussia Dortmund|Bayer Leverkusen|Paris Saint-Germain|PSV Eindhoven|Benfica|Sporting CP|Porto|Marseille|Monaco|Feyenoord|Ajax') },
    { code: 'AFR', country: 'Africa', name: 'CAF Champions League', top: 1, period: 7, offset: 4, season: '2026/27', slots: ['15:00', '18:00', '20:00'],
      teams: L('Al Ahly|Zamalek|Pyramids FC|Mamelodi Sundowns|Orlando Pirates|Wydad Casablanca|Raja Casablanca|ES Tunis|CR Belouizdad|TP Mazembe|Asante Kotoko|Hearts of Oak|Enyimba|Rangers International|Medeama|Remo Stars') }
  ];

  var TEAM_SPORTS = {
    basketball: {
      name: 'Basketball', periods: 4, periodMin: 30, breakMin: 5, halfMin: 15, label: 'Q', value: [2, 2, 2, 2, 3, 3, 1], perPeriod: 28,
      leagues: [{ code: 'US', country: 'USA', name: 'NBA', top: 1, period: 1, offset: 0, season: '2026/27', slots: ['16:00', '18:30', '20:00', '21:30'], fraction: 0.5,
        teams: L('Boston Celtics|Oklahoma City Thunder|Denver Nuggets|Cleveland Cavaliers|New York Knicks|Minnesota Timberwolves|Houston Rockets|Los Angeles Lakers|Golden State Warriors|Milwaukee Bucks|Dallas Mavericks|Indiana Pacers|Orlando Magic|Miami Heat|Philadelphia 76ers|Phoenix Suns|LA Clippers|Memphis Grizzlies|Sacramento Kings|Atlanta Hawks|San Antonio Spurs|Detroit Pistons|Toronto Raptors|New Orleans Pelicans|Chicago Bulls|Brooklyn Nets|Charlotte Hornets|Portland Trail Blazers|Utah Jazz|Washington Wizards') }]
    },
    hockey: {
      name: 'Ice Hockey', periods: 3, periodMin: 30, breakMin: 15, halfMin: 15, label: 'P', value: [1], perPeriod: 1.0,
      leagues: [{ code: 'US', country: 'USA', name: 'NHL', top: 1, period: 1, offset: 0, season: '2026/27', slots: ['16:00', '18:30', '20:00', '21:30'], fraction: 0.5,
        teams: L('Florida Panthers|Edmonton Oilers|Colorado Avalanche|Vegas Golden Knights|Dallas Stars|Carolina Hurricanes|Toronto Maple Leafs|Tampa Bay Lightning|Winnipeg Jets|Boston Bruins|New York Rangers|Minnesota Wild|Washington Capitals|Los Angeles Kings|Ottawa Senators|New Jersey Devils|Vancouver Canucks|Montréal Canadiens|Calgary Flames|St. Louis Blues|Detroit Red Wings|Utah Mammoth|Columbus Blue Jackets|Pittsburgh Penguins|Philadelphia Flyers|Buffalo Sabres|Seattle Kraken|New York Islanders|Nashville Predators|Anaheim Ducks|San Jose Sharks|Chicago Blackhawks') }]
    },
    'american-football': {
      name: 'American Football', periods: 4, periodMin: 30, breakMin: 5, halfMin: 20, label: 'Q', value: [7, 7, 3, 3, 6, 2], perPeriod: 5.75,
      leagues: [{ code: 'US', country: 'USA', name: 'NFL', top: 1, period: 7, offset: 0, season: '2026', slots: ['13:00', '16:25', '20:20'], fraction: 0.5,
        teams: L('Kansas City Chiefs|Philadelphia Eagles|Buffalo Bills|Baltimore Ravens|Detroit Lions|San Francisco 49ers|Green Bay Packers|Cincinnati Bengals|Houston Texans|Los Angeles Rams|Minnesota Vikings|Pittsburgh Steelers|Washington Commanders|Denver Broncos|Seattle Seahawks|Los Angeles Chargers|Dallas Cowboys|Miami Dolphins|Tampa Bay Buccaneers|Atlanta Falcons|Chicago Bears|Jacksonville Jaguars|Indianapolis Colts|Arizona Cardinals|New Orleans Saints|New York Jets|New York Giants|Las Vegas Raiders|Cleveland Browns|Carolina Panthers|Tennessee Titans|New England Patriots') }]
    },
    baseball: {
      name: 'Baseball', periods: 9, periodMin: 13, breakMin: 2, halfMin: 2, label: 'Inn ', value: [1, 1, 1, 2], perPeriod: 0.5,
      leagues: [{ code: 'US', country: 'USA', name: 'MLB', top: 1, period: 1, offset: 0, season: '2026', slots: ['13:10', '16:10', '19:05', '20:40'], fraction: 0.5,
        teams: L('Los Angeles Dodgers|New York Yankees|Philadelphia Phillies|Atlanta Braves|Houston Astros|Baltimore Orioles|San Diego Padres|Milwaukee Brewers|Cleveland Guardians|Seattle Mariners|Arizona Diamondbacks|Boston Red Sox|Chicago Cubs|Detroit Tigers|New York Mets|Kansas City Royals|Minnesota Twins|Texas Rangers|Tampa Bay Rays|Toronto Blue Jays|San Francisco Giants|Cincinnati Reds|St. Louis Cardinals|Pittsburgh Pirates|Los Angeles Angels|Athletics|Washington Nationals|Miami Marlins|Colorado Rockies|Chicago White Sox') }]
    },
    handball: {
      name: 'Handball', periods: 2, periodMin: 30, breakMin: 10, halfMin: 10, label: 'H', value: [1], perPeriod: 15,
      leagues: [{ code: 'DE', country: 'Germany', name: 'Bundesliga', top: 1, period: 3, offset: 0, season: '2026/27', slots: ['18:00', '19:00', '20:30'], fraction: 0.5,
        teams: L('THW Kiel|SG Flensburg-Handewitt|Füchse Berlin|SC Magdeburg|Rhein-Neckar Löwen|MT Melsungen|HSV Hamburg|TSV Hannover-Burgdorf|Bergischer HC|TBV Lemgo Lippe|HC Erlangen|Frisch Auf Göppingen') }]
    },
    rugby: {
      name: 'Rugby', periods: 2, periodMin: 40, breakMin: 10, halfMin: 10, label: 'H', value: [5, 7, 3, 3, 2], perPeriod: 12.5,
      leagues: [{ code: 'ENG', country: 'England', name: 'Premiership', top: 1, period: 7, offset: 1, season: '2026/27', slots: ['15:00', '17:30'], fraction: 0.5,
        teams: L('Bath|Leicester Tigers|Northampton Saints|Saracens|Bristol Bears|Harlequins|Sale Sharks|Exeter Chiefs|Gloucester|Newcastle Red Bulls') }]
    }
  };

  var VOLLEYBALL = { code: 'IT', country: 'Italy', name: 'SuperLega', top: 1, period: 3, offset: 0, season: '2026/27', slots: ['17:00', '18:30', '20:30'],
    teams: L('Sir Susa Perugia|Itas Trentino|Cucine Lube Civitanova|Allianz Milano|Gas Sales Piacenza|Modena Volley|Rana Verona|Monza|Padova|Cisterna|Taranto|Grottazzolina') };

  var TENNIS = [
    { code: 'ATP', country: 'ATP', name: 'ATP Singles', top: 1, season: '2026', players: L('Jannik Sinner|Carlos Alcaraz|Novak Djokovic|Alexander Zverev|Daniil Medvedev|Taylor Fritz|Casper Ruud|Alex de Minaur|Andrey Rublev|Holger Rune|Stefanos Tsitsipas|Ben Shelton|Tommy Paul|Grigor Dimitrov|Felix Auger-Aliassime|Frances Tiafoe') },
    { code: 'WTA', country: 'WTA', name: 'WTA Singles', top: 1, season: '2026', players: L('Aryna Sabalenka|Iga Świątek|Coco Gauff|Jessica Pegula|Elena Rybakina|Jasmine Paolini|Qinwen Zheng|Emma Navarro|Madison Keys|Mirra Andreeva|Daria Kasatkina|Danielle Collins|Paula Badosa|Barbora Krejcikova|Elina Svitolina|Marketa Vondrousova') }
  ];

  // Mock bookmaker feed (these are the "feed" bookmakers the odds provider reports).
  var FEED_BOOKMAKERS = [
    { ref: 'mock-betwave', name: 'BetWave', margin: 0.055 },
    { ref: 'mock-stakeking', name: 'StakeKing', margin: 0.065 },
    { ref: 'mock-oddsden', name: 'OddsDen', margin: 0.05 },
    { ref: 'mock-pariline', name: 'PariLine', margin: 0.07 },
    { ref: 'mock-goalbet', name: 'GoalBet', margin: 0.06 }
  ];

  var NAME_POOLS = {
    en: { f: L('Jack|Harry|Oliver|George|Charlie|Jamie|Tom|Ben|Callum|Declan|Marcus|Kyle|Reece|Luke|Aaron|Ryan'), l: L('Smith|Walker|Taylor|Wilson|Evans|Thomas|Roberts|Johnson|Hughes|Edwards|Clarke|Wright|Turner|Cooper|Bailey|Hall') },
    es: { f: L('Alejandro|Carlos|Diego|Javier|Miguel|Pablo|Sergio|Álvaro|Iker|Raúl|Marcos|Adrián|Rubén|Hugo|Mario|Iván'), l: L('García|Fernández|López|Martínez|Sánchez|Pérez|Gómez|Ruiz|Díaz|Moreno|Álvarez|Romero|Navarro|Torres|Ramos|Vega') },
    it: { f: L('Marco|Luca|Matteo|Andrea|Federico|Davide|Simone|Alessandro|Lorenzo|Nicolò|Giacomo|Riccardo|Stefano|Fabio|Daniele|Gianluca'), l: L('Rossi|Russo|Ferrari|Esposito|Bianchi|Romano|Colombo|Ricci|Marino|Greco|Bruno|Gallo|Conti|De Luca|Costa|Giordano') },
    de: { f: L('Lukas|Jonas|Felix|Maximilian|Leon|Niklas|Tim|Jan|Paul|Moritz|Florian|Tobias|Kevin|Fabian|Dominik|Sebastian'), l: L('Müller|Schmidt|Schneider|Fischer|Weber|Meyer|Wagner|Becker|Schulz|Hoffmann|Koch|Richter|Klein|Wolf|Neumann|Schwarz') },
    fr: { f: L('Lucas|Hugo|Louis|Théo|Antoine|Maxime|Clément|Julien|Romain|Nicolas|Baptiste|Mathieu|Kylian|Alexis|Florian|Yanis'), l: L('Martin|Bernard|Dubois|Thomas|Robert|Richard|Petit|Durand|Leroy|Moreau|Simon|Laurent|Lefebvre|Michel|Garcia|Girard') },
    nl: { f: L('Daan|Sem|Lars|Thijs|Bram|Jesse|Ruben|Stijn|Joris|Niels|Tim|Wout|Kees|Pieter|Mats|Luuk'), l: L('de Jong|Jansen|de Vries|van Dijk|Bakker|Visser|Smit|Meijer|de Boer|Mulder|de Groot|Bos|Vos|Peters|Hendriks|Dekker') },
    pt: { f: L('João|Pedro|Tiago|Rui|Diogo|Bruno|Rafael|André|Miguel|Nuno|Gonçalo|Ricardo|Hugo|Fábio|Daniel|Vasco'), l: L('Silva|Santos|Ferreira|Pereira|Oliveira|Costa|Rodrigues|Martins|Sousa|Fernandes|Gonçalves|Gomes|Lopes|Marques|Alves|Almeida') },
    br: { f: L('Gabriel|Matheus|Lucas|Rafael|Bruno|Thiago|Felipe|Gustavo|Vinícius|Leonardo|Rodrigo|Caio|Diego|Wesley|Igor|Yuri'), l: L('Silva|Souza|Costa|Santos|Oliveira|Pereira|Lima|Carvalho|Gomes|Ribeiro|Almeida|Nascimento|Araújo|Barbosa|Rocha|Dias') },
    gh: { f: L('Kwame|Kofi|Yaw|Kwesi|Kwabena|Nana|Emmanuel|Samuel|Daniel|Ibrahim|Abdul|Mohammed|Joseph|Isaac|Michael|Prince'), l: L('Mensah|Owusu|Boateng|Asante|Appiah|Adjei|Ofori|Amoah|Agyeman|Osei|Tetteh|Quaye|Addo|Annan|Sarpong|Danso') },
    ng: { f: L('Chukwuemeka|Ahmed|Ikenna|Tunde|Emeka|Samuel|Victor|Kelechi|Sadiq|Bright|Taiwo|Chidi|Musa|Obinna|Seyi|Femi'), l: L('Okafor|Adeyemi|Balogun|Ibrahim|Nwosu|Eze|Olawale|Okoro|Abubakar|Ogunleye|Uche|Bello|Umar|Chukwu|Ojo|Ndukwe') },
    ar: { f: L('Mohammed|Ahmed|Abdullah|Khalid|Salem|Fahad|Yousef|Omar|Faisal|Nasser|Sultan|Turki|Saud|Majed|Hamad|Ali'), l: L('Al-Harbi|Al-Qahtani|Al-Ghamdi|Al-Dosari|Al-Shahrani|Al-Mutairi|Al-Otaibi|Al-Zahrani|Al-Amri|Al-Salem|Al-Rashid|Al-Anazi|Al-Subaie|Al-Bishi|Al-Najjar|Al-Hamdan') },
    us: { f: L('James|Michael|Tyler|Jordan|Chris|Brandon|Devin|Malik|Trey|Isaiah|Jalen|Darius|Cole|Austin|Derrick|Tyrese'), l: L('Johnson|Williams|Brown|Davis|Miller|Wilson|Moore|Anderson|Jackson|White|Harris|Martin|Thompson|Robinson|Clark|Lewis') }
  };
  var COUNTRY_POOL = { ATP: 'en', WTA: 'en', ENG: 'en', ES: 'es', IT: 'it', DE: 'de', FR: 'fr', NL: 'nl', PT: 'pt', GH: 'gh', NG: 'ng', BR: 'br', SA: 'ar', US: 'us', EG: 'ar', MA: 'ar', TN: 'ar', DZ: 'ar', ZA: 'en', CD: 'fr', EUR: 'en', AFR: 'gh', INT: 'en' };

  return { SPORTS: SPORTS, FOOTBALL: FOOTBALL, EXTRA_CLUBS: EXTRA_CLUBS, CUPS: CUPS, TEAM_SPORTS: TEAM_SPORTS, VOLLEYBALL: VOLLEYBALL, TENNIS: TENNIS, FEED_BOOKMAKERS: FEED_BOOKMAKERS, NAME_POOLS: NAME_POOLS, COUNTRY_POOL: COUNTRY_POOL };
});
