# 候補系統規格摘要

完整規格見：`Waitlist_System_Specification_v1.0.pdf`

## 系統目標

- 實體賽事候補登記與抽選
- 降低 QR 外流遠端登記風險
- 支援多工作人員同時核驗
- 候補序號唯一、可追加公布抽選結果

## 三個介面

1. **Display** — 現場 QR / 狀態 / 抽選結果
2. **Candidate** — 選手填寫、確認、櫃檯 PIN 核驗
3. **Admin** — 五 Tab：候補管理、抽選管理、顯示設定、系統設定、資料管理

## 兩種登記模式

| | 一般模式 | 櫃檯核驗模式 |
| --- | --- | --- |
| QR Rotation | 預設 ON | 預設 OFF |
| Staff PIN | 不使用 | PIN 驗證後才上傳 |
| 資料上傳時機 | 確認後立即 | PIN 成功後一次上傳 |

## 資料表

| Sheet | 用途 |
| --- | --- |
| Settings | 活動與系統參數 |
| Waitlist | 正式候補資料 |
| LotteryResult | 完整 random_rank |
| PublishBatches | 公布批次 |
| LotteryAudit | 抽選稽核（隱藏） |
| AuditLog | 管理操作紀錄 |

## 驗收重點

- 5 並行發號序號唯一
- request_id 重送不重複發號
- 櫃檯模式 PIN 前 Server 無姓名/電話
- 500 人一次 shuffle，追加批次不重新抽
