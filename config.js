/* KAMERA OPTOM QARSHI — backend (API) manzili.
 *
 * Lokal serverda (localhost:3000) sahifalar va API bitta joyda — manzil bo'sh qoladi.
 * github.io'da sahifalar statik, API esa alohida serverda (Heroku) ishlaydi:
 * KO_API_HOSTED ga Heroku ilovasining manzilini yozing, masalan
 *   'https://kamera-optom-qarshi-1a2b3c.herokuapp.com'
 */
window.KO_API_HOSTED = 'https://kamera-optom-qarshi-129c3b4fde7e.herokuapp.com';

(function () {
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
  var API = local ? '' : String(window.KO_API_HOSTED || '').replace(/\/+$/, '');
  window.KO_API = API;
  if (!API || !window.fetch) return;

  // '/api/...' va '/assets/...' so'rovlari API serverga yuboriladi. Javobdagi "/assets/..."
  // rasm yo'llari to'liq manzilga, yuborilayotgan ma'lumotda esa qayta nisbiy yo'lga aylantiriladi
  // (bazada doim "/assets/..." saqlanadi).
  var ABS = API + '/assets/';
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (url, opt) {
    if (typeof url !== 'string' || !/^\/(api|assets)\//.test(url)) return nativeFetch(url, opt);
    if (opt && typeof opt.body === 'string') opt = Object.assign({}, opt, { body: opt.body.split(ABS).join('/assets/') });
    return nativeFetch(API + url, opt).then(function (r) {
      var type = r.headers.get('content-type') || '';
      if (type.indexOf('application/json') < 0) return r;
      return r.text().then(function (t) {
        return new Response(t.split('"/assets/').join('"' + ABS), { status: r.status, statusText: r.statusText, headers: r.headers });
      });
    });
  };
})();
