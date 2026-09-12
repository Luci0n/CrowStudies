(function () {
  'use strict';
  try {
    var theme = localStorage.getItem('crowstudies:theme');
    if (['gruvbox-light','gruvbox-dark','monokai-light','monokai-dark','runner-light','runner-dark'].indexOf(theme) >= 0) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  } catch (error) {}
}());

(function () {
  'use strict';
  if (window.CrowTopography || document.querySelector('script[data-crow-topography]')) return;
  var script = document.createElement('script');
  script.defer = true;
  script.dataset.crowTopography = 'true';
  script.src = document.currentScript && document.currentScript.src
    ? new URL('topography.js?v=topography-20260912p', document.currentScript.src).href
    : 'assets/topography.js?v=topography-20260912p';
  document.head.appendChild(script);
}());

(function () {
  'use strict';
  if (document.querySelector('link[data-crow-topography-style]')) return;
  var source = document.currentScript && document.currentScript.src;
  var style = document.createElement('link');
  style.rel = 'stylesheet';
  style.dataset.crowTopographyStyle = 'true';
  style.href = source ? new URL('site.css?v=topography-20260912p', source).href : 'assets/site.css?v=topography-20260912p';
  document.head.appendChild(style);
}());

(function () {
  'use strict';
  function initials(value) {
    return String(value || '?').trim().split(/\s+/).slice(0, 2).map(function (part) {
      return part.charAt(0);
    }).join('').toUpperCase();
  }
  try {
    var raw = sessionStorage.getItem('crowstudies:auth-hint');
    var account = raw ? JSON.parse(raw) : null;
    if (!account) return;
    document.querySelectorAll('[data-firebase-auth]').forEach(function (button) {
      var name = account.username || account.displayName || account.email || '?';
      button.disabled = false;
      button.classList.remove('auth-pending');
      button.classList.add('signed-in');
      button.textContent = initials(name);
      button.title = 'Open account menu for ' + name;
      button.setAttribute('aria-label', 'Open account menu for ' + name);
      if (account.avatarUrl) {
        button.classList.add('has-avatar');
        button.style.backgroundImage = 'url("' + String(account.avatarUrl).replace(/"/g, '') + '")';
      }
    });
  } catch (error) {}
}());
