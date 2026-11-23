(function () {
    'use strict';
    if (window.WatchbackRewind) return;
    var TAB = 'yearly-rewind';
    var generation = 0;
    var session = null;
    var timer = null;
    var registered = false;
    var panel = null;
    var report = null;
    var missingReport = false;
    var season = null;
    var reportRevision = 0;
    var strings = {};
    var locale = 'en';
    var inFlight = null;
    var disposed = false;
    var refreshing = null;
    var loadFailed = false;
    var requestedLanguage = null;
    var languageRevision = 0;

    function value(data, key) { return data?.[key] ?? data?.[key.charAt(0).toLowerCase() + key.slice(1)]; }
    function text(key) { return strings['rewind.' + key] || english[key] || key; }
    function node(tag, content, className) {
        var el = document.createElement(tag);
        if (content != null) el.textContent = content;
        if (className) el.className = className;
        return el;
    }
    function request(path) { return session.client.ajax({ type: 'GET', url: session.client.getUrl(path), dataType: 'json' }); }
    function readSession() {
        try {
            var client = typeof ApiClient === 'undefined' ? null : ApiClient;
            return client?.getCurrentUserId?.() && client.accessToken?.()
                ? { client: client, user: client.getCurrentUserId(), token: client.accessToken(), server: client.serverAddress?.() || '' } : null;
        } catch {
            // The host may replace its API client during login/navigation; treat that as signed out.
            return null;
        }
    }
    function same(a, b) { return !!a && !!b && a.client === b.client && a.user === b.user && a.token === b.token && a.server === b.server; }
    function valid(epoch) { return !disposed && epoch === generation && same(session, readSession()); }
    function clear() {
        generation++;
        if (timer) clearTimeout(timer);
        timer = null;
        refreshing = null;
        loadFailed = false;
        requestedLanguage = null;
        languageRevision++;
        strings = {};
        inFlight = null;
        report = null;
        missingReport = false;
        season = null;
        reportRevision++;
        if (panel) panel.replaceChildren();
        panel = null;
        if (registered) window.WatchbackTabs?.unregister(TAB);
        registered = false;
    }
    function reconstructedCount() {
        return value(report, 'ReconstructedItemCount') || (value(report, 'Items') || []).filter(function (item) { return value(item, 'HasReconstructedActivity'); }).length;
    }
    function recordedImportSeconds(source) {
        return value(source, 'PlaybackReportingSeconds') ?? (value(source, 'Items') || []).reduce(function (sum, item) { return sum + (value(item, 'PlaybackReportingSeconds') || 0); }, 0);
    }
    function hasUnmeasuredActivity(source) {
        return !!(value(source, 'ReconstructedItemCount') || value(source, 'PlaybackReportingPlayCount') || recordedImportSeconds(source)
            || (value(source, 'Items') || []).some(function (item) { return value(item, 'HasReconstructedActivity') || value(item, 'PlaybackReportingPlayCount'); }));
    }
    function hasMeasuredPlayback() {
        return (value(value(report, 'Insights'), 'HourlySeconds') || []).some(function (amount) { return amount > 0; });
    }
    function number(amount, digits) { return new Intl.NumberFormat(locale, { maximumFractionDigits: digits || 0 }).format(amount); }
    function date(instant, timeZone) {
        return new Intl.DateTimeFormat(locale, { timeZone: timeZone || value(report, 'TimeZoneId') || 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(instant));
    }
    function year(instant, timeZone) {
        return new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone: timeZone || 'UTC' }).format(new Date(instant));
    }
    function addStat(root, amount, label, icon) {
        var card = node('div', null, 'jfw-rewind-stat');
        var heading = node('h3');
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'currentColor');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.classList.add('jfw-rewind-stat-icon');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', statIcons[icon]);
        svg.append(path);
        heading.append(svg, node('span', label));
        card.append(heading, node('strong', amount));
        root.append(card);
    }
    function svgNode(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
    function section(root, title, className) {
        var result = node('section', null, className);
        result.append(node('h3', title)); root.append(result); return result;
    }
    function genreNames(item) {
        return Array.from(new Set((value(item, 'Genres') || []).filter(function (name) { return typeof name === 'string' && name.trim(); }).map(function (name) { return name.trim(); })));
    }
    function genreWeights(items) {
        var result = new Map();
        items.forEach(function (item) {
            var names = genreNames(item); if (!names.length) names = [''];
            names.forEach(function (name) { result.set(name, (result.get(name) || 0) + (value(item, 'ActiveSeconds') || 0)); });
        });
        return result;
    }
    function genreEntries(weights) {
        var entries = Array.from(weights.entries()).map(function (entry) { return { label: entry[0] || text('unknownGenre'), seconds: entry[1] }; })
            .filter(function (entry) { return entry.seconds > 0; }).sort(function (a, b) { return b.seconds - a.seconds || a.label.localeCompare(b.label); });
        if (entries.length > 6) entries = entries.slice(0, 5).concat([{ label: text('otherGenres'), seconds: entries.slice(5).reduce(function (sum, entry) { return sum + entry.seconds; }, 0) }]);
        return entries;
    }
    function pie(root, title, entries) {
        root.replaceChildren();
        entries = entries.filter(function (entry) { return Number.isFinite(entry.seconds) && entry.seconds > 0; });
        var total = entries.reduce(function (sum, entry) { return sum + entry.seconds; }, 0);
        if (!total || !Number.isFinite(total)) { root.append(node('p', text(reconstructedCount() && !(value(report, 'Items') || []).some(function (item) { return value(item, 'ActiveSeconds') > 0; }) ? 'noDuration' : 'empty'))); return; }
        var svg = svgNode('svg'); svg.setAttribute('viewBox', '0 0 220 220'); svg.classList.add('jfw-rewind-pie');
        svg.setAttribute('role', 'img');
        var legend = node('ul', null, 'jfw-rewind-pie-legend');
        var angle = -Math.PI / 2;
        var descriptions = [];
        entries.forEach(function (entry, index) {
            var share = entry.seconds / total;
            var end = angle + share * Math.PI * 2;
            var shape = svgNode(entries.length === 1 ? 'circle' : 'path');
            if (entries.length === 1) { shape.setAttribute('cx', '110'); shape.setAttribute('cy', '110'); shape.setAttribute('r', '100'); }
            else shape.setAttribute('d', 'M110 110 L' + (110 + 100 * Math.cos(angle)) + ' ' + (110 + 100 * Math.sin(angle)) + ' A100 100 0 ' + (share > .5 ? 1 : 0) + ' 1 ' + (110 + 100 * Math.cos(end)) + ' ' + (110 + 100 * Math.sin(end)) + ' Z');
            var color = pieColors[index % pieColors.length]; shape.setAttribute('fill', color);
            var percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(share);
            var amount = percent + ' · ' + number(entry.seconds / 3600, 1) + ' ' + text('hourUnit');
            var description = entry.label + ': ' + amount;
            var tooltip = svgNode('title'); tooltip.textContent = description; shape.append(tooltip); svg.append(shape);
            descriptions.push(description);
            var row = node('li'); var swatch = node('span', null, 'jfw-rewind-swatch'); swatch.style.backgroundColor = color; swatch.setAttribute('aria-hidden', 'true');
            row.append(swatch, node('span', entry.label, 'jfw-rewind-legend-label'), node('strong', amount)); legend.append(row);
            angle = end;
        });
        svg.setAttribute('aria-label', title + ': ' + descriptions.join('; '));
        root.append(svg, legend);
    }
    function renderGenreChart(root, source, weights, title, className, id) {
        var chart = section(root, title, className);
        var heading = chart.querySelector('h3'); heading.classList.add('jfw-rewind-genre-heading');
        var toggle = node('button', 'ⓘ', 'jfw-rewind-info-toggle'); toggle.type = 'button';
        toggle.setAttribute('aria-label', text('genreInfoToggle')); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', id + '-info');
        heading.append(toggle);
        var info = node('p', text('genreInfo'), 'jfw-rewind-genre-info'); info.id = id + '-info'; info.hidden = true; chart.append(info);
        toggle.addEventListener('click', function () { info.hidden = !info.hidden; toggle.setAttribute('aria-expanded', String(!info.hidden)); });
        var controls = node('div', null, 'jfw-rewind-genre-controls');
        var count = node('p', null, 'jfw-rewind-secondary'); controls.append(count); chart.append(controls);
        var body = node('div', null, 'jfw-rewind-pie-body');
        function show(current) {
            count.textContent = text('genreCount').replace('{count}', number(Array.from(current.keys()).filter(Boolean).length));
            pie(body, title, genreEntries(current));
        }
        var months = value(source, 'Months') || [];
        // Legacy snapshots only retained divided monthly weights; their annual item facts remain usable.
        if (value(source, 'FullTimePerGenre') && months.length && months.every(function (month) { return Array.isArray(value(month, 'Genres')); })) {
            var select = node('select', null, 'jfw-rewind-select'); select.id = id; select.setAttribute('aria-label', text('genrePeriod'));
            var all = node('option', text('wholePeriod')); all.value = 'all'; select.append(all);
            months.forEach(function (month, index) {
                var option = node('option', new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: value(source, 'TimeZoneId') || 'UTC' }).format(new Date(value(month, 'StartUtc'))));
                option.value = String(index); select.append(option);
            });
            select.addEventListener('change', function () {
                show(select.value === 'all' ? weights : new Map(value(months[Number(select.value)], 'Genres').map(function (genre) { return [value(genre, 'Name') || '', value(genre, 'ActiveSeconds') || 0]; })));
            });
            controls.append(select);
        }
        chart.append(body); show(weights);
    }
    function renderPies(items, genres, months) {
        var grid = node('div', null, 'jfw-rewind-pies');
        var mix = section(grid, text('mediaMix'), 'jfw-rewind-mix');
        mix.append(node('p', text('byWatchTime'), 'jfw-rewind-secondary'));
        var mixBody = node('div', null, 'jfw-rewind-pie-body'); mix.append(mixBody);
        var allItems = items.concat(value(value(report, 'Music'), 'Items') || []);
        pie(mixBody, text('mediaMix'), ['Movie', 'Episode', 'Audio'].map(function (kind) {
            return { label: text({ Movie: 'movies', Episode: 'series', Audio: 'musicMedia' }[kind]), seconds: allItems.filter(function (item) { return value(item, 'ItemType') === kind; }).reduce(function (sum, item) { return sum + (value(item, 'ActiveSeconds') || 0); }, 0) };
        }));
        renderGenreChart(grid, report, genres, text('topGenres'), 'jfw-rewind-genres', 'jfw-rewind-genre-period');
        panel.append(grid);
    }
    function distribution(root, labels, amounts) {
        var maximum = Math.max(1, ...amounts);
        var list = node('ul', null, 'jfw-rewind-distribution');
        labels.forEach(function (label, index) {
            var row = node('li'); var track = node('div', null, 'jfw-rewind-distribution-track');
            var bar = node('div'); bar.style.width = (amounts[index] / maximum * 100) + '%'; track.setAttribute('aria-hidden', 'true'); track.append(bar);
            row.append(node('span', label), node('strong', number(amounts[index] / 3600, 1) + ' ' + text('hourUnit')), track); list.append(row);
        });
        root.append(list);
    }
    function favorites(labels, amounts) {
        var maximum = Math.max(...amounts);
        return labels.filter(function (_, index) { return amounts[index] === maximum; }).join(' / ');
    }
    function calendarDate(instant) {
        return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(instant + 'T00:00:00Z'));
    }
    function mediaStreakDays(source) {
        if (!source) return value(report, 'FullTimePerGenre') ? 0 : null;
        var insights = value(source, 'Insights');
        var onlyEstimates = hasUnmeasuredActivity(source) && !(value(insights, 'HourlySeconds') || []).some(function (amount) { return amount > 0; });
        if (insights && !onlyEstimates) return value(insights, 'LongestStreakDays');
        return null;
    }
    function renderStreakSummary(root, combined, video, days, estimatedOnly) {
        if (estimatedOnly) root.append(node('p', text(recordedImportSeconds(report) + recordedImportSeconds(value(report, 'Music')) > 0 ? 'importedInsights' : 'noMeasuredInsights'), 'jfw-rewind-secondary'));
        else if (days === null || days === undefined) root.append(node('p', text('insightsMissing'), 'jfw-rewind-secondary'));
        else {
            root.append(node('p', number(days) + ' ' + text(new Intl.PluralRules(locale).select(days) === 'one' ? 'daySingular' : 'dayPlural'), 'jfw-rewind-streak-length'));
            var from = combined ? value(combined, 'Start') : value(video, 'LongestStreakStart');
            var to = combined ? value(combined, 'End') : value(video, 'LongestStreakEnd');
            if (days && from && to) root.append(node('p', calendarDate(from) + ' – ' + calendarDate(to)));
        }
    }
    function renderStreak(root) {
        var video = value(report, 'Insights');
        var music = value(report, 'Music');
        var musicInsights = value(music, 'Insights');
        var hasMusic = (value(music, 'Items') || []).length > 0;
        var combined = value(report, 'ActivityStreak');
        var measured = hasMeasuredPlayback() || (value(musicInsights, 'HourlySeconds') || []).some(function (amount) { return amount > 0; });
        var estimatedOnly = (hasUnmeasuredActivity(report) || hasUnmeasuredActivity(music)) && !measured;
        var days = null;
        if (combined) days = value(combined, 'Days');
        else if (!hasMusic && video) days = value(video, 'LongestStreakDays');
        renderStreakSummary(root, combined, video, days, estimatedOnly);
        if (combined || hasMusic || value(report, 'FullTimePerGenre')) {
            var breakdown = node('div', null, 'jfw-rewind-streak-breakdown');
            [[report, 'videoMedia', 'video'], [music, 'musicMedia', 'music']].forEach(function (entry) {
                var amount = mediaStreakDays(entry[0]);
                var stat = node('div', null, 'jfw-rewind-streak-' + entry[2]);
                stat.append(node('strong', amount === null || amount === undefined ? '—' : number(amount)), node('span', text(entry[1]))); breakdown.append(stat);
            });
            root.append(breakdown);
        }
        root.append(node('p', text('streakHelp'), 'jfw-rewind-secondary'));
    }
    function renderInsights() {
        var grid = node('div', null, 'jfw-rewind-insight-grid');
        var patterns = section(grid, text('viewingHabits'), 'jfw-rewind-patterns');
        var streak = section(grid, text('streak'), 'jfw-rewind-streak');
        var insights = value(report, 'Insights');
        renderStreak(streak);
        if (!insights) { patterns.append(node('p', text(recordedImportSeconds(report) > 0 ? 'importedInsights' : 'insightsMissing'), 'jfw-rewind-secondary')); panel.append(grid); return; }
        if (hasUnmeasuredActivity(report) && !hasMeasuredPlayback()) {
            patterns.append(node('p', text(recordedImportSeconds(report) > 0 ? 'importedInsights' : 'noMeasuredInsights'), 'jfw-rewind-secondary'));
            panel.append(grid); return;
        }
        if (recordedImportSeconds(report) > 0) patterns.append(node('p', text('importedInsights'), 'jfw-rewind-secondary'));
        var hours = value(insights, 'HourlySeconds') || [];
        var weekdays = value(insights, 'WeekdaySeconds') || [];
        if (!hours.some(function (amount) { return amount > 0; })) patterns.append(node('p', text('empty')));
        else {
            var groups = node('div', null, 'jfw-rewind-pattern-grid');
            var week = node('div'); week.append(node('h4', text('weekday')));
            var labels = weekdays.map(function (_, index) { return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + index))); });
            week.append(node('p', favorites(labels, weekdays), 'jfw-rewind-favorite')); distribution(week, labels, weekdays);
            var day = node('div'); day.append(node('h4', text('daytime')));
            var periods = [[6, 12, 'morning'], [12, 18, 'afternoon'], [18, 24, 'evening'], [0, 6, 'night']];
            var periodLabels = periods.map(function (entry) { return text(entry[2]) + ' (' + String(entry[0]).padStart(2, '0') + ':00–' + String(entry[1]).padStart(2, '0') + ':00)'; });
            var amounts = periods.map(function (entry) { return hours.slice(entry[0], entry[1]).reduce(function (sum, amount) { return sum + amount; }, 0); });
            day.append(node('p', favorites(periodLabels, amounts), 'jfw-rewind-favorite')); distribution(day, periodLabels, amounts);
            groups.append(week, day); patterns.append(groups, node('p', text('serverTime').replace('{zone}', value(report, 'TimeZoneId') || 'UTC'), 'jfw-rewind-secondary'));
        }
        panel.append(grid);
    }
    function previousActiveDays(previous) {
        if (!previous) return null;
        var activeSeconds = value(previous, 'ActiveSeconds') || 0;
        var tolerance = Math.max(0.001, activeSeconds * 1e-10);
        if (hasUnmeasuredActivity(previous) && activeSeconds <= (value(previous, 'EstimatedSeconds') || 0) + recordedImportSeconds(previous) + tolerance) return null;
        return value(previous, 'ActiveDays') || 0;
    }
    function videoComparisonMetrics(items, series, previous) {
        var currentHours = items.reduce(function (sum, item) { return sum + (value(item, 'ActiveSeconds') || 0); }, 0) / 3600;
        var previousHours = previous ? (value(previous, 'ActiveSeconds') || 0) / 3600 : null;
        var metrics = [
            ['hours', reconstructedCount() && !currentHours ? null : currentHours, value(previous, 'ReconstructedItemCount') && !previousHours ? null : previousHours, 1],
            ['movies', items.filter(function (item) { return value(item, 'ItemType') === 'Movie'; }).length, previous ? value(previous, 'MovieCount') || 0 : null, 0],
            ['episodes', items.filter(function (item) { return value(item, 'ItemType') === 'Episode'; }).length, previous ? value(previous, 'EpisodeCount') || 0 : null, 0],
            ['series', series.size, previous ? value(previous, 'SeriesCount') || 0 : null, 0],
            ['activeDays', hasUnmeasuredActivity(report) && !hasMeasuredPlayback() ? null : value(report, 'ActiveDays') || 0, previousActiveDays(previous), 0]
        ];
        if (value(report, 'DataState') === 'NotCollected') metrics.forEach(function (metric) { metric[1] = null; });
        return metrics;
    }
    function appendMusicComparison(metrics, tracks, previousMusic, musicEstimated) {
        if (tracks.length) {
            var listeningHours = tracks.reduce(function (sum, item) { return sum + (value(item, 'ActiveSeconds') || 0); }, 0) / 3600;
            var oldListeningHours = previousMusic ? (value(previousMusic, 'ActiveSeconds') || 0) / 3600 : null;
            metrics.push(
                ['listeningHours', musicEstimated && !listeningHours ? null : listeningHours, value(previousMusic, 'ReconstructedItemCount') && !oldListeningHours ? null : oldListeningHours, 1],
                ['tracks', tracks.length, value(previousMusic, 'TrackCount') ?? null, 0],
                ['musicPlays', tracks.reduce(function (sum, item) { return sum + (value(item, 'PlayCount') || 0); }, 0), value(previousMusic, 'PlayCount') ?? null, 0]
            );
        }
    }
    function renderComparison(items, series, genres) {
        var root = section(panel, text('comparison'), 'jfw-rewind-comparison');
        var previous = value(report, 'Comparison');
        var music = value(report, 'Music');
        var tracks = value(music, 'Items') || [];
        var previousMusic = value(music, 'Comparison');
        var period = previous || previousMusic;
        if (!period) { root.append(node('p', text('noComparison'), 'jfw-rewind-secondary')); return; }
        root.append(node('p', text('previousPeriod') + ': ' + date(value(period, 'PeriodStartUtc'), value(period, 'TimeZoneId')) + ' – ' + date(new Date(new Date(value(period, 'SnapshotAtUtc')).getTime() - 1).toISOString(), value(period, 'TimeZoneId')), 'jfw-rewind-secondary'));
        var musicEstimated = tracks.some(function (item) { return value(item, 'HasReconstructedActivity'); });
        if (reconstructedCount() || value(previous, 'ReconstructedItemCount') || musicEstimated || value(previousMusic, 'ReconstructedItemCount')) root.append(node('p', text('comparisonEstimated'), 'jfw-rewind-notice'));
        else if (value(report, 'DataState') === 'Partial' || value(previous, 'DataState') === 'Partial' || value(music, 'DataState') === 'Partial' || value(previousMusic, 'DataState') === 'Partial') root.append(node('p', text('partialComparison'), 'jfw-rewind-notice'));
        var table = node('table', null, 'jfw-rewind-comparison-table'); var head = node('thead'); var heading = node('tr');
        ['metric', 'current', 'previous', 'change'].forEach(function (key) { var cell = node('th', text(key)); cell.scope = 'col'; heading.append(cell); }); head.append(heading); table.append(head);
        var rows = node('tbody');
        var metrics = videoComparisonMetrics(items, series, previous);
        appendMusicComparison(metrics, tracks, previousMusic, musicEstimated);
        metrics.forEach(function (metric) {
            var row = node('tr'); var label = node('th', text(metric[0] === 'activeDays' && (hasUnmeasuredActivity(report) || hasUnmeasuredActivity(previous)) ? 'measuredActiveDays' : metric[0])); label.scope = 'row';
            if (metric[1] === null || metric[2] === null) {
                row.append(label, node('td', metric[1] === null ? '—' : number(metric[1], metric[3])), node('td', metric[2] === null ? '—' : number(metric[2], metric[3])), node('td', '—'));
                rows.append(row);
                return;
            }
            var difference = new Intl.NumberFormat(locale, { maximumFractionDigits: metric[3], signDisplay: 'exceptZero' }).format(metric[1] - metric[2]);
            if (metric[2] > 0) difference += ' (' + new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format((metric[1] - metric[2]) / metric[2]) + ')';
            row.append(label, node('td', number(metric[1], metric[3])), node('td', number(metric[2], metric[3])), node('td', difference)); rows.append(row);
        });
        table.append(rows); root.append(table);
        if (!previous) return;
        var known = Array.from(genres.entries()).filter(function (entry) { return entry[0]; }).sort(function (a, b) {
            var difference = b[1] - a[1];
            if (difference) return difference;
            if (a[0] < b[0]) return -1;
            return a[0] > b[0] ? 1 : 0;
        });
        root.append(node('p', text('previousTopGenre') + ': ' + (value(previous, 'TopGenre') || text('unknownGenre')) + ' → ' + text('currentTopGenre') + ': ' + (known[0]?.[0] || text('unknownGenre'))));
        var oldGenres = new Set(value(previous, 'Genres') || []);
        var discovered = known.map(function (entry) { return entry[0]; }).filter(function (name) { return !oldGenres.has(name); });
        root.append(node('p', text('newGenres') + ': ' + (discovered.length ? discovered.join(', ') : text('none')), 'jfw-rewind-secondary'));
    }
    function renderStats(items, series, totalSeconds) {
        var stats = node('div', null, 'jfw-rewind-stats');
        var movies = items.filter(function (item) { return value(item, 'ItemType') === 'Movie'; });
        var episodes = items.filter(function (item) { return value(item, 'ItemType') === 'Episode'; });
        var watchHours = '—';
        if (totalSeconds || !reconstructedCount()) watchHours = (reconstructedCount() ? '≈ ' : '') + number(totalSeconds / 3600, 1);
        addStat(stats, watchHours, text('hours'), 'schedule');
        addStat(stats, number(movies.length), text('movies'), 'movie');
        addStat(stats, number(series.size), text('series'), 'tv');
        addStat(stats, number(episodes.length), text('episodes'), 'episodes');
        addStat(stats, hasUnmeasuredActivity(report) && !hasMeasuredPlayback() ? '—' : number(value(report, 'ActiveDays') || 0), text(hasUnmeasuredActivity(report) ? 'measuredActiveDays' : 'activeDays'), 'activeDays');
        var music = value(report, 'Music');
        var tracks = value(music, 'Items') || [];
        if (tracks.length) {
            stats.classList.add('jfw-rewind-stats-music');
            var total = tracks.reduce(function (sum, item) { return sum + (value(item, 'ActiveSeconds') || 0); }, 0);
            var estimated = tracks.some(function (item) { return value(item, 'HasReconstructedActivity'); });
            var listeningHours = '—';
            if (total || !estimated) listeningHours = (estimated ? '≈ ' : '') + number(total / 3600, 1);
            addStat(stats, listeningHours, text('listeningHours'), 'schedule');
            addStat(stats, number(tracks.length), text('tracks'), 'music');
            addStat(stats, number(tracks.reduce(function (sum, item) { return sum + (value(item, 'PlayCount') || 0); }, 0)), text('musicPlays'), 'play');
        }
        panel.append(stats);
    }
    function renderMusic() {
        var music = value(report, 'Music');
        var items = value(music, 'Items') || [];
        if (!items.length) return;
        var root = panel.querySelector('.jfw-rewind-pies');
        var total = items.reduce(function (sum, item) { return sum + (value(item, 'ActiveSeconds') || 0); }, 0);
        var estimated = items.some(function (item) { return value(item, 'HasReconstructedActivity'); });
        var top = section(root, text('topTracks'), 'jfw-rewind-top-tracks');
        root.insertBefore(top, root.querySelector('.jfw-rewind-genres'));
        top.append(node('p', text('byListenTime'), 'jfw-rewind-secondary'));
        if (estimated) top.append(node('p', text('musicReconstructed'), 'jfw-rewind-secondary'));
        if (value(music, 'DataState') === 'Partial') top.append(node('p', text('partial'), 'jfw-rewind-secondary'));
        if (value(music, 'PlaybackReportingPlayCount') > 0) top.append(node('p', text('playbackReporting').replace('{count}', number(value(music, 'PlaybackReportingPlayCount'))), 'jfw-rewind-secondary'));
        var list = node('ol', null, 'jfw-rewind-track-list'); list.setAttribute('role', 'list');
        var maximum = Math.max(1, ...items.map(function (item) { return value(item, 'ActiveSeconds') || 0; }));
        items.slice().sort(function (a, b) {
            return (value(b, 'ActiveSeconds') || 0) - (value(a, 'ActiveSeconds') || 0)
                || String(value(a, 'Name')).localeCompare(String(value(b, 'Name')))
                || String(value(a, 'ItemId')).localeCompare(String(value(b, 'ItemId')));
        }).slice(0, 5).forEach(function (item, index) {
            var duration = value(item, 'ActiveSeconds') || 0;
            var amount = '—';
            if (duration || !value(item, 'HasReconstructedActivity')) amount = (value(item, 'HasReconstructedActivity') ? '≈ ' : '') + number(duration / 3600, 2) + ' ' + text('hourUnit');
            var row = node('li');
            var rank = node('span', String(index + 1).padStart(2, '0'), 'jfw-rewind-track-rank'); rank.setAttribute('aria-hidden', 'true');
            var info = node('div', null, 'jfw-rewind-track-info');
            info.append(node('strong', value(item, 'Name')), node('span', number(value(item, 'PlayCount') || 0) + ' ' + text('musicPlays'), 'jfw-rewind-secondary'));
            var meter = node('div', null, 'jfw-rewind-track-meter'); meter.setAttribute('aria-hidden', 'true');
            var fill = node('div'); fill.style.width = (duration / maximum * 100) + '%'; meter.append(fill);
            row.append(rank, info, node('span', amount, 'jfw-rewind-track-duration'), meter); list.append(row);
        });
        top.append(list);
        if (!total) { top.append(node('p', text('noListeningDuration'))); return; }
        renderGenreChart(root, music, genreWeights(items), text('musicGenres'), 'jfw-rewind-music-genres', 'jfw-rewind-music-period');
    }
    function renderMonthlyChart(root, source, title, className, missing) {
        var months = value(source, 'Months') || [];
        var maximum = Math.max(1, ...months.map(function (month) { return value(month, 'ActiveSeconds') || 0; }));
        var chart = node('section', null, className);
        var chartHeading = node('h3', title + ' ');
        chartHeading.append(node('span', '(' + text('hourUnitLong') + ')', 'jfw-rewind-chart-unit'));
        chart.append(chartHeading);
        var plot = node('div', null, 'jfw-rewind-chart');
        plot.setAttribute('role', 'list');
        plot.setAttribute('aria-label', title + ' (' + text('hourUnitLong') + ')');
        if (missing) { chart.append(node('p', text(missing))); root.append(chart); return; }
        months.forEach(function (month) {
            var column = node('div', null, 'jfw-rewind-month');
            var amount = value(month, 'ActiveSeconds') || 0;
            var instant = new Date(value(month, 'StartUtc'));
            var timeZone = value(source, 'TimeZoneId') || 'UTC';
            var label = new Intl.DateTimeFormat(locale, { timeZone: timeZone, month: 'short' }).format(instant);
            var fullLabel = new Intl.DateTimeFormat(locale, { timeZone: timeZone, month: 'long', year: 'numeric' }).format(instant);
            var estimate = value(month, 'EstimatedSeconds') || 0;
            var hours = number(amount / 3600, 1) + ' ' + text('hourUnit');
            if (estimate > 0) hours += ' (' + text('estimatedPart').replace('{hours}', number(estimate / 3600, 1)) + ')';
            column.setAttribute('role', 'listitem');
            column.setAttribute('aria-label', fullLabel + ': ' + hours);
            column.title = fullLabel + ': ' + hours;
            var track = node('div', null, 'jfw-rewind-bar-track');
            var bar = node('div', null, 'jfw-rewind-bar');
            bar.style.height = (amount / maximum * 100) + '%';
            if (estimate > 0 && amount > 0) { var estimatedBar = node('div', null, 'jfw-rewind-estimated-bar'); estimatedBar.style.height = (estimate / amount * 100) + '%'; bar.append(estimatedBar); }
            track.append(bar);
            column.append(node('span', (estimate > 0 ? '≈ ' : '') + number(amount / 3600, 1), 'jfw-rewind-bar-value'), track, node('span', label, 'jfw-rewind-bar-label'));
            plot.append(column);
        });
        var scroll = node('div', null, 'jfw-rewind-chart-scroll');
        scroll.append(plot);
        chart.append(scroll);
        if (months.some(function (month) { return value(month, 'EstimatedSeconds') > 0; })) {
            var legend = node('p', null, 'jfw-rewind-time-legend');
            ['measured', 'estimated'].forEach(function (key) { var swatch = node('span', null, 'jfw-rewind-swatch jfw-rewind-' + key + '-swatch'); swatch.setAttribute('aria-hidden', 'true'); legend.append(swatch, document.createTextNode(text(key) + ' ')); });
            chart.append(legend);
        }
        root.append(chart);
    }
    function renderReportNotices(state) {
        var jellyfinCount = value(report, 'JellyfinReconstructedItemCount');
        if (jellyfinCount === undefined || jellyfinCount === null) jellyfinCount = (value(report, 'Items') || []).filter(function (item) {
            var reconstructed = value(item, 'HasJellyfinReconstructedActivity');
            return reconstructed === undefined || reconstructed === null ? value(item, 'HasReconstructedActivity') && (value(item, 'PlaybackReportingPlayCount') || 0) <= 0 : reconstructed;
        }).length;
        if (jellyfinCount) panel.append(node('p', text('reconstructed').replace('{count}', number(jellyfinCount)), 'jfw-rewind-notice'));
        if (value(report, 'PlaybackReportingPlayCount') > 0) panel.append(node('p', text('playbackReporting').replace('{count}', number(value(report, 'PlaybackReportingPlayCount'))), 'jfw-rewind-secondary'));
        if ((state === 'Partial' && !reconstructedCount()) || state === 'NotCollected') panel.append(node('p', text(state === 'Partial' ? 'partial' : 'notCollected'), 'jfw-rewind-notice'));
    }
    function render() {
        if (!panel) return;
        panel.replaceChildren();
        panel.classList.add('jfw-rewind');
        var start = value(report, 'PeriodStartUtc');
        var cutoff = value(report, 'SnapshotAtUtc');
        var heading = node('h2', null, 'jfw-rewind-heading');
        heading.append(node('span', text('title') + ' ' + year(cutoff, value(report, 'TimeZoneId'))));
        heading.append(' ', node('span', '(' + date(start) + ' – ' + date(new Date(new Date(cutoff).getTime() - 1).toISOString()) + ')', 'jfw-rewind-period'));
        panel.append(heading);
        var state = value(report, 'DataState');
        renderReportNotices(state);
        if (state === 'NotCollected' && !(value(value(report, 'Music'), 'Items') || []).length) return;
        var items = value(report, 'Items') || [];
        var series = new Set(items.map(function (item) { return value(item, 'SeriesId'); }).filter(Boolean));
        var genres = genreWeights(items);
        var totalSeconds = items.reduce(function (sum, item) { return sum + (value(item, 'ActiveSeconds') || 0); }, 0);
        renderStats(items, series, totalSeconds);
        if (!items.length) panel.append(node('p', text('empty')));
        var months = value(report, 'Months') || [];
        renderPies(items, genres, months);
        renderMusic();
        renderInsights();
        var timelines = node('div', null, 'jfw-rewind-timelines');
        renderMonthlyChart(timelines, report, text('months'), 'jfw-rewind-months', reconstructedCount() && !totalSeconds ? 'noDuration' : null);
        var music = value(report, 'Music');
        var musicItems = value(music, 'Items') || [];
        if (musicItems.length && (value(music, 'Months') || []).length) {
            var hasDuration = musicItems.some(function (item) { return value(item, 'ActiveSeconds') > 0; });
            renderMonthlyChart(timelines, music, text('musicMonths'), 'jfw-rewind-music-months', hasDuration ? null : 'noListeningDuration');
        }
        panel.append(timelines);
        renderComparison(items, series, genres);
    }
    function showError() {
        if (!panel) return;
        panel.replaceChildren(node('p', text('unavailable')));
        var retry = node('button', text('retry'), 'emby-button');
        retry.type = 'button'; retry.addEventListener('click', load); panel.append(retry);
    }
    function showMissing() {
        if (panel) panel.replaceChildren(node('p', text('missing')));
    }
    function load() {
        var epoch = generation;
        var revision = reportRevision;
        if (report) { render(); return; }
        if (missingReport) { showMissing(); return; }
        if (panel) panel.replaceChildren(node('p', text('loading')));
        loadFailed = false;
        if (!inFlight) {
            var pending = Promise.resolve(request('/Watchback/YearlyRewind/My')).then(function (data) {
                if (!valid(epoch) || revision !== reportRevision) return;
                report = data;
                window.WatchbackTabs?.updateTitle?.(TAB, tabTitle());
                render();
            }, function (error) {
                if (!valid(epoch) || revision !== reportRevision) return;
                if (error?.status === 401 || error?.status === 403) { clear(); return; }
                if (error?.status === 404) { missingReport = true; showMissing(); return; }
                loadFailed = true;
                showError();
            }).finally(function () { if (inFlight === pending) inFlight = null; });
            inFlight = pending;
        }
    }
    function probe() {
        var current = readSession();
        if (!same(session, current)) { clear(); session = current; }
        if (!session || disposed) return;
        refreshLanguage();
        if (refreshing) return;
        var epoch = generation;
        var owner = session;
        var nextDelay = null;
        refreshing = Promise.resolve(request('/Watchback/YearlyRewind/My/Status')).then(function (status) {
            if (!valid(epoch)) return;
            var boundary = new Date(value(status, 'NextCheckAtUtc')).getTime() - new Date(value(status, 'ServerTimeUtc')).getTime();
            if (Number.isFinite(boundary) && boundary > 0) nextDelay = Math.max(1000, Math.min(2147483647, boundary));
            if (!value(status, 'Enabled') || !value(status, 'TabVisible')) {
                clear(); return;
            }
            var nextSeason = value(status, 'SeasonStartUtc') || null;
            if (season !== nextSeason) {
                season = nextSeason;
                reportRevision++;
                report = null;
                missingReport = false;
                loadFailed = false;
                inFlight = null;
                if (panel) panel.replaceChildren();
                // A sleeping browser may miss the entire hidden interval between years.
                if (panel?.classList.contains('is-active')) load();
            }
            if (!registered && window.WatchbackTabs) {
                registered = true;
                window.WatchbackTabs.register(TAB, tabTitle(), function (root) { panel = root; }, 'history', function (root) { panel = root; load(); });
            } else {
                window.WatchbackTabs?.updateTitle?.(TAB, tabTitle());
            }
        }, function (error) {
            if (!valid(epoch)) return;
            if (error?.status === 401 || error?.status === 403) { clear(); return; }
            // Retry discovery failures without discarding an already displayed report.
            nextDelay = 60000;
        }).finally(function () {
            if (!disposed && session === owner && same(owner, readSession())) {
                refreshing = null;
                if (timer) clearTimeout(timer);
                timer = nextDelay === null ? null : setTimeout(probe, nextDelay);
            }
        });
    }
    function tabTitle() {
        return text('tabTitle') + (report ? ' ' + year(value(report, 'SnapshotAtUtc'), value(report, 'TimeZoneId')) : '');
    }
    function refreshLanguage() {
        if (!session || disposed) return;
        var selected = (document.documentElement.lang || navigator.language || 'en').split(/[-_]/)[0].toLowerCase();
        selected = ['en', 'de', 'fr', 'es', 'pt', 'zh', 'tr', 'sv'].includes(selected) ? selected : 'en';
        if (requestedLanguage === selected) return;
        requestedLanguage = selected;
        var revision = ++languageRevision;
        var epoch = generation;
        Promise.resolve(request('/Watchback/Translations?lang=' + selected)).then(function (data) {
            if (!valid(epoch) || revision !== languageRevision) return;
            locale = selected;
            strings = data || {};
            if (registered) window.WatchbackTabs?.updateTitle?.(TAB, tabTitle());
            if (report) render();
            else if (panel) {
                if (inFlight) panel.replaceChildren(node('p', text('loading')));
                else if (missingReport) showMissing();
                else if (loadFailed) showError();
            }
        }, function () { if (valid(epoch) && revision === languageRevision) requestedLanguage = null; });
    }
    function refresh() { probe(); }
    function changing() { clear(); session = null; }
    function visible() { if (!document.hidden) probe(); }
    function dispose() {
        clear(); disposed = true;
        languageObserver.disconnect();
        document.removeEventListener('jfw:session-changing', changing);
        document.removeEventListener('jfw:session-changed', refresh);
        document.removeEventListener('jfw:navigation', probe);
        document.removeEventListener('visibilitychange', visible);
    }
    var english = {
        videoMedia: "Films / series",
        musicMedia: "Music",
        genreInfoToggle: "Information about genre counting",
        genreInfo: "The full playback time counts toward every genre assigned to a title. The sum of genre times can therefore exceed actual playback time. Percentages refer to the sum of genre times.",
        title: 'Your year in review', tabTitle: 'Year in review', loading: 'Loading your rewind…', missing: 'No year-in-review report exists for your user.', unavailable: 'Your rewind is not available yet.', retry: 'Try again',
        partial: 'This rewind includes only the periods for which playback was recorded.', notCollected: 'Playback was not recorded before this rewind’s cutoff.',
        empty: 'No qualifying playback was recorded.', hourUnit: 'h', hourUnitLong: 'hours', hours: 'Hours watched', movies: 'Films', episodes: 'Episodes', series: 'Series', activeDays: 'Active days',
        topGenres: 'Your film / series genres', months: 'Your viewing year',
        music: 'Your music year', listeningHours: 'Hours listened', tracks: 'Tracks', musicPlays: 'Music plays',
        topTracks: 'Your top 5 tracks', byListenTime: 'Ranked by listening time.', musicGenres: 'Your music genres', musicMonths: 'Your listening year',
        musicReconstructed: 'Includes reconstructed music activity. Listening time may be estimated or unavailable; play counts may be incomplete.',
        noListeningDuration: 'No listening duration is available for the reconstructed tracks.',
        mediaMix: "Your media mix",
        byWatchTime: "By playback time (hours)",
        genreCount: "Distinct genres: {count}",
        genrePeriod: "Viewing period",
        wholePeriod: "Entire period",
        otherGenres: "Other genres",
        viewingHabits: "Your viewing habits",
        insightsMissing: "These details were not included when this report was created.",
        weekday: "Weekdays",
        daytime: "Time of day",
        morning: "Morning",
        afternoon: "Afternoon",
        evening: "Evening",
        night: "Night",
        serverTime: "Time zone: {zone}",
        streak: "Your longest active-day streak",
        daySingular: "day",
        dayPlural: "days",
        streakHelp: "Consecutive calendar days with measured film, series or music playback.",
        comparison: "Compared with your previous rewind",
        noComparison: "No report for the preceding period is available yet.",
        previousPeriod: "Previous period",
        partialComparison: "At least one period was only partially recorded. These differences do not represent a complete annual comparison.",
        metric: "Metric",
        current: "Current",
        previous: "Previous",
        change: "Change",
        previousTopGenre: "Previous top genre",
        currentTopGenre: "Current top genre",
        newGenres: "Genres absent from the previous report",
        none: "None",
        playbackReporting: "Historical plays imported from Playback Reporting: {count}.",
        reconstructed: "Includes {count} titles reconstructed from Jellyfin data. Watch time may be estimated or unavailable. Viewing habits and active days use measured playback only.",
        measuredActiveDays: "Measured active days",
        noMeasuredInsights: "These details require measured playback. Only reconstructed activity is available for this period.",
        measured: "Recorded",
        importedInsights: "Playback Reporting durations are recorded values. Viewing habits, active days and streaks use only activity intervals recorded by Watchback.",
        estimated: "Estimated",
        estimatedPart: "{hours} h estimated",
        comparisonEstimated: "At least one report includes reconstructed activity. Differences may include estimated values.",
        noDuration: "No watch duration is available for the reconstructed titles.",
        unknownGenre: 'Unknown genre'
    };
    // Clock, film and TV paths match Shared.js's existing plugin icons.
    var pieColors = ['#00a4dc', '#e67e22', '#2ecc71', '#e74c3c', '#9b59b6', '#f1c40f'];
    var statIcons = {
        "music": "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z",
        "play": "M8 5v14l11-7z",
        "schedule": "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
        "movie": "M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z",
        "tv": "M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z",
        "episodes": "M3 6h12v2H3V6zm0 5h12v2H3v-2zm0 5h8v2H3v-2zm14-5 5 3.5-5 3.5v-7z",
        "activeDays": "M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zm-8.4-2.4-3.2-3.2 1.4-1.4 1.8 1.8 4.6-4.6 1.4 1.4-6 6z"
    };
    var style = node('style');
    // Match the settings Overview cards, with scoped fallbacks outside the dashboard.
    style.textContent = `
.jfw-rewind{max-width:1100px;margin:0 auto;padding:2em;color:inherit;--rewind-primary:var(--color-primary,#00a4dc);--rewind-border:var(--color-border,rgba(255,255,255,.1))}
.jfw-rewind-heading{display:flex;flex-wrap:wrap;align-items:baseline;gap:.3em .5em;font-size:2em;margin:0 0 1em}
.jfw-rewind-period{font-size:.5em;font-weight:400;opacity:.6}
.jfw-rewind-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1.2em;margin-bottom:1.2em}
.jfw-rewind-stat{min-width:0;background:rgba(255,255,255,.05);border:1px solid var(--rewind-border);border-radius:var(--radius-lg,8px);padding:var(--spacing-lg,1.2em) var(--spacing-xl,1.5em)}
.jfw-rewind-stat h3{display:flex;align-items:center;gap:.3em;margin:0 0 .3em;font-size:.85em;text-transform:uppercase;letter-spacing:.05em;opacity:.7}
.jfw-rewind-stat-icon{width:1.15em;height:1.15em;flex-shrink:0}.jfw-rewind-stat h3 span{min-width:0;overflow-wrap:anywhere}
.jfw-rewind-stat strong{font-size:1.8em;font-weight:700;color:var(--rewind-primary)}
.jfw-rewind-notice{padding:1em;border-inline-start:4px solid var(--rewind-primary)}
.jfw-rewind section{min-width:0;background:rgba(255,255,255,.03);border:1px solid var(--rewind-border);border-radius:var(--radius-lg,8px);padding:.8em 1.1em 1.1em}
.jfw-rewind > section{margin-top:1.2em}
.jfw-rewind-stats-music{grid-template-columns:repeat(4,minmax(0,1fr))}
.jfw-rewind-track-list{list-style:none;margin:0;padding:0;counter-reset:tracks}
.jfw-rewind-track-list li{display:grid;grid-template-columns:2em minmax(0,1fr) auto;gap:.25em .8em;align-items:center;padding:.8em 0;border-bottom:1px solid var(--rewind-border)}
.jfw-rewind-track-list li:last-child{border-bottom:0}.jfw-rewind-track-rank{font-size:1.2em;font-weight:700;opacity:.45;font-variant-numeric:tabular-nums}.jfw-rewind-track-list li:first-child .jfw-rewind-track-rank{color:var(--rewind-primary);opacity:1}
.jfw-rewind-track-info{display:flex;flex-direction:column;gap:.2em;min-width:0}.jfw-rewind-track-info strong{font-size:.95em;font-weight:600;overflow-wrap:anywhere}.jfw-rewind-track-duration{font-size:.85em;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--rewind-primary)}
.jfw-rewind-track-meter{grid-column:2/-1;height:3px;border-radius:3px;background:var(--rewind-border);overflow:hidden}.jfw-rewind-track-meter div{height:100%;background:var(--rewind-primary);opacity:.65}
.jfw-rewind-timelines{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.2em;margin-top:1.2em}.jfw-rewind-timelines:not(:has(> :nth-child(2))){grid-template-columns:1fr}
.jfw-rewind section > h3{font-size:1.1em;font-weight:600;margin:0 0 .8em;padding-bottom:.5em;border-bottom:2px solid var(--rewind-border)}
.jfw-rewind-chart-unit{font-size:.85em;font-weight:400;opacity:.6}
.jfw-rewind-chart-scroll{overflow-x:auto;scrollbar-width:thin}.jfw-rewind-chart{display:flex;gap:clamp(4px,1vw,16px);min-width:0;padding:.5em 0}
.jfw-rewind-month{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:.5em}
.jfw-rewind-bar-value{font-size:.75em;opacity:.7}.jfw-rewind-bar-track{height:180px;display:flex;align-items:flex-end;width:100%;border-bottom:1px solid var(--rewind-border);background:repeating-linear-gradient(to top,transparent 0,transparent calc(25% - 1px),var(--rewind-border) calc(25% - 1px),var(--rewind-border) 25%)}
.jfw-rewind-bar{position:relative;overflow:hidden;width:100%;background:var(--rewind-primary);border-radius:4px 4px 0 0}.jfw-rewind-bar-label{max-width:100%;font-size:.7em;text-align:center;overflow-wrap:anywhere;opacity:.7}
.jfw-rewind-pies{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.2em;margin-top:1.2em}
.jfw-rewind-estimated-bar{position:absolute;inset:0 0 auto;background:#e67e22}.jfw-rewind-time-legend{display:flex;align-items:center;gap:.5em;font-size:.8em;opacity:.8}.jfw-rewind-measured-swatch{background:var(--rewind-primary)}.jfw-rewind-estimated-swatch{background:#e67e22}
.jfw-rewind-secondary{font-size:.85em;opacity:.65;line-height:1.5;overflow-wrap:anywhere}
.jfw-rewind-pie-body{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:1em;margin-top:1em}
.jfw-rewind-pie{width:180px;max-width:100%;height:auto;flex-shrink:0}.jfw-rewind-pie-legend{list-style:none;padding:0;margin:0;flex:1 1 180px;min-width:0}
.jfw-rewind-pie-legend li{display:flex;align-items:center;gap:.5em;margin:.6em 0;flex-wrap:wrap}.jfw-rewind-swatch{width:.7em;height:.7em;border-radius:2px;flex-shrink:0}.jfw-rewind-legend-label{flex:1;min-width:0;overflow-wrap:anywhere}.jfw-rewind-pie-legend strong{font-size:.85em;font-weight:400;white-space:nowrap}
.jfw-rewind-genre-heading{display:flex;align-items:center;gap:.5em}
.jfw-rewind-info-toggle{border:0;background:transparent;color:#00a4dc;font:inherit;font-size:1.15em;padding:0 .2em;cursor:pointer;line-height:1}.jfw-rewind-info-toggle:focus-visible{outline:2px solid #00a4dc;outline-offset:3px;border-radius:3px}
.jfw-rewind-genre-info{color:#00a4dc;font-size:.85em;line-height:1.5;margin:0 0 1em;overflow-wrap:anywhere}.jfw-rewind-genre-info[hidden]{display:none}
.jfw-rewind-genre-controls{display:flex;align-items:center;justify-content:space-between;gap:.7em}.jfw-rewind-genre-controls p{margin:0;flex:1;min-width:0}.jfw-rewind-genre-controls select{margin-inline-start:auto;min-width:0;max-width:58%}
.jfw-rewind-streak-breakdown{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1em;border-top:1px solid var(--rewind-border);padding-top:1em;margin-top:1em}.jfw-rewind-streak-breakdown > div{display:flex;flex-direction:column;gap:.3em;min-width:0}.jfw-rewind-streak-breakdown strong{font-size:1.5em;color:var(--rewind-primary)}.jfw-rewind-streak-breakdown span{font-size:.8em;opacity:.7;overflow-wrap:anywhere}
.jfw-rewind-select{font:inherit;color:inherit;background:rgba(127,127,127,.1);border:1px solid var(--rewind-border);border-radius:4px;padding:.4em;max-width:100%;color-scheme:light dark}.jfw-rewind-select option{background:Canvas;color:CanvasText}
.jfw-rewind-insight-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:1.2em;margin-top:1.2em}.jfw-rewind-pattern-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.2em}.jfw-rewind-pattern-grid h4{font-size:.9em;margin:.3em 0}.jfw-rewind-favorite{font-size:1.05em;font-weight:600;color:var(--rewind-primary);overflow-wrap:anywhere}
.jfw-rewind-distribution{list-style:none;padding:0;margin:0}.jfw-rewind-distribution li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.4em;margin:.8em 0;font-size:.8em}.jfw-rewind-distribution li span{overflow-wrap:anywhere}.jfw-rewind-distribution strong{font-weight:400;white-space:nowrap;opacity:.7}.jfw-rewind-distribution-track{grid-column:1/-1;background:rgba(127,127,127,.1);border-radius:3px;overflow:hidden;height:5px}.jfw-rewind-distribution-track div{height:100%;background:var(--rewind-primary)}
.jfw-rewind-streak-length{font-size:2em;font-weight:700;color:var(--rewind-primary);margin:.8em 0 .3em;overflow-wrap:anywhere}
.jfw-rewind-comparison-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:.85em}.jfw-rewind-comparison-table th,.jfw-rewind-comparison-table td{text-align:end;padding:.6em .3em;border-bottom:1px solid var(--rewind-border);overflow-wrap:anywhere}.jfw-rewind-comparison-table th:first-child{text-align:start}.jfw-rewind-comparison-table thead{opacity:.7}
@media(max-width:800px){.jfw-rewind-pies,.jfw-rewind-insight-grid,.jfw-rewind-timelines{grid-template-columns:1fr}.jfw-rewind-stats-music{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:500px){.jfw-rewind-pattern-grid,.jfw-rewind-stats-music{grid-template-columns:1fr}}
@media(prefers-color-scheme:light){.jfw-rewind{--rewind-primary:var(--color-primary,#00749c);--rewind-border:var(--color-border,rgba(0,0,0,.15))}}
@media(max-width:700px){.jfw-rewind{padding:1em}.jfw-rewind-heading{font-size:1.6em}.jfw-rewind-period{font-size:.6em}}
`;
    document.head.append(style);
    window.WatchbackRewind = { dispose: function () { dispose(); style.remove(); } };
    // The injected bundle can run before Jellyfin applies the signed-in user's language.
    var languageObserver = new MutationObserver(refreshLanguage);
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    document.addEventListener('jfw:session-changing', changing);
    document.addEventListener('jfw:session-changed', refresh);
    document.addEventListener('jfw:navigation', probe);
    document.addEventListener('visibilitychange', visible);
    refresh();
})();
