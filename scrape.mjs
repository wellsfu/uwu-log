// FFLogs 死亡片段擷取工具
// 用法: node scrape.mjs --report CZKpFPADQ9Mvadb8 --video-dir "E:\obs\07-21-絕 究極武器破壞作戰" [options]
//
// 第一次使用請先複製 config.example.json 成 config.json,填入你自己的網站發布路徑、
// 常駐排除的玩家組合等機器/團隊專屬設定(config.json 已加入 .gitignore,不會被提交)。
//
// 選項(這裡指定的值會覆蓋 config.json):
//   --report <code>       FFLogs 報告代碼 (必填)
//   --domain <domain>     預設讀 config.json,否則 cn.fflogs.com
//   --video-dir <path>    存放對應錄影 mp4 的資料夾 (必填)
//   --out-dir <path>      輸出資料夾,預設 <publish-root>\<date>\ (見下)
//   --publish-root <path> 網站發布根目錄,預設讀 config.json 的 publishRoot
//   --date <YYYY-MM-DD>   發布用的日期子目錄,預設自動從錄影檔名判斷戰鬥當天日期(判斷不出來才退回今天)
//   --lead <sec>          錄影比 log 早開始幾秒,預設讀 config.json,否則 10
//   --pad-before <sec>    死亡時間點前面留幾秒,預設讀 config.json,否則 10
//   --pad-after <sec>     死亡時間點後面留幾秒,預設讀 config.json,否則 5
//   --gap <sec>           死亡事件間隔多少秒內算同一群,預設讀 config.json,否則 10
//   --cut                 是否實際用 ffmpeg 剪片 (預設剪, 用 --no-cut 關閉)
//   --ignore "A,B,C;D,E"  排除特定玩家組合同時死亡的已知戰術死亡 (分號分隔多組, 逗號分隔組內玩家)
//                         預設讀 config.json 的 ignoreGroups

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 讀取機器/團隊專屬設定 (config.json,已 gitignore) ----------
function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    console.warn(`!! config.json 解析失敗,當作沒有設定處理: ${e.message}`);
    return {};
  }
}
const CONFIG = loadConfig();

// ---------- 參數解析 ----------
function parseArgs(argv) {
  const args = { cut: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') args.report = argv[++i];
    else if (a === '--domain') args.domain = argv[++i];
    else if (a === '--video-dir') args.videoDir = argv[++i];
    else if (a === '--out-dir') args.outDir = argv[++i];
    else if (a === '--publish-root') args.publishRoot = argv[++i];
    else if (a === '--date') args.date = argv[++i];
    else if (a === '--lead') args.lead = Number(argv[++i]);
    else if (a === '--pad-before') args.padBefore = Number(argv[++i]);
    else if (a === '--pad-after') args.padAfter = Number(argv[++i]);
    else if (a === '--gap') args.gap = Number(argv[++i]);
    else if (a === '--cut') args.cut = true;
    else if (a === '--no-cut') args.cut = false;
    else if (a === '--ignore') args.ignoreRaw = argv[++i];
  }
  return args;
}

function parseIgnoreGroups(raw) {
  if (!raw) return CONFIG.ignoreGroups || [];
  return raw.split(';').map(g => g.split(',').map(s => s.trim()).filter(Boolean)).filter(g => g.length);
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every(x => sa.has(x));
}

function todayDateStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 從錄影檔名(例如 2026-07-21_20-06-23.mp4)推斷「戰鬥實際發生的日期」,
// 而不是用「執行這支腳本當下」的日期 —— 兩者常常不同(補剪、事後整理都很常見)。
function deriveBattleDate(videoDir) {
  try {
    const files = fs.readdirSync(videoDir).filter(f => /\.mp4$/i.test(f)).sort();
    for (const f of files) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
    }
  } catch { /* fall through */ }
  return null;
}

// 若同一天已經有「不同報告」的輸出,避免直接覆蓋掉,改用 -2 / -3 後綴。
function resolveOutDir(publishRoot, baseDate, reportCode) {
  for (let n = 1; n < 50; n++) {
    const candidateDate = n === 1 ? baseDate : `${baseDate}-${n}`;
    const dir = path.join(publishRoot, candidateDate);
    const dataFile = path.join(dir, 'data.js');
    if (!fs.existsSync(dir)) return { dir, date: candidateDate };
    if (fs.existsSync(dataFile)) {
      const content = fs.readFileSync(dataFile, 'utf-8');
      const m = content.match(/"reportCode"\s*:\s*"([^"]+)"/);
      if (m && m[1] === reportCode) return { dir, date: candidateDate }; // 同一份報告,允許覆蓋重跑
    } else {
      return { dir, date: candidateDate };
    }
  }
  throw new Error('找不到可用的輸出目錄(嘗試次數過多)');
}

const args = parseArgs(process.argv.slice(2));
if (!args.report || !args.videoDir) {
  console.error('用法: node scrape.mjs --report <code> --video-dir <path> [--domain cn.fflogs.com] [--out-dir path] [--publish-root path] [--date YYYY-MM-DD] [--lead 10] [--pad-before 10] [--pad-after 5] [--gap 10] [--no-cut] [--ignore "A,B,C;D,E"]');
  process.exit(1);
}
args.domain = args.domain || CONFIG.domain || 'cn.fflogs.com';
args.lead = args.lead ?? CONFIG.lead ?? 10;
args.padBefore = args.padBefore ?? CONFIG.padBefore ?? 10;
args.padAfter = args.padAfter ?? CONFIG.padAfter ?? 5;
args.gap = args.gap ?? CONFIG.gap ?? 10;
args.publishRoot = args.publishRoot || CONFIG.publishRoot;
if (!args.publishRoot && !args.outDir) {
  console.error('!! 沒有指定發布路徑。請用 --publish-root 指定,或複製 config.example.json 成 config.json 並填入 publishRoot。');
  process.exit(1);
}

// 盡早驗證 --video-dir,避免相對路徑打錯字時,浪費一輪爬蟲(含 Cloudflare 驗證)才在剪片階段才炸掉。
args.videoDir = path.resolve(args.videoDir);
if (!fs.existsSync(args.videoDir) || !fs.statSync(args.videoDir).isDirectory()) {
  console.error(`!! 找不到錄影資料夾: ${args.videoDir}`);
  console.error(`   請確認 --video-dir 路徑正確,建議使用絕對路徑,例如:`);
  console.error(`   --video-dir "E:\\obs\\07-20-絕 究極武器破壞作戰"`);
  process.exit(1);
}

if (!args.outDir) {
  const battleDate = args.date || deriveBattleDate(args.videoDir) || todayDateStr();
  if (!args.date && battleDate === todayDateStr() && !deriveBattleDate(args.videoDir)) {
    console.warn('!! 無法從錄影檔名判斷戰鬥日期(檔名不是 YYYY-MM-DD_... 格式),退回使用今天日期。可用 --date 手動指定。');
  }
  const resolved = resolveOutDir(args.publishRoot, battleDate, args.report);
  args.outDir = resolved.dir;
  args.date = resolved.date;
} else {
  args.date = args.date || todayDateStr();
}
const IGNORE_GROUPS = parseIgnoreGroups(args.ignoreRaw);

fs.mkdirSync(args.outDir, { recursive: true });
console.log(`輸出目錄: ${args.outDir} (戰鬥日期判斷為 ${args.date})`);

// ---------- 小工具 ----------
function mmssToSec(text) {
  const m = text.trim().match(/(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
}

async function ffprobeDuration(file) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  return parseFloat(stdout.trim());
}

function safeName(s) {
  return s.replace(/[\\/:*?"<>|]/g, '_');
}

// ---------- 1. 用 Playwright 抓報告資料 ----------
async function scrapeReport() {
  const profileDir = path.join(__dirname, '.pw-profile');
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
  });
  const page = context.pages()[0] || await context.newPage();

  console.log(`[1/3] 開啟報告總覽頁... 若跳出 Cloudflare 驗證請手動完成一次即可。`);
  await page.goto(`https://${args.domain}/reports/${args.report}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[class*="-wipes-phases"]', { timeout: 60000 });
  await page.waitForTimeout(1000);

  const reportTitle = await page.evaluate(() =>
    document.querySelector('.report-name-text')?.textContent?.trim() || document.title
  );

  const pulls = await page.evaluate(() => {
    const container = document.querySelector('[class*="-wipes-phases"]');
    if (!container) return [];
    const results = [];
    let currentBoss = null;
    for (const child of container.children) {
      if (child.matches('a.phase-fight-grid-caption')) {
        const clone = child.cloneNode(true);
        const innerSpan = clone.querySelector('span');
        if (innerSpan) innerSpan.remove();
        currentBoss = clone.textContent.trim();
      } else if (child.matches('div.wipes-table')) {
        const entries = child.querySelectorAll('a.wipes-entry');
        for (const entry of entries) {
          const href = entry.getAttribute('href') || '';
          const m = href.match(/fight=(\d+)/);
          const pullNumber = m ? parseInt(m[1], 10) : null;
          const percent = entry.querySelector('.fight-grid-cell-percent')?.textContent.trim() || '';
          const phase = entry.querySelector('.fight-grid-cell-phase')?.textContent.trim() || '';
          const durationText = (entry.querySelector('.fight-grid-duration')?.textContent || '').trim();
          const clockTime = (entry.querySelector('.fight-grid-time')?.textContent || '').trim();
          results.push({ pullNumber, boss: currentBoss, percent, phase, durationText, clockTime });
        }
      }
    }
    return results;
  });
  pulls.sort((a, b) => a.pullNumber - b.pullNumber);
  console.log(`    找到 ${pulls.length} 場 pull。`);

  console.log(`[2/3] 逐場抓取死亡事件...`);
  for (const pull of pulls) {
    const url = `https://${args.domain}/reports/${args.report}?fight=${pull.pullNumber}&type=deaths`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.waitForSelector('table[id^="deaths-table-"]', { timeout: 8000 });
    } catch {
      pull.deaths = [];
      console.log(`    pull ${pull.pullNumber}: 無死亡表格 (可能 0 死亡或該場 clear)`);
      continue;
    }
    await page.waitForTimeout(300);
    const deaths = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table[id^="deaths-table-"] tbody tr'));
      return rows.map(tr => {
        const timeText = (tr.querySelector('td.main-table-number.sorting_1')?.textContent || '').trim();
        const nameEl = tr.querySelector('td.main-table-name .main-table-link');
        const name = (nameEl?.textContent || '').trim();
        const job = (nameEl?.className || '').replace('main-table-link', '').trim();
        return { timeText, name, job };
      }).filter(d => d.timeText && d.name);
    });
    pull.deaths = deaths.map(d => ({ ...d, timeSec: mmssToSec(d.timeText) })).filter(d => d.timeSec != null);
    console.log(`    pull ${pull.pullNumber} (${pull.boss}): ${pull.deaths.length} 個死亡事件`);
  }

  await context.close();
  return { reportTitle, pulls };
}

// ---------- 2. 分群 + 篩選 ----------
function clusterAndFilter(pull) {
  const sorted = [...pull.deaths].sort((a, b) => a.timeSec - b.timeSec);
  const clusters = [];
  for (const d of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && d.timeSec - last.maxTime <= args.gap) {
      last.deaths.push(d);
      last.maxTime = d.timeSec;
    } else {
      clusters.push({ deaths: [d], minTime: d.timeSec, maxTime: d.timeSec });
    }
  }
  clusters.forEach((c, idx) => {
    c.isFinalWipe = idx === clusters.length - 1;
    const names = c.deaths.map(d => d.name);
    const uniqueNames = [...new Set(names)];
    c.players = uniqueNames;
    let include = !c.isFinalWipe && uniqueNames.length >= 1 && uniqueNames.length <= 3;
    let reason = include ? 'ok' : (c.isFinalWipe ? 'final_wipe' : 'too_large');
    if (include) {
      for (const grp of IGNORE_GROUPS) {
        if (sameSet(uniqueNames, grp)) { include = false; reason = 'ignored_tactical'; break; }
      }
    }
    c.include = include;
    c.reason = reason;
  });
  return clusters;
}

// ---------- 3. 影片比對 ----------
// 不能只靠「數量相同就照順序 1:1 配對」—— 只要中間夾了一支不相關/多餘的錄影
// (例如忘記停止錄影、或和這份報告無關的另一次嘗試),後面全部場次都會錯位。
// 改成用「影片時長」跟「該 pull 的戰鬥時長」做比對:兩者理論上非常接近
// (影片只會因為提前開始錄影 + 結尾多留一點尾巴而比 pull 時長略長,通常多個幾秒到幾十秒)。
// 在往後幾支影片的窗口內找時長最接近、且不短於 pull 時長的影片,中間跳過的視為孤兒檔案。
async function matchVideos(pulls) {
  const files = fs.readdirSync(args.videoDir).filter(f => /\.mp4$/i.test(f)).sort();
  console.log(`[3/3] 資料夾內找到 ${files.length} 個 mp4,報告內有 ${pulls.length} 場 pull,依片長比對中...`);

  const withDur = [];
  for (const f of files) {
    const full = path.join(args.videoDir, f);
    const durationSec = await ffprobeDuration(full);
    withDur.push({ file: f, path: full, durationSec });
  }

  // 依序往後找「第一支長度足夠」的影片,而不是在一個視窗內找「全局最接近」的影片。
  // 後者看似更精準,但實測會發生「後面某支影片的時長剛好更接近」而被錯誤提前配對、
  // 反而把中間真正該配對的影片擠成孤兒的狀況,導致連鎖錯位。孤兒檔案(不相關的多餘錄影)
  // 只靠「時長太短、完全不夠這場pull用」就能篩掉,不需要跟後面的影片比較誰更接近。
  const TOLERANCE = -3; // 允許影片比 pull 時長略短幾秒的容許誤差(ffprobe/剪輯邊界誤差)
  const WARN_DIFF = 120; // 差距超過這個秒數才提醒人工核對(純粹是提示,不影響配對邏輯)
  let j = 0;
  const orphans = [];
  for (const pull of pulls) {
    let matchIdx = -1;
    for (let k = j; k < withDur.length; k++) {
      if (withDur[k].durationSec - pull.durationSec >= TOLERANCE) { matchIdx = k; break; }
    }
    if (matchIdx === -1) {
      pull.video = null;
      console.warn(`    !! pull ${pull.pullNumber} (${pull.boss}, ${pull.durationText}) 找不到時長足夠的影片,此場略過剪片。`);
      continue;
    }
    for (let k = j; k < matchIdx; k++) orphans.push(withDur[k].file);
    pull.video = withDur[matchIdx];
    const diff = withDur[matchIdx].durationSec - pull.durationSec;
    if (diff > WARN_DIFF) {
      console.warn(`    !! pull ${pull.pullNumber} (${pull.boss}) 對應到 ${withDur[matchIdx].file},但時長差了 ${diff.toFixed(0)} 秒,建議人工核對。`);
    }
    j = matchIdx + 1;
  }
  for (let k = j; k < withDur.length; k++) orphans.push(withDur[k].file);
  if (orphans.length) {
    console.warn(`    !! 有 ${orphans.length} 個影片檔沒有對應到任何 pull(可能是不相關/多餘的錄影),已跳過: ${orphans.join(', ')}`);
  }
}

// ---------- 4. 剪片 ----------
async function cutClip(inputFile, startSec, durSec, outFile) {
  await execFileAsync('ffmpeg', [
    '-y', '-ss', String(Math.max(0, startSec)), '-i', inputFile,
    '-t', String(durSec), '-c', 'copy', '-avoid_negative_ts', 'make_zero',
    outFile, '-hide_banner', '-loglevel', 'error',
  ]);
}

// ---------- main ----------
async function main() {
  const { reportTitle, pulls } = await scrapeReport();

  for (const pull of pulls) {
    pull.durationSec = mmssToSec(pull.durationText) ?? 0;
    pull.clusters = clusterAndFilter(pull);
  }

  await matchVideos(pulls);

  console.log(`[剪片] 開始產生候選片段...`);
  let clipCount = 0;
  for (const pull of pulls) {
    if (!pull.video) continue;
    for (const c of pull.clusters) {
      if (!c.include) continue;
      const clipStart = args.lead + c.minTime - args.padBefore;
      const clipEndRaw = args.lead + c.maxTime + args.padAfter;
      const clipEnd = Math.min(clipEndRaw, pull.video.durationSec);
      const dur = Math.max(1, clipEnd - Math.max(0, clipStart));
      const playersLabel = c.players.map(safeName).join('-');
      const timeLabel = c.deaths[0].timeText.trim().replace(':', '-');
      const outName = `P${String(pull.pullNumber).padStart(2, '0')}_${safeName(pull.boss)}_${timeLabel}_${playersLabel}.mp4`;
      const outPath = path.join(args.outDir, outName);
      c.clipFile = outName;
      c.clipStartSec = Math.max(0, clipStart);
      c.clipEndSec = clipEnd;
      if (args.cut) {
        await cutClip(pull.video.path, Math.max(0, clipStart), dur, outPath);
      }
      clipCount++;
      console.log(`    ${args.cut ? '已剪出' : '(未剪)'} ${outName}`);
    }
  }
  console.log(`共 ${clipCount} 段候選片段。`);

  // ---------- 輸出 data.json ----------
  const data = {
    reportCode: args.report,
    domain: args.domain,
    reportTitle,
    battleDate: args.date,
    generatedAt: new Date().toISOString(),
    settings: { leadSec: args.lead, padBeforeSec: args.padBefore, padAfterSec: args.padAfter, gapSec: args.gap, ignoreGroups: IGNORE_GROUPS },
    pulls: pulls.map(p => ({
      pullNumber: p.pullNumber,
      boss: p.boss,
      phase: p.phase,
      percent: p.percent,
      durationText: p.durationText,
      clockTime: p.clockTime,
      fflogsUrl: `https://${args.domain}/reports/${args.report}?fight=${p.pullNumber}&type=deaths`,
      video: p.video ? { file: p.video.file, durationSec: p.video.durationSec } : null,
      deathCount: p.deaths.length,
      clusters: p.clusters.map(c => ({
        timeText: c.deaths[0].timeText.trim(),
        players: c.players.map(name => ({
          name,
          job: (c.deaths.find(d => d.name === name) || {}).job || '',
        })),
        include: c.include,
        reason: c.reason,
        clipFile: c.clipFile || null,
        clipStartSec: c.clipStartSec ?? null,
        clipEndSec: c.clipEndSec ?? null,
      })),
    })),
  };
  // 寫成 data.js (window.PULLS_DATA = {...}) 而不是 data.json,
  // 這樣 index.html 用 <script src> 讀取,直接雙擊開啟也能運作,不受 file:// 的 fetch/CORS 限制。
  fs.writeFileSync(
    path.join(args.outDir, 'data.js'),
    'window.PULLS_DATA = ' + JSON.stringify(data, null, 2) + ';\n',
    'utf-8'
  );
  console.log(`已寫出 ${path.join(args.outDir, 'data.js')}`);

  // ---------- 複製網頁模板 ----------
  const webDir = path.join(__dirname, 'web');
  for (const f of ['index.html', 'style.css', 'app.js']) {
    fs.copyFileSync(path.join(webDir, f), path.join(args.outDir, f));
  }
  const webDest = path.join(args.outDir, 'index.html');
  console.log(`已複製檢視頁面到 ${args.outDir}`);

  // ---------- 死因分析(人工填寫,腳本絕不覆蓋) ----------
  // analysis.js 是事後人工看過死亡前後傷害紀錄寫的簡短分析,鍵值是 clipFile。
  // 這裡只在完全不存在時建立一個空殼,已存在就保留原內容,避免重跑腳本把手寫分析洗掉。
  const analysisPath = path.join(args.outDir, 'analysis.js');
  if (!fs.existsSync(analysisPath)) {
    fs.writeFileSync(
      analysisPath,
      '// 死因分析:人工看過死亡前後的傷害紀錄後填寫,key 是 clipFile 檔名。\n' +
      '// 腳本重跑不會覆蓋這個檔案,請直接編輯。\n' +
      '// 分析技能名稱前請先查 E:\\obs\\_tools\\fflogs-death-clips\\UWU_MECHANICS.md\n' +
      '// (這隻王的機制對照表,同一個技能名稱可能跨階段重複出現,不要只看FFLogs標的phase)。\n' +
      'window.DEATH_ANALYSIS = {\n' +
      '  // "P02_Ifrit_1-41_Mmaru.mp4": "分析內容...",\n' +
      '};\n',
      'utf-8'
    );
    console.log(`已建立空白死因分析檔 ${analysisPath}(可手動編輯填入分析)`);
  } else {
    console.log(`死因分析檔已存在,保留不覆蓋: ${analysisPath}`);
  }

  buildPortal(args.publishRoot);

  console.log(`完成!用瀏覽器直接開啟 ${webDest} 即可查看(可直接雙擊,不需要架 server)。`);
  console.log(`總覽頁(所有場次): ${path.join(args.publishRoot, 'index.html')}`);
}

// ---------- 產生 death_clips 根目錄的入口頁,列出底下每個日期的場次 ----------
function buildPortal(publishRoot) {
  fs.mkdirSync(publishRoot, { recursive: true });
  const entries = fs.readdirSync(publishRoot, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(name => /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(name));

  const sessions = [];
  for (const name of entries) {
    const dataFile = path.join(publishRoot, name, 'data.js');
    if (!fs.existsSync(dataFile)) continue;
    try {
      const content = fs.readFileSync(dataFile, 'utf-8');
      const jsonText = content.replace(/^\s*window\.PULLS_DATA\s*=\s*/, '').replace(/;\s*$/, '');
      const d = JSON.parse(jsonText);
      const clipCount = d.pulls.reduce((s, p) => s + p.clusters.filter(c => c.include).length, 0);
      const bosses = [...new Set(d.pulls.map(p => p.boss))];
      sessions.push({
        dir: name,
        battleDate: d.battleDate || name,
        reportTitle: d.reportTitle || name,
        reportCode: d.reportCode,
        domain: d.domain,
        pullCount: d.pulls.length,
        clipCount,
        bosses,
        generatedAt: d.generatedAt,
      });
    } catch (e) {
      console.warn(`    !! 讀取 ${dataFile} 失敗,略過: ${e.message}`);
    }
  }
  sessions.sort((a, b) => b.dir.localeCompare(a.dir));

  const cardsHtml = sessions.map(s => `
    <a class="session-card" href="./${encodeURIComponent(s.dir)}/index.html">
      <div class="session-date">${s.battleDate}</div>
      <div class="session-title">${escapeHtml(s.reportTitle)}</div>
      <div class="session-meta">${escapeHtml(s.bosses.join(' / '))}</div>
      <div class="session-stats">${s.pullCount} 場 pull · ${s.clipCount} 段精華片段</div>
    </a>`).join('\n');

  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>死亡片段回顧 - 總覽</title>
<style>
  :root { --bg:#14161c; --bg-card:#1c1f28; --border:#2d3140; --text:#e6e8ee; --text-dim:#9298a8; --accent:#6ea8fe; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,"Segoe UI","Noto Sans TC","PingFang TC",sans-serif; background:var(--bg); color:var(--text); }
  header { padding:24px; border-bottom:1px solid var(--border); }
  header h1 { margin:0 0 4px; font-size:22px; }
  header p { margin:0; color:var(--text-dim); font-size:13px; }
  main { padding:20px 24px 60px; max-width:1000px; margin:0 auto; display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; }
  .session-card { display:block; background:var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:16px; text-decoration:none; color:var(--text); transition:border-color .15s; }
  .session-card:hover { border-color:var(--accent); }
  .session-date { color:var(--accent); font-size:13px; font-weight:600; margin-bottom:4px; }
  .session-title { font-size:15px; font-weight:600; margin-bottom:6px; }
  .session-meta { color:var(--text-dim); font-size:12px; margin-bottom:4px; }
  .session-stats { color:var(--text-dim); font-size:12px; }
  .empty { color:var(--text-dim); padding:40px; text-align:center; grid-column:1/-1; }
</style>
</head>
<body>
  <header>
    <h1>死亡片段回顧 - 總覽</h1>
    <p>共 ${sessions.length} 場次紀錄</p>
  </header>
  <main>
    ${sessions.length ? cardsHtml : '<div class="empty">目前還沒有任何場次</div>'}
  </main>
</body>
</html>
`;
  fs.writeFileSync(path.join(publishRoot, 'index.html'), html, 'utf-8');
  console.log(`已更新總覽頁 ${path.join(publishRoot, 'index.html')} (共 ${sessions.length} 場次)`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
