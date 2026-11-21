function loadSettings() {
    if (_watchbackLoading || !document.getElementById('settingsForm')) return Promise.resolve();
    _watchbackLoading = true;
    return api('Configuration').then(function (cfg) {
        return api('Translations?lang=' + settingsLanguage()).then(function (strings) {
            _translations = strings;
            renderSettings(cfg);
        });
    }).catch(function () {
        var form = document.getElementById('settingsForm');
        form.textContent = T('rewind.error', 'Could not load settings.');
        var retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = T('rewind.retry', 'Try again');
        retry.addEventListener('click', loadSettings);
        form.appendChild(retry);
    }).finally(function () { _watchbackLoading = false; });
}

var configPage = document.getElementById('WatchbackConfigPage');
if (configPage) configPage.addEventListener('viewshow', loadSettings);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadSettings, {once: true});
else loadSettings();
