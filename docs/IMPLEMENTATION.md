# 实现备注

给维护者看的。README 只说用户能感知的东西，具体参数与取舍都在这里。

## 宿主与客户端

`package.json` 里两处声明让 DSH 认出这是一个插件：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },   // 插入 music-player 这一行
  "client": { "platform": "web", "immediately": true,
              "inject": ["@deepseek-ai/dsh-client-ui-layout"] }
}
```

- `platform: "web"` 指渲染层是 Web —— 桌面版的窗口也是加载本地 HTTP 页面的 Electron WebContents，所以桌面版与浏览器版共用同一个客户端半层，不需要单独适配。
- `immediately: true` 让客户端模块在启动时就加载，不等用户打开某个面板。
- 客户端注册在 `shell.overlay`（`order: 20`）这个框架级悬浮层：它盖在所有列之上、又不在任何列的滚动容器里，所以拖到哪儿都不会被裁。

## 目录结构

```
dsh-plugin/                 ← 仓库根 = 插件包根（一个目录，两种身份）
├── index.js                宿主半层：路由、设置持久化、B 站客户端实例
├── bili.js                 纯 Node 的 B 站客户端（不依赖 cordis，可单独测试）
├── client.js               客户端半层：整个悬浮播放器（无构建步骤，手写 h()）
├── cordis.patch.yml        bundle patch：插入一行 music-player
├── icon.svg                插件图标
├── locale/{zh,en}.json     插件管理器里显示的名称与描述
├── data/settings.json      运行时状态（已 .gitignore，不进仓库）
├── .github/workflows/ci.yml
└── dev/
    ├── smoke-test.cjs      离线渲染测试（假 React + vm，无浏览器）
    ├── bili-module-test.mjs 打真实 B 站接口的模块测试
    └── render-social-preview.py
```

## 宿主路由

全部挂在 `/dsh-music` 下，JSON 一律 `{ok:true,...}` / `{ok:false,error}`：

| 路由 | 说明 |
|---|---|
| `GET /api/settings` | 返回 `{version, settings}`；version 每次请求实时读 `package.json` |
| `POST /api/settings` | 白名单字段合并写入（link / mode / volume / position） |
| `GET /api/playlist?link=&page=` | 收藏夹列表；`ps` 必须 ≤ 20，超过会被 B 站判 `请求错误` |
| `GET /api/search?q=` | WBI 签名的视频搜索 |
| `GET /api/track?bvid=` | 取 cid / 标题 / 时长（缓存 1 小时） |
| `GET /stream?bvid=` | 音频代理，`Range` 透传；403 时重新签名一次 |

B 站接口要点：需要 `buvid3` 访客指纹（否则 `x/web-interface/view` 返回 412），搜索与 `playurl` 需要 WBI 签名（mixin key 表 + `w_rid=md5(query+mixin)`）。音频直链缓存 25 分钟。

## 材质与尺寸

| 元素 | 参数 |
|---|---|
| 底衬玻璃 | 底色 3.3%，白色渐变 2.4%→0.3%，`blur(4px) saturate(150%)` |
| 按钮 / 齿轮 / 模式圆 | `rgba(150,158,172,.55)` + `blur(9px) saturate(150%)`，悬停 `.66` |
| 设置面板 | 底色 60%，`blur(26px) saturate(185%)`（内部有正文，故意保留高模糊） |
| 图标 | 象牙白 `#fefaf2`，80% 不透明度 |
| 模式圆点 | 按钮热区 38px、图标 22px；选中时外圈光环**另画在 44px 的画布上**，向四周溢出 3px（放进按钮里会被裁掉，这是踩过的坑） |
| 齿轮 / 播放键 / 上一首 / 下一首 | 44px / 51px / 34px / 34px |
| 控制条 | 195px 宽（`2×34 + 51 + 2×17 + 2×21`），高 76px |

两个小圆的**底色、边框、流动光都在 SVG 上**，没有一处是 CSS 盒子画的——`border-radius` 或 `<button>` 的裁剪曾导致多处"圆角方块"问题。

## 悬浮体的形态与拖动

- 收起态是直径 `D` 的圆（`D = clamp(视口宽 × 0.078, 58, 76)`），黑胶直径 `D × 0.797`，给外圈留一条半透明边
- 展开态宽 `3 × D`、高度不变，黑胶整体向上淡出并缩小到 84%
- 拖动用 pointer 事件；位置钳制在 `MARGIN = 14px` 内，松手时写入 `data/settings.json` 的 `position`
- 位移超过 4px 才算拖动，并抑制随后的 click，避免"拖完顺手把面板打开了"

## 动画

- `--dshmp-beat: .5s`（120 BPM 的 1/4 拍），在 `.dshmp-root` 上定义，改一处全部按比例变化
- 单曲循环：涟漪 `2×beat` + 图标脉动 `1×beat`
- 随机播放：流光 `2×beat`（遮罩里两条暗带，因此每拍经过一次）+ 图标脉动
- 涟漪是 SVG 圆 `transform: scale` + 透明度；流光是对图标施加 `linear-gradient` 遮罩并移动 `mask-position`（方向：`100% → 0%` 才是左→右）
- `prefers-reduced-motion` 下全部停用

## 播放链路

1. 点歌 → `GET /stream?bvid=` 整轨下载成 Blob → `URL.createObjectURL` → `<audio>`
2. **为什么要整轨缓冲**：B 站的 m4s 是分片 MP4，Chromium 对着"边下边播的 Range 流"做时间跳转时会拒绝并从头重取；换成完整 Blob 后 `seekable` 覆盖全曲，跳转变成内存读
3. 超过 20 分钟的长视频退回流式播放（内存与等待成本太高）
4. seek 后有 900ms 静默窗，忽略携带旧位置的 `timeupdate`，避免进度条回弹
5. B 站 `duration` 偶发为 `Infinity`，此时用歌单里的时长兜底，并把目标钳进 `audio.seekable`

## 歌单刷新

打开面板 / 切歌 / 播完各触发一次；只拉第 1 页，按 bvid 去重后**插到已加载列表前面**，保留"加载更多"的后续页；3 秒节流，失败静默不打断播放。

## 设置存储

`data/settings.json` 存四样东西：歌单链接、播放模式、音量、悬浮位置。

用文件而不是 `localStorage`，是因为 GUI 的端口每次启动可能不同（`127.0.0.1:61134` 这类临时端口），而 `localStorage` 按 origin 隔离——换个端口就是另一套存储，设置会"全部重置"。文件路径由插件的 `import.meta.url` 推出，和端口无关。

写入走 `POST /api/settings`，客户端做了 350ms 防抖；`localStorage` 只作为读不到宿主时的兜底镜像。不保存播放历史，也不保存任何登录凭证。

## 版本号

`package.json` 的 `version` 是唯一来源：宿主每次请求实时读取 → 面板底部显示 `v0.1.62`。改版本号只需改这一处 + 刷新页面，不必重装（只有「设置 → 插件」里显示的版本来自安装时的 lockfile，发版时重装一次即可对齐）。

## 已知取舍

- 不含登录：只用公开接口，拿不到私有歌单与高码率档位
- 不提供下载/导出
- 版权材料一律没有进仓库（早期曾用过官方 favicon 里的鲸鱼标识，现已换成原始矢量图标）

## 专利备忘

现在的播放链路只用标准 Web 能力（HTTP `Range`、`Blob` + `createObjectURL`、`seekable`/`buffered`、指针事件拖动），没有自创机制，因此**不存在可被指认的发明点**——这几样都早于任何可能的申请日，属现有技术。

真正要记的是：**以后加功能时，下面这几类做法有专利在附近**。

| 专利 | 它覆盖什么 | 我们现在的区别 | 加了什么会靠近它 |
|---|---|---|---|
| [CN106713986A](https://patents.google.com/patent/CN106713986A/zh) | 用**字幕时间轴**决定跳转目标 | 不用字幕 | 按歌词/字幕跳转 |
| [CN105828096B](https://patents.google.com/patent/CN105828096B/zh) | **服务端**按媒体段取子段 | 客户端整文件缓冲 | 改服务端分段、细化边下边播的分片管理 |
| [US9363579B2](https://patents.google.com/patent/US9363579B2/en) | 拖动进度条时显示**缩略图预览** | 只显示进度 | 进度条悬停/拖动出缩略图 |
| [CN103811038A](https://patentimages.storage.googleapis.com/29/86/22/560a1c209a9749/CN103811038A.pdf) | 缓存文件加入播放器**缓存列表** | 无缓存列表 | 多曲预缓存队列、离线缓存管理 |

还有一条：WBI 签名是 B 站自家协议，专利归他们，我们只是按其公开行为实现——真要出事是条款问题，不是专利问题。

> 这是当初基于公开检索的初筛结论，不是法律意见。真要做正式的自由实施分析（FTO），得用 CNIPA / USPTO 全文本库逐件核对权利要求。
