# 回购转发金库 keeper

permissionless 触发金库 `buyback()`:每隔 `interval`(默认 3min)用余额的 `spendBps`(默认 60%)回购本币 → 转给固定接收钱包。热钱包只付 gas,无任何权限。

## 环境变量(见 `.env.example`)
- `KEEPER_PK` 热钱包私钥(少量 BNB 付 gas,**别用 admin / 部署钱包**)
- `VAULT` 金库地址(Flap 建币后 `vaultPortal.getVault(币)` 拿)
- `RPC_URL` 可选(默认主网 publicnode)
- `BUYBACK_GAS` 默认 800000

## 跑法

### A) GitHub Actions(推荐,不用自己开机)
1. 仓库设 **Public**(Actions 无限免费;私有库 2000min/月不够每 3min 跑)
2. Settings → Secrets: `KEEPER_PK` ;Variables: `VAULT`(可选 `RPC_URL`)
3. `.github/workflows/buyback-keeper.yml`(已就位,整包拖拽即含)
4. **cron-job.org 每 3 分钟** 打 `workflow_dispatch`(GitHub 自带 schedule 不稳):
   - URL: `https://api.github.com/repos/<owner>/<repo>/actions/workflows/buyback-keeper.yml/dispatches`
   - POST,每 3min
   - Headers:`Authorization: Bearer <PAT(Actions:rw)>`、`Accept: application/vnd.github+json`、`Content-Type: application/json`、`X-GitHub-Api-Version: 2022-11-28`、`User-Agent: cronjob`
   - Body:`{"ref":"main"}`
   - ⚠️ PAT 值别带占位符尖括号 `< >`;PAT 有效期到了要续

### B) VPS 常驻
`.env` 配好 → `LOOP=1 node buyback-keeper.mjs`(每 `INTERVAL_MS` 跑一轮)

## 验证
GitHub Actions 日志:`buyback ✅ 回购 X BNB → 买到 Y 代币 → 已转接收钱包` = 成功;`未到点或余额不足,跳过` = 还没到 3min 或余额太少。
