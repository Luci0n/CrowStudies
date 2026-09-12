(function () {
  'use strict';
  try {
    var theme = localStorage.getItem('crowstudies:theme');
    var allowed = ['gruvbox-light','gruvbox-dark','monokai-light','monokai-dark','runner-light','runner-dark'];
    if (allowed.indexOf(theme) >= 0) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  } catch (error) {}
}());
