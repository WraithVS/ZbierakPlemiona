//  Scavenge optimizer + popup potwierdzenia (Plemiona / TribalWars)
//  Wersja do hostowania i ladowania przez:  javascript:$.getScript('RAW_URL');
//   - rozklad na wolne poziomy, kolejnosc od najwyzszego tieru
//   - prog 10 ludnosci na najwyzszym tierze -> wylacza najnizszy tier (od dolu)
//   - POPUP: pokazuje plan i pyta Tak/Nie przed wysylka
//  Koszt ludnosci: piki/miecz/topor/lucznik=1, lekki=4, lucznik konny=5, ciezki=6

(function(){
    var settings = {
        max_ressources: 99999,   // maks. surowca z JEDNEGO poziomu
        archers: 0,              // 1 = swiat z lucznikami, 0 = bez
        skip_level_1: 1,         // 1 = pomin poziom 1 zawsze
        min_population: 10,      // prog ludnosci najwyzszego tieru
        confirm_popup: 1,        // 1 = pokaz okno potwierdzenia; 0 = od razu dzialaj
        auto_send: 1,            // 1 = po Tak wypelnij i KLIKNIJ Start; 0 = tylko wypelnij
        send_delay_ms: 350
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

    var unitList=ORDER.filter(function(u){return !(settings.archers==0&&(u=='archer'||u=='marcher'));});

    function resolveField(u){return document.querySelector('input.unitsInput[name="'+u+'"]')||document.querySelector('input[name="'+u+'"]');}
    function available(u){
        var f=resolveField(u); if(!f)return 0;
        var box=f.closest('td')||f.parentNode, a=box?box.querySelector('a.units-entry-all'):null;
        if(a){var m=a.innerText.match(/\d+/); if(m)return Number(m[0]);}
        return 0;
    }

    var buttons=Array.prototype.slice.call(document.getElementsByClassName('free_send_button'));
    if(buttons.length==0){alert('Nie znaleziono przyciskow poziomow'); return;}
    var freeLevels=[];
    buttons.forEach(function(btn,idx){if(!btn.classList.contains('btn-disabled'))freeLevels.push(idx+1);});
    if(settings.skip_level_1==1)freeLevels=freeLevels.filter(function(l){return l!=1;});
    if(freeLevels.length==0){alert('Brak wolnych poziomow zbieractwa'); return;}

    var avail={};
    unitList.forEach(function(u){
        var c=unit_cfg[u], a=available(u);
        a=a>c.untouchable?a-c.untouchable:0;
        if(a>=c.conditional_safeguard)a-=c.conditional_safeguard;
        if(a>c.max_unit_number)a=c.max_unit_number;
        avail[u]=a;
    });

    function buildPlan(levels){
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

    var levels=freeLevels.slice().sort(function(a,b){return b-a;});
    var R=buildPlan(levels);
    while(levels.length>1&&topTierPop(levels,R.pops)<settings.min_population){
        var lowest=levels.reduce(function(a,b){return LOOT[a]<LOOT[b]?a:b;});
        levels=levels.filter(function(l){return l!=lowest;});
        R=buildPlan(levels);
    }
    var plan=R.plan;

    function setVal(el,value){var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value');if(d&&d.set)d.set.call(el,value);else el.value=value;}
    function fill(u,n){
        var el=resolveField(u); if(!el)return;
        el.focus(); setVal(el,String(Number(n)));
        ['keydown','input','keyup','change'].forEach(function(ev){el.dispatchEvent(new Event(ev,{bubbles:true}));});
        el.blur(); if(window.jQuery)jQuery(el).trigger('keyup').trigger('change');
    }
    function fillLevel(i){unitList.forEach(function(u){fill(u,plan[i][u]);});}
    function clickLevel(level){var b=document.getElementsByClassName('free_send_button')[level-1];if(b&&!b.classList.contains('btn-disabled'))b.click();}

    function execute(){
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

    function showPopup(onYes){
        var old=document.getElementById('scavPopup'); if(old)old.remove();
        var rows=levels.map(function(l,i){
            var pop=unitList.reduce(function(s,u){return s+plan[i][u]*POP[u];},0);
            var cells=unitList.filter(function(u){return plan[i][u]>0;})
                .map(function(u){return LABEL[u]+': <b>'+plan[i][u]+'</b>';}).join('<br>')||'-';
            return '<tr style="border-top:1px solid #d8cfae">'+
                '<td style="padding:6px 10px;text-align:center;font-weight:bold">'+l+'</td>'+
                '<td style="padding:6px 10px;text-align:center">'+LOOT[l]+'</td>'+
                '<td style="padding:6px 10px;text-align:center">'+pop+'</td>'+
                '<td style="padding:6px 10px">'+cells+'</td></tr>';
        }).join('');

        var ov=document.createElement('div');
        ov.id='scavPopup';
        ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:Verdana,Arial,sans-serif';
        ov.innerHTML=
            '<div style="background:#f4e4bc;border:2px solid #7d510f;border-radius:6px;max-width:560px;width:92%;max-height:88vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.5)">'+
              '<div style="background:#c1a264;padding:10px 14px;font-size:15px;font-weight:bold;color:#3b2a16;border-bottom:2px solid #7d510f">Zbieractwo - potwierdz rozklad</div>'+
              '<div style="padding:12px 14px;color:#3b2a16;font-size:13px">'+
                '<div style="margin-bottom:8px">Kolejnosc wysylki: <b>'+levels.join(' -> ')+'</b></div>'+
                '<table style="width:100%;border-collapse:collapse;background:#fffaf0;border:1px solid #d8cfae">'+
                  '<tr style="background:#e7d6a8"><th style="padding:6px 10px">Poziom</th><th style="padding:6px 10px">Faktor</th><th style="padding:6px 10px">Ludnosc</th><th style="padding:6px 10px;text-align:left">Jednostki</th></tr>'+
                  rows+
                '</table>'+
              '</div>'+
              '<div style="padding:10px 14px;display:flex;gap:10px;justify-content:flex-end;border-top:2px solid #7d510f;background:#ede0bc">'+
                '<button id="scavNo" style="padding:8px 18px;border:1px solid #7d510f;border-radius:4px;background:#d9c89a;color:#3b2a16;font-weight:bold;cursor:pointer">Nie, anuluj</button>'+
                '<button id="scavYes" style="padding:8px 18px;border:1px solid #2f6f2f;border-radius:4px;background:#5cab5c;color:#fff;font-weight:bold;cursor:pointer">Tak, rozloz</button>'+
              '</div>'+
            '</div>';
        document.body.appendChild(ov);

        function close(){document.removeEventListener('keydown',onKey);ov.remove();}
        function onKey(e){if(e.key==='Escape')close();}
        document.addEventListener('keydown',onKey);
        ov.addEventListener('click',function(e){if(e.target===ov)close();});
        document.getElementById('scavNo').addEventListener('click',close);
        document.getElementById('scavYes').addEventListener('click',function(){close();onYes();});
    }

    console.log('[Zbieractwo] kolejnosc: '+levels.join(' -> '));
    levels.forEach(function(l,i){
        var pop=unitList.reduce(function(s,u){return s+plan[i][u]*POP[u];},0);
        var parts=unitList.filter(function(u){return plan[i][u]>0;}).map(function(u){return u+':'+plan[i][u];});
        console.log('  Poziom '+l+' (faktor '+LOOT[l]+', '+pop+' ludnosci) -> '+(parts.join(', ')||'-'));
    });

    if(settings.confirm_popup==1) showPopup(execute);
    else execute();
})();
