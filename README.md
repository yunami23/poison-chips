# 这片有毒！ / POISON CHIPS

一款适合两个人在**不同手机、不同电脑**上实时联机的小游戏。

## 一分钟上手

- 房主输入昵称，创建房间；把六位房间码或「复制邀请链接」发给好友。
- 两人到齐，房主点击「开始互坑」。
- 桌上摆 20 片薯片。两人各自**秘密选中一片**作为“毒薯片”，点击确认。对方**看不到你选了哪片**。
- 进入轮流拿薯片阶段。你拿到**对方埋的那片**就输掉本局；拿到别的薯片安全，轮到对方。
- 一人赢下一局记 1 星，**三局两胜（先赢两局）**赢下整场。
- 若双方选择了同一片薯片，它对**两个人都有效**，谁先碰到谁输。
- 如果你拿走了自己标记的薯片，而对方选择的是另一片，你不会输；但相当于拆掉自己设给对方的陷阱。
- 比赛结束双方点击「再来一场」，重新开局。

## 特色

- 可实时联机，共享一桌薯片
- 毒药由服务器保存，揭晓前绝不会给对方传递毒药位置
- 点击薯片，再点确认，防止误触
- 手机、平板、电脑自适应
- 邀请链接与房间码
- 断线自动重连，同一个浏览器标签刷新可恢复身份
- 三局两胜，比分和回合即时同步
- 不需要用户账号，不需要数据库和第三方 Node 包

## 发布网站：用 GitHub + Render

**请新建仓库 `poison-chips`，不要覆盖之前的 `edge-club`。**

1. 解压下载的 ZIP，在电脑上打开解压后的项目目录。
2. 在 GitHub 新建一个空的公开仓库（如 `poison-chips`）。
3. 点击新仓库的 `uploading an existing file` 或 Add file → Upload files。
4. 将项目目录里的所有文件和文件夹上传到 GitHub 仓库的根目录，尤其是 **`public` 整个文件夹**。上传完成后，在仓库里确认能看到 `public/index.html`、`public/style.css`、`public/app.js`、`server.js`、`package.json` 和 `render.yaml`。点击 Commit changes。
5. 打开 https://dashboard.render.com/ ，New → Web Service → 连接新的 `poison-chips` 仓库。
6. 配置 Name：`poison-chips`，Language：**Node**，Branch：`main`，Root Directory **留空**，Build Command：`npm install`，Start Command：`npm start`，Compute 选 **Free**。
7. 点击 Deploy Web Service。成功且显示 Live 后，打开页面里显示的 `https://...onrender.com` 网址。

不要使用 GitHub Pages 或 Render Static Site——这个项目需要 WebSocket 服务器。

**注意：** Render Free 可能因空闲进入休眠、重启或清除进程内存，这会使房间失效，重新建房即可。服务器进程内的房间不持久保存。

## 本地运行（可选）

需要 Node.js 20 或更高版本。

```bash
npm install
npm start
```

打开 http://localhost:3000 。两个浏览器或不同标签页可以先本地测试。

自动化测试：

```bash
npm test
```

## 文件结构

- `server.js`：HTTP 与 WebSocket 服务，服务器判定游戏规则与保密下毒
- `public/index.html`：网页布局
- `public/style.css`：界面视觉与手机响应式
- `public/app.js`：创建与加入房间、交互、实时同步与断线恢复
- `public/favicon.svg`：网页小图标
- `test/game.test.js`：自动化联机测试
- `render.yaml`：Render 配置文件
- `package.json`：Node 项目启动及测试设置

