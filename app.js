/* MCGateway Field Manual. Read-only browser client for the official public APIs. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const format = n => new Intl.NumberFormat('en-US').format(n);
  const numeric = n => Number.isSafeInteger(n) && n >= 0;
  const escapeStatus = {available:'Available',near_capacity:'Near capacity',full:'Full',offline:'Offline',checking:'Checking'};
  const validStatuses = new Set(Object.keys(escapeStatus));
  // GitHub Pages serves static files only. Read public data directly when allowed by CORS.
  // Other hosts preserve the Cloudflare Worker proxy fallback behavior.
  const isStaticPreview = location.protocol === 'file:' || location.hostname.endsWith('.github.io');
  // The design preview must never silently substitute invented statistics or bot statuses.
  const CACHE_KEY = 'mcgateway-v3-verified-v2:';
  const MAX_CACHE_AGE = {summary: 12*60*60*1000, bots: 30*60*1000, statistics: 12*60*60*1000};
  const resources = {
    summary: {live:false,verifiedAt:null},
    bots: {live:false,verifiedAt:null},
    statistics: {live:false,verifiedAt:null}
  };
  const lastGood = new Map();
  const pendingRequests = new Map();
  const isLive = kind => resources[kind]?.live===true;
  const verifiedTime = kind => resources[kind]?.verifiedAt ? new Date(resources[kind].verifiedAt).toLocaleTimeString() : 'unknown';
  function validator(kind, data, cached=false) {
    if(kind==='summary')return validateSummary(data);
    if(kind==='bots')return validateFleet(data,cached);
    return validateRecent(data);
  }
  function lastVerified(kind) {
    const inMemory=lastGood.get(kind);
    if(inMemory && Date.now()-inMemory.savedAt <= MAX_CACHE_AGE[kind])return inMemory;
    try {
      const entry=JSON.parse(localStorage.getItem(CACHE_KEY+kind)||'null');
      if(!entry || !Number.isFinite(entry.savedAt) || entry.savedAt>Date.now()+60000 ||
         Date.now()-entry.savedAt>MAX_CACHE_AGE[kind])return null;
      validator(kind,entry.data,true);
      lastGood.set(kind,entry);
      return entry;
    }catch{return null;}
  }
  function rememberVerified(kind,data) {
    const entry={data,savedAt:Date.now()};
    lastGood.set(kind,entry);
    try{localStorage.setItem(CACHE_KEY+kind,JSON.stringify(entry));}catch{}
    const age=Date.now()-Date.parse(data.generatedAt||'');
    const freshBot=kind!=='bots'||(Number.isFinite(age)&&age>=-60000&&age<=180000);
    resources[kind]={live:freshBot,verifiedAt:freshBot?entry.savedAt:Date.parse(data.generatedAt)};
  }
  function markCached(kind,entry) {
    const generated=Date.parse(entry?.data?.generatedAt||'');
    resources[kind]={live:false,verifiedAt:Number.isFinite(generated)?generated:(entry?.savedAt??null)};
  }
  const ENDPOINTS = {
    summary: isStaticPreview ? ['https://mcgateway.net/api/summary'] : ['/api/summary','https://api.mcgateway.net/v1/public/summary'],
    bots: isStaticPreview ? ['https://mcgateway.net/api/bots'] : ['/api/bots','https://api.mcgateway.net/v1/public/bots'],
    statistics: isStaticPreview ? ['https://mcgateway.net/api/statistics'] : ['/api/statistics','https://api.mcgateway.net/v1/public/statistics']
  };
  let toastTimer = null;
  const time = iso => Date.parse(iso || '');
  function toast(message) {
    const node = $('toast');if (!node) return;
    node.textContent=message;node.classList.add('visible');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('visible'),3100);
  }
  function setAll(selector,value) {
    const label=String(value);
    $$(selector).forEach(el=>{
      const useReel=el.matches('[data-stat],[data-recent],[data-live="hubPlayers"]') && Boolean(window.MCGatewayRoll);
      if(useReel){
        const valid=/^[0-9][0-9,]*$/.test(label);
        const num=valid?Number(label.replace(/,/g,'')):NaN;
        if(Number.isSafeInteger(num)&&num>=0)window.MCGatewayRoll.set(el,num);
        else window.MCGatewayRoll.clear(el,label);
      }else el.textContent=label;
      if(el.matches('[data-stat]'))el.classList.toggle('is-placeholder', !/^[0-9,]+$/.test(label));
    });
  }
  function relative(iso) {
    const at=time(iso);if (!Number.isFinite(at)) return 'Unknown';
    const seconds=Math.max(0,Math.floor((Date.now()-at)/1000));
    if(seconds<10) return 'just now';if(seconds<60)return `${seconds}s ago`;
    if(seconds<3600) return `${Math.floor(seconds/60)}m ago`;
    if(seconds<86400) return `${Math.floor(seconds/3600)}h ago`;
    return `${Math.floor(seconds/86400)}d ago`;
  }
  // Human-readable clocks tick independently of live API polling.
  let summaryGeneratedAt=NaN, lastTransferAt=NaN, fleetGeneratedAt=NaN;
  function elapsedDescription(at) {
    if(!Number.isFinite(at))return 'Unavailable';
    const seconds=Math.max(0,Math.floor((Date.now()-at)/1000));
    if(seconds<1)return 'just now';
    if(seconds<60)return seconds+' '+(seconds===1?'second':'seconds')+' ago';
    const minutes=Math.floor(seconds/60);
    if(minutes<60)return minutes+' '+(minutes===1?'minute':'minutes')+' ago';
    const hours=Math.floor(minutes/60);
    if(hours<24)return hours+' '+(hours===1?'hour':'hours')+' ago';
    const days=Math.floor(hours/24);
    return days+' '+(days===1?'day':'days')+' ago';
  }
  function renderLastTransferAge(at) {
    // Keep the number and its smaller unit separate, like the Access Fleet count.
    for(const el of $('[data-live="lastTransfer"]')) {
      const number=el.querySelector('[data-transfer-age-number]');
      const unit=el.querySelector('[data-transfer-age-unit]');
      if(!number||!unit)continue;
      if(!Number.isFinite(at)) {
        number.textContent='...';
        unit.textContent='Unavailable';
        el.setAttribute('aria-label','Last transfer unavailable');
        continue;
      }
      const seconds=Math.max(0,Math.floor((Date.now()-at)/1000));
      let value=seconds, label=seconds===1?'second ago':'seconds ago';
      if(seconds>=86400){value=Math.floor(seconds/86400);label=value===1?'day ago':'days ago';}
      else if(seconds>=3600){value=Math.floor(seconds/3600);label=value===1?'hour ago':'hours ago';}
      else if(seconds>=60){value=Math.floor(seconds/60);label=value===1?'minute ago':'minutes ago';}
      const formatted=format(value);
      if(number.textContent!==formatted)number.textContent=formatted;
      if(unit.textContent!==label)unit.textContent=label;
      el.setAttribute('aria-label','Last transfer '+formatted+' '+label);
    }
  }
  function updateActivityClocks() {
    renderLastTransferAge(lastTransferAt);
    if(Number.isFinite(summaryGeneratedAt)) {
      const age=Date.now()-summaryGeneratedAt, fresh=age>=-60000&&age<=180000;
      setAll('#summaryFreshness',isLive('summary')&&fresh
        ? 'Live feed · checked '+elapsedDescription(summaryGeneratedAt)+'.'
        : 'Live feed delayed · last verified '+elapsedDescription(summaryGeneratedAt)+'.');
      if(!fresh)document.querySelectorAll('[data-gateway-status]').forEach(el=>{el.textContent='Status unverified';el.dataset.status='checking';});
    }
    if(fleet&&Number.isFinite(fleetGeneratedAt)) {
      const age=Date.now()-fleetGeneratedAt, fresh=age>=-60000&&age<=180000;
      if(fleetVerified&&!fresh){fleetVerified=false;applyBotWidgets();renderRoster();}
      setAll('[data-fleet-updated]',fleetVerified&&fresh
        ? 'Fleet checked '+elapsedDescription(fleetGeneratedAt)+'.'
        : 'Fleet availability unverified · last checked '+elapsedDescription(fleetGeneratedAt)+'.');
    }
  }

  async function fetchJSON(kind) {
    // Share any in-flight request to prevent overlapping responses racing each other.
    if(pendingRequests.has(kind))return pendingRequests.get(kind);
    const job=(async()=>{
      let lastError;
      // GitHub Pages uses the single public production proxy, with one retry for
      // transient failures. No mock records are ever returned here.
      const urls=ENDPOINTS[kind];
      for(let attempt=0;attempt<(isStaticPreview?2:1);attempt++){
        for(const url of urls){
          const controller=new AbortController();
          const stop=setTimeout(()=>controller.abort(),8000);
          try{
            const response=await fetch(url,{headers:{Accept:'application/json'},cache:'no-store',signal:controller.signal});
            if(!response.ok)throw new Error('HTTP '+response.status);
            // A delayed bot snapshot is still genuine data, but never verified as current availability.
            const data=validator(kind,await response.json(),kind==='bots');
            rememberVerified(kind,data);
            return data;
          }catch(error){lastError=error;}
          finally{clearTimeout(stop);}
        }
      }
      const saved=lastVerified(kind);
      if(saved){
        markCached(kind,saved);
        return saved.data;
      }
      markCached(kind,null);
      throw lastError||new Error('Live data temporarily unavailable');
    })();
    pendingRequests.set(kind,job);
    try{return await job;}finally{if(pendingRequests.get(kind)===job)pendingRequests.delete(kind);}
  }
  function validateSummary(data) {
    if(!data || !data.totals || !data.live || !data.status || !Number.isFinite(time(data.generatedAt)))throw new Error('Missing public summary');
    if(!['transfers','uniquePlayers','trackedServers'].every(k=>numeric(data.totals[k])))throw new Error('Invalid totals');
    if(!numeric(data.live.playersInHub))throw new Error('Invalid Hub count');
    return data;
  }
  function validateFleet(data, allowExpired=false) {
    if(!data || !Array.isArray(data.bots) || !data.counts || !Number.isFinite(time(data.generatedAt)))throw new Error('Missing fleet data');
    const counts={total:data.bots.length,available:0,nearCapacity:0,full:0,offline:0,checking:0};
    const seen=new Set();
    for(const bot of data.bots) {
      if(!bot || typeof bot.gamertag!=='string'||!bot.gamertag.trim()||bot.gamertag.length>40||/[\u0000-\u001f\u007f]/.test(bot.gamertag)||seen.has(bot.gamertag)||!validStatuses.has(bot.status)||!numeric(bot.capacity)||bot.capacity===0||(bot.friends!=null&&!numeric(bot.friends)))throw new Error('Malformed fleet record');
      seen.add(bot.gamertag);counts[bot.status==='near_capacity'?'nearCapacity':bot.status]++;
    }
    for(const k in counts)if(!numeric(data.counts[k])||data.counts[k]!==counts[k])throw new Error('Incorrect fleet counts');
    // A cached fleet is not evidence that a bot is safe to add now.
    const age=Date.now()-time(data.generatedAt);
    if(!allowExpired && (age > 180000 || age < -60000))throw new Error('Fleet response out of date');
    return data;
  }
  function validateRecent(data) {
    if(!data || !Number.isFinite(time(data.generatedAt))) throw new Error('Missing recent activity');
    const keys=['last24Hours','last7Days','last30Days'];
    if(!keys.every(k=>numeric(data.transfers?.[k]?.transfers)))throw new Error('Invalid recent totals');
    return data;
  }
  async function copyText(text) {
    if(!text)return false;
    try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return true;}}catch{}
    const input=document.createElement('textarea');input.value=text;input.readOnly=true;input.style.cssText='position:fixed;left:-1000px;top:-1000px';document.body.append(input);input.select();
    let ok=false;try{ok=document.execCommand('copy');}catch{}input.remove();return ok;
  }
  const menuButton=$('menuButton'), mobileMenu=$('mobileMenu');
  function closeMenu(){if(menuButton)menuButton.setAttribute('aria-expanded','false');if(mobileMenu)mobileMenu.hidden=true;}
  menuButton?.addEventListener('click',()=>{const open=menuButton.getAttribute('aria-expanded')!=='true';menuButton.setAttribute('aria-expanded',String(open));if(mobileMenu)mobileMenu.hidden=!open;});
  mobileMenu?.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeMenu));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
  window.addEventListener('resize',()=>{if(innerWidth>1060)closeMenu();});
  $$('.questions details, .faq-stack details').forEach(detail=>detail.addEventListener('toggle',()=>{
    if(!detail.open)return;const parent=detail.closest('.questions,.faq-stack');parent?.querySelectorAll('details').forEach(other=>{if(other!==detail)other.open=false;});
  }));

  // Live summary: lifetime totals, Hub population, service condition.
  const hasSummary=$$('[data-stat], [data-live], [data-gateway-status]').length>0;
  function renderSummary(raw) {
    const data=validateSummary(raw);
    for(const k of ['transfers','uniquePlayers','trackedServers'])setAll(`[data-stat="${k}"]`,format(data.totals[k]));
    setAll('[data-live="hubPlayers"]',format(data.live.playersInHub));
    summaryGeneratedAt=time(data.generatedAt);
    lastTransferAt=time(data.live.lastTransferAt);
    const state=typeof data.status.state==='string'?data.status.state:'checking';
    const labels={online:'Online',delayed:'Delayed',lost_signal:'Signal unavailable',offline:'Offline',checking:'Checking'};
    const age=Date.now()-time(data.generatedAt),fresh=age>=-60000&&age<=180000;
    const verified=isLive('summary')&&fresh;
    $$('[data-gateway-status]').forEach(el=>{el.textContent=verified?(labels[state]||'Checking'):'Status unverified';el.dataset.status=verified?state:'checking';});
    updateActivityClocks();
  }
  let summaryBusy=false;
  async function updateSummary(){
    if(!hasSummary||document.hidden||summaryBusy)return;
    summaryBusy=true;
    try{renderSummary(await fetchJSON('summary'));}
    catch(error){
      summaryGeneratedAt=NaN;lastTransferAt=NaN;
      renderLastTransferAge(NaN);
      setAll('#summaryFreshness','Could not connect to live statistics. Retrying automatically.');
      $$('[data-gateway-status]').forEach(el=>{el.textContent='Status unavailable';el.dataset.status='checking';});
      $$('[data-stat]').forEach(el=>{if(el.textContent.includes('Connecting'))el.textContent='Unavailable';});
    }finally{summaryBusy=false;}
  }

  // Read-only current bot fleet with session-locked recommendation.
  const hasBotWidgets=$$('[data-live-bot-widget]').length>0;
  const hasRoster=Boolean($('botRoster'));
  let fleet=null, chosen=null, sort='order', fleetVerified=false, fleetBusy=false;
  const sortByIndex=bot=>{const m=bot.gamertag.match(/(\d+)$/);return m?Number(m[1]):99999;};
  function recommended(fleet,exclude=null){
    const preferred=fleet.bots.find(b=>b.gamertag===fleet.recommendedBot?.gamertag&&b.status==='available'&&b.gamertag!==exclude);
    return preferred || fleet.bots.filter(b=>b.status==='available'&&b.gamertag!==exclude).sort((a,b)=>(a.friends??a.capacity)-(b.friends??b.capacity))[0] || null;
  }
  function applyFleetStats() {
    if(!fleet)return;
    for(const k of ['available','nearCapacity','full','offline','checking'])setAll(`[data-fleet-stat="${k}"]`,format(fleet.counts[k]));
    setAll('[data-bot-count]',format(fleet.counts.total));
    // The fleet age label is refreshed by the one-second activity clock.
    const el=$('fleetFreshness');if(el)el.textContent=fleetVerified?'Last updated '+new Date(fleet.generatedAt).toLocaleTimeString()+'.':'Connection delayed. Last verified '+verifiedTime('bots')+'. Check mcgateway.net/bots before adding a bot.';
  }
  function applyBotWidgets() {
    for(const widget of $$('[data-live-bot-widget]')) {
      const bot=fleet?.bots.find(b=>b.gamertag===chosen);
      const safe=fleetVerified && bot?.status==='available';
      const name=widget.querySelector('[data-bot-name]');if(name)name.textContent=bot?bot.gamertag:chosen||(fleetVerified?'No available bot':'Checking availability…');
      const help=widget.querySelector('[data-bot-help]');if(help)help.textContent=!fleetVerified&&bot?'Last known bot details. Availability is not currently verified.':bot?(safe?'Available · '+(bot.friends==null?'Capacity count not confirmed':`${format(bot.friends)} / ${format(bot.capacity)} friends`):`This bot is now ${escapeStatus[bot.status].toLowerCase()}. Choose another available account.`):chosen?'This bot is no longer listed. Choose another available account.':fleetVerified?'No available bot right now. Check the complete fleet.':'Waiting for verified bot availability.';
      const badge=widget.querySelector('[data-bot-state]');if(badge){badge.textContent=bot?(fleetVerified?escapeStatus[bot.status].toUpperCase():'UNVERIFIED'):fleetVerified?(chosen?'UNAVAILABLE':'NO BOTS'):'CHECKING';badge.dataset.status=fleetVerified?(bot?.status||'offline'):'checking';}
      const button=widget.querySelector('[data-bot-copy]');if(button){button.disabled=!safe;button.dataset.gamertag=safe?bot.gamertag:'';button.title=fleetVerified?'':'Bot availability is not currently verified';}
    }
  }
  function renderRoster() {
    const roster=$('botRoster');if(!roster||!fleet)return;
    const selected=fleet.bots.find(b=>b.gamertag===chosen);
    const listed=[...fleet.bots].sort((a,b)=>{
      if(sort==='recommended'){const ar=a.gamertag===chosen?-1:0,br=b.gamertag===chosen?-1:0;if(ar!==br)return ar-br;}
      if(sort==='least-full'||sort==='most-full'){
        const af=a.friends==null?Infinity:a.friends/a.capacity,bf=b.friends==null?Infinity:b.friends/b.capacity;
        const dif=sort==='least-full'?af-bf:bf-af;if(dif)return dif;
      }
      if(sort==='most-recent'){
        const at=Math.max(time(a.lastRelayAt)||0,time(a.lastSuccessfulTransferAt)||0),bt=Math.max(time(b.lastRelayAt)||0,time(b.lastSuccessfulTransferAt)||0);
        if(at!==bt)return bt-at;
      }
      return sortByIndex(a)-sortByIndex(b)||a.gamertag.localeCompare(b.gamertag);
    });
    const fragment=document.createDocumentFragment();
    for(const bot of listed){
      const row=document.createElement('article');row.className='fleet-entry';row.dataset.status=fleetVerified?bot.status:'checking';
      if(bot.gamertag===chosen)row.classList.add('is-selected');
      const top=document.createElement('div');top.className='fleet-entry-top';
      const heading=document.createElement('h3');heading.textContent=bot.gamertag;

      const state=document.createElement('span');state.className='fleet-status';state.textContent=fleetVerified?escapeStatus[bot.status]:'Unverified';state.dataset.status=fleetVerified?bot.status:'checking';
      top.append(heading,state);
      const meta=document.createElement('p');meta.textContent=bot.friends==null?'Friend capacity not confirmed':`${format(bot.friends)} of ${format(bot.capacity)} friends`;
      const activity=document.createElement('small');activity.textContent=Number.isFinite(time(bot.lastRelayAt))?'Last used '+relative(bot.lastRelayAt):Number.isFinite(time(bot.lastSuccessfulTransferAt))?'Last confirmed transfer '+relative(bot.lastSuccessfulTransferAt):'No recent transfer evidence';
      const track=document.createElement('div');track.className='capacity-track';const fill=document.createElement('span');if(bot.friends!=null)fill.style.width=Math.min(100,bot.friends/bot.capacity*100)+'%';track.append(fill);
      const action=document.createElement('button');action.className='outline-small';action.type='button';action.textContent=bot.gamertag===chosen?'Selected bot':'Select bot';action.disabled=!fleetVerified||bot.status!=='available';action.addEventListener('click',()=>{chosen=bot.gamertag;applyBotWidgets();renderRoster();toast(bot.gamertag+' selected. Copy the gamertag above.');});
      row.append(top,meta,track,activity,action);fragment.append(row);
    }
    roster.replaceChildren(fragment);
  }
  function renderFleet(data) {
    fleetVerified=isLive('bots');
    fleet=validateFleet(data,!fleetVerified);
    fleetGeneratedAt=time(data.generatedAt);
    // Select only from verified live data and retain this choice until a user changes it.
    if(chosen===null&&fleetVerified)chosen=recommended(fleet)?.gamertag||null;
    applyFleetStats();applyBotWidgets();renderRoster();updateActivityClocks();
  }
  async function updateFleet() {
    if((!hasBotWidgets&&!hasRoster)||fleetBusy)return;
    fleetBusy=true;
    try{renderFleet(await fetchJSON('bots'));}
    catch(error){
      fleetVerified=false;
      if(fleet){applyFleetStats();applyBotWidgets();renderRoster();updateActivityClocks();}
      else {
        fleetGeneratedAt=NaN;
        $$('[data-bot-name]').forEach(el=>el.textContent='Availability unavailable');
        $$('[data-bot-help]').forEach(el=>el.textContent='Cannot verify bot availability. Please try again shortly.');
        $$('[data-bot-copy]').forEach(el=>{el.disabled=true;el.dataset.gamertag='';});
        setAll('[data-fleet-stat]','Unavailable');
        setAll('[data-fleet-updated]','Waiting for bot availability.');
        const note=$('fleetFreshness');if(note)note.textContent='Could not connect. Retrying automatically.';
        if(hasRoster)$('botRoster').innerHTML='<div class="loading-panel">Waiting for the live bot roster. No example availability is being shown.</div>';
      }
    }finally{fleetBusy=false;}
  }
  $$('[data-bot-copy]').forEach(button=>button.addEventListener('click',async()=>{
    const gamertag=button.dataset.gamertag;if(!gamertag||button.disabled)return;
    const ok=await copyText(gamertag);toast(ok?gamertag+' copied to clipboard.':`Gamertag: ${gamertag}. You can enter it manually in Minecraft.`);
    const label=button.querySelector('[data-copy-label]');
    if(label&&ok){label.textContent='Copied!';setTimeout(()=>{label.textContent='Copy';},1800);}
  }));
  $('botSort')?.addEventListener('change',e=>{sort=e.target.value;renderRoster();});
  $('refreshFleet')?.addEventListener('click',()=>{toast('Checking bot availability…');updateFleet();});
  $('refreshBotChoice')?.addEventListener('click',()=>{
    if(!fleet || !fleetVerified){updateFleet();toast('Waiting to verify bot availability…');return;}
    const next=recommended(fleet,chosen);if(next)chosen=next.gamertag;
    applyBotWidgets();renderRoster();toast(next?'Recommendation changed to '+next.gamertag+'.':'No alternative available bot right now.');
  });

  const recentExists=$$('[data-recent]').length>0;
  function renderRecent(raw) {
    const data=validateRecent(raw);
    ['last24Hours','last7Days','last30Days'].forEach(key=>setAll(`[data-recent="${key}"]`,format(data.transfers[key].transfers)));
    setAll('#recentFreshness',isLive('statistics')?'Updated '+relative(data.generatedAt)+'.':'Connection delayed. Last verified '+verifiedTime('statistics')+'.');
  }
  let recentBusy=false;
  async function updateRecent() {
    if(!recentExists||document.hidden||recentBusy)return;
    recentBusy=true;
    try{renderRecent(await fetchJSON('statistics'));}
    catch(error){
      // Never replace a previously verified statistic with a fabricated or blank number.
      $$('[data-recent]').forEach(el=>{if(el.textContent.includes('Connecting'))el.textContent='Unavailable';});
      setAll('#recentFreshness','Could not connect to recent activity. Retrying automatically.');
    }finally{recentBusy=false;}
  }
  function hydrateVerifiedData() {
    // Show only previously verified values immediately on page refresh.
    for(const kind of ['summary','bots','statistics']) {
      const saved=lastVerified(kind);
      if(!saved)continue;
      markCached(kind,saved);
      try {
        if(kind==='summary' && hasSummary)renderSummary(saved.data);
        if(kind==='bots' && (hasBotWidgets||hasRoster))renderFleet(saved.data);
        if(kind==='statistics' && recentExists)renderRecent(saved.data);
      } catch(error) {
        // A bad cached snapshot must never stop independent live API requests.
        console.warn('Could not restore cached '+kind+' data; fetching live instead.', error);
      }
    }
  }
  function refresh(){updateSummary();updateFleet();updateRecent();}
  hydrateVerifiedData();
  refresh();
  // Keep request cadence modest; don't continue polling hidden tabs.
  setInterval(updateActivityClocks,1000);
  setInterval(()=>{if(!document.hidden)updateSummary();},10000);
  setInterval(()=>{if(!document.hidden)updateFleet();},12000);
  setInterval(()=>{if(!document.hidden)updateRecent();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
