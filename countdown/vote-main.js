(function(){
  'use strict';

  // ── Config (set before deployment) ──
  var VOTE_END      = '2026-07-06T03:00:00Z';      // Voting closes (Mon Jul 6 2026 03:00 UTC, 45/15 schedule)
  var DEPLOY_DATE   = '2026-07-21T03:00:00Z';      // Contracts go live (Tue Jul 21 2026 03:00 UTC)

  // Vote collector (Cloudflare Worker). Until baked, page falls back to mcap ordering.
  var COLLECTOR_URL    = 'https://punzi-vote-collector.punziwars.workers.dev';
  var POLL_INTERVAL_MS = 90000;                    // 90s live tally cadence
  var MAX_SELECT       = 64;                       // approval voting: up to 64 picks
  var VOTED_KEY        = 'punzi_wars_voted_v1';    // localStorage device marker
  var DAPP_URL = 'https://punzi.xyz';

  // ── Live collector state (populated by fetchTally) ──
  var LIVE_SCORES         = null;   // { symbol: ballotCount } — null = fallback to mcap
  var LIVE_TOTAL_VOTES    = 0;      // total selections cast (the one headline metric)
  var LIVE_STATE          = null;   // 'pre' | 'open' | 'closed'
  var PREV_OVERALL_RANKS  = {};     // { symbol: lastSeenOverallRank } — drives ▲/▼ delta badges
  var POLL_TIMER          = null;   // setInterval handle
  var FIRST_LIVE_RENDER   = true;   // suppress delta badges on first live paint

  // Reveal-phase poll lifecycle: keep polling after 'closed' until the cron-fold
  // total stabilizes; see evaluateRevealStop() for the stop-decision.
  var REVEAL_POLL_TIMER       = null;   // setInterval handle for the reveal-phase poll
  var REVEAL_POLL_DONE        = false;  // sticky — true once stop-decision has fired
  var REVEAL_LAST_TOTAL       = null;   // last LIVE_TOTAL_VOTES observed while closed
  var REVEAL_STABLE_COUNT     = 0;      // consecutive identical-total observations
  var REVEAL_FIRST_CLOSED_AT  = 0;      // ms timestamp of the first 'closed' observation
  var REVEAL_STABLE_TARGET    = 3;      // stop after this many consecutive identical totals
  var REVEAL_MAX_WAIT_MS      = 10 * 60 * 1000;  // hard cap: 10 min from first 'closed'

  // ── Ballot selection + submission state ──
  var SELECTED        = {};         // { symbol: true } — the voter's current ballot
  var HAS_VOTED       = false;      // device marker / post-submit lock
  var SUBMITTING      = false;      // in-flight POST /vote guard
  var TURNSTILE_TOKEN = null;       // most recent Turnstile token
  var OPTIMISTIC_MIN  = 0;          // displayed-total floor once this device votes — no post-submit dip while the cron fold catches up

  // ── Live ticker state (rolling buffer of recent rank changes) ──
  var TICKER_BUFFER       = [];     // [{ sym, name, diff, fromRank, toRank, ts }]
  var TICKER_MAX          = 12;     // Keep latest N changes
  var TICKER_STALE_MS     = 15 * 60 * 1000;  // Drop entries older than 15 min

  // ── DOM refs ──
  var $phaseDot    = document.getElementById('phaseDot');
  var $phaseText   = document.getElementById('phaseText');
  var $titleSub    = document.getElementById('titleSub');
  var $intro       = document.getElementById('introSection');
  var $vote        = document.getElementById('voteSection');
  var $reveal      = document.getElementById('revealSection');
  var $liveSection = document.getElementById('liveSection');
  var $dappLink    = document.getElementById('dappLink');
  var $hookLine2   = document.getElementById('hookLine2');
  var $voterCount  = document.getElementById('voterCount');
  var $daysLeft    = document.getElementById('daysLeft');
  var $cdLabel     = document.getElementById('countdownLabel');
  var $totalVoters = document.getElementById('totalVoters');
  var $tokenBrowser = document.getElementById('tokenBrowser');
  var $browserSub   = document.getElementById('tokenBrowserSub');
  var $finalRoster       = document.getElementById('finalRoster');
  var $finalRosterList   = document.getElementById('finalRosterList');
  var $finalRosterToggle = document.getElementById('finalRosterToggle');
  var $heroImg           = document.getElementById('heroImg');

  // One timer; label + target shift with sub-phase, hidden when live.
  var $stack = document.getElementById('countdownStack');
  var $cdRowLabel = document.getElementById('cdRowLabel');
  var $pzTimeline = document.getElementById('pzTimeline');
  var anchorEls = [
    {
      id: 'close',
      row: document.getElementById('cdRowClose'),
      dEl: document.getElementById('cd-close-d'),
      hEl: document.getElementById('cd-close-h'),
      mEl: document.getElementById('cd-close-m'),
      sEl: document.getElementById('cd-close-s'),
      prev: { d: null, h: null, m: null, s: null }
    }
  ];

  function pad(n){ n = Math.max(0, n|0); return n < 10 ? '0' + n : '' + n; }
  function writeIfChanged(el, val, prev, key){
    if (el && prev[key] !== val) { el.textContent = val; prev[key] = val; }
  }

  function parseDate(str, fallbackDays){
    if(!str || str === str.toUpperCase().replace(/[^A-Z_]/g,'')){ // placeholder check
      var d = new Date(); d.setDate(d.getDate() + fallbackDays); return d.getTime();
    }
    return new Date(str).getTime();
  }

  var tVoteEnd   = parseDate(VOTE_END, 30);
  var tDeploy    = parseDate(DEPLOY_DATE, 60);

  // ── Phase Detection (voting → reveal → live) ──
  // Collector's 'closed' state wins over the local clock (handles clock skew).
  function getPhase(){
    var now = Date.now();
    if(now < tVoteEnd && LIVE_STATE !== 'closed') return 'voting';
    if(now < tDeploy)                              return 'reveal';
    return 'live';
  }

  function updatePhaseUI(){
    var phase = getPhase();

    $phaseDot.className = 'phase-dot ' + phase;
    var phaseLabels = {
      voting: 'Voting Open',
      reveal: 'Voting Closed',
      live: 'LIVE'
    };
    $phaseText.textContent = phaseLabels[phase] || '';

    var subtitles = {
      voting: 'Vote for the 64',
      reveal: 'Voting Has Ended',
      live: 'The Game Is Live'
    };
    $titleSub.textContent = subtitles[phase] || '';

    $intro.classList.toggle('hidden', phase === 'live');
    $vote.classList.toggle('hidden', phase !== 'voting');
    $reveal.classList.toggle('hidden', phase !== 'reveal');
    $liveSection.classList.toggle('hidden', phase !== 'live');
    $tokenBrowser.classList.toggle('hidden', phase === 'live');

    if($heroImg){
      var heroSrc = (phase === 'voting') ? 'raccoon/punzi-war-is-coming.jpg'
                                         : 'raccoon/punzi-the-weaver.jpg';
      if($heroImg.getAttribute('src') !== heroSrc) $heroImg.setAttribute('src', heroSrc);
    }

    if(phase === 'voting'){
      var dLeft = Math.max(0, Math.ceil((tVoteEnd - Date.now()) / 86400000));
      $daysLeft.textContent = dLeft;
    }

    if(phase === 'live'){
      $dappLink.href = DAPP_URL;
      var $rankings = document.getElementById('rankingsLink');
      if($rankings) $rankings.href = DAPP_URL.replace(/\/+$/, '') + '/warroom';
    }

    if(phase === 'voting') $hookLine2.textContent = 'WILL YOU DECIDE?';
    else if(phase === 'reveal') $hookLine2.textContent = 'THE 64 ARE CHOSEN.';
    else if(phase === 'live') $hookLine2.textContent = 'THE PUNZI WARS ARE LIVE.';

    if ($cdLabel) {
      if(phase === 'voting') $cdLabel.textContent = 'Voting Closes In';
      else $cdLabel.textContent = 'Deployment In';
    }
  }

  // ── Countdown Timer ──
  function updateAnchor(a, targetMs){
    if (!a || !a.row) return false;
    var diff = targetMs - Date.now();
    if (diff <= 0) {
      if (!a.row.classList.contains('complete')) a.row.classList.add('complete');
      return false;
    }
    if (a.row.classList.contains('complete')) a.row.classList.remove('complete');
    var totalSec = Math.floor(diff / 1000);
    writeIfChanged(a.dEl, pad(Math.floor(totalSec/86400)),       a.prev, 'd');
    writeIfChanged(a.hEl, pad(Math.floor((totalSec%86400)/3600)), a.prev, 'h');
    writeIfChanged(a.mEl, pad(Math.floor((totalSec%3600)/60)),    a.prev, 'm');
    writeIfChanged(a.sEl, pad(totalSec%60),                        a.prev, 's');
    return true;
  }

  function syncTimelineToPhase(phase){
    if (!$pzTimeline) return;
    var desired = (phase === 'voting') ? 'vote'
                : (phase === 'reveal') ? 'results'
                : 'deploy';
    if ($pzTimeline.getAttribute('data-active') === desired) return;
    $pzTimeline.setAttribute('data-active', desired);
    var nodes = $pzTimeline.querySelectorAll('.pz-timeline-node');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-phase') === desired) nodes[i].setAttribute('aria-current','step');
      else nodes[i].removeAttribute('aria-current');
    }
  }

  function tick(){
    var phase = getPhase();
    syncTimelineToPhase(phase);
    var anyCounting = false;
    if (phase === 'voting') {
      if ($cdRowLabel) $cdRowLabel.textContent = 'Voting Closes In';
      anyCounting = updateAnchor(anchorEls[0], tVoteEnd);
    } else if (phase === 'reveal') {
      if ($cdRowLabel) $cdRowLabel.textContent = 'Game Deploys In';
      anyCounting = updateAnchor(anchorEls[0], tDeploy);
    } else {
      if ($stack) $stack.style.display = 'none';
    }
    setTimeout(tick, 1000 - (Date.now() % 1000));
  }

  // ── Animated Curve Background ──
  var curves = [
    { name: 'LINEAR',      fn: function(x){ return x; } },
    { name: 'POWER LAW',   fn: function(x){ return Math.pow(x, 1.8); } },
    { name: 'SIGMOID',     fn: function(x){ return 1 / (1 + Math.exp(-10 * (x - 0.5))); } },
    { name: 'EXPONENTIAL', fn: function(x){ return (Math.exp(3*x) - 1) / (Math.exp(3) - 1); } },
    { name: 'GEOMETRIC',   fn: function(x){ return Math.pow(1.5, x*5) / Math.pow(1.5, 5); } },
    { name: 'LOGARITHMIC', fn: function(x){ return Math.log(1 + 9*x) / Math.log(10); } },
    { name: 'SQUARE ROOT', fn: function(x){ return Math.sqrt(x); } },
    { name: 'STEP',        fn: function(x){ return Math.floor(x * 6) / 6; } }
  ];

  function buildCurvePath(fn){
    var w=800,h=400,pts=[],steps=120;
    for(var i=0;i<=steps;i++){
      var t=i/steps,y=fn(t);
      if(y<0)y=0;if(y>1)y=1;
      var px=40+t*(w-80),py=(h-40)-y*(h-80);
      pts.push((i===0?'M':'L')+px.toFixed(1)+','+py.toFixed(1));
    }
    return pts.join(' ');
  }

  function animateCurves(){
    var path=document.getElementById('curvePath');
    var label=document.getElementById('curveLabel');
    if(!path||!label)return;
    var idx=0,DRAW=6500,HOLD=1200,FADE=900;
    function drawNext(){
      var c=curves[idx];
      path.setAttribute('d',buildCurvePath(c.fn));
      label.textContent=c.name;
      var len;try{len=path.getTotalLength();}catch(e){len=1200;}
      path.style.transition='none';
      path.style.strokeDasharray=len+' '+len;
      path.style.strokeDashoffset=len;
      path.style.opacity='1';
      void path.getBoundingClientRect();
      path.style.transition='stroke-dashoffset '+DRAW+'ms cubic-bezier(0.65,0,0.35,1), opacity '+FADE+'ms ease';
      path.style.strokeDashoffset='0';
      label.classList.add('visible');
      setTimeout(function(){
        path.style.opacity='0';
        label.classList.remove('visible');
        setTimeout(function(){idx=(idx+1)%curves.length;drawNext();},FADE+100);
      },DRAW+HOLD);
    }
    drawNext();
  }

  // ── Token Browser ──
  // Token data: s=symbol, n=name, c=category, m=marketcap, l=logo filename
  var TOKENS = [{"s":"ETH","n":"Ethereum","c":"Native","m":2.77801e+11,"l":"eth"},{"s":"USDT","n":"Tether","c":"Stable","m":1.8976e+11,"l":"usdt"},{"s":"BNB","n":"BNB","c":"Native","m":9.14435e+10,"l":"bnb"},{"s":"USDC","n":"USDC","c":"Stable","m":7.70193e+10,"l":"usdc"},{"s":"stETH","n":"Lido Staked Ether","c":"DeFi","m":2.01767e+10,"l":"steth"},{"s":"WBT","n":"WhiteBIT Coin","c":"Exchange","m":1.27239e+10,"l":"wbt"},{"s":"USDS","n":"USDS","c":"Stable","m":1.10299e+10,"l":"usds"},{"s":"HYPE","n":"Hyperliquid","c":"Native","m":9.6351e+09,"l":"hype"},{"s":"wstETH","n":"Wrapped stETH","c":"Wrapped","m":9.59438e+09,"l":"wsteth"},{"s":"WBTC","n":"Wrapped Bitcoin","c":"Wrapped","m":9.54024e+09,"l":"wbtc"},{"s":"LINK","n":"Chainlink","c":"Infra","m":7.61352e+09,"l":"link"},{"s":"cbBTC","n":"Coinbase Wrapped BTC","c":"Wrapped","m":6.65077e+09,"l":"cbbtc"},{"s":"TON","n":"Toncoin","c":"Native","m":6.19191e+09,"l":"ton"},{"s":"USD1","n":"USD1","c":"Stable","m":4.41909e+09,"l":"usd1"},{"s":"weETH","n":"Wrapped eETH","c":"Wrapped","m":4.4182e+09,"l":"weeth"},{"s":"DAI","n":"Dai","c":"Stable","m":4.38278e+09,"l":"dai"},{"s":"AVAX","n":"Avalanche","c":"Native","m":4.33313e+09,"l":"avax"},{"s":"M","n":"MemeCore","c":"Native","m":4.29404e+09,"l":"m"},{"s":"USDe","n":"Ethena USDe","c":"Stable","m":3.96895e+09,"l":"usde"},{"s":"SHIB","n":"Shiba Inu","c":"Meme","m":3.8268e+09,"l":"shib"},{"s":"RAIN","n":"Rain","c":"Utility","m":3.62415e+09,"l":"rain"},{"s":"USDG","n":"Global Dollar","c":"Stable","m":3.54805e+09,"l":"usdg"},{"s":"CRO","n":"Cronos","c":"Native","m":3.47442e+09,"l":"cro"},{"s":"PYUSD","n":"PayPal USD","c":"Stable","m":3.46135e+09,"l":"pyusd"},{"s":"XAUt","n":"Tether Gold","c":"Stable","m":2.77938e+09,"l":"xaut"},{"s":"UNI","n":"Uniswap","c":"DeFi","m":2.42813e+09,"l":"uni"},{"s":"DOT","n":"Polkadot","c":"Native","m":2.35336e+09,"l":"dot"},{"s":"MNT","n":"Mantle","c":"Native","m":2.21851e+09,"l":"mnt"},{"s":"PAXG","n":"PAX Gold","c":"Stable","m":2.21439e+09,"l":"paxg"},{"s":"WLFI","n":"World Liberty Financial","c":"Utility","m":2.16024e+09,"l":"wlfi"},{"s":"ONDO","n":"Ondo","c":"DeFi","m":1.9835e+09,"l":"ondo"},{"s":"OKB","n":"OKB","c":"Exchange","m":1.80921e+09,"l":"okb"},{"s":"SKY","n":"Sky","c":"DeFi","m":1.78328e+09,"l":"sky"},{"s":"HTX","n":"HTX DAO","c":"Exchange","m":1.78283e+09,"l":"htx"},{"s":"ICP","n":"Internet Computer","c":"Native","m":1.77738e+09,"l":"icp"},{"s":"PEPE","n":"Pepe","c":"Meme","m":1.76615e+09,"l":"pepe"},{"s":"ASTER","n":"Aster","c":"Utility","m":1.75359e+09,"l":"aster"},{"s":"RLUSD","n":"Ripple USD","c":"Stable","m":1.57254e+09,"l":"rlusd"},{"s":"AAVE","n":"Aave","c":"DeFi","m":1.49738e+09,"l":"aave"},{"s":"USDD","n":"USDD","c":"Stable","m":1.47117e+09,"l":"usdd"},{"s":"BGB","n":"Bitget Token","c":"Exchange","m":1.46246e+09,"l":"bgb"},{"s":"MORPHO","n":"Morpho","c":"DeFi","m":1.30666e+09,"l":"morpho"},{"s":"ENA","n":"Ethena","c":"DeFi","m":1.12603e+09,"l":"ena"},{"s":"QNT","n":"Quant","c":"Infra","m":1.09485e+09,"l":"qnt"},{"s":"ATOM","n":"Cosmos Hub","c":"Native","m":1.08884e+09,"l":"atom"},{"s":"POL","n":"POL (ex-MATIC)","c":"Native","m":1.0605e+09,"l":"pol"},{"s":"U","n":"United Stables","c":"Stable","m":1.02779e+09,"l":"u"},{"s":"RENDER","n":"Render","c":"Infra","m":1.00516e+09,"l":"render"},{"s":"WLD","n":"Worldcoin","c":"Utility","m":9.37283e+08,"l":"wld"},{"s":"NEXO","n":"NEXO","c":"Exchange","m":9.23095e+08,"l":"nexo"},{"s":"rETH","n":"Rocket Pool ETH","c":"Wrapped","m":8.90051e+08,"l":"reth"},{"s":"STABLE","n":"​​Stable","c":"Stable","m":8.71403e+08,"l":"stable"},{"s":"ARB","n":"Arbitrum","c":"L2","m":8.65513e+08,"l":"arb"},{"s":"SIREN","n":"Siren","c":"Utility","m":8.60056e+08,"l":"siren"},{"s":"GT","n":"Gate","c":"Exchange","m":7.84049e+08,"l":"gt"},{"s":"FLR","n":"Flare","c":"Native","m":7.54721e+08,"l":"flr"},{"s":"VVV","n":"Venice Token","c":"AI","m":7.00786e+08,"l":"vvv"},{"s":"BONK","n":"Bonk","c":"Wrapped","m":6.36099e+08,"l":"bonk"},{"s":"USDTB","n":"USDtb","c":"Stable","m":6.26906e+08,"l":"usdtb"},{"s":"BDX","n":"Beldex","c":"Native","m":6.16944e+08,"l":"bdx"},{"s":"B","n":"BUILDon","c":"DeFi","m":6.05436e+08,"l":"b"},{"s":"DEXE","n":"DeXe","c":"DeFi","m":5.98919e+08,"l":"dexe"},{"s":"PENGU","n":"Pudgy Penguins","c":"Wrapped","m":5.98734e+08,"l":"pengu"},{"s":"TRUMP","n":"Official Trump","c":"Meme","m":5.91662e+08,"l":"trump"},{"s":"SKYAI","n":"SkyAI","c":"AI","m":5.83988e+08,"l":"skyai"},{"s":"GHO","n":"GHO","c":"Stable","m":5.8374e+08,"l":"gho"},{"s":"VIRTUAL","n":"Virtuals Protocol","c":"AI","m":5.46969e+08,"l":"virtual"},{"s":"FET","n":"Artificial Superintelligence Alliance","c":"AI","m":5.16758e+08,"l":"fet"},{"s":"Cake","n":"PancakeSwap","c":"DeFi","m":5.0992e+08,"l":"cake"},{"s":"INJ","n":"Injective","c":"Native","m":5.0273e+08,"l":"inj"},{"s":"TUSD","n":"TrueUSD","c":"Stable","m":4.94157e+08,"l":"tusd"},{"s":"SEI","n":"Sei","c":"Native","m":4.75283e+08,"l":"sei"},{"s":"AERO","n":"Aerodrome Finance","c":"DeFi","m":4.66991e+08,"l":"aero"},{"s":"CHZ","n":"Chiliz","c":"Gaming","m":4.6316e+08,"l":"chz"},{"s":"BILL","n":"Billions Network","c":"Utility","m":4.54541e+08,"l":"bill"},{"s":"EURC","n":"EURC","c":"Stable","m":4.53024e+08,"l":"eurc"},{"s":"EDGE","n":"edgeX","c":"Utility","m":4.51878e+08,"l":"edge"},{"s":"KITE","n":"Kite","c":"AI","m":4.44518e+08,"l":"kite"},{"s":"H","n":"Humanity","c":"AI","m":4.3864e+08,"l":"h"},{"s":"CRV","n":"Curve DAO","c":"DeFi","m":4.31176e+08,"l":"crv"},{"s":"SPX","n":"SPX6900","c":"Meme","m":4.29289e+08,"l":"spx"},{"s":"UB","n":"Unibase","c":"DeFi","m":4.28282e+08,"l":"ub"},{"s":"币安人生","n":"币安人生 (BinanceLife)","c":"Meme","m":4.24236e+08,"l":"币安人生"},{"s":"tBTC","n":"tBTC","c":"Wrapped","m":4.20359e+08,"l":"tbtc"},{"s":"FDUSD","n":"First Digital USD","c":"Stable","m":4.09779e+08,"l":"fdusd"},{"s":"APXUSD","n":"apxUSD","c":"Stable","m":3.9689e+08,"l":"apxusd"},{"s":"ETHFI","n":"Ether.fi","c":"DeFi","m":3.95663e+08,"l":"ethfi"},{"s":"LAB","n":"LAB","c":"AI","m":3.93694e+08,"l":"lab"},{"s":"ZRO","n":"LayerZero","c":"Infra","m":3.79829e+08,"l":"zro"},{"s":"MON","n":"Monad","c":"Native","m":3.70647e+08,"l":"monad"},{"s":"PENDLE","n":"Pendle","c":"DeFi","m":3.62934e+08,"l":"pendle"},{"s":"JASMY","n":"JasmyCoin","c":"Utility","m":3.50328e+08,"l":"jasmy"},{"s":"BASED","n":"Based","c":"Meme","m":2.2637e+07,"l":"based"},{"s":"LDO","n":"Lido DAO","c":"DeFi","m":3.41839e+08,"l":"ldo"},{"s":"GNO","n":"Gnosis","c":"L2","m":3.41785e+08,"l":"gno"},{"s":"OP","n":"Optimism","c":"L2","m":3.3377e+08,"l":"op"},{"s":"BTT","n":"BitTorrent","c":"Utility","m":3.25501e+08,"l":"btt"},{"s":"PYTH","n":"Pyth Network","c":"Infra","m":3.23317e+08,"l":"pyth"},{"s":"GRT","n":"The Graph","c":"Infra","m":3.13194e+08,"l":"grt"},{"s":"STRK","n":"Starknet","c":"Infra","m":2.98251e+08,"l":"strk"},{"s":"ENS","n":"Ethereum Name Service","c":"Infra","m":2.94736e+08,"l":"ens"},{"s":"SYRUP","n":"Maple Finance","c":"DeFi","m":2.85061e+08,"l":"syrup"},{"s":"KAIA","n":"Kaia","c":"Native","m":2.78524e+08,"l":"kaia"},{"s":"FRAX","n":"Legacy Frax Dollar","c":"Stable","m":2.74155e+08,"l":"frax"},{"s":"TEL","n":"Telcoin","c":"Utility","m":2.68156e+08,"l":"tel"},{"s":"APEPE","n":"Ape and Pepe","c":"Meme","m":2.67821e+08,"l":"apepe"},{"s":"USDAI","n":"USDai","c":"Stable","m":2.60675e+08,"l":"usdai"},{"s":"GWEI","n":"ETHGas","c":"Utility","m":2.55301e+08,"l":"gwei"},{"s":"REAL","n":"RealLink","c":"Utility","m":2.54607e+08,"l":"real"},{"s":"RUSD","n":"Royal Dollar","c":"Stable","m":2.49991e+08,"l":"rusd"},{"s":"XPL","n":"Plasma","c":"Native","m":2.47575e+08,"l":"xpl"},{"s":"crvUSD","n":"crvUSD","c":"Stable","m":2.44375e+08,"l":"crvusd"},{"s":"FARTCOIN","n":"Fartcoin","c":"Meme","m":2.38918e+08,"l":"fartcoin"},{"s":"LIT","n":"Lighter","c":"DeFi","m":2.36336e+08,"l":"lit"},{"s":"AXS","n":"Axie Infinity","c":"Gaming","m":2.35793e+08,"l":"axs"},{"s":"COMP","n":"Compound","c":"DeFi","m":2.31566e+08,"l":"comp"},{"s":"TWT","n":"Trust Wallet","c":"Utility","m":2.16772e+08,"l":"twt"},{"s":"SAND","n":"The Sandbox","c":"Gaming","m":2.16137e+08,"l":"sand"},{"s":"PIEVERSE","n":"Pieverse","c":"Gaming","m":2.09451e+08,"l":"pieverse"},{"s":"XCN","n":"Onyxcoin","c":"Infra","m":1.95457e+08,"l":"xcn"},{"s":"S","n":"Sonic","c":"Native","m":1.93973e+08,"l":"sonic"},{"s":"MANA","n":"Decentraland","c":"Gaming","m":1.91809e+08,"l":"mana"},{"s":"ZK","n":"ZKsync","c":"L2","m":1.85694e+08,"l":"zk"},{"s":"GENIUS","n":"Genius","c":"AI","m":1.85627e+08,"l":"genius"},{"s":"GALA","n":"GALA","c":"Gaming","m":1.83451e+08,"l":"gala"},{"s":"VSN","n":"Vision","c":"Utility","m":1.78648e+08,"l":"vsn"},{"s":"CVX","n":"Convex Finance","c":"DeFi","m":1.77873e+08,"l":"cvx"},{"s":"FF","n":"Falcon Finance","c":"DeFi","m":1.77128e+08,"l":"ff"},{"s":"WFI","n":"WeFi","c":"Utility","m":1.76619e+08,"l":"wfi"},{"s":"EIGEN","n":"EigenCloud (prev. EigenLayer)","c":"Infra","m":1.73897e+08,"l":"eigen"},{"s":"CFG","n":"Centrifuge","c":"Infra","m":1.73526e+08,"l":"cfg"},{"s":"BTSE","n":"BTSE Token","c":"Exchange","m":1.72207e+08,"l":"btse"},{"s":"REUSD","n":"Re Protocol reUSD","c":"Stable","m":1.71739e+08,"l":"reusd"},{"s":"BAT","n":"Basic Attention","c":"Utility","m":1.63921e+08,"l":"bat"},{"s":"SFP","n":"SafePal","c":"Utility","m":1.6386e+08,"l":"sfp"},{"s":"MX","n":"MX","c":"Utility","m":1.60892e+08,"l":"mx"},{"s":"IMX","n":"Immutable","c":"Infra","m":1.60629e+08,"l":"imx"},{"s":"APE","n":"ApeCoin","c":"Meme","m":1.57241e+08,"l":"ape"},{"s":"TAG","n":"TAGGER","c":"AI","m":1.55129e+08,"l":"tag"},{"s":"TRAC","n":"OriginTrail","c":"Infra","m":1.54116e+08,"l":"trac"},{"s":"USAT","n":"USAT","c":"Utility","m":1.52649e+08,"l":"usat"},{"s":"NUSD","n":"Neutrl USD","c":"Stable","m":1.50617e+08,"l":"nusd"},{"s":"GLM","n":"Golem","c":"Infra","m":1.49704e+08,"l":"glm"},{"s":"ATH","n":"Aethir","c":"AI","m":1.46456e+08,"l":"ath"},{"s":"AB","n":"AB","c":"Utility","m":1.45936e+08,"l":"ab"},{"s":"BANANAS31","n":"Banana For Scale","c":"Meme","m":1.4278e+08,"l":"bananas31"},{"s":"1INCH","n":"1INCH","c":"DeFi","m":1.42314e+08,"l":"1inch"},{"s":"SAHARA","n":"Sahara AI","c":"Infra","m":1.38935e+08,"l":"sahara"},{"s":"FRXUSD","n":"Frax USD","c":"Stable","m":1.38668e+08,"l":"frxusd"},{"s":"AUSD","n":"AUSD","c":"Stable","m":1.36858e+08,"l":"ausd"},{"s":"FLUID","n":"Fluid","c":"DeFi","m":1.36122e+08,"l":"fluid"},{"s":"CHIP","n":"USD.AI","c":"Stable","m":1.33116e+08,"l":"chip"},{"s":"CHEEMS","n":"Cheems Token","c":"Meme","m":1.31099e+08,"l":"cheems"},{"s":"IRYS","n":"Irys","c":"Infra","m":1.28834e+08,"l":"irys"},{"s":"EURCV","n":"EUR CoinVertible","c":"Stable","m":1.2797e+08,"l":"eurcv"},{"s":"RSR","n":"Reserve Rights","c":"DeFi","m":1.2639e+08,"l":"rsr"},{"s":"MEGA","n":"MegaETH","c":"L2","m":1.2617e+08,"l":"mega"},{"s":"SENT","n":"Sentient","c":"AI","m":1.25088e+08,"l":"sent"},{"s":"TIBBIR","n":"Ribbita by Virtuals","c":"AI","m":1.2486e+08,"l":"tibbir"},{"s":"ZEN","n":"Horizen","c":"L2","m":1.23364e+08,"l":"zen"},{"s":"GOMINING","n":"GoMining Token","c":"Infra","m":1.2246e+08,"l":"gomining"},{"s":"SNX","n":"Synthetix","c":"DeFi","m":1.22048e+08,"l":"snx"},{"s":"ASTEROID","n":"Asteroid Shiba","c":"Meme","m":1.20083e+08,"l":"asteroid"},{"s":"0G","n":"0G","c":"Infra","m":1.19657e+08,"l":"0g"},{"s":"SOSO","n":"SoSoValue","c":"Infra","m":1.18393e+08,"l":"soso"},{"s":"SAFE","n":"Safe","c":"Infra","m":1.14995e+08,"l":"safe"},{"s":"LPT","n":"Livepeer","c":"Infra","m":1.14486e+08,"l":"lpt"},{"s":"KMNO","n":"Kamino","c":"DeFi","m":1.13791e+08,"l":"kmno"},{"s":"BSB","n":"Block Street","c":"Infra","m":1.13096e+08,"l":"bsb"},{"s":"GAS","n":"Gas","c":"Native","m":1.12568e+08,"l":"gas"},{"s":"BMX","n":"BitMart Token","c":"Exchange","m":1.12244e+08,"l":"bmx"},{"s":"KAITO","n":"KAITO","c":"AI","m":1.10719e+08,"l":"kaito"},{"s":"QTUM","n":"Qtum","c":"Native","m":1.10194e+08,"l":"qtum"},{"s":"AWE","n":"AWE Network","c":"Infra","m":1.10004e+08,"l":"awe"},{"s":"ZRX","n":"0x Protocol","c":"DeFi","m":1.09016e+08,"l":"zrx"},{"s":"FORM","n":"Four","c":"Gaming","m":1.08469e+08,"l":"form"},{"s":"BERA","n":"Berachain","c":"Native","m":1.06136e+08,"l":"bera"},{"s":"PROS","n":"Pharos","c":"Native","m":1.05616e+08,"l":"pros"},{"s":"COW","n":"CoW Protocol","c":"DeFi","m":1.05459e+08,"l":"cow"},{"s":"BEAM","n":"Beam","c":"Gaming","m":1.03788e+08,"l":"beam"},{"s":"KSM","n":"Kusama","c":"Native","m":1.03561e+08,"l":"ksm"},{"s":"BRETT","n":"Based Brett","c":"Meme","m":1.0102e+08,"l":"brett"},{"s":"BIO","n":"Bio Protocol","c":"Infra","m":1.00557e+08,"l":"bio"},{"s":"RVN","n":"Ravencoin","c":"Native","m":1.00324e+08,"l":"rvn"},{"s":"ORDI","n":"ORDI","c":"Meme","m":9.99345e+07,"l":"ordi"},{"s":"YFI","n":"yearn.finance","c":"DeFi","m":9.95031e+07,"l":"yfi"},{"s":"LINEA","n":"Linea","c":"L2","m":9.93025e+07,"l":"linea"},{"s":"DEEP","n":"DeepBook","c":"DeFi","m":9.71961e+07,"l":"deep"},{"s":"TURBO","n":"Turbo","c":"Meme","m":9.65627e+07,"l":"turbo"},{"s":"ENJ","n":"Enjin Coin","c":"Gaming","m":9.55138e+07,"l":"enj"},{"s":"KTA","n":"Keeta","c":"Native","m":9.52994e+07,"l":"kta"},{"s":"AIOZ","n":"AIOZ Network","c":"Infra","m":9.35857e+07,"l":"aioz"},{"s":"SPK","n":"Spark","c":"DeFi","m":9.28973e+07,"l":"spk"},{"s":"ICNT","n":"Impossible Cloud Network Token","c":"Infra","m":9.26472e+07,"l":"icnt"},{"s":"W","n":"Wormhole","c":"Infra","m":9.20497e+07,"l":"w"},{"s":"TRIA","n":"TRIA","c":"AI","m":9.15564e+07,"l":"tria"},{"s":"USDAT","n":"Saturn Dollar","c":"Utility","m":9.13369e+07,"l":"usdat"},{"s":"ARKM","n":"Arkham","c":"AI","m":9.09703e+07,"l":"arkm"},{"s":"ESPORTS","n":"Yooldo Games","c":"Gaming","m":9.03073e+07,"l":"esports"},{"s":"NXPC","n":"Nexpace","c":"Gaming","m":9.02402e+07,"l":"nxpc"},{"s":"TFUEL","n":"Theta Fuel","c":"Native","m":8.90283e+07,"l":"tfuel"},{"s":"BARD","n":"Lombard","c":"DeFi","m":8.77136e+07,"l":"bard"},{"s":"GRX","n":"GRX Chain","c":"Exchange","m":8.71998e+07,"l":"grx"},{"s":"CTC","n":"Creditcoin","c":"Native","m":8.70883e+07,"l":"ctc"},{"s":"ZETA","n":"ZetaChain","c":"Native","m":8.67988e+07,"l":"zeta"},{"s":"MINA","n":"Mina Protocol","c":"Native","m":8.67531e+07,"l":"mina"},{"s":"USDA","n":"USDA","c":"Stable","m":8.66414e+07,"l":"usda"},{"s":"DOG","n":"Dog (Bitcoin)","c":"Meme","m":8.64317e+07,"l":"dog"},{"s":"ROSE","n":"Oasis","c":"Native","m":8.61801e+07,"l":"rose"},{"s":"ZIL","n":"Zilliqa","c":"Native","m":8.48888e+07,"l":"zil"},{"s":"SUPER","n":"SuperVerse","c":"Gaming","m":8.45074e+07,"l":"super"},{"s":"BABYDOGE","n":"Baby Doge Coin","c":"Meme","m":8.44284e+07,"l":"babydoge"},{"s":"RON","n":"Ronin","c":"Native","m":8.40218e+07,"l":"ron"},{"s":"QUBIC","n":"Qubic","c":"Native","m":8.32688e+07,"l":"qubic"},{"s":"AXL","n":"Axelar","c":"Infra","m":8.28495e+07,"l":"axl"},{"s":"TAC","n":"TAC","c":"Native","m":8.15644e+07,"l":"tac"},{"s":"TOSHI","n":"Toshi","c":"Meme","m":8.15644e+07,"l":"toshi"},{"s":"CKB","n":"Nervos Network","c":"L2","m":8.12624e+07,"l":"ckb"},{"s":"MBG","n":"MBG By Multibank Group","c":"Exchange","m":8.10992e+07,"l":"mbg"},{"s":"FOGO","n":"Fogo","c":"Native","m":8.01371e+07,"l":"fogo"},{"s":"ASTR","n":"Astar","c":"Native","m":7.99148e+07,"l":"astr"},{"s":"XPR","n":"XPR Network","c":"Native","m":7.94995e+07,"l":"xpr"},{"s":"HOT","n":"Holo","c":"Infra","m":7.87208e+07,"l":"hot"},{"s":"AMP","n":"Amp","c":"DeFi","m":7.86783e+07,"l":"amp"},{"s":"USELESS","n":"Useless Coin","c":"Meme","m":7.83978e+07,"l":"useless"},{"s":"PLUME","n":"Plume","c":"Native","m":7.81841e+07,"l":"plume"},{"s":"AZTEC","n":"Aztec","c":"L2","m":7.74191e+07,"l":"aztec"},{"s":"MOVE","n":"Movement","c":"Native","m":7.6985e+07,"l":"move"},{"s":"BLUR","n":"Blur","c":"DeFi","m":7.6976e+07,"l":"blur"},{"s":"GMX","n":"GMX","c":"DeFi","m":7.59546e+07,"l":"gmx"},{"s":"RIF","n":"Rootstock Infrastructure Framework","c":"Infra","m":7.51187e+07,"l":"rif"},{"s":"DUSK","n":"DUSK","c":"Native","m":7.48104e+07,"l":"dusk"},{"s":"DGB","n":"DigiByte","c":"Native","m":7.11218e+07,"l":"dgb"},{"s":"KAVA","n":"Kava","c":"Native","m":7.08511e+07,"l":"kava"},{"s":"VELO","n":"Velo","c":"DeFi","m":7.08446e+07,"l":"velo"},{"s":"COAI","n":"ChainOpera AI","c":"AI","m":7.01884e+07,"l":"coai"},{"s":"POLYX","n":"Polymesh","c":"Native","m":6.96155e+07,"l":"polyx"},{"s":"T","n":"Threshold Network","c":"DeFi","m":6.95991e+07,"l":"t"},{"s":"CYS","n":"Cysic","c":"Native","m":6.88109e+07,"l":"cys"},{"s":"BABY","n":"Babylon","c":"DeFi","m":6.81403e+07,"l":"baby"},{"s":"FLOW","n":"Flow","c":"Native","m":6.78104e+07,"l":"flow"},{"s":"POPCAT","n":"Popcat","c":"Meme","m":6.69461e+07,"l":"popcat"},{"s":"SUSHI","n":"Sushi","c":"DeFi","m":6.67619e+07,"l":"sushi"},{"s":"NAORIS","n":"Naoris Protocol","c":"Native","m":6.65053e+07,"l":"naoris"},{"s":"KAIO","n":"KAIO","c":"Infra","m":6.62749e+07,"l":"kaio"},{"s":"SN120","n":"affine","c":"AI","m":6.60707e+07,"l":"sn120"},{"s":"MOG","n":"Mog Coin","c":"Meme","m":6.59316e+07,"l":"mog"},{"s":"MOCA","n":"Moca Network","c":"Gaming","m":6.57907e+07,"l":"moca"},{"s":"NPC","n":"Non-Playable Coin","c":"Meme","m":6.57382e+07,"l":"npc"},{"s":"NMR","n":"Numeraire","c":"DeFi","m":6.55849e+07,"l":"nmr"},{"s":"HOME","n":"HOME","c":"DeFi","m":6.43988e+07,"l":"home"},{"s":"UAI","n":"UnifAI Network","c":"AI","m":6.3953e+07,"l":"uai"},{"s":"ZAMA","n":"Zama","c":"Infra","m":6.28242e+07,"l":"zama"},{"s":"JUPUSD","n":"JupUSD","c":"Stable","m":6.23338e+07,"l":"jupusd"},{"s":"VTHO","n":"VeThor","c":"Utility","m":6.08457e+07,"l":"vtho"},{"s":"EURI","n":"Eurite","c":"Stable","m":5.9789e+07,"l":"euri"},{"s":"CELO","n":"Celo","c":"Native","m":5.82401e+07,"l":"celo"},{"s":"OPG","n":"OpenGradient","c":"AI","m":5.82204e+07,"l":"opg"},{"s":"REZ","n":"Renzo","c":"DeFi","m":5.76888e+07,"l":"rez"},{"s":"TRB","n":"Tellor Tributes","c":"Infra","m":5.56515e+07,"l":"trb"},{"s":"RED","n":"RedStone","c":"Infra","m":5.56123e+07,"l":"red"},{"s":"XYO","n":"XYO Network","c":"Infra","m":5.44556e+07,"l":"xyo"},{"s":"API3","n":"Api3","c":"Infra","m":5.4375e+07,"l":"api3"},{"s":"WMTX","n":"World Mobile Token","c":"Infra","m":5.42971e+07,"l":"wmtx"},{"s":"FXUSD","n":"f(x) Protocol fxUSD","c":"Stable","m":5.41286e+07,"l":"fxusd"},{"s":"XUSD","n":"StraitsX XUSD","c":"Stable","m":5.39004e+07,"l":"xusd"},{"s":"MASK","n":"Mask Network","c":"Infra","m":5.36287e+07,"l":"mask"},{"s":"ANKR","n":"Ankr Network","c":"Infra","m":5.26841e+07,"l":"ankr"},{"s":"FIDD","n":"Fidelity Digital Dollar","c":"Stable","m":5.15278e+07,"l":"fidd"},{"s":"AVNT","n":"Avantis","c":"DeFi","m":5.12531e+07,"l":"avnt"},{"s":"ROBO","n":"Fabric Protocol","c":"Utility","m":5.0996e+07,"l":"robo"},{"s":"MYX","n":"MYX Finance","c":"DeFi","m":4.71433e+07,"l":"myx"},{"s":"MERL","n":"Merlin Chain","c":"L2","m":4.53234e+07,"l":"merl"},{"s":"NEIRO","n":"Neiro","c":"Meme","m":4.20934e+07,"l":"neiro"},{"s":"EDU","n":"Open Campus","c":"Utility","m":4.06376e+07,"l":"edu"},{"s":"ZBT","n":"ZEROBASE","c":"L2","m":4.02784e+07,"l":"zbt"},{"s":"HUMA","n":"Huma Finance","c":"DeFi","m":4.00022e+07,"l":"huma"},{"s":"ESP","n":"Espresso","c":"Infra","m":3.94565e+07,"l":"esp"},{"s":"WOJAK","n":"wojak","c":"Utility","m":3.9077e+07,"l":"wojak"},{"s":"MANTA","n":"Manta Network","c":"L2","m":3.86106e+07,"l":"manta"},{"s":"HYPER","n":"Hyperlane","c":"Infra","m":3.74299e+07,"l":"hyper"},{"s":"CYBER","n":"CYBER","c":"L2","m":3.54534e+07,"l":"cyber"},{"s":"BREV","n":"Brevis","c":"Utility","m":3.44461e+07,"l":"brev"},{"s":"GPS","n":"GoPlus Security","c":"Infra","m":3.40606e+07,"l":"gps"},{"s":"YGG","n":"Yield Guild Games","c":"Gaming","m":3.35454e+07,"l":"ygg"},{"s":"AIXBT","n":"aixbt","c":"AI","m":3.25515e+07,"l":"aixbt"},{"s":"PHA","n":"PHALA","c":"Infra","m":3.17939e+07,"l":"pha"},{"s":"BLAST","n":"Blast","c":"L2","m":3.17299e+07,"l":"blast"},{"s":"SIGN","n":"Sign","c":"Infra","m":3.16808e+07,"l":"sign"},{"s":"CTSI","n":"Cartesi","c":"Infra","m":3.15434e+07,"l":"ctsi"},{"s":"BTW","n":"Bitway","c":"Utility","m":3.13159e+07,"l":"btw"},{"s":"MOVR","n":"Moonriver","c":"Native","m":3.10397e+07,"l":"movr"},{"s":"SAPIEN","n":"Sapien","c":"Utility","m":3.07592e+07,"l":"sapien"},{"s":"COLLECT","n":"Collect on Fanable","c":"Gaming","m":3.06024e+07,"l":"collect"},{"s":"AUDIO","n":"Audius","c":"Infra","m":3.01935e+07,"l":"audio"},{"s":"SOPH","n":"Sophon","c":"L2","m":3.01033e+07,"l":"soph"},{"s":"HONEY","n":"Honey","c":"Native","m":2.4565e+07,"l":"honey"},{"s":"TAIKO","n":"Taiko","c":"L2","m":2.22581e+07,"l":"taiko"},{"s":"AURORA","n":"Aurora","c":"Native","m":1.96506e+07,"l":"aurora"},{"s":"GLMR","n":"Moonbeam","c":"Native","m":1.84604e+07,"l":"glmr"}];

  var CATEGORIES = ['All','Native','L2','DeFi','Stable','Gaming','Meme','Infra','Utility','AI','Exchange','Wrapped'];
  var CAT_COLORS = {Native:'#FFD700',L2:'#0984E3',DeFi:'#6C5CE7',Stable:'#10B981',Gold:'#DAA520',Yield:'#10B981',Gaming:'#EF4444',Meme:'#FFA500',Infra:'#6495ED',Utility:'#9370DB',AI:'#00FF7F',Exchange:'#FFD700',Wrapped:'#C0C0C0'};

  function fmtMcap(n){
    if(n>=1e12) return '$'+Math.round(n/1e11)/10+'T';
    if(n>=1e9) return '$'+Math.round(n/1e8)/10+'B';
    if(n>=1e6) return '$'+Math.round(n/1e6)+'M';
    return '$'+Math.round(n/1e3)+'K';
  }

  function fmtWeight(n){
    if(n>=1e6) return (n/1e6).toFixed(1)+'M';
    if(n>=1e3) return (n/1e3).toFixed(1)+'K';
    if(n>=100)  return Math.round(n).toString();
    if(n>=10)   return n.toFixed(1);
    return n.toFixed(2);
  }

  // Sort: live votes desc → market cap desc (tiebreak / fallback).
  function rankCmp(a,b){
    if(LIVE_SCORES){
      var sa = LIVE_SCORES[a.s] || 0;
      var sb = LIVE_SCORES[b.s] || 0;
      if(sb !== sa) return sb - sa;
    }
    return b.m - a.m;
  }

  // Build { symbol: overallRank } across all tokens (drives top-64 gold + deltas).
  function computeOverallRanks(){
    var sorted = TOKENS.slice().sort(rankCmp);
    var map = {};
    for(var i=0;i<sorted.length;i++) map[sorted[i].s] = i+1;
    return map;
  }

  function updateBrowserSub(){
    if(!$browserSub) return;
    while($browserSub.firstChild) $browserSub.removeChild($browserSub.firstChild);
    if(LIVE_STATE === 'closed'){
      var badge = document.createElement('span');
      badge.className = 'live-final-badge';
      badge.textContent = 'FINAL';
      $browserSub.appendChild(badge);
      $browserSub.appendChild(document.createTextNode(
        'Sorted by votes · ' + LIVE_TOTAL_VOTES.toLocaleString() +
        ' total vote' + (LIVE_TOTAL_VOTES === 1 ? '' : 's') + ' · the 64 are in gold'));
    } else if(LIVE_SCORES && LIVE_TOTAL_VOTES > 0){
      var dot = document.createElement('span');
      dot.className = 'live-dot';
      dot.setAttribute('aria-hidden', 'true');
      $browserSub.appendChild(dot);
      $browserSub.appendChild(document.createTextNode(
        'LIVE · Sorted by votes · ' + LIVE_TOTAL_VOTES.toLocaleString() +
        ' total vote' + (LIVE_TOTAL_VOTES === 1 ? '' : 's') +
        ' · top 64 in gold · updates every 90s'));
    } else {
      $browserSub.textContent = 'Sorted by market cap. Tap tokens to build your ballot — pick up to 64.';
    }
  }

  function renderTokenGrid(filter, search){
    var $grid=document.getElementById('tokenGrid');
    var overallRanks = computeOverallRanks();
    var useLive = !!LIVE_SCORES;
    var showingCategory = filter && filter !== 'All';

    var filtered=TOKENS.filter(function(t){
      if(showingCategory && t.c!==filter) return false;
      if(search){var q=search.toLowerCase();if(t.s.toLowerCase().indexOf(q)===-1&&t.n.toLowerCase().indexOf(q)===-1) return false;}
      return true;
    });
    filtered.sort(rankCmp);

    // Grid built with createElement/textContent so token fields can't be parsed as HTML.
    function makeSpan(cls, text){
      var s = document.createElement('span');
      s.className = cls;
      if(text != null) s.textContent = text;
      return s;
    }

    while($grid.firstChild) $grid.removeChild($grid.firstChild);

    if(filtered.length===0){
      var empty = document.createElement('div');
      empty.className = 'no-results';
      empty.textContent = 'No tokens match your search.';
      $grid.appendChild(empty);
    } else {
      for(var i=0;i<filtered.length;i++){
        var t=filtered[i];
        var filterRank  = i+1;
        var overallRank = overallRanks[t.s];
        var inTop64     = useLive && overallRank<=64;
        var prev        = PREV_OVERALL_RANKS[t.s];

        var cardClass   = 'token-card' + (inTop64 ? ' in-64' : '') + (SELECTED[t.s] ? ' selected' : '');
        var card = document.createElement('div');
        card.className = cardClass;
        card.setAttribute('data-sym', t.s);

        card.appendChild(makeSpan('rank', '#'+filterRank));

        // Delta badge — only on live updates after the first paint.
        if(useLive && !FIRST_LIVE_RENDER && prev && prev!==overallRank){
          var diff = prev - overallRank;
          if(diff > 0){
            var up = makeSpan('delta up', '▲'+diff);
            up.setAttribute('aria-label', 'up '+diff);
            card.appendChild(up);
          } else if(diff < 0){
            var down = makeSpan('delta down', '▼'+(-diff));
            down.setAttribute('aria-label', 'down '+(-diff));
            card.appendChild(down);
          }
        }

        var img = document.createElement('img');
        img.className = 'token-logo';
        img.setAttribute('src', 'logos/'+t.l+'.webp');
        img.setAttribute('alt', t.s);
        img.setAttribute('loading', 'lazy');
        card.appendChild(img);

        card.appendChild(makeSpan('token-sym', t.s));
        card.appendChild(makeSpan('token-name', t.n));
        card.appendChild(makeSpan('token-mcap', fmtMcap(t.m)));

        if(useLive){
          var weight = LIVE_SCORES[t.s] || 0;
          card.appendChild(makeSpan('token-weight', fmtWeight(weight)+' votes'));
        }

        // Overall rank — only inside a category filter.
        if(useLive && showingCategory){
          card.appendChild(makeSpan('token-overall', '#'+overallRank+' overall'));
        }

        card.appendChild(makeSpan('token-cat cat-'+t.c, t.c));

        $grid.appendChild(card);
      }
    }

    // Broken-image fallback via addEventListener (keeps inline handlers out of CSP).
    $grid.querySelectorAll('img.token-logo').forEach(function(img){
      img.addEventListener('error', function(){ this.style.display='none'; });
    });

    // Capture rank changes into the ticker buffer (skip first live render).
    if(useLive && !FIRST_LIVE_RENDER){
      var newChanges = [];
      for(var sym in overallRanks){
        var fromR = PREV_OVERALL_RANKS[sym];
        var toR   = overallRanks[sym];
        if(!fromR || fromR === toR) continue;
        var tokenMeta = TOKENS.find(function(x){return x.s===sym;});
        newChanges.push({
          sym: sym,
          name: tokenMeta ? tokenMeta.n : sym,
          diff: fromR - toR,   // positive = moved up
          fromRank: fromR,
          toRank: toR,
          ts: Date.now()
        });
      }
      if(newChanges.length > 0){
        newChanges.sort(function(a,b){ return Math.abs(b.diff) - Math.abs(a.diff); });
        // Dedupe prior entries for symbols that just changed again.
        var newSyms = {};
        newChanges.forEach(function(c){newSyms[c.sym]=true;});
        TICKER_BUFFER = TICKER_BUFFER.filter(function(c){return !newSyms[c.sym];});
        TICKER_BUFFER = newChanges.concat(TICKER_BUFFER).slice(0, TICKER_MAX);
        renderTicker();
      }
    }

    if(useLive){
      PREV_OVERALL_RANKS = overallRanks;
      if(FIRST_LIVE_RENDER) FIRST_LIVE_RENDER = false;
    }
    updateBrowserSub();
    updateGridToggle();
  }

  function updateGridToggle(){
    var grid = document.getElementById('tokenGrid');
    var wrap = document.getElementById('tokenGridToggleWrap');
    var btn  = document.getElementById('tokenGridToggle');
    if(!grid || !wrap || !btn) return;
    var total    = grid.querySelectorAll('.token-card').length;
    var hideAt   = (window.matchMedia && window.matchMedia('(max-width:767px)').matches) ? 12 : 24;
    var collapsed = grid.classList.contains('collapsed');
    if(total <= hideAt){
      wrap.setAttribute('hidden','');
      return;
    }
    wrap.removeAttribute('hidden');
    var text = btn.querySelector('.token-grid-toggle-text');
    var icon = btn.querySelector('.token-grid-toggle-icon');
    if(collapsed){
      if(text) text.textContent = 'Show all ' + total + ' candidates';
      if(icon) icon.textContent = '▼';
      btn.setAttribute('aria-expanded','false');
    } else {
      if(text) text.textContent = 'Show fewer';
      if(icon) icon.textContent = '▲';
      btn.setAttribute('aria-expanded','true');
    }
  }

  // Reveal-phase roster: the 64 community-chosen tokens, ranked by final tally.
  function renderFinalRoster(){
    if(!$finalRosterList) return;
    var top64 = TOKENS.slice().sort(rankCmp).slice(0, 64);
    var useLive = !!LIVE_SCORES;
    while($finalRosterList.firstChild) $finalRosterList.removeChild($finalRosterList.firstChild);
    var frag = document.createDocumentFragment();
    for(var i=0;i<top64.length;i++){
      var t = top64[i];
      var li = document.createElement('li');
      li.className = 'fr-row';

      var rank = document.createElement('span');
      rank.className = 'fr-rank';
      rank.textContent = '#' + (i + 1);
      li.appendChild(rank);

      var logo = document.createElement('img');
      logo.className = 'fr-logo';
      logo.src = 'logos/' + t.l + '.webp';
      logo.alt = '';
      logo.loading = 'lazy';
      logo.addEventListener('error', function(){ this.style.visibility = 'hidden'; });
      li.appendChild(logo);

      var sym = document.createElement('span');
      sym.className = 'fr-sym';
      sym.textContent = t.s;
      li.appendChild(sym);

      var name = document.createElement('span');
      name.className = 'fr-name';
      name.textContent = t.n;
      li.appendChild(name);

      if(useLive){
        var votes = LIVE_SCORES[t.s] || 0;
        var v = document.createElement('span');
        v.className = 'fr-votes';
        v.textContent = votes.toLocaleString() + ' vote' + (votes === 1 ? '' : 's');
        li.appendChild(v);
      }
      frag.appendChild(li);
    }
    $finalRosterList.appendChild(frag);
  }

  function renderTicker(){
    var $bar = document.getElementById('tickerBar');
    var $track = document.getElementById('tickerTrack');
    if(!$bar || !$track) return;
    var cutoff = Date.now() - TICKER_STALE_MS;
    TICKER_BUFFER = TICKER_BUFFER.filter(function(c){return c.ts >= cutoff;});
    if(!LIVE_SCORES || TICKER_BUFFER.length === 0){
      $bar.classList.add('hidden');
      return;
    }
    $bar.classList.remove('hidden');
    function itemHtml(c){
      var dir = c.diff > 0 ? 'up' : 'down';
      var arrow = c.diff > 0 ? '▲' : '▼';
      var mag = Math.abs(c.diff);
      var inOutTag = '';
      if(c.toRank <= 64 && c.fromRank > 64) inOutTag = ' <span class="to-rank" style="color:var(--gold);font-weight:700">IN THE 64</span>';
      else if(c.toRank > 64 && c.fromRank <= 64) inOutTag = ' <span class="to-rank" style="color:#EF4444;font-weight:700">OUT OF THE 64</span>';
      else inOutTag = ' <span class="to-rank">→ #'+c.toRank+'</span>';
      return '<span class="ticker-item">'
        +'<span class="sym">'+c.sym+'</span>'
        +'<span class="name">'+c.name+'</span>'
        +'<span class="change '+dir+'">'+arrow+mag+'</span>'
        +inOutTag
        +'</span>'
        +'<span class="ticker-sep" aria-hidden="true">&middot;</span>';
    }
    var singlePass = TICKER_BUFFER.map(itemHtml).join('');
    // itemHtml interpolates only TOKENS-derived strings and computed integers.
    $track.innerHTML = TICKER_BUFFER.length >= 3 ? singlePass + singlePass : singlePass;
  }

  // ===PUNZI_REVEAL_STOP_BEGIN===
  // Closure-free stop-decision for the reveal poll: stop once totalVotes is
  // unchanged across `stableTarget` polls, or `maxWaitMs` after first 'closed'.
  function evaluateRevealStop(input){
    var state             = input.state;
    var totalVotes        = input.totalVotes;
    var prevLastTotal     = input.prevLastTotal;
    var prevStableCount   = input.prevStableCount   || 0;
    var prevFirstClosedAt = input.prevFirstClosedAt || 0;
    var now               = input.now;
    var stableTarget      = input.stableTarget;
    var maxWaitMs         = input.maxWaitMs;

    // Not closed — never stop, and don't advance stability (closed→open must not lock in a run).
    if(state !== 'closed'){
      return {
        shouldStop:        false,
        nextLastTotal:     prevLastTotal,
        nextStableCount:   prevStableCount,
        nextFirstClosedAt: prevFirstClosedAt
      };
    }

    // Anchor the wait-clock on the FIRST closed observation, then preserve it.
    var firstClosedAt = prevFirstClosedAt || now;

    // Stability tracking: consecutive identical totals count as one run.
    var stableCount;
    if(prevLastTotal === totalVotes){
      stableCount = prevStableCount + 1;
    } else {
      stableCount = 1;
    }

    var capExceeded   = (now - firstClosedAt) >= maxWaitMs;
    var stableReached = stableCount >= stableTarget;

    return {
      shouldStop:        capExceeded || stableReached,
      nextLastTotal:     totalVotes,
      nextStableCount:   stableCount,
      nextFirstClosedAt: firstClosedAt
    };
  }
  // ===PUNZI_REVEAL_STOP_END===

  // ── Collector live-tally polling (silent fallback when not configured) ──
  function isCollectorConfigured(){
    return COLLECTOR_URL && COLLECTOR_URL.indexOf('PLACEHOLDER') === -1;
  }

  function collectorBase(){
    return COLLECTOR_URL.replace(/\/+$/, '');
  }

  function fetchTally(){
    if(!isCollectorConfigured()) return;
    fetch(collectorBase()+'/tally', { headers:{'Accept':'application/json'} })
      .then(function(r){ return r && r.ok ? r.json() : null; })
      .then(function(data){
        if(!data || typeof data !== 'object') return;
        if(data.tallies && typeof data.tallies === 'object'){
          var map = {};
          for(var k in data.tallies){
            if(Object.prototype.hasOwnProperty.call(data.tallies,k)) map[k] = Number(data.tallies[k]) || 0;
          }
          LIVE_SCORES = map;
        }
        LIVE_STATE       = data.state || null;
        LIVE_TOTAL_VOTES = Math.max(Number(data.totalVotes) || 0, OPTIMISTIC_MIN);
        if($voterCount)  $voterCount.textContent  = LIVE_TOTAL_VOTES.toLocaleString();
        if($totalVoters) $totalVoters.textContent = LIVE_TOTAL_VOTES.toLocaleString();
        var activeBtn = document.querySelector('.filter-btn.active');
        var cat = activeBtn ? activeBtn.getAttribute('data-cat') : 'All';
        var search = (document.getElementById('tokenSearch') || {}).value || '';
        renderTokenGrid(cat, search);
        renderFinalRoster();
        if(LIVE_STATE === 'closed' && POLL_TIMER){
          clearInterval(POLL_TIMER); POLL_TIMER = null;
        }
        // Advance the reveal stop-decision only while the reveal poll drives fetches.
        if(REVEAL_POLL_TIMER){
          var rstop = evaluateRevealStop({
            state:             LIVE_STATE,
            totalVotes:        LIVE_TOTAL_VOTES,
            prevLastTotal:     REVEAL_LAST_TOTAL,
            prevStableCount:   REVEAL_STABLE_COUNT,
            prevFirstClosedAt: REVEAL_FIRST_CLOSED_AT,
            now:               Date.now(),
            stableTarget:      REVEAL_STABLE_TARGET,
            maxWaitMs:         REVEAL_MAX_WAIT_MS
          });
          REVEAL_LAST_TOTAL      = rstop.nextLastTotal;
          REVEAL_STABLE_COUNT    = rstop.nextStableCount;
          REVEAL_FIRST_CLOSED_AT = rstop.nextFirstClosedAt;
          if(rstop.shouldStop){
            REVEAL_POLL_DONE = true;
            stopRevealPolling();
          }
        }
      })
      .catch(function(err){
        // Graceful degradation: keep showing the last good tally.
        try{ console.warn('[punzi-vote] tally fetch failed, keeping last good tally:', err && err.message); }catch(_){}
      });
  }

  function startPolling(){
    if(POLL_TIMER || !isCollectorConfigured()) return;
    fetchTally();
    POLL_TIMER = setInterval(function(){
      if(document.visibilityState === 'visible' && LIVE_STATE !== 'closed'){
        fetchTally();
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling(){
    if(POLL_TIMER){ clearInterval(POLL_TIMER); POLL_TIMER = null; }
  }

  // Reveal-phase poll: separate timer, stopped by evaluateRevealStop via fetchTally.
  function startRevealPolling(){
    if(REVEAL_POLL_TIMER || REVEAL_POLL_DONE || !isCollectorConfigured()) return;
    fetchTally();  // immediate refresh on entering reveal
    REVEAL_POLL_TIMER = setInterval(function(){
      if(document.visibilityState === 'visible'){
        fetchTally();
      }
    }, POLL_INTERVAL_MS);
  }

  function stopRevealPolling(){
    if(REVEAL_POLL_TIMER){ clearInterval(REVEAL_POLL_TIMER); REVEAL_POLL_TIMER = null; }
  }

  // Refresh on tab return (also during reveal until REVEAL_POLL_DONE) to avoid a stale total.
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible' && isCollectorConfigured() && !REVEAL_POLL_DONE){
      fetchTally();
    }
  });

  // ── Share Your Vote ──
  // One-click Post on X; the URL refreshes periodically to keep the count current.
  (function(){
    var $postBtn = document.getElementById('sharePostBtn');
    if(!$postBtn) return;

    var SITE_URL = 'https://punzi.xyz';

    function buildTweet(totalVotes){
      var lines = ['I voted in the PUNZI WARS Token Election.'];
      lines.push('300 candidates. 64 slots. Pick the 64 schemes you want built.');
      if(totalVotes > 0) lines.push(totalVotes.toLocaleString() + ' votes cast so far.');
      lines.push(SITE_URL);
      return lines.join('\n\n');
    }

    function refreshTweet(){
      $postBtn.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(buildTweet(LIVE_TOTAL_VOTES));
    }

    refreshTweet();
    setInterval(refreshTweet, POLL_INTERVAL_MS);
  })();

  function renderFilters(){
    var $bar=document.getElementById('filterBar');
    var counts={All:TOKENS.length};
    TOKENS.forEach(function(t){counts[t.c]=(counts[t.c]||0)+1;});
    var html='';
    CATEGORIES.forEach(function(cat){
      var c=counts[cat]||0;if(cat!=='All'&&c===0)return;
      html+='<button class="filter-btn'+(cat==='All'?' active':'')+'" data-cat="'+cat+'">'+cat+'<span class="filter-count">'+c+'</span></button>';
    });
    // html interpolates only the hardcoded CATEGORIES and integer counts.
    $bar.innerHTML=html;
    var btns=$bar.querySelectorAll('.filter-btn');
    var activeCat='All';
    btns.forEach(function(btn){
      btn.addEventListener('click',function(){
        btns.forEach(function(b){b.classList.remove('active');});
        btn.classList.add('active');
        activeCat=btn.getAttribute('data-cat');
        renderTokenGrid(activeCat,document.getElementById('tokenSearch').value);
      });
    });
  }

  var searchTimer;
  document.getElementById('tokenSearch').addEventListener('input',function(){
    var val=this.value;
    clearTimeout(searchTimer);
    searchTimer=setTimeout(function(){
      var activeBtn=document.querySelector('.filter-btn.active');
      var cat=activeBtn?activeBtn.getAttribute('data-cat'):'All';
      renderTokenGrid(cat,val);
    },150);
  });

  // renderFilters() binds per-button listeners — call once only.
  renderFilters();
  renderTokenGrid('All','');
  renderFinalRoster();

  // ── Candidate marquee ──
  function populateMarquee(){
    var track = document.getElementById('chainMarqueeTrack');
    if(!track) return;
    // Duplicate the list so the -50% translate produces a seamless loop.
    var full = TOKENS.concat(TOKENS);
    var frag = document.createDocumentFragment();
    for(var i = 0; i < full.length; i++){
      var t = full[i];
      var img = document.createElement('img');
      img.src = 'logos/' + t.l + '.webp';
      img.alt = t.s;
      img.title = t.s;
      img.loading = i < 24 ? 'eager' : 'lazy';
      img.width = 44;
      img.height = 44;
      frag.appendChild(img);
    }
    track.appendChild(frag);
  }
  populateMarquee();

  // ── Ballot selection + submission ──
  function selectedSymbols(){ return Object.keys(SELECTED); }

  function flashLimitHint(){
    var $c = document.getElementById('selectionCount');
    if(!$c) return;
    $c.textContent = 'Maximum '+MAX_SELECT+' selected';
    $c.classList.add('limit');
    setTimeout(function(){ $c.classList.remove('limit'); updateSelectionUI(); }, 1400);
  }

  function updateSelectionUI(){
    var n = selectedSymbols().length;
    var $c = document.getElementById('selectionCount');
    var $b = document.getElementById('submitBallotBtn');
    if($c && !$c.classList.contains('limit')) $c.textContent = n+' of '+MAX_SELECT+' selected';
    if($b) $b.disabled = SUBMITTING || HAS_VOTED || n < 1 || n > MAX_SELECT;
  }

  function toggleSelect(sym, card){
    if(SELECTED[sym]){
      delete SELECTED[sym];
      if(card) card.classList.remove('selected');
    } else {
      if(selectedSymbols().length >= MAX_SELECT){ flashLimitHint(); return; }
      SELECTED[sym] = true;
      if(card) card.classList.add('selected');
    }
    updateSelectionUI();
  }

  function onGridClick(e){
    if(getPhase() !== 'voting' || HAS_VOTED) return;
    var card = e.target && e.target.closest ? e.target.closest('.token-card') : null;
    if(!card) return;
    var sym = card.getAttribute('data-sym');
    if(sym) toggleSelect(sym, card);
  }

  function showSubmitStatus(kind, msg){
    var $s = document.getElementById('submitStatus');
    if(!$s){ console.warn('[ballot]', kind, msg); return; }
    $s.className = 'ballot-status ' + kind;
    $s.textContent = msg;
  }

  function submitErrorMessage(code){
    switch(code){
      case 'cooldown':         return 'Please wait about a minute between ballots from the same connection, then try again.';
      case 'turnstile_failed': return 'Verification failed. Please try submitting again.';
      case 'vote_closed':      return 'Voting has closed.';
      case 'invalid_ballot':   return 'Your selection was invalid — pick between 1 and 64 tokens.';
      case 'too_large':        return 'Your ballot was too large. Reduce your selection and try again.';
      default:                 return 'Something went wrong. Please try submitting again.';
    }
  }

  function resetTurnstile(){
    try{ if(window.turnstile && window.turnstile.reset) window.turnstile.reset(); }catch(_){}
    TURNSTILE_TOKEN = null;
  }

  function renderVotedState(){
    var $box = document.getElementById('ballotSubmit');
    if(!$box) return;
    while($box.firstChild) $box.removeChild($box.firstChild);
    var wrap = document.createElement('div');
    wrap.className = 'ballot-voted';
    var title = document.createElement('div');
    title.className = 'ballot-voted-title';
    title.textContent = 'Ballot submitted ✓';
    var msg = document.createElement('div');
    msg.className = 'ballot-voted-msg';
    msg.textContent = 'Thanks for voting. The live tally below updates every 90 seconds. '
      + 'The grid and tally stay visible.';
    wrap.appendChild(title);
    wrap.appendChild(msg);
    $box.appendChild(wrap);
  }

  function submitBallot(){
    if(SUBMITTING || HAS_VOTED) return;
    var picks = selectedSymbols();
    if(picks.length < 1 || picks.length > MAX_SELECT) return;
    if(!isCollectorConfigured()){ showSubmitStatus('error', 'Voting is not open yet.'); return; }
    if(!TURNSTILE_TOKEN){
      showSubmitStatus('error', 'Verification not ready — wait a moment, then submit again.');
      resetTurnstile();
      return;
    }
    SUBMITTING = true;
    updateSelectionUI();
    showSubmitStatus('pending', 'Submitting your ballot...');
    fetch(collectorBase()+'/vote', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ picks: picks, turnstileToken: TURNSTILE_TOKEN })
    })
      .then(function(r){ return r.json().catch(function(){ return {ok:false,error:'bad_response'}; }); })
      .then(function(data){
        SUBMITTING = false;
        if(data && data.ok){
          HAS_VOTED = true;
          // Device marker — best-effort only; the collector is authoritative.
          try{ localStorage.setItem(VOTED_KEY, String(Date.now())); }catch(_){}
          // Optimistic: floor the headline total so it doesn't dip while the cron fold catches up.
          OPTIMISTIC_MIN = LIVE_TOTAL_VOTES + picks.length;
          LIVE_TOTAL_VOTES = OPTIMISTIC_MIN;
          if($voterCount)  $voterCount.textContent  = LIVE_TOTAL_VOTES.toLocaleString();
          if($totalVoters) $totalVoters.textContent = LIVE_TOTAL_VOTES.toLocaleString();
          renderVotedState();
          fetchTally();
        } else {
          showSubmitStatus('error', submitErrorMessage(data && data.error));
          resetTurnstile();
          updateSelectionUI();
        }
      })
      .catch(function(){
        SUBMITTING = false;
        showSubmitStatus('error', 'Network error — your ballot was not recorded. Please try again.');
        resetTurnstile();
        updateSelectionUI();
      });
  }

  // Turnstile invokes these by name from the widget's data-* attributes.
  window.punziTurnstileOk      = function(token){ TURNSTILE_TOKEN = token; };
  window.punziTurnstileErr     = function(){ TURNSTILE_TOKEN = null; };
  window.punziTurnstileExpired = function(){ TURNSTILE_TOKEN = null; };

  // ── Init ──
  try{ if(localStorage.getItem(VOTED_KEY)) HAS_VOTED = true; }catch(_){}
  updatePhaseUI();
  tick();
  animateCurves();

  // Ballot selection uses event delegation (the grid re-renders often).
  var $gridEl = document.getElementById('tokenGrid');
  if($gridEl) $gridEl.addEventListener('click', onGridClick);
  var $submitBtn = document.getElementById('submitBallotBtn');
  if($submitBtn) $submitBtn.addEventListener('click', submitBallot);
  if(HAS_VOTED) renderVotedState(); else updateSelectionUI();

  // Grid collapse toggle.
  var $gridToggle = document.getElementById('tokenGridToggle');
  if($gridToggle){
    $gridToggle.addEventListener('click', function(){
      var grid = document.getElementById('tokenGrid');
      if(!grid) return;
      grid.classList.toggle('collapsed');
      updateGridToggle();
    });
  }
  // Final-64 roster collapse toggle.
  if($finalRosterToggle && $finalRoster){
    $finalRosterToggle.addEventListener('click', function(){
      var collapsed = $finalRoster.classList.toggle('collapsed');
      $finalRosterToggle.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  // Re-evaluate the toggle on viewport changes (mobile/desktop threshold differs).
  if(window.matchMedia){
    var mq = window.matchMedia('(max-width:767px)');
    if(mq.addEventListener) mq.addEventListener('change', updateGridToggle);
    else if(mq.addListener) mq.addListener(updateGridToggle);
  }

  // Phase supervisor: start/stop polling across voting → reveal → live.
  function supervisePolling(){
    var phase = getPhase();
    if(phase === 'voting' && LIVE_STATE !== 'closed'){
      startPolling();
      return;
    }
    stopPolling();
    if(phase === 'reveal' && isCollectorConfigured() && !REVEAL_POLL_DONE){
      startRevealPolling();
    } else {
      stopRevealPolling();
    }
  }
  supervisePolling();
  setInterval(function(){
    updatePhaseUI();
    supervisePolling();
    renderTicker(); // also trims stale ticker entries periodically
  }, 60000);
})();
