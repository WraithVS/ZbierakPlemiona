//  Scavenge optimizer + popup z ustawieniami na zywo (Plemiona / TribalWars)
//  Wersja do hostowania i ladowania przez:  javascript:$.getScript('RAW_URL');
//   - rozklad na wybrane poziomy, kolejnosc od najwyzszego tieru
//   - checkboxy per poziom (mozesz wlaczyc/wylaczyc np. poziom 1)
//   - przelaczniki: lucznicy, auto-start, max surowca/poziom, min. ludnosc tieru
//   - kazda zmiana w popupie -> przelicza plan i odrysowuje tabele
//   - ustawienia zapisywane w localStorage (per swiat)
//  Koszt ludnosci: piki/miecz/topor/lucznik=1, lekki=4, lucznik konny=5, ciezki=6

(function(){
    // ---- domyslne ustawienia (uzywane przy pierwszym uruchomieniu / po resecie) ----
    var DEFAULTS = {
        max_ressources: 99999,   // maks. surowca z JEDNEGO poziomu
        archers: 0,              // 1 = swiat z lucznikami, 0 = bez
        min_population: 10,      // prog ludnosci najwyzszego tieru
        confirm_popup: 1,        // 1 = pokaz okno potwierdzenia; 0 = od razu dzialaj
        auto_send: 1,            // 1 = po Tak wypelnij i KLIKNIJ Start; 0 = tylko wypelnij
        send_delay_ms: 350,
        // ktore poziomy biora udzial w rozkladzie (domyslnie poziom 1 wylaczony)
        levels_enabled: { 1:false, 2:true, 3:true, 4:true }
    };

    var unit_cfg = {
        spear:   { untouchable: 0, max_unit_number: 99999, conditional_safeguard: 0 },
        sword:   { untouchable: 0, max_unit_number: 99999, conditional_safeguard: 0 },
        axe:     { untouchable: 0, max_unit_number: 99999, conditional_safeguard: 0 },
        archer:  { untouchable: 0, max_unit_number: 99999, conditional_safeguard: 0 },
        light:   { untouchable: 0, max_unit_number: 99999, conditional_safeguard: 0 },
        marcher: { untouchable: 0, max_unit_number: 99999, conditional_safeguard: 0 },
        heavy:   { untouchable: 0, max_unit_number: 99999, conditional_safeguard: 0 }
    };

    var ORDER=['spear','sword','axe','archer','light','marcher','heavy'];
    var CAP={spear:25,sword:15,axe:10,archer:10,light:80,marcher:50,heavy:50}; // pojemnosc lupu
    var POP={spear:1,sword:1,axe:1,archer:1,light:4,marcher:5,heavy:6};        // ludnosc
    var LOOT={1:0.10,2:0.25,3:0.50,4:0.75};                                    // faktor lupu
    var LABEL={spear:'Pikinier',sword:'Miecznik',axe:'Topornik',archer:'Lucznik',light:'Lekki kaw.',marcher:'Lucznik konny',heavy:'Ciezki kaw.'};

    var url=document.URL;
    if(url.indexOf('screen=place')==-1||url.indexOf('mode=scavenge')==-1){
        alert('Skrypt do uzycia w placu w zakladce zbieractwo'); return;
    }

    // ---- localStorage: klucz per swiat, zeby rozne swiaty mialy rozne ustawienia ----
    var STORE_KEY = 'zbieracz_settings_' + (
        (window.game_data && game_data.world) ? game_data.world :
        (location.host.split('.')[0] || 'default')
    );

    function loadSettings(){
        var s = {};
        for(var k in DEFAULTS) s[k] = (typeof DEFAULTS[k]==='object')
            ? JSON.parse(JSON.stringify(DEFAULTS[k])) : DEFAULTS[k];
        try{
            var raw = localStorage.getItem(STORE_KEY);
            if(raw){
                var saved = JSON.parse(raw);
                for(var key in saved){
                    if(key==='levels_enabled' && saved.levels_enabled){
                        for(var lv in saved.levels_enabled) s.levels_enabled[lv] = !!saved.levels_enabled[lv];
                    } else if(key in s){
                        s[key] = saved[key];
                    }
                }
            }
        }catch(e){ console.warn('[Zbieractwo] nie udalo sie wczytac ustawien:', e); }
        return s;
    }
    function saveSettings(){
        try{ localStorage.setItem(STORE_KEY, JSON.stringify(settings)); }
        catch(e){ console.warn('[Zbieractwo] nie udalo sie zapisac ustawien:', e); }
    }

    var settings = loadSettings();

    // ---- wykrycie wolnych poziomow (przyciski na placu) ----
    var buttons=Array.prototype.slice.call(document.getElementsByClassName('free_send_button'));
    if(buttons.length==0){alert('Nie znaleziono przyciskow poziomow'); return;}
    var freeLevels=[];
    buttons.forEach(function(btn,idx){if(!btn.classList.contains('btn-disabled'))freeLevels.push(idx+1);});
    if(freeLevels.length==0){alert('Brak wolnych poziomow zbieractwa'); return;}

    // ---- helpery dostepnosci jednostek ----
    function resolveField(u){return document.querySelector('input.unitsInput[name="'+u+'"]')||document.querySelector('input[name="'+u+'"]');}
    function available(u){
        var f=resolveField(u); if(!f)return 0;
        var box=f.closest('td')||f.parentNode, a=box?box.querySelector('a.units-entry-all'):null;
        if(a){var m=a.innerText.match(/\d+/); if(m)return Number(m[0]);}
        return 0;
    }

    // ---- rdzen: liczenie planu (matematyka bez zmian) ----
    function buildPlan(levels, unitList, avail){
        var tw=levels.reduce(function(s,l){return s+1/LOOT[l];},0);
        var plan=levels.map(function(){var o={};unitList.forEach(function(u){o[u]=0;});return o;});
        unitList.forEach(function(u){
            if(avail[u]<=0)return;
            levels.forEach(function(l,i){plan[i][u]=avail[u]*(1/LOOT[l])/tw;});
        });
        levels.forEach(function(l,i){
            var cap=0; unitList.forEach(function(u){cap+=plan[i][u]*CAP[u];});
            var res=cap*LOOT[l];
            if(res>settings.max_ressources&&res>0){var r=settings.max_ressources/res;unitList.forEach(function(u){plan[i][u]*=r;});}
        });
        var pops=plan.map(function(p){var pp=0;unitList.forEach(function(u){p[u]=Math.floor(p[u]);pp+=p[u]*POP[u];});return pp;});
        return {plan:plan,pops:pops};
    }
    function topTierPop(levels,pops){var hi=0;for(var i=1;i<levels.length;i++)if(LOOT[levels[i]]>LOOT[levels[hi]])hi=i;return pops[hi];}

    // ---- recompute: czyta aktualne settings, zwraca {levels, plan, unitList, avail} ----
    function recompute(){
        var unitList=ORDER.filter(function(u){return !(settings.archers==0&&(u=='archer'||u=='marcher'));});

        var avail={};
        unitList.forEach(function(u){
            var c=unit_cfg[u], a=available(u);
            a=a>c.untouchable?a-c.untouchable:0;
            if(a>=c.conditional_safeguard)a-=c.conditional_safeguard;
            if(a>c.max_unit_number)a=c.max_unit_number;
            avail[u]=a;
        });

        // poziomy = wolne ∩ zaznaczone w ustawieniach
        var levels=freeLevels.filter(function(l){return settings.levels_enabled[l]!==false;});
        if(levels.length===0) return {levels:[],plan:[],unitList:unitList,avail:avail};

        levels=levels.slice().sort(function(a,b){return b-a;});
        var R=buildPlan(levels, unitList, avail);
        // proba ludnosciowa: ucina najslabszy tier dopoki top tier < min_population
        while(levels.length>1&&topTierPop(levels,R.pops)<settings.min_population){
            var lowest=levels.reduce(function(a,b){return LOOT[a]<LOOT[b]?a:b;});
            levels=levels.filter(function(l){return l!=lowest;});
            R=buildPlan(levels, unitList, avail);
        }
        return {levels:levels, plan:R.plan, unitList:unitList, avail:avail};
    }

    // ---- wpisywanie wartosci do pol + klikanie Start ----
    function setVal(el,value){var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value');if(d&&d.set)d.set.call(el,value);else el.value=value;}
    function fill(u,n){
        var el=resolveField(u); if(!el)return;
        el.focus(); setVal(el,String(Number(n)));
        ['keydown','input','keyup','change'].forEach(function(ev){el.dispatchEvent(new Event(ev,{bubbles:true}));});
        el.blur(); if(window.jQuery)jQuery(el).trigger('keyup').trigger('change');
    }
    function clickLevel(level){var b=document.getElementsByClassName('free_send_button')[level-1];if(b&&!b.classList.contains('btn-disabled'))b.click();}

    function execute(state){
        var levels=state.levels, plan=state.plan, unitList=state.unitList;
        function fillLevel(i){unitList.forEach(function(u){fill(u,plan[i][u]);});}
        if(settings.auto_send==1){
            var k=0;
            (function step(){
                if(k>=levels.length)return;
                var i=k++; fillLevel(i);
                setTimeout(function(){clickLevel(levels[i]);setTimeout(step,settings.send_delay_ms);},80);
            })();
        } else {
            fillLevel(0);
            console.log('[Zbieractwo] auto_send=0 -> wypelniono tylko poziom '+levels[0]);
        }
    }

    // ---- POPUP z panelem ustawien ----
    function showPopup(){
        var old=document.getElementById('scavPopup'); if(old)old.remove();

        var ov=document.createElement('div');
        ov.id='scavPopup';
        ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:Verdana,Arial,sans-serif';
        ov.innerHTML=
            '<div style="background:#f4e4bc;border:2px solid #7d510f;border-radius:6px;max-width:600px;width:94%;max-height:90vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.5)">'+
              '<div style="background:#c1a264;padding:10px 14px;font-size:15px;font-weight:bold;color:#3b2a16;border-bottom:2px solid #7d510f">Zbieractwo - ustawienia i rozklad</div>'+
              '<div id="scavSettings" style="padding:12px 14px;color:#3b2a16;font-size:13px;border-bottom:1px solid #d8cfae;background:#efe2bf"></div>'+
              '<div id="scavBody" style="padding:12px 14px;color:#3b2a16;font-size:13px"></div>'+
              '<div style="padding:10px 14px;display:flex;gap:10px;justify-content:flex-end;border-top:2px solid #7d510f;background:#ede0bc">'+
                '<button id="scavReset" style="padding:8px 14px;border:1px solid #7d510f;border-radius:4px;background:#cdbd8e;color:#3b2a16;font-weight:bold;cursor:pointer;margin-right:auto">Reset</button>'+
                '<button id="scavNo" style="padding:8px 18px;border:1px solid #7d510f;border-radius:4px;background:#d9c89a;color:#3b2a16;font-weight:bold;cursor:pointer">Nie, anuluj</button>'+
                '<button id="scavYes" style="padding:8px 18px;border:1px solid #2f6f2f;border-radius:4px;background:#5cab5c;color:#fff;font-weight:bold;cursor:pointer">Tak, rozloz</button>'+
              '</div>'+
            '</div>';
        document.body.appendChild(ov);

        var settingsBox=document.getElementById('scavSettings');
        var body=document.getElementById('scavBody');

        function renderSettings(){
            var lvBoxes=freeLevels.map(function(l){
                var on=settings.levels_enabled[l]!==false;
                return '<label style="margin-right:12px;white-space:nowrap"><input type="checkbox" data-lv="'+l+'" '+(on?'checked':'')+'> Poziom '+l+'</label>';
            }).join('');
            settingsBox.innerHTML=
                '<div style="margin-bottom:8px"><b>Poziomy:</b> '+lvBoxes+'</div>'+
                '<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center">'+
                    '<label><input type="checkbox" id="scavArchers" '+(settings.archers?'checked':'')+'> Swiat z lucznikami</label>'+
                    '<label><input type="checkbox" id="scavAuto" '+(settings.auto_send?'checked':'')+'> Auto-start</label>'+
                    '<label>Max surowca/poziom: <input type="number" id="scavMaxRes" value="'+settings.max_ressources+'" style="width:80px"></label>'+
                    '<label>Min. ludnosc tieru: <input type="number" id="scavMinPop" value="'+settings.min_population+'" style="width:60px"></label>'+
                '</div>';

            // podpiecie eventow
            settingsBox.querySelectorAll('input[data-lv]').forEach(function(cb){
                cb.addEventListener('change',function(){
                    settings.levels_enabled[Number(cb.getAttribute('data-lv'))]=cb.checked;
                    apply();
                });
            });
            document.getElementById('scavArchers').addEventListener('change',function(e){settings.archers=e.target.checked?1:0;apply();});
            document.getElementById('scavAuto').addEventListener('change',function(e){settings.auto_send=e.target.checked?1:0;apply(true);});
            document.getElementById('scavMaxRes').addEventListener('change',function(e){var v=parseInt(e.target.value,10);settings.max_ressources=isNaN(v)?DEFAULTS.max_ressources:v;apply();});
            document.getElementById('scavMinPop').addEventListener('change',function(e){var v=parseInt(e.target.value,10);settings.min_population=isNaN(v)?DEFAULTS.min_population:v;apply();});
        }

        var current; // ostatnio policzony stan
        function renderPlan(){
            current=recompute();
            var levels=current.levels, plan=current.plan, unitList=current.unitList;
            if(levels.length===0){
                body.innerHTML='<div style="color:#8a1f1f"><b>Brak poziomow do rozkladu</b> - zaznacz przynajmniej jeden poziom powyzej.</div>';
                document.getElementById('scavYes').disabled=true;
                document.getElementById('scavYes').style.opacity=.5;
                return;
            }
            document.getElementById('scavYes').disabled=false;
            document.getElementById('scavYes').style.opacity=1;

            var totalPop=0, totalRes=0;
            var rows=levels.map(function(l,i){
                var pop=unitList.reduce(function(s,u){return s+plan[i][u]*POP[u];},0);
                var cap=unitList.reduce(function(s,u){return s+plan[i][u]*CAP[u];},0);
                var res=Math.round(cap*LOOT[l]);
                totalPop+=pop; totalRes+=res;
                var cells=unitList.filter(function(u){return plan[i][u]>0;})
                    .map(function(u){return LABEL[u]+': <b>'+plan[i][u]+'</b>';}).join('<br>')||'-';
                return '<tr style="border-top:1px solid #d8cfae">'+
                    '<td style="padding:6px 10px;text-align:center;font-weight:bold">'+l+'</td>'+
                    '<td style="padding:6px 10px;text-align:center">'+LOOT[l]+'</td>'+
                    '<td style="padding:6px 10px;text-align:center">'+pop+'</td>'+
                    '<td style="padding:6px 10px;text-align:center">'+res.toLocaleString('pl-PL')+'</td>'+
                    '<td style="padding:6px 10px">'+cells+'</td></tr>';
            }).join('');

            body.innerHTML=
                '<div style="margin-bottom:8px">Kolejnosc wysylki: <b>'+levels.join(' -> ')+'</b></div>'+
                '<table style="width:100%;border-collapse:collapse;background:#fffaf0;border:1px solid #d8cfae">'+
                  '<tr style="background:#e7d6a8"><th style="padding:6px 10px">Poziom</th><th style="padding:6px 10px">Faktor</th><th style="padding:6px 10px">Ludnosc</th><th style="padding:6px 10px">~Lup</th><th style="padding:6px 10px;text-align:left">Jednostki</th></tr>'+
                  rows+
                  '<tr style="background:#e7d6a8;font-weight:bold"><td colspan="2" style="padding:6px 10px;text-align:right">Razem:</td><td style="padding:6px 10px;text-align:center">'+totalPop+'</td><td style="padding:6px 10px;text-align:center">'+totalRes.toLocaleString('pl-PL')+'</td><td></td></tr>'+
                '</table>';
        }

        function apply(skipReSettings){
            saveSettings();
            if(!skipReSettings){} // panel ustawien nie wymaga przerysowania przy kazdej zmianie
            renderPlan();
        }

        function close(){document.removeEventListener('keydown',onKey);ov.remove();}
        function onKey(e){if(e.key==='Escape')close();}
        document.addEventListener('keydown',onKey);
        ov.addEventListener('click',function(e){if(e.target===ov)close();});
        document.getElementById('scavNo').addEventListener('click',close);
        document.getElementById('scavReset').addEventListener('click',function(){
            settings=JSON.parse(JSON.stringify(DEFAULTS));
            saveSettings(); renderSettings(); renderPlan();
        });
        document.getElementById('scavYes').addEventListener('click',function(){
            if(!current||current.levels.length===0)return;
            saveSettings(); close(); execute(current);
        });

        renderSettings();
        renderPlan();
    }

    // ---- log do konsoli (na bazie biezacych ustawien) ----
    (function logInitial(){
        var st=recompute();
        console.log('[Zbieractwo] kolejnosc: '+(st.levels.join(' -> ')||'(brak)'));
        st.levels.forEach(function(l,i){
            var pop=st.unitList.reduce(function(s,u){return s+st.plan[i][u]*POP[u];},0);
            var parts=st.unitList.filter(function(u){return st.plan[i][u]>0;}).map(function(u){return u+':'+st.plan[i][u];});
            console.log('  Poziom '+l+' (faktor '+LOOT[l]+', '+pop+' ludnosci) -> '+(parts.join(', ')||'-'));
        });
    })();

    if(settings.confirm_popup==1) showPopup();
    else execute(recompute());
})();
