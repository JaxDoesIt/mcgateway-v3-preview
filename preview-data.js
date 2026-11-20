/* Clearly labeled mock-data fallback for the temporary GitHub Pages design preview.
   Real production data and code are never modified by this module. */
(() => {
  'use strict';
  if (!(location.hostname.endsWith('.github.io') || location.protocol === 'file:')) return;
  const started = Date.now();
  const storageKey = 'mcgateway-v3-preview-force-demo';
  let forced = false;
  try { forced = sessionStorage.getItem(storageKey) === '1'; } catch {}
  const sources = new Map();
  const stateList = ['available','available','available','near_capacity','available','available','full','available','offline','available','near_capacity','available','checking','available','near_capacity','available'];
  const friendCounts = [518,632,372,931,461,727,1000,603,580,251,956,687,803,549,919,366];

  const style = document.createElement('style');
  style.textContent = '.preview-data-notice{position:relative;z-index:1001;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:9px 16px;padding:9px 15px;text-align:center;background:#183b43;color:#fff5db;border-bottom:2px solid #6ca8a0;font:600 12px/1.4 system-ui,-apple-system,sans-serif}.preview-data-notice[hidden]{display:none!important}.preview-data-notice strong{color:#f4db9d;letter-spacing:.06em}.preview-data-notice span{font-weight:400}.preview-data-notice button{border:1px solid #a6d0c6;background:#224e52;color:white;padding:6px 10px;border-radius:6px;cursor:pointer;font:600 11px system-ui,-apple-system,sans-serif}.preview-data-notice button:hover{background:#326869}.fleet-entry .demo-bot-avatar{display:inline-grid;place-items:center;flex:none;width:30px;height:30px;border-radius:7px;background:linear-gradient(145deg,#215263,#388c7a);color:#f6e8bc;font:800 11px/1 system-ui,-apple-system,sans-serif;border:1px solid #6fa7a0}';
  document.head.append(style);
  const banner = document.createElement('div');
  banner.className = 'preview-data-notice';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  const lead = document.createElement('strong');
  lead.textContent = 'DEMO DATA';
  const message = document.createElement('span');
  const switcher = document.createElement('button');
  switcher.type = 'button';
  switcher.addEventListener('click', () => {
    forced = false;
    try { sessionStorage.setItem(storageKey, '0'); } catch {}
    location.reload();
  });
  banner.append(lead, message, switcher);
  document.body.prepend(banner);

  function showSource() {
    const anyDemo = [...sources.values()].includes('demo');
    const anyLive = [...sources.values()].includes('live');
    // When the page is fully connected, no technical preview banner is needed.
    banner.hidden = !forced && !anyDemo;
    if (forced) message.textContent = 'Sample bots and statistics only. These numbers do not reflect actual availability.';
    else if (anyDemo && anyLive) message.textContent = 'Some information is simulated because a live connection failed. Verify availability on mcgateway.net.';
    else if (anyDemo) message.textContent = 'Showing example bots and numbers while the connection is unavailable.';
    else message.textContent = '';
    switcher.textContent = forced ? 'Use real data' : 'Retry connection';
  }
  function source(kind, demo) { sources.set(kind, demo ? 'demo' : 'live'); showSource(); }
  function sample(kind) {
    const tick = Math.floor((Date.now() - started) / 10000);
    const now = new Date().toISOString();
    if (kind === 'summary') return {
      generatedAt: now,
      totals: { transfers: 327840 + tick * 3, uniquePlayers: 20680 + Math.floor(tick / 6), trackedServers: 17240 + Math.floor(tick / 20) },
      live: { playersInHub: 14 + (tick % 7), lastTransferAt: new Date(Date.now() - (14 + tick % 28) * 1000).toISOString() },
      status: { state: 'online' }
    };
    if (kind === 'bots') {
      const bots = stateList.map((status, i) => ({
        gamertag: 'MCGateway' + i,
        status, capacity: 1000,
        friends: friendCounts[i],
        lastRelayAt: new Date(Date.now() - (i * 19 + 3) * 60000).toISOString(),
        lastSuccessfulTransferAt: new Date(Date.now() - (i * 23 + 1) * 60000).toISOString()
      }));
      const counts = { total: bots.length, available: 0, nearCapacity: 0, full: 0, offline: 0, checking: 0 };
      for (const bot of bots) counts[bot.status === 'near_capacity' ? 'nearCapacity' : bot.status]++;
      return { generatedAt: now, bots, counts, recommendedBot: { gamertag: 'MCGateway2' } };
    }
    if (kind === 'statistics') return {
      generatedAt: now,
      transfers: {
        last24Hours: { transfers: 1280 + tick * 2 },
        last7Days: { transfers: 8720 + tick * 2 },
        last30Days: { transfers: 38750 + tick * 2 }
      }
    };
    throw new Error('Unknown mock data type');
  }
  showSource();
  window.MCGatewayPreviewDemo = Object.freeze({
    forceDemo: forced,
    setSource: source,
    sample,
    isDemo(kind) { return sources.get(kind) === 'demo'; }
  });
})();
