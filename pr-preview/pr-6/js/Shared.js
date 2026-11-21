var _translations = {};
var _watchbackSnapshot = '';
var _watchbackLoading = false;
var _watchbackSaving = false;

function settingsLanguage() {
    // Jellyfin updates the document language from the active user's display preference.
    var selected = (document.documentElement.lang || navigator.language || 'en').split(/[-_]/)[0].toLowerCase();
    return ['en', 'de', 'fr', 'es', 'pt', 'zh', 'tr', 'sv'].includes(selected) ? selected : 'en';
}

function T(key, fallback) {
    return Object.hasOwn(_translations, key) ? _translations[key] : (fallback || key);
}

function escHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function escAttr(value) { return escHtml(value); }

function api(path, method, data) {
    var options = {url: ApiClient.getUrl('Watchback/' + path), type: method || 'GET', dataType: 'json'};
    if (data !== undefined) {
        options.data = JSON.stringify(data);
        options.contentType = 'application/json';
    }
    return Promise.resolve(ApiClient.ajax(options));
}
