function loadSettings() {
    if (settingsState.loading || !document.getElementById('settingsForm')) return Promise.resolve();
    settingsState.loading = true;
    return api('Configuration').then(function (cfg) {
        return api('Translations?lang=' + settingsLanguage()).then(function (strings) {
            settingsState.translations = strings;
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
    }).finally(function () { settingsState.loading = false; });
}

var configPage = document.getElementById('WatchbackConfigPage');
if (configPage) configPage.addEventListener('viewshow', loadSettings);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadSettings, {once: true});
else void loadSettings();
