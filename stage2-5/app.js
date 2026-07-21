(function(){
  'use strict';

  // (Interim holding page — countdown & reveal logic removed; visuals only.)

  // Animated curve background — cycles through all 8 bonding curves.
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

  function buildCurvePath(fn) {
    var w = 800, h = 400;
    var pts = [];
    var steps = 120;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var yNorm = fn(t);
      if (yNorm < 0) yNorm = 0;
      if (yNorm > 1) yNorm = 1;
      var x = 40 + t * (w - 80);
      var y = (h - 40) - yNorm * (h - 80);
      pts.push((i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1));
    }
    return pts.join(' ');
  }

  function animateCurves() {
    var path = document.getElementById('curvePath');
    var label = document.getElementById('curveLabel');
    if (!path || !label) return;

    var idx = 0;
    var DRAW_MS = 6500;
    var HOLD_MS = 1200;
    var FADE_MS = 900;

    function drawNext() {
      var curve = curves[idx];
      path.setAttribute('d', buildCurvePath(curve.fn));
      label.textContent = curve.name;

      var length;
      try { length = path.getTotalLength(); }
      catch (e) { length = 1200; }

      // Reset dash with no transition.
      path.style.transition = 'none';
      path.style.strokeDasharray = length + ' ' + length;
      path.style.strokeDashoffset = length;
      path.style.opacity = '1';

      // Force reflow so the transition kicks in fresh.
      void path.getBoundingClientRect();

      path.style.transition =
        'stroke-dashoffset ' + DRAW_MS + 'ms cubic-bezier(0.65,0,0.35,1), ' +
        'opacity ' + FADE_MS + 'ms ease';
      path.style.strokeDashoffset = '0';
      label.classList.add('visible');

      setTimeout(function(){
        path.style.opacity = '0';
        label.classList.remove('visible');
        setTimeout(function(){
          idx = (idx + 1) % curves.length;
          drawNext();
        }, FADE_MS + 100);
      }, DRAW_MS + HOLD_MS);
    }

    drawNext();
  }

  // Candidate marquee — all 300 ballot tokens.
  var candidatesLogos = [
    { id: 'eth', sym: 'ETH' },
    { id: 'usdt', sym: 'USDT' },
    { id: 'bnb', sym: 'BNB' },
    { id: 'usdc', sym: 'USDC' },
    { id: 'steth', sym: 'stETH' },
    { id: 'wbt', sym: 'WBT' },
    { id: 'usds', sym: 'USDS' },
    { id: 'hype', sym: 'HYPE' },
    { id: 'wsteth', sym: 'wstETH' },
    { id: 'wbtc', sym: 'WBTC' },
    { id: 'link', sym: 'LINK' },
    { id: 'cbbtc', sym: 'cbBTC' },
    { id: 'ton', sym: 'TON' },
    { id: 'usd1', sym: 'USD1' },
    { id: 'weeth', sym: 'weETH' },
    { id: 'dai', sym: 'DAI' },
    { id: 'avax', sym: 'AVAX' },
    { id: 'm', sym: 'M' },
    { id: 'usde', sym: 'USDe' },
    { id: 'shib', sym: 'SHIB' },
    { id: 'rain', sym: 'RAIN' },
    { id: 'usdg', sym: 'USDG' },
    { id: 'cro', sym: 'CRO' },
    { id: 'pyusd', sym: 'PYUSD' },
    { id: 'xaut', sym: 'XAUt' },
    { id: 'uni', sym: 'UNI' },
    { id: 'dot', sym: 'DOT' },
    { id: 'mnt', sym: 'MNT' },
    { id: 'paxg', sym: 'PAXG' },
    { id: 'wlfi', sym: 'WLFI' },
    { id: 'ondo', sym: 'ONDO' },
    { id: 'okb', sym: 'OKB' },
    { id: 'sky', sym: 'SKY' },
    { id: 'htx', sym: 'HTX' },
    { id: 'icp', sym: 'ICP' },
    { id: 'pepe', sym: 'PEPE' },
    { id: 'aster', sym: 'ASTER' },
    { id: 'rlusd', sym: 'RLUSD' },
    { id: 'aave', sym: 'AAVE' },
    { id: 'usdd', sym: 'USDD' },
    { id: 'bgb', sym: 'BGB' },
    { id: 'morpho', sym: 'MORPHO' },
    { id: 'ena', sym: 'ENA' },
    { id: 'qnt', sym: 'QNT' },
    { id: 'atom', sym: 'ATOM' },
    { id: 'pol', sym: 'POL' },
    { id: 'u', sym: 'U' },
    { id: 'render', sym: 'RENDER' },
    { id: 'wld', sym: 'WLD' },
    { id: 'nexo', sym: 'NEXO' },
    { id: 'reth', sym: 'rETH' },
    { id: 'stable', sym: 'STABLE' },
    { id: 'arb', sym: 'ARB' },
    { id: 'siren', sym: 'SIREN' },
    { id: 'gt', sym: 'GT' },
    { id: 'flr', sym: 'FLR' },
    { id: 'vvv', sym: 'VVV' },
    { id: 'bonk', sym: 'BONK' },
    { id: 'usdtb', sym: 'USDTB' },
    { id: 'bdx', sym: 'BDX' },
    { id: 'b', sym: 'B' },
    { id: 'dexe', sym: 'DEXE' },
    { id: 'pengu', sym: 'PENGU' },
    { id: 'trump', sym: 'TRUMP' },
    { id: 'skyai', sym: 'SKYAI' },
    { id: 'gho', sym: 'GHO' },
    { id: 'virtual', sym: 'VIRTUAL' },
    { id: 'fet', sym: 'FET' },
    { id: 'cake', sym: 'Cake' },
    { id: 'inj', sym: 'INJ' },
    { id: 'tusd', sym: 'TUSD' },
    { id: 'sei', sym: 'SEI' },
    { id: 'aero', sym: 'AERO' },
    { id: 'chz', sym: 'CHZ' },
    { id: 'bill', sym: 'BILL' },
    { id: 'eurc', sym: 'EURC' },
    { id: 'edge', sym: 'EDGE' },
    { id: 'kite', sym: 'KITE' },
    { id: 'h', sym: 'H' },
    { id: 'crv', sym: 'CRV' },
    { id: 'spx', sym: 'SPX' },
    { id: 'ub', sym: 'UB' },
    { id: '币安人生', sym: '币安人生' },
    { id: 'tbtc', sym: 'tBTC' },
    { id: 'fdusd', sym: 'FDUSD' },
    { id: 'apxusd', sym: 'APXUSD' },
    { id: 'ethfi', sym: 'ETHFI' },
    { id: 'lab', sym: 'LAB' },
    { id: 'zro', sym: 'ZRO' },
    { id: 'monad', sym: 'MON' },
    { id: 'pendle', sym: 'PENDLE' },
    { id: 'jasmy', sym: 'JASMY' },
    { id: 'based', sym: 'BASED' },
    { id: 'ldo', sym: 'LDO' },
    { id: 'gno', sym: 'GNO' },
    { id: 'op', sym: 'OP' },
    { id: 'btt', sym: 'BTT' },
    { id: 'pyth', sym: 'PYTH' },
    { id: 'grt', sym: 'GRT' },
    { id: 'strk', sym: 'STRK' },
    { id: 'ens', sym: 'ENS' },
    { id: 'syrup', sym: 'SYRUP' },
    { id: 'kaia', sym: 'KAIA' },
    { id: 'frax', sym: 'FRAX' },
    { id: 'tel', sym: 'TEL' },
    { id: 'apepe', sym: 'APEPE' },
    { id: 'usdai', sym: 'USDAI' },
    { id: 'gwei', sym: 'GWEI' },
    { id: 'real', sym: 'REAL' },
    { id: 'rusd', sym: 'RUSD' },
    { id: 'xpl', sym: 'XPL' },
    { id: 'crvusd', sym: 'crvUSD' },
    { id: 'fartcoin', sym: 'FARTCOIN' },
    { id: 'lit', sym: 'LIT' },
    { id: 'axs', sym: 'AXS' },
    { id: 'comp', sym: 'COMP' },
    { id: 'twt', sym: 'TWT' },
    { id: 'sand', sym: 'SAND' },
    { id: 'pieverse', sym: 'PIEVERSE' },
    { id: 'xcn', sym: 'XCN' },
    { id: 'sonic', sym: 'S' },
    { id: 'mana', sym: 'MANA' },
    { id: 'zk', sym: 'ZK' },
    { id: 'genius', sym: 'GENIUS' },
    { id: 'gala', sym: 'GALA' },
    { id: 'vsn', sym: 'VSN' },
    { id: 'cvx', sym: 'CVX' },
    { id: 'ff', sym: 'FF' },
    { id: 'wfi', sym: 'WFI' },
    { id: 'eigen', sym: 'EIGEN' },
    { id: 'cfg', sym: 'CFG' },
    { id: 'btse', sym: 'BTSE' },
    { id: 'reusd', sym: 'REUSD' },
    { id: 'bat', sym: 'BAT' },
    { id: 'sfp', sym: 'SFP' },
    { id: 'mx', sym: 'MX' },
    { id: 'imx', sym: 'IMX' },
    { id: 'ape', sym: 'APE' },
    { id: 'tag', sym: 'TAG' },
    { id: 'trac', sym: 'TRAC' },
    { id: 'usat', sym: 'USAT' },
    { id: 'nusd', sym: 'NUSD' },
    { id: 'glm', sym: 'GLM' },
    { id: 'ath', sym: 'ATH' },
    { id: 'ab', sym: 'AB' },
    { id: 'bananas31', sym: 'BANANAS31' },
    { id: '1inch', sym: '1INCH' },
    { id: 'sahara', sym: 'SAHARA' },
    { id: 'frxusd', sym: 'FRXUSD' },
    { id: 'ausd', sym: 'AUSD' },
    { id: 'fluid', sym: 'FLUID' },
    { id: 'chip', sym: 'CHIP' },
    { id: 'cheems', sym: 'CHEEMS' },
    { id: 'irys', sym: 'IRYS' },
    { id: 'eurcv', sym: 'EURCV' },
    { id: 'rsr', sym: 'RSR' },
    { id: 'mega', sym: 'MEGA' },
    { id: 'sent', sym: 'SENT' },
    { id: 'tibbir', sym: 'TIBBIR' },
    { id: 'zen', sym: 'ZEN' },
    { id: 'gomining', sym: 'GOMINING' },
    { id: 'snx', sym: 'SNX' },
    { id: 'asteroid', sym: 'ASTEROID' },
    { id: '0g', sym: '0G' },
    { id: 'soso', sym: 'SOSO' },
    { id: 'safe', sym: 'SAFE' },
    { id: 'lpt', sym: 'LPT' },
    { id: 'kmno', sym: 'KMNO' },
    { id: 'bsb', sym: 'BSB' },
    { id: 'gas', sym: 'GAS' },
    { id: 'bmx', sym: 'BMX' },
    { id: 'kaito', sym: 'KAITO' },
    { id: 'qtum', sym: 'QTUM' },
    { id: 'awe', sym: 'AWE' },
    { id: 'zrx', sym: 'ZRX' },
    { id: 'form', sym: 'FORM' },
    { id: 'bera', sym: 'BERA' },
    { id: 'pros', sym: 'PROS' },
    { id: 'cow', sym: 'COW' },
    { id: 'beam', sym: 'BEAM' },
    { id: 'ksm', sym: 'KSM' },
    { id: 'brett', sym: 'BRETT' },
    { id: 'bio', sym: 'BIO' },
    { id: 'rvn', sym: 'RVN' },
    { id: 'ordi', sym: 'ORDI' },
    { id: 'yfi', sym: 'YFI' },
    { id: 'linea', sym: 'LINEA' },
    { id: 'deep', sym: 'DEEP' },
    { id: 'turbo', sym: 'TURBO' },
    { id: 'enj', sym: 'ENJ' },
    { id: 'kta', sym: 'KTA' },
    { id: 'aioz', sym: 'AIOZ' },
    { id: 'spk', sym: 'SPK' },
    { id: 'icnt', sym: 'ICNT' },
    { id: 'w', sym: 'W' },
    { id: 'tria', sym: 'TRIA' },
    { id: 'usdat', sym: 'USDAT' },
    { id: 'arkm', sym: 'ARKM' },
    { id: 'esports', sym: 'ESPORTS' },
    { id: 'nxpc', sym: 'NXPC' },
    { id: 'tfuel', sym: 'TFUEL' },
    { id: 'bard', sym: 'BARD' },
    { id: 'grx', sym: 'GRX' },
    { id: 'ctc', sym: 'CTC' },
    { id: 'zeta', sym: 'ZETA' },
    { id: 'mina', sym: 'MINA' },
    { id: 'usda', sym: 'USDA' },
    { id: 'dog', sym: 'DOG' },
    { id: 'rose', sym: 'ROSE' },
    { id: 'zil', sym: 'ZIL' },
    { id: 'super', sym: 'SUPER' },
    { id: 'babydoge', sym: 'BABYDOGE' },
    { id: 'ron', sym: 'RON' },
    { id: 'qubic', sym: 'QUBIC' },
    { id: 'axl', sym: 'AXL' },
    { id: 'tac', sym: 'TAC' },
    { id: 'toshi', sym: 'TOSHI' },
    { id: 'ckb', sym: 'CKB' },
    { id: 'mbg', sym: 'MBG' },
    { id: 'fogo', sym: 'FOGO' },
    { id: 'astr', sym: 'ASTR' },
    { id: 'xpr', sym: 'XPR' },
    { id: 'hot', sym: 'HOT' },
    { id: 'amp', sym: 'AMP' },
    { id: 'useless', sym: 'USELESS' },
    { id: 'plume', sym: 'PLUME' },
    { id: 'aztec', sym: 'AZTEC' },
    { id: 'move', sym: 'MOVE' },
    { id: 'blur', sym: 'BLUR' },
    { id: 'gmx', sym: 'GMX' },
    { id: 'rif', sym: 'RIF' },
    { id: 'dusk', sym: 'DUSK' },
    { id: 'dgb', sym: 'DGB' },
    { id: 'kava', sym: 'KAVA' },
    { id: 'velo', sym: 'VELO' },
    { id: 'coai', sym: 'COAI' },
    { id: 'polyx', sym: 'POLYX' },
    { id: 't', sym: 'T' },
    { id: 'cys', sym: 'CYS' },
    { id: 'baby', sym: 'BABY' },
    { id: 'flow', sym: 'FLOW' },
    { id: 'popcat', sym: 'POPCAT' },
    { id: 'sushi', sym: 'SUSHI' },
    { id: 'naoris', sym: 'NAORIS' },
    { id: 'kaio', sym: 'KAIO' },
    { id: 'sn120', sym: 'SN120' },
    { id: 'mog', sym: 'MOG' },
    { id: 'moca', sym: 'MOCA' },
    { id: 'npc', sym: 'NPC' },
    { id: 'nmr', sym: 'NMR' },
    { id: 'home', sym: 'HOME' },
    { id: 'uai', sym: 'UAI' },
    { id: 'zama', sym: 'ZAMA' },
    { id: 'jupusd', sym: 'JUPUSD' },
    { id: 'vtho', sym: 'VTHO' },
    { id: 'euri', sym: 'EURI' },
    { id: 'celo', sym: 'CELO' },
    { id: 'opg', sym: 'OPG' },
    { id: 'rez', sym: 'REZ' },
    { id: 'trb', sym: 'TRB' },
    { id: 'red', sym: 'RED' },
    { id: 'xyo', sym: 'XYO' },
    { id: 'api3', sym: 'API3' },
    { id: 'wmtx', sym: 'WMTX' },
    { id: 'fxusd', sym: 'FXUSD' },
    { id: 'xusd', sym: 'XUSD' },
    { id: 'mask', sym: 'MASK' },
    { id: 'ankr', sym: 'ANKR' },
    { id: 'fidd', sym: 'FIDD' },
    { id: 'avnt', sym: 'AVNT' },
    { id: 'robo', sym: 'ROBO' },
    { id: 'myx', sym: 'MYX' },
    { id: 'merl', sym: 'MERL' },
    { id: 'neiro', sym: 'NEIRO' },
    { id: 'edu', sym: 'EDU' },
    { id: 'zbt', sym: 'ZBT' },
    { id: 'huma', sym: 'HUMA' },
    { id: 'esp', sym: 'ESP' },
    { id: 'wojak', sym: 'WOJAK' },
    { id: 'manta', sym: 'MANTA' },
    { id: 'hyper', sym: 'HYPER' },
    { id: 'cyber', sym: 'CYBER' },
    { id: 'brev', sym: 'BREV' },
    { id: 'gps', sym: 'GPS' },
    { id: 'ygg', sym: 'YGG' },
    { id: 'aixbt', sym: 'AIXBT' },
    { id: 'pha', sym: 'PHA' },
    { id: 'blast', sym: 'BLAST' },
    { id: 'sign', sym: 'SIGN' },
    { id: 'ctsi', sym: 'CTSI' },
    { id: 'btw', sym: 'BTW' },
    { id: 'movr', sym: 'MOVR' },
    { id: 'sapien', sym: 'SAPIEN' },
    { id: 'collect', sym: 'COLLECT' },
    { id: 'audio', sym: 'AUDIO' },
    { id: 'soph', sym: 'SOPH' },
    { id: 'honey', sym: 'HONEY' },
    { id: 'taiko', sym: 'TAIKO' },
    { id: 'aurora', sym: 'AURORA' },
    { id: 'glmr', sym: 'GLMR' }
  ];

  function populateMarquee() {
    var track = document.getElementById('chainMarqueeTrack');
    if (!track) return;
    // Duplicate the list so the -50% translate produces a seamless loop.
    var full = candidatesLogos.concat(candidatesLogos);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < full.length; i++) {
      var c = full[i];
      var img = document.createElement('img');
      img.src = 'logos/' + c.id + '.webp';
      img.alt = c.sym;
      img.loading = i < 24 ? 'eager' : 'lazy';
      img.width = 44;
      img.height = 44;
      frag.appendChild(img);
    }
    track.appendChild(frag);
  }

  function init() {
    populateMarquee();
    animateCurves();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
