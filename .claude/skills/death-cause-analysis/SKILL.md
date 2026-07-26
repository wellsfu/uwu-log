---
name: death-cause-analysis
description: Use when analyzing an FFLogs death record for a raid encounter in this repo — writing analysis.js entries, answering "why did X die here", or checking whether a newly added encounter's *_MECHANICS.md is queryable.
---

# 死因解析 (Death Cause Analysis)

## Overview

每個副本各自有一份 `<ENCOUNTER>_MECHANICS.md`(例如 `UWU_MECHANICS.md`),把死亡紀錄裡的技能名稱對照到機制說明與死因判讀。這份 skill 是通用的**查表流程**,不寫死任何一隻王的技能——機制知識全部放在對應的 `*_MECHANICS.md` 裡。新增副本時只要照同樣的表格結構寫一份新的 `*_MECHANICS.md`,不用改這份 skill。

## When to use

- 要幫某場 pull 的死亡紀錄寫死因說明(填 `analysis.js`)
- 被問「這個技能為什麼會死」、「這次團滅原因」
- 專案新增了一個副本,要確認它的 `*_MECHANICS.md` 能否被這份流程查到

## Step 1 — 找到對應的機制表

在專案根目錄找 `*_MECHANICS.md`。若有多份,用 FFLogs 報告的副本/zone 名稱,或使用者提到的副本名稱去比對檔名。**找不到對應檔案就直接說明「這個副本沒有機制對照表」,不要拿別隻王的表硬套。**

## Step 2 — 從 FFLogs 死亡紀錄取得欄位

技能名稱(致命一擊)、是否標記「一擊必殺」、死亡時間點(pull 內相對秒數)、受到的傷害、受到的治療、DOT 持續秒數(若有)。

## Step 3 — 查表分類,注意技能名稱跨階段重複

在機制表裡找到這個技能名稱所屬的分類(表格通常會分兩大類,常見是「一擊必殺」vs「持續傷害/補量」)。**同一個技能名稱可能在多個階段重複出現**——不要只看 FFLogs 標的 phase 就下結論,對照死亡時間點所在的秒數區間(機制表通常附各階段大約時長)來判斷實際是哪個階段施放的。

## Step 4 — 依分類套用推理

**優先順序:機制表裡該技能那一列如果已經有自己的「死因判讀」文字,以那句為準;下面這張表只是機制表沒寫清楚時的通用備援邏輯。**

| 分類 | 死因判讀(通用備援,無專屬判讀時才用) |
|---|---|
| 一擊必殺類 | 通常是「機制沒躲開/站位錯誤」。除非傷害數字明顯偏低,才註明「傷害不高但仍死亡,推測死前血量已偏低」 |
| 持續傷害/補量類 | 看治療量:很低(數百內)= 沒被照顧到;不低但仍死亡 = 補量沒跟上疊加速度,或機制本身傷害偏高 |
| 分攤型機制(同一時間多人死) | 先查是否為需要分攤的技能(死因是分攤人數不足),再查是否為同一個一擊必殺 AOE 命中多人(死因是站位重疊) |
| 表上查不到的技能名稱 | 不要硬套其他技能的判讀。用傷害/治療數字套用上面通用邏輯,並提醒機制表可能需要補充這個技能 |

## Step 5 — 寫成結論

1~3 句話,說明是哪個機制、為什麼死(機制沒躲 vs 補量不夠 vs 分攤不足)。若在這個 repo 的 scrape.mjs 工作流程下,寫進輸出資料夾 `analysis.js` 對應的 `clipFile` key,不要覆蓋既有內容(腳本重跑也不會覆蓋,直接編輯即可)。

## Common mistakes

- 只看 FFLogs 標的 phase 就假設技能來源,沒對照死亡時間點——同技能跨階段重複時會判斷錯誤
- 治療量不低卻直接判定「機制沒躲開」,沒分清一擊必殺 vs 補量類的判讀邏輯
- 找不到對應的 `*_MECHANICS.md` 卻硬套其他副本的表
