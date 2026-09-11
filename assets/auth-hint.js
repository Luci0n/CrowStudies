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
