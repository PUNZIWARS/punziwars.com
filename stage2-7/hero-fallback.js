// Hero-image error-fallback handlers, attached via addEventListener so CSP can omit
// 'unsafe-inline'. Loaded by pre.html and index.html; no-ops on whichever img is absent.
(function () {
    // pre.html: hide img + show the SVG placeholder sibling.
    var preHero = document.getElementById('preHeroImg');
    if (preHero) {
        var preHeroFallback = function () {
            preHero.style.display = 'none';
            if (preHero.nextElementSibling) {
                preHero.nextElementSibling.style.display = 'flex';
            }
        };
        preHero.addEventListener('error', preHeroFallback);
        // Image may have already failed before the listener attached.
        if (preHero.complete && preHero.naturalWidth === 0) {
            preHeroFallback();
        }
    }

    // index.html: one-shot swap to alternate raccoon image; listener is removed
    // inside the handler to avoid an infinite loop if the fallback also 404s.
    var heroImg = document.getElementById('heroImg');
    if (heroImg) {
        var heroImgFallback = function () {
            heroImg.removeEventListener('error', heroImgFallback);
            heroImg.src = 'raccoon/punzi-the-contenders.jpg';
        };
        heroImg.addEventListener('error', heroImgFallback);
        if (heroImg.complete && heroImg.naturalWidth === 0) {
            heroImgFallback();
        }
    }
})();
