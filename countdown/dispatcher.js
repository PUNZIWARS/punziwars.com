/* Time-gated dispatcher. Before vote-open, redirects to pre.html.
   localhost only: ?review=1 bypasses the gate; ignored on production hosts. */
(function () {
  var VOTE_OPEN_TIME = 1779418800000;  // Fri May 22 2026 03:00 UTC
  var host = location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  var bypassActive = isLocal && location.search.indexOf('review=1') !== -1;
  if (Date.now() < VOTE_OPEN_TIME && !bypassActive) window.location.replace('./pre.html');
})();
