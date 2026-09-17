# BeybladeX 賽事候補系統

實體賽事候補登記、現場核驗、候補抽選與追加公布。依 [Waitlist_System_Specification_v1.0](docs/spec-summary.md) 實作。

**技術堆疊：** Google Apps Script + Google Sheets + HTML/CSS/JavaScript

## 功能概覽

| 頁面 | 路徑 | 說明 |
| --- | --- | --- |
| Display | `?page=display` | 現場 QR、作業狀態、抽選結果（免登入） |
| Candidate | `?page=candidate` | 選手登記、確認防呆、櫃檯 PIN 核驗 |
| Admin | `?page=admin` | 管理後台（ADMIN PIN 登入） |

### 核心特性

- 一般模式 / 櫃檯核驗模式（Admin 切換）
- ADMIN PIN + 操作者姓名 + 12 小時 Session
- Staff PIN：每登記 session 與每裝置各自限次（預設 3 次；裝置鎖定 30 秒，不影響其他選手）
- Admin PIN Rate Limit（5 分鐘 5 次失敗鎖定，僅限管理後台登入）
- QR Rotation + Token TTL 防外流遠端登記
- LockService Atomic 發號 + request_id 冪等
- 首次抽選建立完整 random_rank，後續僅追加公布
- 三狀態 Display：開放 / 作業中 / 關閉 + 抽選結果輪播

## 專案結構

本 repo 的 Apps Script 原始碼在 `src/`（`clasp` 的 `rootDir: "src"`）：

```
beybladeX_tournament_Alternate-selection/
├── src/
│   ├── main.gs                 # Web App 入口 doGet / doPost
│   ├── config.gs               # 常數與 Sheet 設定
│   ├── setup.gs                # 一次性初始化
│   ├── auth/adminAuth.gs
│   ├── repos/                  # Google Sheets 資料存取
│   ├── services/               # 業務邏輯
│   ├── utils/                  # 工具函式
│   ├── display.html
│   ├── candidate.html
│   ├── admin.html
│   ├── styles.html
│   └── appsscript.json        # Apps Script manifest（clasp push 用）
├── .clasp.json.example
└── .env.example                # Script Properties 設定說明
```

## 部署步驟

### 1. 建立 Google 試算表

1. 新建空白 Google 試算表
2. 複製試算表 ID（網址中 `/d/` 與 `/edit` 之間的字串）

### 2. 建立 Apps Script 專案

**方式 A：使用 clasp（建議）**

```bash
npm install -g @google/clasp
clasp login
# 在本 repo 根目錄（含 .clasp.json 處）執行：
# 必須加 --rootDir src，manifest 才會寫入 src/appsscript.json（與 rootDir 一致）
clasp create --type standalone --title "BeybladeX 候補系統" --rootDir src
# 或複製 .clasp.json.example → .clasp.json，填入 scriptId
# 記得到 https://script.google.com/home/usersettings 開啟 Apps Script API
clasp push
```

**方式 B：手動**

1. 前往 [script.google.com](https://script.google.com) 建立 Standalone 專案
2. 將 `src/` 內所有 `.gs` 與 `.html` 檔案複製貼上

### 3. 設定 Script Properties

在 Apps Script 編輯器：**專案設定 → Script properties**，依 `.env.example` 設定：

| 屬性 | 必填 | 說明 |
| --- | --- | --- |
| `SPREADSHEET_ID` | ✅ | Google 試算表 ID |
| `ADMIN_PIN` | ✅ | 管理員 PIN |
| `SESSION_TTL_HOURS` | 否 | Session 有效時間（預設 12 小時） |
| `LOGIN_RATE_LIMIT_WINDOW_MINUTES` | 否 | PIN 失敗計數窗口（預設 5 分鐘） |
| `LOGIN_RATE_LIMIT_MAX_FAILURES` | 否 | 窗口內最大失敗次數（預設 5 次） |
| `LOGIN_LOCKOUT_MINUTES` | 否 | 鎖定時間（預設 5 分鐘） |

或在編輯器執行一次：

```javascript
setSpreadsheetId('YOUR_SPREADSHEET_ID');
```

### 4. 初始化工作表

部署後**首次讀寫試算表時會自動建立**（例如開啟 Display、Admin 或第一筆候補登記），無需手動執行。

若需手動補建或確認結構，可在 Apps Script 編輯器執行 `setupWaitlistSystem()`。

自動建立的工作表：

- Settings
- Waitlist
- LotteryResult
- PublishBatches
- LotteryAudit（隱藏）
- AuditLog

預設 Staff PIN：`0313`（請於 Admin 後台立即修改）

### 5. 部署 Web App

1. **部署 → 新增部署 → 網頁應用程式**
2. 執行身分：**我**
3. 存取權：**任何人**（公開 Display / Candidate 需要）
4. 部署後取得 URL

### 6. 存取各頁面

```
https://script.google.com/macros/s/YOUR_ID/exec?page=display
https://script.google.com/macros/s/YOUR_ID/exec?page=candidate
https://script.google.com/macros/s/YOUR_ID/exec?page=admin
```

Candidate 由 Display QR 帶入 token 進入，格式如下：

```text
https://script.google.com/macros/s/YOUR_ID/exec?page=candidate&token=TOKEN
```

成功頁可憑 receipt 恢復：

```text
https://script.google.com/macros/s/YOUR_ID/exec?page=candidate&receipt=RECEIPT_TOKEN
```

### 7. 更新程式碼（clasp push 後如何反映到線上）

`clasp push` **只更新 Apps Script 專案原始碼**，不會自動更新已對外的 Web App `/exec` 網址。

**日常更新流程：**

1. 在本 repo 根目錄（含 `.clasp.json` 處）執行：

```bash
clasp push
# 若無變更被跳過，可強制推送：
clasp push --force
```

2. 開啟 [script.google.com](https://script.google.com) → 進入本專案
3. **部署 → 管理部署** → 點現有部署旁的 **編輯（鉛筆）**
4. **版本** 選 **新版本** → **部署**
5. 用原 Web App URL 重新整理（建議無痕或 Ctrl+F5，避免快取舊 HTML）

| 動作 | 效果 |
| --- | --- |
| `clasp push` | 編輯器／專案內程式碼已更新 |
| 部署「新版本」 | 正式 `/exec` 網址才會跑新碼 |
| 測試部署 `/dev` | 通常跟著最新碼，僅供測試 |

**注意：**

- 必須在本 repo 根目錄（含 `.clasp.json`）執行 `clasp`；若在上一層目錄會出現 `Project settings not found`
- `.clasp.json` 的 `rootDir` 應為 `"src"`（本專案原始碼目錄）；`appsscript.json` 也在 `src/`，根目錄若有多餘的 manifest 可刪除
- `clasp create` 請加 `--rootDir src`，否則 manifest 會落在 repo 根目錄而 `clasp push` 不會推送
- `clasp login` 後需至 [Apps Script API 設定](https://script.google.com/home/usersettings) 開啟 API 存取
- `clasp push` 後若只推送 1 個檔案，代表 `.claspignore` 設定有誤；正常應推送約 22 個檔案（含 `main.gs`）
- 若出現「找不到 doGet」，通常是程式未推送成功，或部署版本未更新

## 現場使用流程

1. Admin 開啟 `?page=admin`，設定活動名稱、場次、登記模式
2. Display 頁投影：`?page=display`
3. 點「開放候補」→ 選手掃 QR 進入 Candidate 登記
4. 必要時「停止新增」（QR 隱藏，已掃碼者可完成）
5. 「結束候補」→ 執行首次抽選 → Display 顯示結果
6. 缺額時追加公布 Batch 2 / 3 …
7. 活動結束匯出資料 → 清空本場（序號重設 #001）

## 開發階段

| Phase | 內容 | 狀態 |
| --- | --- | --- |
| 1 | 一般模式、Atomic 發號、Candidate 成功頁 | ✅ 骨架完成 |
| 2 | 櫃檯核驗、PIN、橘色狀態 | ✅ 骨架完成 |
| 3 | Display QR Rotation、Responsive | ✅ 骨架完成 |
| 4 | 抽選、Publish Batch、結果 Display | ✅ 骨架完成 |
| 5 | 匯出/清空、Audit、進階抽選 | 🔶 基礎版完成 |
| 6 | 壓力測試、實機驗收 | ⬜ 待進行 |

## API Actions

| Action | 說明 |
| --- | --- |
| `getPublicState` | Display 輪詢狀態 |
| `validateToken` | QR 掃描後建立 form session |
| `register` | 一般模式登記 |
| `verifyAndRegister` | 櫃檯模式 + PIN |
| `getReceipt` | 成功頁憑證恢復 |
| `admin.login` | Admin PIN 登入 |
| `admin.logout` | Admin 登出 |
| `admin.checkSession` | 驗證 Admin Session |
| `admin.*` | 管理後台操作（需 Session token） |

## 核心原則

- **有候補序號 = 已完成登記**
- **首次抽選建立完整 random_rank，後續僅追加公布**
- **所有正式寫入走 LockService + request_id 冪等**

## 注意事項

- Google Chart QR API 需網路連線；若不可用可改用 QR 函式庫
- Admin 需設定 `ADMIN_PIN`；登入後 Session 預設 12 小時有效
- QR Code 必須使用正式 Apps Script Web App `/exec` 網址，不應使用 HTMLService iframe 內的 `googleusercontent` URL

## 授權

內部使用。依候補系統功能與技術規格書 v1.0 開發。
