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
    for(const el of document.querySelectorAll('[data-live="lastTransfer"]')) {
      const number=el.querySelector('[data-transfer-age-number]');
      const unit=el.querySelector('[data-transfer-age-unit]');
      if(!number||!unit)continue;
      if(statisticsPage&&!summaryIsCurrent()) {
        if(number.textContent!=='...')number.textContent='...';
        if(unit.textContent!=='Unverified')unit.textContent='Unverified';
        el.setAttribute('aria-label','Last recorded transfer unverified');
        continue;
      }
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
    hideUnverifiedLiveStatistics();
    if(fleet&&Number.isFinite(fleetGeneratedAt)) {
      const age=Date.now()-fleetGeneratedAt, fresh=age>=-60000&&age<=180000;
      if(fleetVerified&&!fresh){fleetVerified=false;applyFleetStats();applyBotWidgets();renderRoster();}
      setAll('[data-fleet-updated]',fleetVerified&&fresh
        ? 'Fleet checked '+elapsedDescription(fleetGeneratedAt)+'.'
        : 'Fleet availability unverified · last checked '+elapsedDescription(fleetGeneratedAt)+'.');
      refreshFleetActivity();
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
  const statisticsPage=Boolean(document.body?.classList.contains('statistics-page'));
  const hasSummary=document.querySelectorAll('[data-stat], [data-live], [data-gateway-status]').length>0;
  function summaryIsCurrent() {
    const age=Date.now()-summaryGeneratedAt;
    return isLive('summary')&&Number.isFinite(age)&&age>=-60000&&age<=180000;
  }
  function hideUnverifiedLiveStatistics() {
    if(!statisticsPage||summaryIsCurrent())return;
    const players=document.querySelector('[data-live="hubPlayers"]');
    if(players&&players.textContent!=='Unverified')setAll('[data-live="hubPlayers"]','Unverified');
    document.querySelectorAll('[data-gateway-status]').forEach(el=>{
      if(el.textContent!=='Status unverified')el.textContent='Status unverified';
      el.dataset.status='checking';
    });
  }
  function renderSummary(raw) {
    const data=validateSummary(raw);
    for(const k of ['transfers','uniquePlayers','trackedServers'])setAll(`[data-stat="${k}"]`,format(data.totals[k]));
    setAll('[data-live="hubPlayers"]',!statisticsPage||isLive('summary')&&Date.now()-time(data.generatedAt)<=180000&&Date.now()-time(data.generatedAt)>=-60000?format(data.live.playersInHub):'Unverified');
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
      if(statisticsPage)setAll('[data-live="hubPlayers"]','Unverified');
      setAll('#summaryFreshness','Could not connect to live statistics. Retrying automatically.');
      $$('[data-gateway-status]').forEach(el=>{el.textContent='Status unavailable';el.dataset.status='checking';});
      $$('[data-stat]').forEach(el=>{if(el.textContent.includes('Connecting'))el.textContent='Unavailable';});
    }finally{summaryBusy=false;}
  }

  // Read-only current bot fleet with session-locked recommendation.
  const hasBotWidgets=$$('[data-live-bot-widget]').length>0;
  const hasRoster=Boolean($('botRoster'));
  const hasFleetCount=document.querySelectorAll('[data-bot-count]').length>0;
  let fleet=null, chosen=null, sort=$('botSort')?.value||'order', availableOnly=false, fleetVerified=false, fleetBusy=false, recommendationInitialized=false, manuallySelected=false, pinnedRecommendation=null;
  const rosterCards=new Map();
  function botNumber(bot) {
    const name=bot.gamertag.trim();
    if(/^MCGateway$/i.test(name))return 0;
    const suffix=name.match(/(\d+)$/);
    return suffix?Number(suffix[1]):Number.MAX_SAFE_INTEGER;
  }
  function byBotNumber(a,b) {
    return botNumber(a)-botNumber(b)||a.gamertag.localeCompare(b.gamertag);
  }
  // Follow the authoritative API recommendation. If it is missing, mirror
  // the server's activity-first policy rather than choosing the emptiest bot.
  const ACTIVITY_BANDS_MS=[15000,60000,300000,900000];
  function botLastActivityMs(bot) {
    const times=[time(bot.lastRelayAt),time(bot.lastSuccessfulTransferAt)].filter(Number.isFinite);
    return times.length?Math.max(...times):null;
  }
  function botActivityBand(bot,now) {
    const at=botLastActivityMs(bot);
    if(at==null)return ACTIVITY_BANDS_MS.length;
    const band=ACTIVITY_BANDS_MS.findIndex(limit=>Math.max(0,now-at)<=limit);
    return band<0?ACTIVITY_BANDS_MS.length:band;
  }
  function recommended(snapshot) {
    const ceiling=Number.isSafeInteger(snapshot.recommendationPolicy?.friendCeiling)
      ? snapshot.recommendationPolicy.friendCeiling:950;
    const eligible=b=>b.status==='available'&&numeric(b.friends)&&b.friends<ceiling;
    const preferred=snapshot.bots.find(b=>b.gamertag===snapshot.recommendedBot?.gamertag&&eligible(b));
    if(preferred)return preferred;
    const now=Date.now();
    return snapshot.bots.filter(eligible).sort((a,b)=>
      botActivityBand(a,now)-botActivityBand(b,now)
      ||b.friends-a.friends
      ||(botLastActivityMs(b)||0)-(botLastActivityMs(a)||0)
      ||a.gamertag.localeCompare(b.gamertag)
    )[0]||null;
  }
  function sortedBots(snapshot) {
    const preferred=pinnedRecommendation;
    const eligible=availableOnly?snapshot.bots.filter(b=>b.status==='available'):[...snapshot.bots];
    return eligible.sort((a,b)=>{
      if(sort==='available'||sort==='recommended'){
        if(sort==='recommended') {
          const ar=a.gamertag===preferred?0:1,br=b.gamertag===preferred?0:1;
          if(ar!==br)return ar-br;
        }
        const av=a.status==='available'?0:1,bv=b.status==='available'?0:1;
        if(av!==bv)return av-bv;
      }
      if(sort==='least-full'||sort==='most-full'){
        const aKnown=a.friends!=null,bKnown=b.friends!=null;
        if(aKnown!==bKnown)return aKnown?-1:1;
        if(aKnown) {
          const ar=a.friends/a.capacity,br=b.friends/b.capacity;
          if(ar!==br)return sort==='least-full'?ar-br:br-ar;
        }
      }
      if(sort==='most-recent'){
        const at=Math.max(time(a.lastRelayAt)||0,time(a.lastSuccessfulTransferAt)||0);
        const bt=Math.max(time(b.lastRelayAt)||0,time(b.lastSuccessfulTransferAt)||0);
        if(at!==bt)return bt-at;
      }
      return byBotNumber(a,b);
    });
  }
  function setIfChanged(node,value) {
    const next=String(value);
    if(node.textContent!==next)node.textContent=next;
  }
  function applyFleetStats() {
    if(!fleet)return;
    for(const k of ['available','nearCapacity','full','offline','checking'])setAll('[data-fleet-stat="'+k+'"]',format(fleet.counts[k]));
    setAll('[data-bot-count]',statisticsPage&&!fleetVerified?'Unverified':format(fleet.counts.total));
    if(statisticsPage)setAll('[data-bot-freshness]',fleetVerified?'Current fleet total':'Fleet total not currently verified');
    const summary=$('fleetSummary');
    if(summary)setIfChanged(summary,fleetVerified
      ? format(fleet.counts.available)+' of '+format(fleet.counts.total)+' access bots currently available'
      : 'Availability is not currently verified. Showing last known fleet information.');
    const el=$('fleetFreshness');
    if(el)setIfChanged(el,fleetVerified
      ? 'Last updated '+new Date(fleet.generatedAt).toLocaleTimeString()+'.'
      : 'Connection delayed. Last verified '+verifiedTime('bots')+'. Bot availability may have changed.');
  }
  function applyBotWidgets() {
    for(const widget of $$('[data-live-bot-widget]')) {
      const bot=fleet?.bots.find(b=>b.gamertag===chosen);
      const safe=fleetVerified&&bot?.status==='available';
      const name=widget.querySelector('[data-bot-name]');
      if(name)setIfChanged(name,bot?bot.gamertag:chosen||(fleetVerified?'No available bot':'Checking availability…'));
      const heading=widget.querySelector('[data-bot-heading]');
      if(heading)setIfChanged(heading,manuallySelected?'Your bot':'Recommended bot');
      const help=widget.querySelector('[data-bot-help]');
      if(help)setIfChanged(help,!fleetVerified&&bot
        ? 'Last known details. Availability cannot be confirmed right now.'
        : bot?(safe
          ? 'Available · '+(bot.friends==null?'Friend count not confirmed':format(bot.friends)+' / '+format(bot.capacity)+' friends')
          : 'This bot is now '+escapeStatus[bot.status].toLowerCase()+'. Choose another available account.')
        : chosen?'This bot is no longer listed. Choose another available account.'
        : fleetVerified?'No available bot right now. Check the complete fleet.':'Waiting for verified bot availability.');
      const badge=widget.querySelector('[data-bot-state]');
      if(badge){
        setIfChanged(badge,bot?(fleetVerified?escapeStatus[bot.status].toUpperCase():'UNVERIFIED'):fleetVerified?(chosen?'UNAVAILABLE':'NO BOTS'):'CHECKING');
        badge.dataset.status=fleetVerified?(bot?.status||'offline'):'checking';
      }
      const button=widget.querySelector('[data-bot-copy]');
      if(button) {
        button.disabled=!safe;
        button.dataset.gamertag=safe?bot.gamertag:'';
        button.title=safe?'Copy '+bot.gamertag:'Bot availability is not currently verified';
      }
    }
    // Keep Xbox guide instructions in sync with the live recommendation card.
    const selectedGuideBot=fleet?.bots.find(b=>b.gamertag===chosen);
    const guideName=fleetVerified&&selectedGuideBot?.status==='available'
      ? selectedGuideBot.gamertag : 'the recommended bot shown above';
    $('[data-guide-bot-name]').forEach(node=>setIfChanged(node,guideName));
  }
  async function copyGamertag(gamertag,button,label) {
    const current=fleetVerified&&fleet?.bots.find(b=>b.gamertag===gamertag&&b.status==='available');
    if(!current){toast('Bot availability has changed. Refresh the fleet and try again.');return;}
    const copied=await copyText(gamertag);
    toast(copied?gamertag+' copied to clipboard.':'Copy failed. You can enter '+gamertag+' manually in Minecraft.');
    if(copied&&label) {
      const original=button.dataset.copyOriginal||label.textContent;
      button.dataset.copyOriginal=original;
      setIfChanged(label,'Copied!');
      setTimeout(()=>{if(label.isConnected)setIfChanged(label,original);},1800);
    }
  }
  function botActivityText(bot) {
    if(!bot)return 'Recent activity unavailable';
    const lastRelay=time(bot.lastRelayAt);
    if(Number.isFinite(lastRelay))return 'Last used '+elapsedDescription(lastRelay);
    const lastTransfer=time(bot.lastSuccessfulTransferAt);
    if(Number.isFinite(lastTransfer))return 'Last transfer '+elapsedDescription(lastTransfer);
    return 'No recent activity reported';
  }
  function refreshFleetActivity() {
    if(!fleet)return;
    const selected=fleet.bots.find(bot=>bot.gamertag===chosen);
    for(const node of document.querySelectorAll('[data-bot-last-used]'))setIfChanged(node,botActivityText(selected));
    for(const bot of fleet.bots){
      const card=rosterCards.get(bot.gamertag);
      if(card)setIfChanged(card.activity,botActivityText(bot));
    }
  }
  function createRosterCard(bot) {
    const row=document.createElement('article');row.className='fleet-entry';
    row.dataset.gamertag=bot.gamertag;
    const top=document.createElement('div');top.className='fleet-entry-top';
    const heading=document.createElement('h3');heading.textContent=bot.gamertag;
    const state=document.createElement('span');state.className='fleet-status';
    top.append(heading,state);
    const meta=document.createElement('p');
    const track=document.createElement('div');track.className='capacity-track';
    const fill=document.createElement('span');track.append(fill);
    const activity=document.createElement('small');
    const actions=document.createElement('div');actions.className='fleet-entry-actions';
    const select=document.createElement('button');select.className='outline-small';
    select.type='button';select.textContent='Select bot';
    select.addEventListener('click',()=>{
      if(!fleetVerified||!fleet?.bots.some(b=>b.gamertag===bot.gamertag&&b.status==='available')) {
        toast('Bot availability is not currently verified.');return;
      }
      chosen=bot.gamertag;manuallySelected=true;applyBotWidgets();renderRoster();
      toast(bot.gamertag+' selected. Copy its name here or at the top of the page.');
    });
    const copy=document.createElement('button');copy.className='outline-small roster-copy';
    copy.type='button';copy.textContent='Copy bot name';
    copy.addEventListener('click',()=>copyGamertag(bot.gamertag,copy,copy));
    actions.append(select,copy);row.append(top,meta,track,activity,actions);
    return {row,state,meta,fill,activity,select,copy};
  }
  function updateRosterCard(card,bot) {
    const isSelected=bot.gamertag===chosen;
    const safe=fleetVerified&&bot.status==='available';
    card.row.classList.toggle('is-selected',isSelected);
    card.row.dataset.status=fleetVerified?bot.status:'checking';
    card.state.dataset.status=fleetVerified?bot.status:'checking';
    setIfChanged(card.state,fleetVerified?escapeStatus[bot.status]:'Unverified');
    setIfChanged(card.meta,bot.friends==null?'Friend capacity not confirmed':format(bot.friends)+' of '+format(bot.capacity)+' friends');
    card.fill.style.width=bot.friends==null?'0%':Math.min(100,bot.friends/bot.capacity*100)+'%';
    setIfChanged(card.activity,botActivityText(bot));
    card.select.disabled=!safe;
    setIfChanged(card.select,isSelected?'Selected bot':'Select bot');
    card.copy.disabled=!safe;
    card.copy.title=safe?'Copy '+bot.gamertag:'Availability is not currently verified';
    if(!safe&&card.copy.textContent==='Copied!')setIfChanged(card.copy,'Copy bot name');
  }
  function renderRoster() {
    const roster=$('botRoster');
    if(!roster||!fleet)return;
    const known=new Set(fleet.bots.map(b=>b.gamertag));
    for(const [name,card] of rosterCards) {
      if(!known.has(name)){card.row.remove();rosterCards.delete(name);}
    }
    for(const bot of fleet.bots) {
      let card=rosterCards.get(bot.gamertag);
      if(!card){card=createRosterCard(bot);rosterCards.set(bot.gamertag,card);}
      updateRosterCard(card,bot);
    }
    const ordered=sortedBots(fleet).map(b=>rosterCards.get(b.gamertag).row);
    const current=[...roster.children];
    if(current.length!==ordered.length||current.some((el,i)=>el!==ordered[i])) {
      const focused=document.activeElement;
      const restore=focused&&roster.contains(focused)?focused:null;
      roster.replaceChildren(...ordered);
      if(restore&&restore.isConnected&&document.activeElement!==restore)restore.focus({preventScroll:true});
    }
    const empty=$('fleetEmpty');
    if(empty) {
      empty.hidden=ordered.length!==0;
      if(!empty.hidden)setIfChanged(empty,availableOnly
        ? fleetVerified?'No bots are marked Available right now.':'Cannot confirm available bots right now.'
        : 'No access bots are currently listed.');
    }
  }
  function renderFleet(data) {
    fleetVerified=isLive('bots');
    fleet=validateFleet(data,!fleetVerified);
    fleetGeneratedAt=time(data.generatedAt);
    // A recommendation is chosen only on the first verified page load or by a user action.
    // Never silently switch the account just because later API snapshots recommend another.
    if(!recommendationInitialized&&fleetVerified){
      chosen=recommended(fleet)?.gamertag||null;
      pinnedRecommendation=chosen;
      manuallySelected=false;
      recommendationInitialized=true;
    }
    applyFleetStats();applyBotWidgets();renderRoster();refreshFleetActivity();updateActivityClocks();
  }
  async function updateFleet() {
    if((!hasBotWidgets&&!hasRoster&&!hasFleetCount)||fleetBusy)return false;
    fleetBusy=true;
    try{renderFleet(await fetchJSON('bots'));return fleetVerified;}
    catch(error){
      fleetVerified=false;
      if(fleet){applyFleetStats();applyBotWidgets();renderRoster();updateActivityClocks();}
      else {
        fleetGeneratedAt=NaN;
        $$('[data-bot-name]').forEach(el=>el.textContent='Availability unavailable');
        $$('[data-bot-help]').forEach(el=>el.textContent='Cannot verify bot availability. Please try again shortly.');
        document.querySelectorAll('[data-bot-copy]').forEach(el=>{el.disabled=true;el.dataset.gamertag='';});
        document.querySelectorAll('[data-bot-last-used]').forEach(el=>setIfChanged(el,'Recent activity unavailable'));
        setAll('[data-fleet-stat]','Unavailable');
        setAll('[data-bot-count]','Unavailable');
        setAll('[data-bot-freshness]','Could not verify the fleet');
        setAll('[data-fleet-updated]','Waiting for bot availability.');
        const note=$('fleetFreshness');if(note)note.textContent='Could not connect. Retrying automatically.';
        const summary=$('fleetSummary');if(summary)summary.textContent='Live fleet data is unavailable right now.';
        if(hasRoster)$('botRoster').innerHTML='<div class="loading-panel">Waiting for the live bot roster. Retrying automatically.</div>';
      }
      return false;
    }finally{fleetBusy=false;}
  }
  $$('[data-bot-copy]').forEach(button=>button.addEventListener('click',async()=>{
    const name=button.dataset.gamertag;
    if(!name||button.disabled)return;
    await copyGamertag(name,button,button.querySelector('[data-copy-label]'));
  }));
  $('botSort')?.addEventListener('change',e=>{sort=e.target.value;renderRoster();});
  $('availableOnly')?.addEventListener('change',e=>{availableOnly=e.target.checked;renderRoster();});
  $('refreshFleet')?.addEventListener('click',()=>{toast('Checking bot availability…');updateFleet();});
  $('refreshBotChoice')?.addEventListener('click',async()=>{
    if(fleetBusy){toast('Checking the latest fleet data…');return;}
    const verified=await updateFleet();
    if(!verified){toast('Cannot verify a recommendation right now. Please try again.');return;}
    const next=recommended(fleet);
    if(!next){toast('No available bot currently meets the recommendation criteria.');return;}
    const previous=chosen;
    chosen=next.gamertag;
    pinnedRecommendation=chosen;
    manuallySelected=false;
    recommendationInitialized=true;
    applyBotWidgets();renderRoster();refreshFleetActivity();
    toast(previous===chosen?'Still recommending '+chosen+'.':'Recommendation updated to '+chosen+'.');
  });

    const recentExists=$$('[data-recent]').length>0;
  // Use the same Central Time calendar as the public statistics API.
  // The hourly snapshot changes on UTC hour boundaries, which are also
  // precisely the top of every local hour in America/Chicago.
  const RECENT_HOUR_MS=60*60*1000;
  const RECENT_PERIODS=[
    {key:'last24Hours',divisor:24,unit:'hour',kind:'hourly'},
    {key:'last7Days',divisor:7,unit:'day',kind:'daily'},
    {key:'last30Days',divisor:30,unit:'day',kind:'daily'}
  ];
  const RECENT_BUCKET_CACHE='mcgateway-v3-period-stats-v1:';
  const centralDateFormatter=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'
  });
  const recentSnapshots=new Map();
  function recentPeriodKey(period,ms=Date.now()){
    if(period.kind==='hourly')return 'hour:'+Math.floor(ms/RECENT_HOUR_MS);
    const parts=Object.fromEntries(centralDateFormatter.formatToParts(new Date(ms))
      .filter(part=>['year','month','day'].includes(part.type))
      .map(part=>[part.type,part.value]));
    return 'day:'+parts.year+'-'+parts.month+'-'+parts.day;
  }
  function showRecentPeriod(period,value){
    setAll('[data-recent="'+period.key+'"]',format(value));
    setAll('[data-recent-average="'+period.key+'"]',
      format(Math.round(value/period.divisor))+' transfers per '+period.unit+' on average');
  }
  function hydrateRecentIntervals(){
    if(!recentExists)return;
    const now=Date.now();
    for(const period of RECENT_PERIODS){
      try{
        const data=JSON.parse(localStorage.getItem(RECENT_BUCKET_CACHE+period.key)||'null');
        if(!data||data.bucket!==recentPeriodKey(period,now)||!numeric(data.value)||
           !Number.isFinite(data.savedAt)||data.savedAt>now+60000)continue;
        recentSnapshots.set(period.key,{bucket:data.bucket,value:data.value});
        showRecentPeriod(period,data.value);
      }catch{}
    }
  }
  function recentNeedsRefresh(now=Date.now()){
    return RECENT_PERIODS.some(period=>
      recentSnapshots.get(period.key)?.bucket!==recentPeriodKey(period,now));
  }
  function renderRecent(raw){
    const data=validateRecent(raw);
    // A saved API fallback or a snapshot generated before the hour/day boundary
    // must not lock an old count into the NEW reporting period.
    if(!isLive('statistics'))return false;
    const now=Date.now(),generated=time(data.generatedAt);
    let changed=false;
    for(const period of RECENT_PERIODS){
      const bucket=recentPeriodKey(period,now);
      if(recentSnapshots.get(period.key)?.bucket===bucket)continue;
      if(recentPeriodKey(period,generated)!==bucket)continue;
      const value=data.transfers[period.key].transfers;
      recentSnapshots.set(period.key,{bucket,value});
      try{localStorage.setItem(RECENT_BUCKET_CACHE+period.key,
        JSON.stringify({bucket,value,savedAt:now}));}catch{}
      showRecentPeriod(period,value);
      changed=true;
    }
    return changed;
  }
  let recentBusy=false;
  async function updateRecent(){
    if(!recentExists||document.hidden||recentBusy||!recentNeedsRefresh())return;
    recentBusy=true;
    try{renderRecent(await fetchJSON('statistics'));}
    catch(error){
      // A failed request leaves already-captured values untouched.
      for(const period of RECENT_PERIODS){
        if(recentSnapshots.get(period.key)?.bucket===recentPeriodKey(period))continue;
        setAll('[data-recent="'+period.key+'"]','Unavailable');
        setAll('[data-recent-average="'+period.key+'"]','Average unavailable');
      }
    }finally{recentBusy=false;}
  }
  // Schedule at absolute hour boundaries rather than an interval measured
  // from page load. Check Central Time date changes at each boundary so DST
  // and browsers outside Central Time do not shift the midnight refresh.
  let recentBoundaryTimer=null;
  function scheduleRecentBoundary(){
    if(!recentExists)return;
    clearTimeout(recentBoundaryTimer);
    const now=Date.now();
    const next=(Math.floor(now/RECENT_HOUR_MS)+1)*RECENT_HOUR_MS;
    recentBoundaryTimer=setTimeout(()=>{
      if(!document.hidden)updateRecent();
      scheduleRecentBoundary();
    },Math.max(30,next-now+25));
  }
    function hydrateVerifiedData() {
    // Show only previously verified values immediately on page refresh.
    for(const kind of ['summary','bots','statistics']) {
      const saved=lastVerified(kind);
      if(!saved)continue;
      markCached(kind,saved);
      try {
        if(kind==='summary' && hasSummary)renderSummary(saved.data);
        if(kind==='bots' && (hasBotWidgets||hasRoster||hasFleetCount))renderFleet(saved.data);
        // Recent totals use their own hour/day-locked snapshots, never an
        // arbitrary cached API response from before the latest boundary.
      } catch(error) {
        // A bad cached snapshot must never stop independent live API requests.
        console.warn('Could not restore cached '+kind+' data; fetching live instead.', error);
      }
    }
  }
  function refresh(){updateSummary();updateFleet();updateRecent();}
  hydrateVerifiedData();
  hydrateRecentIntervals();
  refresh();
  scheduleRecentBoundary();
  // Keep request cadence modest; don't continue polling hidden tabs.
  setInterval(updateActivityClocks,1000);
  setInterval(()=>{if(!document.hidden)updateSummary();},10000);
  setInterval(()=>{if(!document.hidden)updateFleet();},12000);
  // This interval only retries missing snapshots. Captured periods are
  // frozen until the next top-of-hour or Central Time midnight boundary.
  setInterval(()=>{if(!document.hidden)updateRecent();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
