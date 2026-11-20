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
  const previewDemo = isStaticPreview ? window.MCGatewayPreviewDemo : null;
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
  function setAll(selector,value) { $$(selector).forEach(el=>{ el.textContent=String(value); if(el.matches('[data-stat]')) el.classList.toggle('is-placeholder', !/^[\d,]+$/.test(String(value))); }); }
  function relative(iso) {
    const at=time(iso);if (!Number.isFinite(at)) return 'Unknown';
    const seconds=Math.max(0,Math.floor((Date.now()-at)/1000));
    if(seconds<10) return 'just now';if(seconds<60)return `${seconds}s ago`;
    if(seconds<3600) return `${Math.floor(seconds/60)}m ago`;
    if(seconds<86400) return `${Math.floor(seconds/3600)}h ago`;
    return `${Math.floor(seconds/86400)}d ago`;
  }
  async function fetchJSON(kind) {
    if(previewDemo?.forceDemo){previewDemo.setSource(kind,true);return previewDemo.sample(kind);}
    let lastError;
    for(const url of ENDPOINTS[kind]) {
      const controller = new AbortController();
      const stop = setTimeout(()=>controller.abort(),4200);
      try {
        const response=await fetch(url,{headers:{Accept:'application/json'},cache:'no-store',signal:controller.signal});
        if(!response.ok)throw new Error('HTTP '+response.status);
        const data=await response.json();
        if(previewDemo){
          ({summary:validateSummary,bots:validateFleet,statistics:validateRecent})[kind](data);
          previewDemo.setSource(kind,false);
        }
        return data;
      } catch(e){lastError=e;}finally{clearTimeout(stop);}
    }
    if(previewDemo){previewDemo.setSource(kind,true);return previewDemo.sample(kind);}
    throw lastError || new Error('Unable to reach the public service');
  }
  function validateSummary(data) {
    if(!data || !data.totals || !data.live || !data.status || !Number.isFinite(time(data.generatedAt)))throw new Error('Missing public summary');
    if(!['transfers','uniquePlayers','trackedServers'].every(k=>numeric(data.totals[k])))throw new Error('Invalid totals');
    if(!numeric(data.live.playersInHub))throw new Error('Invalid Hub count');
    return data;
  }
  function validateFleet(data) {
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
    if(age > 180000 || age < -60000)throw new Error('Fleet response out of date');
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
  async function updateSummary() {
    if(!hasSummary || document.hidden)return;
    try {
      const data=validateSummary(await fetchJSON('summary'));
      const totals=data.totals;
      for(const k of ['transfers','uniquePlayers','trackedServers'])setAll(`[data-stat="${k}"]`,format(totals[k]));
      setAll('[data-live="hubPlayers"]',format(data.live.playersInHub));
      setAll('[data-live="lastTransfer"]',Number.isFinite(time(data.live.lastTransferAt))?relative(data.live.lastTransferAt):'Not available');
      const state=typeof data.status.state==='string'?data.status.state:'checking';
      const labels={online:'Online',delayed:'Delayed',lost_signal:'Signal unavailable',offline:'Offline',checking:'Checking'};
      $$('[data-gateway-status]').forEach(el=>{el.textContent=labels[state]||'Checking';el.dataset.status=state;});
      const age=Date.now()-time(data.generatedAt);
      const fresh=age>=-60000 && age<=180000;
      if(!fresh) {
        $$('[data-gateway-status]').forEach(el=>{el.textContent='Status unverified';el.dataset.status='checking';});
        setAll('#summaryFreshness','Last published totals: '+new Date(data.generatedAt).toLocaleString()+'. Status freshness could not be confirmed.');
      } else setAll('#summaryFreshness',previewDemo?.isDemo('summary') ? 'SIMULATED totals for design testing, not live data.' : 'Public Warehouse totals · Updated '+relative(data.generatedAt)+'.');
    } catch(e) {
      $$('[data-stat]').forEach(el=>{if(el.textContent.includes('Connecting'))el.textContent='Unavailable';});
      setAll('[data-live]','Unavailable');
      $$('[data-gateway-status]').forEach(el=>{el.textContent='Status unavailable';el.dataset.status='checking';});
      setAll('#summaryFreshness','Live totals are temporarily unavailable. See mcgateway.net/statistics for the official published dashboard.');
    }
  }

  // Read-only current bot fleet with session-locked recommendation.
  const hasBotWidgets=$$('[data-live-bot-widget]').length>0;
  const hasRoster=Boolean($('botRoster'));
  let fleet=null, chosen=null, sort='order';
  const sortByIndex=bot=>{const m=bot.gamertag.match(/(\d+)$/);return m?Number(m[1]):99999;};
  function recommended(fleet,exclude=null){
    const preferred=fleet.bots.find(b=>b.gamertag===fleet.recommendedBot?.gamertag&&b.status==='available'&&b.gamertag!==exclude);
    return preferred || fleet.bots.filter(b=>b.status==='available'&&b.gamertag!==exclude).sort((a,b)=>(a.friends??a.capacity)-(b.friends??b.capacity))[0] || null;
  }
  function applyFleetStats() {
    if(!fleet)return;
    for(const k of ['available','nearCapacity','full','offline','checking'])setAll(`[data-fleet-stat="${k}"]`,format(fleet.counts[k]));
    setAll('[data-bot-count]',format(fleet.counts.total));
    setAll('[data-fleet-updated]',previewDemo?.isDemo('bots') ? 'SIMULATED roster for design review.' : 'Fleet checked '+relative(fleet.generatedAt)+'.');
    const el=$('fleetFreshness');if(el)el.textContent=previewDemo?.isDemo('bots') ? 'DEMO BOT DATA: Friend counts, activity and availability are examples only. Check mcgateway.net for actual status.' : 'Last public fleet update '+new Date(fleet.generatedAt).toLocaleTimeString()+'.';
  }
  function applyBotWidgets() {
    for(const widget of $$('[data-live-bot-widget]')) {
      const bot=fleet?.bots.find(b=>b.gamertag===chosen);
      const safe=bot?.status==='available';
      const name=widget.querySelector('[data-bot-name]');if(name)name.textContent=bot?bot.gamertag:fleet?'No available bot':'Checking availability…';
      const help=widget.querySelector('[data-bot-help]');if(help)help.textContent=previewDemo?.isDemo('bots') ? 'Example bot, example status. Visit mcgateway.net/bots for real availability.' : bot?(safe?'Available · '+(bot.friends==null?'Capacity count not confirmed':`${format(bot.friends)} / ${format(bot.capacity)} friends`):`This bot is now ${escapeStatus[bot.status].toLowerCase()}. Choose another available account.`):fleet?'Visit the fleet below to check accounts.':'Reading official fleet data…';
      const badge=widget.querySelector('[data-bot-state]');if(badge){badge.textContent=bot?escapeStatus[bot.status].toUpperCase():'CHECKING';badge.dataset.status=bot?.status||'checking';}
      const button=widget.querySelector('[data-bot-copy]');if(button){button.disabled=!safe || Boolean(previewDemo?.isDemo('bots'));button.dataset.gamertag=safe&&!previewDemo?.isDemo('bots')?bot.gamertag:'';if(previewDemo?.isDemo('bots'))button.title='Demo data: check official bot availability before copying';}
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
      const row=document.createElement('article');row.className='fleet-entry';row.dataset.status=bot.status;
      if(bot.gamertag===chosen)row.classList.add('is-selected');
      const top=document.createElement('div');top.className='fleet-entry-top';
      const heading=document.createElement('h3');heading.textContent=bot.gamertag;
      if(previewDemo?.isDemo('bots')){const avatar=document.createElement('span');avatar.className='demo-bot-avatar';avatar.textContent='MG';avatar.setAttribute('aria-hidden','true');heading.prepend(avatar);heading.style.display='flex';heading.style.alignItems='center';heading.style.gap='8px';}
      const state=document.createElement('span');state.className='fleet-status';state.textContent=escapeStatus[bot.status];state.dataset.status=bot.status;
      top.append(heading,state);
      const meta=document.createElement('p');meta.textContent=bot.friends==null?'Friend capacity not confirmed':`${format(bot.friends)} of ${format(bot.capacity)} friends`;
      const activity=document.createElement('small');activity.textContent=Number.isFinite(time(bot.lastRelayAt))?'Last used '+relative(bot.lastRelayAt):Number.isFinite(time(bot.lastSuccessfulTransferAt))?'Last confirmed transfer '+relative(bot.lastSuccessfulTransferAt):'No recent transfer evidence';
      const track=document.createElement('div');track.className='capacity-track';const fill=document.createElement('span');if(bot.friends!=null)fill.style.width=Math.min(100,bot.friends/bot.capacity*100)+'%';track.append(fill);
      const action=document.createElement('button');action.className='outline-small';action.type='button';action.textContent=bot.gamertag===chosen?'Selected bot':'Select bot';action.disabled=bot.status!=='available';action.addEventListener('click',()=>{chosen=bot.gamertag;applyBotWidgets();renderRoster();toast(bot.gamertag+' selected. Copy the gamertag above.');});
      row.append(top,meta,track,activity,action);fragment.append(row);
    }
    roster.replaceChildren(fragment);
  }
  async function updateFleet() {
    if(!hasBotWidgets&&!hasRoster)return;
    try{
      fleet=validateFleet(await fetchJSON('bots'));
      if(chosen===null || !fleet.bots.some(b=>b.gamertag===chosen&&b.status==='available'))chosen=recommended(fleet)?.gamertag||null;
      applyFleetStats();applyBotWidgets();renderRoster();
    }catch(e){
      fleet=null;chosen=null;
      $$('[data-bot-name]').forEach(el=>el.textContent='Availability unavailable');
      $$('[data-bot-help]').forEach(el=>el.textContent='Could not verify the current bot list. Please try again or open the official Bots page.');
      $$('[data-bot-copy]').forEach(el=>{el.disabled=true;el.dataset.gamertag='';});
      setAll('[data-fleet-stat]','—');
      setAll('[data-fleet-updated]','Bot availability cannot be verified right now.');
      const note=$('fleetFreshness');if(note)note.textContent='The public bot service could not be reached. No bots are being recommended until fresh data is available.';
      if(hasRoster)$('botRoster').innerHTML='<div class="loading-panel">Live bot availability is temporarily unavailable. Refresh to try again, or use the public bot list on mcgateway.net.</div>';
    }
  }
  $$('[data-bot-copy]').forEach(button=>button.addEventListener('click',async()=>{
    const gamertag=button.dataset.gamertag;if(!gamertag||button.disabled)return;
    const ok=await copyText(gamertag);toast(ok?gamertag+' copied to clipboard.':`Gamertag: ${gamertag}. You can enter it manually in Minecraft.`);
  }));
  $('botSort')?.addEventListener('change',e=>{sort=e.target.value;renderRoster();});
  $('refreshFleet')?.addEventListener('click',()=>{toast('Checking the latest public bot status…');updateFleet();});
  $('refreshBotChoice')?.addEventListener('click',()=>{
    if(!fleet){updateFleet();return;}
    const next=recommended(fleet,chosen);if(next)chosen=next.gamertag;
    applyBotWidgets();renderRoster();toast(next?'Recommendation changed to '+next.gamertag+'.':'No alternative available bot right now.');
  });

  const recentExists=$$('[data-recent]').length>0;
  async function updateRecent(){if(!recentExists||document.hidden)return;
    try{
      const data=validateRecent(await fetchJSON('statistics'));
      ['last24Hours','last7Days','last30Days'].forEach(key=>setAll(`[data-recent="${key}"]`,format(data.transfers[key].transfers)));
      setAll('#recentFreshness',previewDemo?.isDemo('statistics') ? 'SIMULATED recent activity for layout testing, not real transfers.' : 'Recent Warehouse aggregates · Updated '+relative(data.generatedAt)+'.');
    }catch(e){setAll('[data-recent]','Unavailable');setAll('#recentFreshness','Recent transfer totals cannot be retrieved right now.');}
  }
  function refresh(){updateSummary();updateFleet();updateRecent();}
  refresh();
  // Keep request cadence modest; don't continue polling hidden tabs.
  setInterval(()=>{if(!document.hidden)updateSummary();},10000);
  setInterval(()=>{if(!document.hidden)updateFleet();},12000);
  setInterval(()=>{if(!document.hidden)updateRecent();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
