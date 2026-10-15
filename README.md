# PULSELINE

PULSELINE 是一套可独立部署到 BOT Chain 的二元预测市场项目。它不是原 STAKE 网站的镜像，而是重新设计的品牌、页面布局和代码实现。

## 功能

- BOT Chain 主网配置（Chain ID 677）与自动加链/切链。
- 使用原生 BOT 对 YES 或 NO 建仓。
- 每个钱包在同一市场只能选择一个方向，可以在上限内追加。
- 授权 creator 创建市场，授权 resolver 结算结果。
- 获胜者按资金池比例领取；无效市场原额退款。
- 超过 3 天未结算的市场可由任何人标记无效，防止资金永久锁定。
- 首页、市场索引、市场详情、信号榜和控制台均采用全新的响应式布局。

> 当前前端处于 Preview Mode，使用明确标注的示例市场。部署自己的合约并配置地址后才会启用真实交易。

## BOT Chain

| 项目 | 主网 | 测试网 |
|---|---|---|
| Chain ID | `677` | `968` |
| RPC | `https://rpc.botchain.ai` | `https://rpc.bohr.life` |
| Explorer | `https://scan.botchain.ai` | `https://scan.bohr.life` |

## 部署合约

安装 Foundry 后：

```powershell
cd contracts
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts --no-git
forge test -vv
Copy-Item .env.example .env
```

在本机 `.env` 中填写专用部署钱包的 `PRIVATE_KEY`，不要上传或发送私钥。建议先部署测试网：

```powershell
forge script script/Deploy.s.sol --rpc-url bot_testnet --broadcast
```

主网：

```powershell
forge script script/Deploy.s.sol --rpc-url bot_mainnet --broadcast
```

默认手续费为 `200` basis points，即失败一侧资金池的 2%。部署钱包初始拥有 owner、creator 和 resolver 权限。

## 本地前端

```powershell
cd frontend
Copy-Item .env.example .env.local
```

填写：

```dotenv
VITE_PULSELINE_ADDRESS=0x你的PulseMarkets合约地址
```

然后：

```powershell
npm install
npm run dev
```

## Vercel

把代码上传到新的 GitHub 仓库，例如 `pulseline`。在 Vercel 导入时设置：

- Root Directory：`frontend`
- Framework：Vite
- Build Command：`npm run build`
- Output Directory：`dist`
- Environment Variable：`VITE_PULSELINE_ADDRESS`

没有合约地址也能部署和预览页面，但按钮不会发送交易。

## 安全与运营说明

- 主网部署前必须运行测试并进行独立合约审计。
- resolver 对结果拥有重要权限；市场条款和证据源必须公开、明确、可重复验证。
- 预测市场可能受到不同司法辖区的法律或监管限制，公开运营前应获得专业意见。
- 不要复用个人主钱包私钥，建议使用专用部署账户和多签 treasury。

## 许可与来源

本项目采用 MIT 许可。参考来源与独立实现说明见 `NOTICE.md`。
