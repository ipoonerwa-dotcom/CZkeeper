// 回购转发金库 keeper —— 独立一套。
// 职责:permissionless 触发 金库.buyback()(每 ~3min 花 spendBps 余额回购本币 → 转给接收钱包)。
// 热钱包只付 gas、无任何权限;漏跑只是延迟,不影响资金安全(金库无提款)。
//
// 运行: node buyback-keeper.mjs            (跑一轮即退 —— 适合 GitHub Actions cron)
//       LOOP=1 node buyback-keeper.mjs      (常驻循环 —— 适合 VPS)
//
// 依赖: npm i ethers   (ethers v6)
// 环境变量:
//   RPC_URL      BSC RPC(默认主网 https://bsc-rpc.publicnode.com)
//   KEEPER_PK    热钱包私钥(只放少量 BNB 付 gas;别用部署/admin 私钥)
//   VAULT        回购转发金库地址(从 Flap vaultPortal.getVault(币) 拿)
//   INTERVAL_MS  LOOP 模式轮询间隔(默认 180000 = 3min)
//   BUYBACK_GAS  buyback 的 gasLimit(默认 800000;Flap 曲线 swap+转账较吃 gas,留足余量)

import { ethers } from "ethers";

const RPC = process.env.RPC_URL || "https://bsc-rpc.publicnode.com";
const PK = process.env.KEEPER_PK;
const VAULT = process.env.VAULT;
const INTERVAL_MS = Number(process.env.INTERVAL_MS || "180000");
const BUYBACK_GAS = BigInt(process.env.BUYBACK_GAS || "800000");

if (!PK || !VAULT) {
  console.error("缺少 KEEPER_PK / VAULT 环境变量");
  process.exit(1);
}

const ABI = [
  "function buybackReady() view returns (bool)",
  "function nextBuybackAt() view returns (uint256)",
  "function buyback() returns (uint256)",
];
// 如实报告:tx 成功不等于真买了 —— 看 Buyback 事件确认。
const EVT = new ethers.Interface(["event Buyback(uint256 bnbIn, uint256 bought)"]);

const provider = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1 });
const wallet = new ethers.Wallet(PK, provider);

function report(rc) {
  let saw = false;
  for (const log of rc.logs) {
    let p;
    try { p = EVT.parseLog(log); } catch { continue; }
    if (p && p.name === "Buyback") {
      saw = true;
      console.log(`  ✅ 回购 ${ethers.formatEther(p.args.bnbIn)} BNB → 买到 ${p.args.bought} 代币 → 已转接收钱包`);
    }
  }
  if (!saw) console.log("  (本笔无 Buyback 事件)");
}

async function waitWithTimeout(tx, ms = 90000) {
  return Promise.race([
    tx.wait(1),
    new Promise((_, rej) => setTimeout(() => rej(new Error("tx wait timeout")), ms)),
  ]);
}

async function runOnce() {
  console.log(`buyback keeper ${wallet.address} @ ${new Date().toISOString()}`);
  const c = new ethers.Contract(VAULT, ABI, wallet);
  try {
    if (!(await c.buybackReady())) {
      const at = await c.nextBuybackAt();
      console.log(`[buyback] 未到点或余额不足,下次 @ ${new Date(Number(at) * 1000).toISOString()},跳过`);
      return;
    }
    // 滑点闸:先静态模拟 buyback;会 revert(内盘行情波动/单笔买量触顶滑点)就本轮跳过,绝不发注定失败的 tx 白烧 gas
    try {
      await c.buyback.staticCall();
    } catch (e) {
      console.log("[buyback] 静态模拟会 revert(多半滑点),本轮跳过省 gas:", e.shortMessage || e.message);
      return;
    }
    // 静态已过 -> gas 右尺寸(估算*1.3,下限 BUYBACK_GAS),再发真 tx
    let gas;
    try {
      gas = ((await c.buyback.estimateGas()) * 13n) / 10n;
    } catch {
      gas = BUYBACK_GAS;
    }
    if (gas < BUYBACK_GAS) gas = BUYBACK_GAS;
    const tx = await c.buyback({ gasLimit: gas });
    const rc = await waitWithTimeout(tx);
    console.log(`[buyback] tx ${rc.hash}`);
    report(rc);
  } catch (e) {
    console.error("[buyback] 失败:", e.shortMessage || e.message);
  }
  console.log("本轮完成");
}

async function main() {
  if (process.env.LOOP === "1") {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await runOnce().catch((e) => console.error("轮次异常:", e.message));
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  } else {
    await runOnce();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
