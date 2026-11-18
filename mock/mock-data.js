var MOCK_YEARLY_REWIND=(function(){
    var items=[];
    for(var i=0;i<18;i++){
        var seconds=(1.5+(i%5)*0.15)*3600;
        items.push({ItemId:'rewind-movie-'+i,Name:'Demo film '+(i+1),ItemType:'Movie',Genres:[['Drama','Science Fiction','Adventure'][i%3]],
            ActiveSeconds:seconds,EstimatedSeconds:i===0?seconds:0,HasReconstructedActivity:i===0,PlayCount:1});
    }
    for(var episode=0;episode<60;episode++){
        var show=episode%4;
        items.push({ItemId:'rewind-episode-'+episode,Name:'Episode '+(Math.floor(episode/4)+1),ItemType:'Episode',
            SeriesId:'rewind-series-'+show,SeriesName:'Demo series '+(show+1),Genres:[show%2?'Comedy':'Drama'],ActiveSeconds:2700,PlayCount:1});
    }
    var total=items.reduce(function(sum,item){return sum+item.ActiveSeconds;},0);
    var estimate=items[0].EstimatedSeconds,measured=total-estimate;
    var weights=[5,9,8,6,4,3,2,4,6,8,10,7];
    var weightSum=weights.reduce(function(sum,weight){return sum+weight;},0);
    var genres={};
    items.forEach(function(item){genres[item.Genres[0]]=(genres[item.Genres[0]]||0)+item.ActiveSeconds;});
    var months=weights.map(function(weight,index){
        var amount=measured*weight/weightSum+(index===0?estimate:0);
        return {StartUtc:new Date(Date.UTC(2025,11+index,15)).toISOString(),EndUtc:new Date(Date.UTC(2025,12+index,15)).toISOString(),
            ActiveSeconds:amount,EstimatedSeconds:index===0?estimate:0,
            Genres:Object.keys(genres).map(function(name){return {Name:name,ActiveSeconds:amount*genres[name]/total};})};
    });
    function distribute(weights){var sum=weights.reduce(function(a,b){return a+b;},0);return weights.map(function(weight){return measured*weight/sum;});}
    return {SchemaVersion:1,SnapshotId:'demo-rewind-2026',UserId:'demo-user',PeriodStartUtc:'2025-12-15T00:00:00Z',SnapshotAtUtc:'2026-12-15T00:00:00Z',
        GeneratedAtUtc:'2026-12-15T00:00:00Z',TimeZoneId:'UTC',DataState:'Partial',Items:items,Months:months,ActiveDays:68,ReconstructedItemCount:1,
        Insights:{HourlySeconds:distribute([0,0,0,0,0,0,0,1,2,2,1,1,2,1,1,1,2,4,8,12,16,14,8,3]),
            WeekdaySeconds:distribute([8,9,10,10,17,26,20]),LongestStreakDays:7,LongestStreakStart:'2026-11-02',LongestStreakEnd:'2026-11-08'},
        Comparison:{PeriodStartUtc:'2024-12-15T00:00:00Z',SnapshotAtUtc:'2025-12-15T00:00:00Z',TimeZoneId:'UTC',DataState:'Ready',
            ActiveSeconds:65*3600,EstimatedSeconds:0,ReconstructedItemCount:0,MovieCount:14,EpisodeCount:48,SeriesCount:3,ActiveDays:72,Genres:['Drama','Comedy','Adventure'],TopGenre:'Drama'}};
})();

var MOCK_CONFIG = {YearlyRewindEnabled:true,YearlyRewindStartDate:'12-15',YearlyRewindEndDate:'01-15'};
var demoLanguage = new URLSearchParams(location.search).get('lang') || 'de';
document.documentElement.lang = demoLanguage;
window.ApiClient = {
  getCurrentUserId: function () { return 'demo-user'; },
  accessToken: function () { return 'demo-token'; },
  serverAddress: function () { return location.origin; },
  getUrl: function (path) { return path; },
  ajax: function (options) {
    if (options.url.includes('Translations')) {
      var language = new URL(options.url, location.href).searchParams.get('lang') || demoLanguage;
      return fetch('i18n/' + language + '.json').then(function (response) { if (!response.ok) throw new Error('Unsupported demo language'); return response.json(); });
    }
    if (options.url.includes('Configuration')) {
      if (options.type === 'PUT') Object.assign(MOCK_CONFIG, JSON.parse(options.data));
      return Promise.resolve({...MOCK_CONFIG});
    }
    if (options.url.includes('/Status')) return Promise.resolve({Enabled:MOCK_CONFIG.YearlyRewindEnabled,TabVisible:MOCK_CONFIG.YearlyRewindEnabled,Available:true,SnapshotId:MOCK_YEARLY_REWIND.SnapshotId,SnapshotAtUtc:MOCK_YEARLY_REWIND.SnapshotAtUtc,TimeZoneId:'UTC'});
    return Promise.resolve(structuredClone(MOCK_YEARLY_REWIND));
  }
};
window.WatchbackTabs = {
  register: function (_id, title, mount) { var button=document.getElementById('demoRewind');button.hidden=false;button.title=title;mount(document.getElementById('demoReport')); },
  unregister: function () { document.getElementById('demoRewind').hidden=true;document.getElementById('demoReport').replaceChildren(); },
  updateTitle: function (_id, title) { document.getElementById('demoRewind').title=title; }
};
document.querySelectorAll('[data-demo-view]').forEach(function (button) {
  button.addEventListener('click', function () {
    document.querySelectorAll('[data-demo-view]').forEach(function (item) {item.setAttribute('aria-pressed', String(item===button));});
    document.getElementById('demoSettings').hidden=button.dataset.demoView!=='settings';
    document.getElementById('demoReport').hidden=button.dataset.demoView!=='rewind';
  });
});
