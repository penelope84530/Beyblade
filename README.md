# Beyblade Inventory Lab

一個可部署到 GitHub Pages 的戰鬥陀螺收藏網站。

## 功能

- 輸入編號或名稱新增收藏，例如 `UX01`、`魔導至尊`
- 自動拆解部件（Blade / Ratchet / Bit）
- 顯示分類統計（BX / UX / CX）
- 記錄功能（localStorage）
- `settings.json` 匯入 / 匯出
- 依風格（攻擊、防禦、持久、平衡）推薦可組裝配對
- 推薦結果顯示正式別稱
- 顯示圖片（Blade 主圖 + 各部件圖）
- 五角量表與強度分數

## 資料來源

爬蟲來源：

- https://go-shoot.github.io/x/products/?blade.CX.main=Ar
- 以及同站 `x/db` JSON（prod-beys、part-blade、part-ratchet、part-bit 等）

## 開發

```bash
npm install
npm run dev
```

## 重新爬取圖鑑

```bash
npm run scrape
```

輸出檔案：

- `public/data/catalog.json`

## 正式建置

```bash
npm run build
```

## GitHub Pages 部署

本專案已內建 workflow：

- `.github/workflows/deploy-pages.yml`

使用方式：

1. 將專案推到 GitHub，預設分支為 `main`
2. 進入 repo 的 **Settings > Pages**
3. Build and deployment 選擇 **GitHub Actions**
4. push 到 `main` 後會自動部署
