# uwu-log

自動化工具:從 FFLogs 報告抓「絕 究極武器破壞作戰(UWU)」的死亡事件,對應到本機 OBS 錄影,剪出候選死亡片段,並產生一個可以直接分享給隊友看的靜態網頁。

## 這個 repo 裡有什麼 / 沒有什麼

**有**:
- `scrape.mjs` — 主程式(爬 FFLogs → 分群判斷 → 對應影片 → ffmpeg 剪片 → 產生網頁)
- `web/` — 網頁模板
- `memory/` — 死因分析參考資料庫,給人工/AI 寫死因分析時查用,分成 `class-abilities/`(職業技能)與 `encounters/`(副本機制,目前有 UWU)兩個子系統,詳見 `memory/README.md`
- `config.example.json` — 設定檔範本

**沒有(刻意不放進 git)**:
- 實際剪出來的死亡片段影片、`data.js`(這些是每次執行的產出,不是原始碼)
- 各團隊自己寫的 `analysis.js`(死因分析內容,見下方說明)
- `config.json`(你自己的路徑/團隊設定,複製範本自己填)
- `.pw-profile/`(Playwright 用來記住 Cloudflare 驗證狀態的瀏覽器 profile,不要共用)

## 安裝

需要:Node.js 18+、`ffmpeg`/`ffprobe` 在 PATH 上、夠用的硬碟空間(剪出來的片段是原始畫質,單支可能到 50~80MB)。

```
npm install
npx playwright install chromium
cp config.example.json config.json
```

打開 `config.json`,至少填 `publishRoot`(你想把產生的網頁放到哪個資料夾,例如你的 web server 的 htdocs 路徑)。`ignoreGroups` 是可選的:如果你們隊上有已知的「戰術性同死」組合(例如某機制設計上就是特定幾個人一起吃傷害,不是失誤),把那幾個人的名字填進去,分析時會自動排除,不會被誤判成需要檢討的死亡。

## 使用方式

```
node scrape.mjs --report <FFLogs報告代碼> --video-dir "<這場錄影所在的資料夾路徑>"
```

報告代碼從 FFLogs 網址取得:`https://cn.fflogs.com/reports/AbCdEfGh1234` → 代碼是 `AbCdEfGh1234`。`--video-dir` 請用絕對路徑,資料夾內錄影檔名需符合 `YYYY-MM-DD_HH-MM-SS.mp4` 格式(大多數 OBS 預設命名就是這樣),工具會用檔名判斷戰鬥日期、並依照片長把每支影片對應到正確的 pull。

第一次執行若跳出 Cloudflare 「我是人類」驗證,手動完成一次即可,之後 `.pw-profile` 會記住驗證狀態。

常用參數(詳見 `scrape.mjs` 檔頭註解):`--no-cut`(只看候選清單、不真的剪片,適合先預覽)、`--pad-before`/`--pad-after`(死亡前後留幾秒,預設 10/5)、`--gap`(幾秒內的死亡算同一群,預設10)、`--ignore "A,B,C;D,E"`(CLI 覆蓋 config.json 的排除組合)。

跑完會在 `<publishRoot>/<戰鬥日期>/` 產生 `index.html`,直接雙擊開啟即可看候選片段,`<publishRoot>/index.html` 則是彙總所有場次的總覽頁。

## 死因分析怎麼加(analysis.js)

工具本身只能用「傷害數字、是否一擊必殺、治療量」做粗略分群,無法判斷「這個死亡實際上是什麼機制、為什麼會死」——這件事需要人(或 AI)實際去看 FFLogs 該場的死亡明細,對照 `memory/encounters/UWU/` 查出對應的技能機制,再寫一段簡短說明。

每次執行 `scrape.mjs` 都會在輸出資料夾自動建立一個空的 `analysis.js`(如果還不存在的話;已存在則不會覆蓋),格式是:

```js
window.DEATH_ANALYSIS = {
  "P02_Ifrit_1-41_Mmaru.mp4": {
    conclusion: "一句話結論",
    mechanism: "機制講解——這技能是什麼、怎麼運作",
    detail: "詳細分析——結合這場實際數據跟前後事件,說明為什麼判定是這個死因",
  },
  // key 是候選片段的檔名(跟 data.js 裡每個 cluster 的 clipFile 一致)
};
```

網頁載入時如果在 `DEATH_ANALYSIS` 裡找到對應片段的 key,就會在該片段卡片下方依序顯示這三段;找不到就不顯示,不影響其他功能(舊版純字串格式也相容,會當成單一段落顯示)。

寫分析建議直接請 AI 助手照 `.claude/skills/death-cause-analysis/SKILL.md` 的流程處理——裡面包含查表、跨階段技能名稱消歧,以及判斷死因是死者自己站錯、還是隊友沒開減傷/沒歸位、或前一次死亡連鎖造成的完整步驟。這一步因為每個團隊的報告、玩家都不一樣,沒辦法變成共用程式碼。

## 想貢獻的話

歡迎改進的方向:
- `scrape.mjs` 的分群/影片比對邏輯(目前用「片長依序比對」抓孤兒錄影,可能還有邊界案例)
- `web/` 的顯示介面
- **最歡迎**:`memory/encounters/UWU/` 機制寫錯或不夠精確的地方——這份是給所有人共用查的機制對照表,不是某個團隊專屬的
