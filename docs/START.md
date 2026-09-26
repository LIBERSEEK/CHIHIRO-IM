# 千寻 · 启动

打开千寻即可扫码登录 QQ，不必自己先跑 `QQ --no-sandbox`。

```bash
git clone https://github.com/LIBERSEEK/CHIHIRO.git
cd CHIHIRO
git submodule update --init vendor/napcat vendor/astrbot
npm install
npm run setup
npm run dev
```

`npm run setup` 会检测系统、QQ、系统工具、NapCat、前端构建和 AstrBot
Python 环境。项目自有依赖会自动下载、校验并安装；QQ 或系统工具缺失时会给出明确的人工操作提示。

随时可用 `npm run doctor` 只检查、不修改，用 `npm run repair` 重新执行安全修复。

浏览器：http://127.0.0.1:3100/

Chrome / Edge 地址栏右侧可「安装千寻」到桌面（PWA，独立窗口）。Gateway 需在跑。

1. 点左侧 **+**
2. 下拉选择 **QQ**（其它客户端为即将支持）
3. 点「开始登录」——后台拉起 NTQQ
4. 页内扫码
5. 左栏出现账号，中间进入 IM

停服务：运行 `npm run dev` 的终端里 `Ctrl+C`。QQ 进程若仍在，用「退出 QQ」。

## 故障处理

不要手动用 `--no-sandbox` 启动官方 QQ。先运行 `npm run doctor`；若存在可修复项，运行
`npm run repair`。Gateway 已启动时也可以在 Agent 错误页直接点「自动修复」。
