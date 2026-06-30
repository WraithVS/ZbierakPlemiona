//  Scavenge optimizer + popup z ustawieniami na zywo (Plemiona / TribalWars)
//  Wersja do hostowania i ladowania przez:  javascript:$.getScript('RAW_URL');
//   - 3 tryby rozkladu: rowny czas / max lup/h / limit czasu
//   - model czasu + ETA (godzina powrotu), lup/h, ostrzezenie o magazynie
//   - rezerwa i limit per jednostka, profile, historia wysylek, eksport/import
//   - kazda zmiana w popupie -> przelicza plan i odrysowuje tabele
//   - ustawienia zapisywane w localStorage (per swiat)
//
//  Model czasu zbieractwa (sekundy):
//      t = ( ((loot_factor * capacity)^2 * 100)^EXP + INIT ) * FACTOR
//  Stale EXP/INIT/FACTOR sa wykrywane ze strony (obiekt ScavengeScreen), z fallbackiem
//  na 0.45 / 1800 / 0.6830201284. FACTOR zalezy od predkosci swiata - mozna go skalibrowac
//  recznie w sekcji "Zaawansowane" (zmierz 1 realny bieg i wpisz wspolczynnik).
//
//  Koszt ludnosci: piki/miecz/topor/lucznik=1, lekki=4, lucznik konny=5, ciezki=6

(function(){
    'use strict';

    // ====================================================================
    //  STALE JEDNOSTEK (w TW niezmienne miedzy swiatami)
    // ====================================================================
    var ORDER = ['spear','sword','axe','archer','light','marcher','heavy'];
    var CAP   = {spear:25,sword:15,axe:10,archer:10,light:80,marcher:50,heavy:50}; // pojemnosc lupu
    var POP   = {spear:1,sword:1,axe:1,archer:1,light:4,marcher:5,heavy:6};        // ludnosc
    var LOOT  = {1:0.10,2:0.25,3:0.50,4:0.75};                                     // faktor lupu
    var LABEL = {spear:'Pikinier',sword:'Miecznik',axe:'Topornik',archer:'Lucznik',light:'Lekki kaw.',marcher:'Lucznik konny',heavy:'Ciezki kaw.'};

    // ====================================================================
    //  DOMYSLNE USTAWIENIA
    // ====================================================================
    var DEFAULTS = {
        max_ressources: 99999,   // maks. surowca z JEDNEGO poziomu (globalnie)
        archers: 0,              // 1 = swiat z lucznikami, 0 = bez  (zostawione "jak jest")
        min_population: 10,      // prog ludnosci najwyzszego tieru
        confirm_popup: 1,        // 1 = pokaz okno; 0 = od razu dzialaj
        auto_send: 1,            // 1 = po Tak wypelnij i kliknij Start; 0 = tylko wypelnij
        send_delay_ms: 350,
        levels_enabled: { 1:false, 2:true, 3:true, 4:true },

        mode: 'equal',           // 'equal' = rowny czas | 'maxh' = max lup/h | 'time' = limit czasu
        absence_hours: 8,        // dla trybu 'time': maks. dlugosc najdluzszego biegu

        reserve: { spear:0,sword:0,axe:0,archer:0,light:0,marcher:0,heavy:0 }, // zostaw w domu
        maxunit: { spear:0,sword:0,axe:0,archer:0,light:0,marcher:0,heavy:0 }, // 0 = bez limitu

        time_factor: 0,          // 0 = autodetekcja/domyslny; >0 = reczna kalibracja
        warn_storage: 1,         // ostrzegaj gdy lup przepelni magazyn

        ui_pos: null             // zapamietana pozycja okna {x,y}
    };

    // ====================================================================
    //  WALIDACJA EKRANU
    // ====================================================================
    var url = document.URL;
    if (url.indexOf('screen=place') === -1 || url.indexOf('mode=scavenge') === -1){
        alert('Skrypt do uzycia w placu w zakladce zbieractwo');
        return;
    }

    // ====================================================================
    //  WYKRYCIE SWIATA / localStorage
    // ====================================================================
    var gd = (window.game_data || {});
    var WORLD = gd.world || (location.host.split('.')[0] || 'default');
    var SPEED = num(gd.speed, 1);

    var STORE_KEY    = 'zbieracz_settings_' + WORLD;
    var PROFILES_KEY = 'zbieracz_profiles_' + WORLD;
    var HISTORY_KEY  = 'zbieracz_history_'  + WORLD;

    function num(x, d){ x = parseFloat(x); return isNaN(x) ? (d||0) : x; }
    function clampInt(x, d){ var v = parseInt(x,10); return isNaN(v) ? d : v; }

    function loadSettings(){
        var s = deepDefaults();
        try{
            var raw = localStorage.getItem(STORE_KEY);
            if(raw){
                var saved = JSON.parse(raw);
                for(var key in saved){
                    if(!(key in s)) continue;
                    if(typeof s[key] === 'object' && s[key] && !Array.isArray(s[key]) && saved[key]){
                        for(var sub in saved[key]){ if(sub in s[key]) s[key][sub] = saved[key][sub]; }
                    } else {
                        s[key] = saved[key];
                    }
                }
            }
        }catch(e){ console.warn('[Zbieractwo] nie udalo sie wczytac ustawien:', e); }
        return s;
    }
    function deepDefaults(){
        var s = {};
        for(var k in DEFAULTS){
            s[k] = (typeof DEFAULTS[k] === 'object' && DEFAULTS[k] !== null)
                 ? JSON.parse(JSON.stringify(DEFAULTS[k])) : DEFAULTS[k];
        }
        return s;
    }
    function saveSettings(){
        try{ localStorage.setItem(STORE_KEY, JSON.stringify(settings)); }
        catch(e){ console.warn('[Zbieractwo] nie udalo sie zapisac ustawien:', e); }
    }

    var settings = loadSettings();

    // ---- profile ----
    function loadProfiles(){ try{ return JSON.parse(localStorage.getItem(PROFILES_KEY)||'{}'); }catch(e){ return {}; } }
    function saveProfiles(p){ try{ localStorage.setItem(PROFILES_KEY, JSON.stringify(p)); }catch(e){} }

    // ---- historia ----
    function loadHistory(){ try{ return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]'); }catch(e){ return []; } }
    function saveHistory(h){ try{ localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-300))); }catch(e){} }
    function logDispatch(levels, plan, unitList){
        var h = loadHistory();
        var ts = Date.now();
        levels.forEach(function(l,i){
            var units = {}; var any=false;
            unitList.forEach(function(u){ if(plan[i][u]>0){ units[u]=plan[i][u]; any=true; } });
            if(!any) return;
            var cap = unitList.reduce(function(a,u){return a+plan[i][u]*CAP[u];},0);
            h.push({ t:ts, world:WORLD, level:l, units:units, res:Math.round(cap*LOOT[l]) });
        });
        saveHistory(h);
    }

    // ====================================================================
    //  MODEL CZASU
    // ====================================================================
    var TIME = { exp:0.45, init:1800, factor:0.6830201284 };
    (function detectTime(){
        try{
            var found = scanScavengeConstants();
            if(found){
                if(found.duration_exponent)        TIME.exp    = num(found.duration_exponent, TIME.exp);
                if(found.duration_initial_seconds) TIME.init   = num(found.duration_initial_seconds, TIME.init);
                if(found.duration_factor)          TIME.factor = num(found.duration_factor, TIME.factor);
            }
        }catch(e){}
        if(settings.time_factor && settings.time_factor > 0) TIME.factor = settings.time_factor; // reczna kalibracja ma priorytet
    })();

    function scanScavengeConstants(){
        var seen = [];
        function find(o, d){
            if(!o || typeof o !== 'object' || d > 3) return null;
            if(seen.indexOf(o) >= 0) return null;
            seen.push(o);
            if(('duration_exponent' in o) && ('duration_factor' in o)) return o;
            for(var k in o){
                try{ var v = o[k]; if(v && typeof v === 'object'){ var r = find(v, d+1); if(r) return r; } }catch(e){}
            }
            return null;
        }
        try{ if(window.ScavengeScreen){ var r = find(window.ScavengeScreen, 0); if(r) return r; } }catch(e){}
        try{
            for(var key in window){
                if(/scaveng/i.test(key)){ var r2 = find(window[key], 0); if(r2) return r2; }
            }
        }catch(e){}
        return null;
    }

    function runTime(lf, cap){ // sekundy
        if(cap <= 0) return 0;
        var inner = Math.pow(lf * cap, 2) * 100;
        return (Math.pow(inner, TIME.exp) + TIME.init) * TIME.factor;
    }
    function capForTime(lf, t){ // pojemnosc dajaca bieg o czasie t
        var x = t / TIME.factor - TIME.init;
        if(x <= 0) return 0;
        var inner = Math.pow(x, 1 / TIME.exp);   // = (lf*cap)^2 * 100
        var lc = Math.sqrt(inner / 100);         // = lf*cap
        return lc / lf;
    }
    function lootPerHour(lf, cap){ var t = runTime(lf, cap); return t > 0 ? (cap * lf) / (t / 3600) : 0; }

    function fmtDur(s){
        s = Math.round(s);
        var h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
        function p(n){ return (n<10?'0':'')+n; }
        return (h>0 ? h+':' : '') + p(m) + ':' + p(sec);
    }
    function fmtClock(s){
        var d = new Date(Date.now() + s*1000);
        return d.toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'});
    }
    function fmtInt(n){ return Math.round(n).toLocaleString('pl-PL'); }

    // ====================================================================
    //  WOLNE POZIOMY + DOSTEPNOSC JEDNOSTEK
    // ====================================================================
    var buttons = Array.prototype.slice.call(document.getElementsByClassName('free_send_button'));
    if(buttons.length === 0){ alert('Nie znaleziono przyciskow poziomow'); return; }
    var freeLevels = [];
    buttons.forEach(function(btn, idx){ if(!btn.classList.contains('btn-disabled')) freeLevels.push(idx+1); });

    function resolveField(u){
        return document.querySelector('input.unitsInput[name="'+u+'"]') || document.querySelector('input[name="'+u+'"]');
    }
    function availableRaw(u){
        var f = resolveField(u); if(!f) return 0;
        var box = f.closest('td') || f.parentNode, a = box ? box.querySelector('a.units-entry-all') : null;
        if(a){ var m = a.innerText.match(/\d+/); if(m) return Number(m[0]); }
        return 0;
    }

    // ====================================================================
    //  WAGI ROZKLADU wg trybu
    // ====================================================================
    // 'equal' : wagi = 1/loot -> wszystkie biegi wracaja w tym samym czasie (matematycznie dokladnie,
    //           bo czas zalezy tylko od (loot*cap), a stala +INIT jest wspolna dla poziomow).
    // 'maxh'  : numeryczny przydzial calej puli pojemnosci tak, by zmaksymalizowac sumaryczny lup/h
    //           (przy ciaglym dosylaniu kazdego poziomu po powrocie) - uwzglednia narzut INIT.
    // 'time'  : wagi = pojemnosc dajaca bieg o dlugosci 'absence_hours'; pula skalowana tak,
    //           by zaden bieg nie przekroczyl zadanego czasu (nadmiar zostaje w domu).
    function computeWeights(levels, totalAvailCap){
        if(settings.mode === 'maxh'){
            return allocMaxPerHour(levels, totalAvailCap);
        }
        if(settings.mode === 'time'){
            var T = Math.max(60, num(settings.absence_hours,8) * 3600);
            return levels.map(function(l){ return Math.max(1e-6, capForTime(LOOT[l], T)); });
        }
        // 'equal'
        return levels.map(function(l){ return 1 / LOOT[l]; });
    }

    // skala puli (mnoznik dostepnych jednostek) zaleznie od trybu
    function poolScale(levels, weights, totalAvailCap){
        if(settings.mode === 'time'){
            var sumT = weights.reduce(function(s,w){return s+w;},0);
            return totalAvailCap > 0 ? Math.min(1, sumT / totalAvailCap) : 1;
        }
        return 1; // equal i maxh uzywaja calej puli
    }

    function allocMaxPerHour(levels, totalCap){
        var n = levels.length, alloc = levels.map(function(){return 0;});
        if(totalCap <= 0) return alloc;
        var step = Math.max(1, totalCap / 500), remaining = totalCap, guard = 0;
        while(remaining > 1e-6 && guard++ < 2000){
            var s = Math.min(step, remaining), best = -1, bestGain = -Infinity;
            for(var i=0;i<n;i++){
                var lf = LOOT[levels[i]];
                var gain = lootPerHour(lf, alloc[i]+s) - lootPerHour(lf, alloc[i]);
                if(gain > bestGain){ bestGain = gain; best = i; }
            }
            if(best < 0) break;
            alloc[best] += s; remaining -= s;
        }
        return alloc;
    }

    // ====================================================================
    //  RDZEN: PLAN
    // ====================================================================
    function effectiveAvail(unitList){
        var avail = {};
        unitList.forEach(function(u){
            var a = availableRaw(u);
            var reserve = clampInt(settings.reserve[u], 0);
            var maxu    = clampInt(settings.maxunit[u], 0);
            a = a > reserve ? a - reserve : 0;
            if(maxu > 0 && a > maxu) a = maxu;
            avail[u] = a;
        });
        return avail;
    }

    function buildPlan(levels, unitList, avail, weights){
        var tw = weights.reduce(function(s,w){return s+w;}, 0) || 1;
        var plan = levels.map(function(){ var o={}; unitList.forEach(function(u){o[u]=0;}); return o; });
        unitList.forEach(function(u){
            if(avail[u] <= 0) return;
            levels.forEach(function(l,i){ plan[i][u] = avail[u] * weights[i] / tw; });
        });
        // limit surowca per poziom (globalny prog)
        levels.forEach(function(l,i){
            var cap = 0; unitList.forEach(function(u){ cap += plan[i][u]*CAP[u]; });
            var res = cap * LOOT[l];
            if(res > settings.max_ressources && res > 0){
                var r = settings.max_ressources / res;
                unitList.forEach(function(u){ plan[i][u] *= r; });
            }
        });
        // floor + metryki
        var pops = [], caps = [], times = [];
        plan.forEach(function(p,i){
            var pp=0, cc=0;
            unitList.forEach(function(u){ p[u] = Math.floor(p[u]); pp += p[u]*POP[u]; cc += p[u]*CAP[u]; });
            pops.push(pp); caps.push(cc); times.push(runTime(LOOT[levels[i]], cc));
        });
        return { plan:plan, pops:pops, caps:caps, times:times };
    }

    function topTierPop(levels, pops){
        var hi = 0;
        for(var i=1;i<levels.length;i++) if(LOOT[levels[i]] > LOOT[levels[hi]]) hi = i;
        return pops[hi];
    }

    function recompute(){
        var unitList = ORDER.filter(function(u){ return !(settings.archers==0 && (u=='archer'||u=='marcher')); });
        var avail = effectiveAvail(unitList);
        var totalAvailCap = unitList.reduce(function(s,u){ return s + avail[u]*CAP[u]; }, 0);

        var levels = freeLevels.filter(function(l){ return settings.levels_enabled[l] !== false; });
        if(levels.length === 0) return { levels:[], plan:[], unitList:unitList, avail:avail, pops:[], caps:[], times:[] };
        levels = levels.slice().sort(function(a,b){ return b-a; }); // od najwyzszego tieru

        function build(lvls){
            var w = computeWeights(lvls, totalAvailCap);
            var s = poolScale(lvls, w, totalAvailCap);
            var av = {}; unitList.forEach(function(u){ av[u] = Math.floor(avail[u]*s); });
            var R = buildPlan(lvls, unitList, av, w);
            return R;
        }

        var R = build(levels);
        // proba ludnosciowa: ucina najslabszy tier dopoki top tier < min_population
        while(levels.length > 1 && topTierPop(levels, R.pops) < settings.min_population){
            var lowest = levels.reduce(function(a,b){ return LOOT[a] < LOOT[b] ? a : b; });
            levels = levels.filter(function(l){ return l != lowest; });
            R = build(levels);
        }
        return { levels:levels, plan:R.plan, unitList:unitList, avail:avail, pops:R.pops, caps:R.caps, times:R.times };
    }

    // ====================================================================
    //  MAGAZYN (ostrzezenie o przepelnieniu)
    // ====================================================================
    function storageInfo(){
        var v = (gd && gd.village) ? gd.village : null;
        if(!v) return null;
        var maxr = num(v.storage_max, 0);
        if(maxr <= 0) return null;
        var cur = { wood:num(v.wood,0), clay:num(v.stone,0), iron:num(v.iron,0) };
        return { max:maxr, cur:cur, free:Math.max(0, maxr - Math.max(cur.wood,cur.clay,cur.iron)) };
    }
    function storageWarning(totalRes){
        if(!settings.warn_storage) return '';
        var si = storageInfo(); if(!si) return '';
        // zbieractwo zwraca ~rowno na 3 surowce
        var perRes = totalRes/3;
        var worst = Math.max(si.cur.wood, si.cur.clay, si.cur.iron) + perRes;
        if(worst > si.max){
            return '<div style="margin-top:8px;padding:6px 8px;background:#f3d6a8;border:1px solid #a06b1f;border-radius:4px;color:#6b3a0f">'+
                   '&#9888; Lup moze przepelnic magazyn (max '+fmtInt(si.max)+'/surowiec). Przewidywane ~'+fmtInt(worst)+' najpelniejszego surowca.</div>';
        }
        return '';
    }

    // ====================================================================
    //  WPISYWANIE + WYSYLKA
    // ====================================================================
    function setVal(el, value){
        var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
        if(d && d.set) d.set.call(el, value); else el.value = value;
    }
    function fill(u, n){
        var el = resolveField(u); if(!el) return;
        el.focus(); setVal(el, String(Number(n)));
        ['keydown','input','keyup','change'].forEach(function(ev){ el.dispatchEvent(new Event(ev, {bubbles:true})); });
        el.blur(); if(window.jQuery) jQuery(el).trigger('keyup').trigger('change');
    }
    function clickLevel(level){
        var b = document.getElementsByClassName('free_send_button')[level-1];
        if(b && !b.classList.contains('btn-disabled')) b.click();
    }

    function execute(state){
        var levels = state.levels, plan = state.plan, unitList = state.unitList;
        if(!levels || levels.length === 0) return;
        logDispatch(levels, plan, unitList);

        function fillLevel(i){ unitList.forEach(function(u){ fill(u, plan[i][u]); }); }

        if(settings.auto_send == 1){
            var k = 0;
            (function step(){
                if(k >= levels.length){ return; }
                var i = k++; fillLevel(i);
                setTimeout(function(){ clickLevel(levels[i]); setTimeout(step, settings.send_delay_ms); }, 80);
            })();
        } else {
            fillLevel(0);
            console.log('[Zbieractwo] auto_send=0 -> wypelniono tylko poziom '+levels[0]);
        }
    }

    // ====================================================================
    //  POPUP
    // ====================================================================
    function showPopup(){
        var old = document.getElementById('scavPopup'); if(old) old.remove();

        var ov = document.createElement('div');
        ov.id = 'scavPopup';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:Verdana,Arial,sans-serif';
        var posStyle = settings.ui_pos ? 'position:fixed;left:'+settings.ui_pos.x+'px;top:'+settings.ui_pos.y+'px;margin:0;' : '';
        ov.innerHTML =
            '<div id="scavDlg" style="'+posStyle+'background:#f4e4bc;border:2px solid #7d510f;border-radius:6px;max-width:680px;width:96%;max-height:92vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.5)">'+
              '<div id="scavHead" style="background:#c1a264;padding:10px 14px;font-size:15px;font-weight:bold;color:#3b2a16;border-bottom:2px solid #7d510f;cursor:move">Zbieractwo - ustawienia i rozklad <span style="font-weight:normal;font-size:11px">(swiat '+WORLD+', x'+SPEED+')</span></div>'+
              '<div id="scavSettings" style="padding:10px 14px;color:#3b2a16;font-size:13px;border-bottom:1px solid #d8cfae;background:#efe2bf"></div>'+
              '<div id="scavBody" style="padding:10px 14px;color:#3b2a16;font-size:13px"></div>'+
              '<div id="scavHist" style="padding:8px 14px;color:#3b2a16;font-size:12px;border-top:1px solid #d8cfae;background:#efe2bf"></div>'+
              '<div style="padding:10px 14px;display:flex;gap:10px;justify-content:flex-end;border-top:2px solid #7d510f;background:#ede0bc;flex-wrap:wrap">'+
                '<button id="scavReset" style="padding:8px 14px;border:1px solid #7d510f;border-radius:4px;background:#cdbd8e;color:#3b2a16;font-weight:bold;cursor:pointer;margin-right:auto">Reset</button>'+
                '<button id="scavNo" style="padding:8px 18px;border:1px solid #7d510f;border-radius:4px;background:#d9c89a;color:#3b2a16;font-weight:bold;cursor:pointer">Nie, anuluj</button>'+
                '<button id="scavYes" style="padding:8px 18px;border:1px solid #2f6f2f;border-radius:4px;background:#5cab5c;color:#fff;font-weight:bold;cursor:pointer">Tak, rozloz</button>'+
              '</div>'+
            '</div>';
        document.body.appendChild(ov);

        var settingsBox = document.getElementById('scavSettings');
        var body = document.getElementById('scavBody');
        var histBox = document.getElementById('scavHist');

        makeDraggable(document.getElementById('scavHead'), document.getElementById('scavDlg'));

        function inp(id, val, w){ return '<input id="'+id+'" value="'+val+'" style="width:'+(w||60)+'px">'; }

        function renderSettings(){
            var lvBoxes = freeLevels.map(function(l){
                var on = settings.levels_enabled[l] !== false;
                return '<label style="margin-right:12px;white-space:nowrap"><input type="checkbox" data-lv="'+l+'" '+(on?'checked':'')+'> Poziom '+l+'</label>';
            }).join('');

            var unitRows = ORDER.filter(function(u){ return !(settings.archers==0 && (u=='archer'||u=='marcher')); })
                .map(function(u){
                    return '<tr>'+
                        '<td style="padding:2px 6px">'+LABEL[u]+'</td>'+
                        '<td style="padding:2px 6px;text-align:center" data-av="'+u+'">'+availableRaw(u)+'</td>'+
                        '<td style="padding:2px 6px;text-align:center"><input type="number" data-res="'+u+'" value="'+clampInt(settings.reserve[u],0)+'" style="width:64px"></td>'+
                        '<td style="padding:2px 6px;text-align:center"><input type="number" data-max="'+u+'" value="'+clampInt(settings.maxunit[u],0)+'" style="width:64px"></td>'+
                    '</tr>';
                }).join('');

            var profiles = loadProfiles();
            var profOpts = '<option value="">-- profil --</option>' + Object.keys(profiles).map(function(n){ return '<option value="'+n+'">'+n+'</option>'; }).join('');

            settingsBox.innerHTML =
                '<div style="margin-bottom:8px"><b>Poziomy:</b> '+lvBoxes+'</div>'+

                '<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-bottom:8px">'+
                    '<label><input type="checkbox" id="scavArchers" '+(settings.archers?'checked':'')+'> Swiat z lucznikami</label>'+
                    '<label><input type="checkbox" id="scavAuto" '+(settings.auto_send?'checked':'')+'> Auto-start</label>'+
                    '<label>Max surowca/poziom: '+inp('scavMaxRes', settings.max_ressources, 80)+'</label>'+
                    '<label>Min. ludnosc tieru: '+inp('scavMinPop', settings.min_population, 60)+'</label>'+
                '</div>'+

                '<div style="margin-bottom:8px;padding:6px 8px;background:#e7d6a8;border-radius:4px">'+
                    '<b>Tryb rozkladu:</b> '+
                    '<label style="margin-left:8px"><input type="radio" name="scavMode" value="equal" '+(settings.mode==='equal'?'checked':'')+'> Rowny czas</label>'+
                    '<label style="margin-left:8px"><input type="radio" name="scavMode" value="maxh" '+(settings.mode==='maxh'?'checked':'')+'> Max lup/h</label>'+
                    '<label style="margin-left:8px"><input type="radio" name="scavMode" value="time" '+(settings.mode==='time'?'checked':'')+'> Limit czasu</label>'+
                    '<span id="scavHoursWrap" style="margin-left:10px'+(settings.mode==='time'?'':';display:none')+'">do <input type="number" id="scavHours" value="'+settings.absence_hours+'" style="width:54px" step="0.5"> h</span>'+
                '</div>'+

                '<details style="margin-bottom:6px"><summary style="cursor:pointer;font-weight:bold">Jednostki (rezerwa / limit)</summary>'+
                    '<table style="width:100%;border-collapse:collapse;margin-top:6px;background:#fffaf0;border:1px solid #d8cfae">'+
                    '<tr style="background:#e7d6a8"><th style="padding:2px 6px;text-align:left">Jedn.</th><th style="padding:2px 6px">Dostepne</th><th style="padding:2px 6px">Zostaw</th><th style="padding:2px 6px">Max (0=bez)</th></tr>'+
                    unitRows + '</table>'+
                '</details>'+

                '<details style="margin-bottom:6px"><summary style="cursor:pointer;font-weight:bold">Profile / Eksport</summary>'+
                    '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">'+
                        '<select id="scavProfSel" style="min-width:140px">'+profOpts+'</select>'+
                        '<button id="scavProfLoad" type="button">Wczytaj</button>'+
                        '<button id="scavProfSave" type="button">Zapisz jako...</button>'+
                        '<button id="scavProfDel" type="button">Usun</button>'+
                        '<button id="scavExport" type="button">Eksport JSON</button>'+
                        '<button id="scavImport" type="button">Import JSON</button>'+
                    '</div>'+
                '</details>'+

                '<details style="margin-bottom:2px"><summary style="cursor:pointer;font-weight:bold">Zaawansowane (model czasu)</summary>'+
                    '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:12px;align-items:center">'+
                        '<label>duration_factor: '+inp('scavFactor', (settings.time_factor||TIME.factor), 110)+'</label>'+
                        '<label><input type="checkbox" id="scavWarn" '+(settings.warn_storage?'checked':'')+'> Ostrzegaj o magazynie</label>'+
                    '</div>'+
                    '<div style="font-size:11px;margin-top:6px;color:#6b5a3a">Wspolczynnik czasu zalezy od predkosci swiata. Jesli ETA sie nie zgadza: zmierz 1 realny bieg i wpisz wartosc (sam rozklad jednostek na to nie reaguje).</div>'+
                '</details>';

            // --- eventy: poziomy ---
            settingsBox.querySelectorAll('input[data-lv]').forEach(function(cb){
                cb.addEventListener('change', function(){ settings.levels_enabled[Number(cb.getAttribute('data-lv'))] = cb.checked; apply(); });
            });
            // --- podstawowe ---
            byId('scavArchers').addEventListener('change', function(e){ settings.archers = e.target.checked?1:0; apply(true); });
            byId('scavAuto').addEventListener('change', function(e){ settings.auto_send = e.target.checked?1:0; apply(); });
            byId('scavMaxRes').addEventListener('change', function(e){ settings.max_ressources = clampInt(e.target.value, DEFAULTS.max_ressources); apply(); });
            byId('scavMinPop').addEventListener('change', function(e){ settings.min_population = clampInt(e.target.value, DEFAULTS.min_population); apply(); });
            // --- tryb ---
            settingsBox.querySelectorAll('input[name="scavMode"]').forEach(function(r){
                r.addEventListener('change', function(){ settings.mode = r.value; var w=byId('scavHoursWrap'); if(w) w.style.display = (r.value==='time'?'':'none'); apply(true); });
            });
            var hrs = byId('scavHours'); if(hrs) hrs.addEventListener('change', function(e){ settings.absence_hours = num(e.target.value, 8); apply(); });
            // --- jednostki ---
            settingsBox.querySelectorAll('input[data-res]').forEach(function(el){
                el.addEventListener('change', function(){ settings.reserve[el.getAttribute('data-res')] = clampInt(el.value,0); apply(); });
            });
            settingsBox.querySelectorAll('input[data-max]').forEach(function(el){
                el.addEventListener('change', function(){ settings.maxunit[el.getAttribute('data-max')] = clampInt(el.value,0); apply(); });
            });
            // --- zaawansowane ---
            byId('scavFactor').addEventListener('change', function(e){ var v=num(e.target.value,0); settings.time_factor = v>0?v:0; if(v>0) TIME.factor=v; apply(); });
            byId('scavWarn').addEventListener('change', function(e){ settings.warn_storage = e.target.checked?1:0; apply(); });
            // --- profile / eksport ---
            byId('scavProfLoad').addEventListener('click', function(){
                var n = byId('scavProfSel').value; if(!n) return;
                var p = loadProfiles(); if(!p[n]) return;
                mergeInto(settings, p[n]); saveSettings(); renderSettings(); renderPlan();
            });
            byId('scavProfSave').addEventListener('click', function(){
                var n = prompt('Nazwa profilu:'); if(!n) return;
                var p = loadProfiles(); p[n] = JSON.parse(JSON.stringify(settings)); saveProfiles(p); renderSettings();
            });
            byId('scavProfDel').addEventListener('click', function(){
                var n = byId('scavProfSel').value; if(!n) return;
                var p = loadProfiles(); delete p[n]; saveProfiles(p); renderSettings();
            });
            byId('scavExport').addEventListener('click', function(){
                var txt = JSON.stringify(settings, null, 2);
                prompt('Skopiuj ustawienia (JSON):', txt);
            });
            byId('scavImport').addEventListener('click', function(){
                var txt = prompt('Wklej ustawienia (JSON):', '');
                if(!txt) return;
                try{ mergeInto(settings, JSON.parse(txt)); saveSettings(); renderSettings(); renderPlan(); }
                catch(e){ alert('Niepoprawny JSON'); }
            });
        }

        var current;
        function renderPlan(){
            current = recompute();
            var levels = current.levels, plan = current.plan, unitList = current.unitList;
            var yes = byId('scavYes');
            if(levels.length === 0){
                body.innerHTML = '<div style="color:#8a1f1f"><b>Brak poziomow do rozkladu</b> - zaznacz przynajmniej jeden poziom powyzej.</div>';
                yes.disabled = true; yes.style.opacity = .5; return;
            }
            yes.disabled = false; yes.style.opacity = 1;

            // ile zostaje w domu (na bazie efektywnej dostepnosci)
            var sentTotal = {}; unitList.forEach(function(u){ sentTotal[u]=0; });
            levels.forEach(function(l,i){ unitList.forEach(function(u){ sentTotal[u]+=plan[i][u]; }); });

            var totalPop=0, totalRes=0, maxTime=0;
            var rows = levels.map(function(l,i){
                var pop = current.pops[i], cap = current.caps[i];
                var res = Math.round(cap*LOOT[l]);
                var t = current.times[i];
                var lph = Math.round(lootPerHour(LOOT[l], cap));
                totalPop+=pop; totalRes+=res; if(t>maxTime) maxTime=t;
                var cells = unitList.filter(function(u){return plan[i][u]>0;})
                    .map(function(u){ return LABEL[u]+': <b>'+plan[i][u]+'</b>'; }).join('<br>') || '-';
                return '<tr style="border-top:1px solid #d8cfae">'+
                    '<td style="padding:5px 8px;text-align:center;font-weight:bold">'+l+'</td>'+
                    '<td style="padding:5px 8px;text-align:center">'+LOOT[l]+'</td>'+
                    '<td style="padding:5px 8px">'+cells+'</td>'+
                    '<td style="padding:5px 8px;text-align:center">'+pop+'</td>'+
                    '<td style="padding:5px 8px;text-align:center">'+fmtInt(res)+'</td>'+
                    '<td style="padding:5px 8px;text-align:center;white-space:nowrap">'+(t>0?fmtDur(t):'-')+'<br><span style="font-size:11px;color:#6b5">'+(t>0?fmtClock(t):'')+'</span></td>'+
                    '<td style="padding:5px 8px;text-align:center">'+fmtInt(lph)+'</td></tr>';
            }).join('');

            var leftover = unitList.filter(function(u){ return (current.avail[u]-sentTotal[u])>0; })
                .map(function(u){ return LABEL[u]+': '+(current.avail[u]-sentTotal[u]); }).join(', ');

            body.innerHTML =
                '<div style="margin-bottom:6px">Kolejnosc: <b>'+levels.join(' -> ')+'</b> &nbsp;|&nbsp; tryb: <b>'+modeLabel()+'</b></div>'+
                '<table style="width:100%;border-collapse:collapse;background:#fffaf0;border:1px solid #d8cfae">'+
                  '<tr style="background:#e7d6a8">'+
                    '<th style="padding:5px 8px">Poz.</th><th style="padding:5px 8px">Faktor</th><th style="padding:5px 8px;text-align:left">Jednostki</th>'+
                    '<th style="padding:5px 8px">Ludn.</th><th style="padding:5px 8px">~Lup</th><th style="padding:5px 8px">Czas / powrot</th><th style="padding:5px 8px">Lup/h</th></tr>'+
                  rows +
                  '<tr style="background:#e7d6a8;font-weight:bold"><td colspan="3" style="padding:5px 8px;text-align:right">Razem:</td>'+
                    '<td style="padding:5px 8px;text-align:center">'+totalPop+'</td>'+
                    '<td style="padding:5px 8px;text-align:center">'+fmtInt(totalRes)+'</td>'+
                    '<td style="padding:5px 8px;text-align:center">'+(maxTime>0?'max '+fmtDur(maxTime):'-')+'</td>'+
                    '<td style="padding:5px 8px;text-align:center">'+fmtInt(maxTime>0?(totalRes/(maxTime/3600)):0)+'</td></tr>'+
                '</table>'+
                storageWarning(totalRes)+
                (leftover ? '<div style="margin-top:6px;font-size:11px;color:#6b5a3a">W domu zostaje: '+leftover+'</div>' : '');
        }

        function modeLabel(){ return settings.mode==='maxh'?'max lup/h':(settings.mode==='time'?('limit '+settings.absence_hours+'h'):'rowny czas'); }

        function renderHistory(){
            var h = loadHistory();
            if(h.length === 0){ histBox.innerHTML = '<span style="color:#8a7a55">Historia pusta.</span>'; return; }
            var totalRes = h.reduce(function(s,r){ return s + (r.res||0); }, 0);
            var first = h[0].t, days = Math.max(1, (Date.now()-first)/86400000);
            histBox.innerHTML =
                '<b>Historia ('+WORLD+'):</b> wyslan: '+h.length+' &nbsp;|&nbsp; lacznie ~'+fmtInt(totalRes)+' surowca'+
                ' &nbsp;|&nbsp; ~'+fmtInt(totalRes/days)+'/dzien '+
                '<button id="scavHistClear" type="button" style="margin-left:8px">Wyczysc</button>';
            var b = byId('scavHistClear'); if(b) b.addEventListener('click', function(){ saveHistory([]); renderHistory(); });
        }

        function apply(reRenderSettings){
            saveSettings();
            if(reRenderSettings) renderSettings();
            renderPlan();
        }

        function close(){ document.removeEventListener('keydown', onKey); ov.remove(); }
        function onKey(e){ if(e.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);
        ov.addEventListener('click', function(e){ if(e.target === ov) close(); });
        byId('scavNo').addEventListener('click', close);
        byId('scavReset').addEventListener('click', function(){
            settings = deepDefaults(); saveSettings(); renderSettings(); renderPlan(); renderHistory();
        });
        byId('scavYes').addEventListener('click', function(){
            if(!current || current.levels.length === 0) return;
            saveSettings(); close(); execute(current);
        });

        renderSettings();
        renderPlan();
        renderHistory();
    }

    // ====================================================================
    //  POMOCNICZE UI
    // ====================================================================
    function byId(id){ return document.getElementById(id); }
    function mergeInto(target, src){
        for(var k in src){
            if(!(k in target)) continue;
            if(typeof target[k]==='object' && target[k] && !Array.isArray(target[k]) && src[k]){
                for(var s in src[k]){ if(s in target[k]) target[k][s] = src[k][s]; }
            } else { target[k] = src[k]; }
        }
    }
    function makeDraggable(handle, dlg){
        if(!handle || !dlg) return;
        var sx, sy, ox, oy, dragging = false;
        handle.addEventListener('mousedown', function(e){
            dragging = true;
            var r = dlg.getBoundingClientRect();
            dlg.style.position = 'fixed'; dlg.style.margin = '0';
            ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
            e.preventDefault();
        });
        document.addEventListener('mousemove', function(e){
            if(!dragging) return;
            var x = ox + (e.clientX - sx), y = oy + (e.clientY - sy);
            dlg.style.left = x+'px'; dlg.style.top = y+'px';
        });
        document.addEventListener('mouseup', function(){
            if(!dragging) return; dragging = false;
            var r = dlg.getBoundingClientRect();
            settings.ui_pos = { x: Math.round(r.left), y: Math.round(r.top) }; saveSettings();
        });
    }

    // ====================================================================
    //  LOG DO KONSOLI
    // ====================================================================
    (function logInitial(){
        var st = recompute();
        console.log('[Zbieractwo] swiat '+WORLD+' x'+SPEED+' | tryb '+settings.mode+' | czas: exp='+TIME.exp+' init='+TIME.init+' factor='+TIME.factor);
        console.log('[Zbieractwo] kolejnosc: '+(st.levels.join(' -> ')||'(brak)'));
        st.levels.forEach(function(l,i){
            var parts = st.unitList.filter(function(u){return st.plan[i][u]>0;}).map(function(u){return u+':'+st.plan[i][u];});
            console.log('  Poziom '+l+' (faktor '+LOOT[l]+', '+st.pops[i]+' ludn., czas '+fmtDur(st.times[i])+', lup/h '+Math.round(lootPerHour(LOOT[l],st.caps[i]))+') -> '+(parts.join(', ')||'-'));
        });
    })();

    // ====================================================================
    //  START
    // ====================================================================
    if(settings.confirm_popup == 1) showPopup();
    else execute(recompute());

})();
