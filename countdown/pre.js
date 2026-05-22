(function () {
  'use strict';
  /* pre.html auto-flip: at vote-open, redirects to the live vote. */
  var VOTE_OPEN_TIME = 1779418800000;  /* Fri May 22 2026 03:00 UTC — kept in sync by bake_pins.sh */

  function checkFlip() {
    if (Date.now() >= VOTE_OPEN_TIME) {
      window.location.replace('./');
      return true;
    }
    return false;
  }

  if (!checkFlip()) {
    var t = setInterval(function () { if (checkFlip()) clearInterval(t); }, 1000);
  }
})();
