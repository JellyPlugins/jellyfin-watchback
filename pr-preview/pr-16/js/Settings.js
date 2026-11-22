function renderSettings(cfg) {
    var form = document.getElementById('settingsForm');
    if (!form) return;
    var h = '<div class="settings-card">';
        h += '<div class="checkbox-row"><input type="checkbox" id="cfgYearlyRewindEnabled"' + (cfg.YearlyRewindEnabled ? ' checked' : '') + '><label for="cfgYearlyRewindEnabled">' + escHtml(T('rewind.enable', 'Enable personal yearly rewinds')) + '</label></div>';
        h += '<div class="help-text">' + escHtml(T('rewind.settingsHelp', 'Uses recorded activity and available Jellyfin data. One rewind per user is created at 00:00 server time on the start date. The page is hidden after the end date; the rewind is kept.')) + '</div>';
        h += '<fieldset id="cfgRewindDates" class="settings-rewind-dates"' + (cfg.YearlyRewindEnabled ? '' : ' disabled') + '>';
        [['Start', cfg.YearlyRewindStartDate || '12-15'], ['End', cfg.YearlyRewindEndDate || '01-15']].forEach(function (entry) {
            var parts = entry[1].split('-');
            var label = entry[0] === 'Start' ? T('rewind.startDate', 'Start date') : T('rewind.endDate', 'End date');
            h += '<fieldset class="settings-rewind-date"><legend>' + escHtml(label) + '</legend><div class="settings-rewind-parts">';
            h += '<div><label for="cfgRewind' + entry[0] + 'Day">' + escHtml(T('rewind.day', 'Day')) + '</label> <input type="number" min="1" max="31" required id="cfgRewind' + entry[0] + 'Day" aria-describedby="cfgRewind' + entry[0] + 'Error" value="' + escAttr(parts[1]) + '"></div>';
            h += '<div><label for="cfgRewind' + entry[0] + 'Month">' + escHtml(T('rewind.month', 'Month')) + '</label> <input type="number" min="1" max="12" required id="cfgRewind' + entry[0] + 'Month" aria-describedby="cfgRewind' + entry[0] + 'Error" value="' + escAttr(parts[0]) + '"></div></div><p id="cfgRewind' + entry[0] + 'Error" class="help-text settings-rewind-error" role="alert" hidden></p></fieldset>';
        });
        h += '</fieldset>';

    h += '</div>';
    h += '<p id="settingsMsg" role="status" aria-live="polite" hidden></p>';
    h += '<div class="settings-save-band" id="settingsSaveBand" aria-hidden="true"><button type="button" class="action-btn" id="btnSaveSettings">' + escHtml(T('saveSettings', 'Save settings')) + '</button></div>';
    form.innerHTML = h;
    settingsState.snapshot = JSON.stringify(buildSettingsPayload());
    form.oninput = updateSettingsState;
    form.onchange = updateSettingsState;
    form.onsubmit = function (event) { event.preventDefault(); void saveSettings(); };
    document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
}

function buildSettingsPayload() {
    return {
        YearlyRewindEnabled: !!document.getElementById('cfgYearlyRewindEnabled')?.checked,
        YearlyRewindStartDate: rewindFormDate('Start'),
        YearlyRewindEndDate: rewindFormDate('End')
    };
}

function updateSettingsState() {
    var toggle = document.getElementById('cfgYearlyRewindEnabled');
    if (!toggle) return;
    var enabled = toggle.checked;
    document.getElementById('cfgRewindDates').disabled = !enabled;
    validateRewindDates(buildSettingsPayload());
    var dirty = JSON.stringify(buildSettingsPayload()) !== settingsState.snapshot;
    var band = document.getElementById('settingsSaveBand');
    band.classList.toggle('is-visible', dirty);
    band.setAttribute('aria-hidden', String(!dirty));
    document.getElementById('btnSaveSettings').disabled = settingsState.saving;
}

function saveSettings() {
    if (settingsState.saving) return Promise.resolve();
    var payload = buildSettingsPayload();
    if (validateRewindDates(payload, true)) return Promise.resolve();
    var submitted = JSON.stringify(payload);
    var message = document.getElementById('settingsMsg');
    settingsState.saving = true;
    document.getElementById('btnSaveSettings').disabled = true;
    message.textContent = T('savingSettings', 'Saving settings…');
    message.hidden = false;
    return api('Configuration', 'PUT', payload).then(function () {
        settingsState.snapshot = submitted;
        message.textContent = '';
        message.hidden = true;
    }).catch(function () {
        message.textContent = T('settingsError', 'Could not save settings. Try again.');
        message.hidden = false;
    }).finally(function () {
        settingsState.saving = false;
        updateSettingsState();
    });
}

function rewindFormDate(prefix) {
    // Disabled controls must not block opting out or overwrite the stored dates.
    if (document.getElementById('cfgYearlyRewindEnabled')?.checked === false) return null;
    var day = document.getElementById('cfgRewind' + prefix + 'Day');
    var month = document.getElementById('cfgRewind' + prefix + 'Month');
    if (!day || !month) return null;
    return month.value.padStart(2, '0') + '-' + day.value.padStart(2, '0');
}

function rewindDateIssue(value) {
    var parts = /^([^-]*)-(.*)$/.exec(value);
    if (parts) {
        var month = Number(parts[1]), day = Number(parts[2]);
        if (!/^\d{2}$/.test(parts[1]) || month < 1 || month > 12) {
            return { message: T('rewind.invalidMonth', 'Enter a whole-number month from 1 to 12.'), fields: ['Month'] };
        }
        if (!/^\d{2}$/.test(parts[2]) || day < 1 || day > 31) {
            return { message: T('rewind.invalidDay', 'Enter a whole-number day from 1 to 31.'), fields: ['Day'] };
        }
        var date = new Date(Date.UTC(2001, month - 1, day));
        if (date.getUTCMonth() + 1 === month && date.getUTCDate() === day) return null;
    }
    return { message: T('rewind.invalidDate', 'Enter a valid date for the selected month. February 29 is not supported.'), fields: ['Day', 'Month'] };
}

function validateRewindDates(payload, focusInvalid) {
    var firstMessage = null;
    var firstInvalid = null;
    ['Start', 'End'].forEach(function (prefix) {
        var value = payload['YearlyRewind' + prefix + 'Date'];
        var issue = value == null ? null : rewindDateIssue(value);
        var error = document.getElementById('cfgRewind' + prefix + 'Error');
        if (error) {
            var message = issue?.message || '';
            if (error.textContent !== message) error.textContent = message;
            error.hidden = !issue;
        }
        ['Day', 'Month'].forEach(function (part) {
            var field = document.getElementById('cfgRewind' + prefix + part);
            if (!field) return;
            var invalid = !!issue && issue.fields.includes(part);
            if (invalid) {
                field.setAttribute('aria-invalid', 'true');
                if (!firstInvalid && !field.disabled) firstInvalid = field;
            } else field.removeAttribute('aria-invalid');
            field.setCustomValidity(invalid ? issue.message : '');
        });
        if (issue && !firstMessage) firstMessage = issue.message;
    });
    if (focusInvalid && firstInvalid) {
        firstInvalid.focus();
    }
    return firstMessage;
}
