'use strict';

(function () {
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      switch (ch) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return '&#39;';
      }
    });
  }

  function buildAvatarHtml(user) {
    if (user.avatar) {
      var url = 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=64';
      return '<img src="' + encodeURI(url) + '" alt="' + escapeHtml(user.username || '') + '" />';
    }
    var letter = ((user.username || '?').charAt(0)).toUpperCase();
    return '<span class="user-avatar-letter">' + escapeHtml(letter) + '</span>';
  }

  function renderLoggedIn(user) {
    var brand = document.getElementById('brand');
    var auth = document.getElementById('auth-area');
    if (!brand || !auth) return;

    brand.innerHTML =
      '<span class="user-avatar">' + buildAvatarHtml(user) + '</span>' +
      '<span class="user-name">' + escapeHtml(user.username || '') + '</span>';

    auth.innerHTML = '<a class="btn btn-secondary btn-sm" href="/auth/logout">Logout</a>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    fetch('/api/user', { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.loggedIn && data.user) {
          renderLoggedIn(data.user);
        }
        // Otherwise keep the default logo + "Login with Discord" button.
      })
      .catch(function () {
        // Network error / not authenticated — leave the default UI in place.
      });
  });
})();
