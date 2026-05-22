/* Pre-populate "Days Remaining" synchronously so visitors on slow connections never see an em-dash. */
(function(){
  var t = new Date('2026-07-06T03:00:00Z').getTime();
  var d = Math.max(0, Math.ceil((t - Date.now()) / 86400000));
  var el = document.getElementById('daysLeft');
  if(el) el.textContent = d;
})();
