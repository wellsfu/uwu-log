(function () {
  const data = window.PULLS_DATA;
  if (!data) {
    document.getElementById('pulls').textContent = '找不到 data.js,請重新執行 scrape.mjs。';
    return;
  }

  const ROLE_MAP = {
    Paladin: 'tank', Warrior: 'tank', DarkKnight: 'tank', Gunbreaker: 'tank',
    WhiteMage: 'healer', Scholar: 'healer', Astrologian: 'healer', Sage: 'healer',
    Monk: 'dps', Dragoon: 'dps', Ninja: 'dps', Samurai: 'dps', Reaper: 'dps', Viper: 'dps',
    Bard: 'dps', Machinist: 'dps', Dancer: 'dps',
    BlackMage: 'dps', Summoner: 'dps', RedMage: 'dps', Pictomancer: 'dps', BlueMage: 'dps',
  };

  function roleOf(job) { return ROLE_MAP[job] || 'dps'; }

  function percentClass(percentText) {
    const n = parseFloat(percentText);
    if (isNaN(n)) return '';
    if (n <= 20) return 'good';
    if (n <= 60) return 'mid';
    return 'bad';
  }

  // ---------- header ----------
  document.getElementById('report-title').textContent = data.reportTitle || 'FFLogs 死亡片段回顧';
  const reportLink = document.getElementById('report-link');
  reportLink.href = `https://${data.domain}/reports/${data.reportCode}`;

  const totalClips = data.pulls.reduce((sum, p) => sum + p.clusters.filter(c => c.include).length, 0);
  document.getElementById('stats').textContent =
    `共 ${data.pulls.length} 場 pull · ${totalClips} 段候選死亡片段 · 產生時間 ${new Date(data.generatedAt).toLocaleString('zh-TW')}`;

  // ---------- filters population ----------
  const bossSet = new Set();
  const playerSet = new Set();
  data.pulls.forEach(p => {
    bossSet.add(p.boss);
    p.clusters.forEach(c => c.players.forEach(pl => playerSet.add(pl.name)));
  });
  const bossSelect = document.getElementById('filter-boss');
  [...bossSet].sort().forEach(b => {
    const opt = document.createElement('option');
    opt.value = b; opt.textContent = b;
    bossSelect.appendChild(opt);
  });
  const playerSelect = document.getElementById('filter-player');
  [...playerSet].sort().forEach(pl => {
    const opt = document.createElement('option');
    opt.value = pl; opt.textContent = pl;
    playerSelect.appendChild(opt);
  });

  const showExcludedBox = document.getElementById('filter-show-excluded');

  // ---------- render ----------
  const pullsEl = document.getElementById('pulls');

  function playerBadge(pl) {
    const span = document.createElement('span');
    span.className = `player-badge ${roleOf(pl.job)}`;
    span.textContent = pl.name;
    return span;
  }

  function clusterCard(c) {
    const card = document.createElement('div');
    card.className = 'cluster-card' + (c.include ? '' : ' excluded');
    card.dataset.players = c.players.map(p => p.name).join(',');

    const top = document.createElement('div');
    top.className = 'cluster-top';
    const time = document.createElement('span');
    time.className = 'cluster-time';
    time.textContent = `死亡時刻 ${c.timeText}`;
    top.appendChild(time);
    if (!c.include) {
      const tag = document.createElement('span');
      tag.className = 'cluster-tag';
      tag.textContent = c.reason === 'final_wipe' ? '團滅' : c.reason === 'ignored_tactical' ? '戰術性同死' : '人數過多';
      top.appendChild(tag);
    }
    card.appendChild(top);

    const badges = document.createElement('div');
    badges.className = 'player-badges';
    c.players.forEach(pl => badges.appendChild(playerBadge(pl)));
    card.appendChild(badges);

    if (c.include && c.clipFile) {
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'none';
      const source = document.createElement('source');
      source.src = './' + encodeURIComponent(c.clipFile);
      source.type = 'video/mp4';
      video.appendChild(source);
      card.appendChild(video);
    } else if (c.include) {
      const na = document.createElement('div');
      na.className = 'no-video';
      na.textContent = '找不到對應影片';
      card.appendChild(na);
    }

    // 死因分析是人工(或AI照 death-cause-analysis skill)看過死亡前後的傷害紀錄後寫的,不是腳本自動產生。
    // 只有在 analysis.js 裡有對應這個片段的條目時才會顯示。條目可以是三段式物件
    // { conclusion, mechanism, detail },舊格式的純字串也相容(當成單一段落顯示)。
    const analysisMap = window.DEATH_ANALYSIS || {};
    const analysisEntry = c.clipFile ? analysisMap[c.clipFile] : null;
    if (analysisEntry) {
      const sections = typeof analysisEntry === 'string'
        ? [['死因分析', analysisEntry]]
        : [
            ['結論', analysisEntry.conclusion],
            ['機制講解', analysisEntry.mechanism],
            ['詳細分析', analysisEntry.detail],
          ];
      const box = document.createElement('div');
      box.className = 'death-analysis';
      for (const [labelText, bodyText] of sections) {
        if (!bodyText) continue;
        const label = document.createElement('div');
        label.className = 'death-analysis-label';
        label.textContent = labelText;
        const body = document.createElement('div');
        body.className = 'death-analysis-body';
        body.textContent = bodyText;
        box.appendChild(label);
        box.appendChild(body);
      }
      if (box.childElementCount) card.appendChild(box);
    }

    return card;
  }

  function renderPull(pull) {
    const card = document.createElement('div');
    card.className = 'pull-card';
    card.dataset.boss = pull.boss;

    const header = document.createElement('div');
    header.className = 'pull-header';
    header.innerHTML = `
      <span class="pull-num">Pull ${pull.pullNumber}</span>
      <span class="pull-boss">${pull.boss}</span>
      <span class="pull-phase">${pull.phase || ''}</span>
      <span class="pull-percent ${percentClass(pull.percent)}">${pull.percent}</span>
      <span class="pull-meta">
        <span>${pull.clockTime}</span>
        <span>時長 ${pull.durationText}</span>
        <span>${pull.deathCount} 次死亡</span>
        <a href="${pull.fflogsUrl}" target="_blank" rel="noopener">FFLogs 死亡列表 ↗</a>
        ${pull.video ? `<a href="./${encodeURIComponent(pull.video.file)}" target="_blank" rel="noopener">完整錄影 ↗</a>` : ''}
      </span>
    `;
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'pull-body';
    const grid = document.createElement('div');
    grid.className = 'cluster-grid';
    pull.clusters.forEach(c => grid.appendChild(clusterCard(c)));
    body.appendChild(grid);
    if (!pull.clusters.length || !pull.clusters.some(c => c.include)) {
      const note = document.createElement('div');
      note.className = 'no-clips';
      note.textContent = pull.clusters.length ? '本場沒有符合條件的獨立死亡片段(全部為團滅或戰術性同死)。' : '本場沒有偵測到死亡事件。';
      body.appendChild(note);
    }
    card.appendChild(body);
    return card;
  }

  data.pulls.forEach(pull => pullsEl.appendChild(renderPull(pull)));

  // ---------- filtering ----------
  function applyFilters() {
    const boss = bossSelect.value;
    const player = playerSelect.value;
    const showExcluded = showExcludedBox.checked;

    document.querySelectorAll('.pull-card').forEach((pullCard, i) => {
      const pull = data.pulls[i];
      const bossMatch = !boss || pull.boss === boss;
      // 是否顯示整場 pull:只看 boss 篩選 + (若有指定玩家)該玩家在這場是否曾經死亡,
      // 不受「顯示排除事件」勾選影響,避免只有團滅的場次整場消失、看不到完整時間軸。
      const playerInPull = !player || pull.clusters.some(c => c.players.some(p => p.name === player));

      pullCard.querySelectorAll('.cluster-card').forEach((cc, j) => {
        const c = pull.clusters[j];
        const playerMatch = !player || c.players.some(p => p.name === player);
        const excludedOk = c.include || showExcluded;
        cc.style.display = (playerMatch && excludedOk) ? '' : 'none';
      });
      pullCard.classList.toggle('hidden', !bossMatch || !playerInPull);
    });
  }

  bossSelect.addEventListener('change', applyFilters);
  playerSelect.addEventListener('change', applyFilters);
  showExcludedBox.addEventListener('change', applyFilters);
  applyFilters();
})();
