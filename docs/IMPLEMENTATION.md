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
├── docs/IMPLEMENTATION.md  这份实现备注
├── docs/THIRD_PARTY.md     第三方素材署名（Lucide 的 repeat-1 图标）
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
| 底衬玻璃（长条 / 圆圈） | `color-mix(in srgb, var(--dsw-alias-bg-layer-1) 46%, transparent)` + `blur(4px) saturate(150%)` |
| 按钮 / 齿轮 / 模式圆 | 同一支 `color-mix(in srgb, currentColor 18%, transparent)`，悬停 26%，**不带 backdrop-filter**：对圆角矩形采样会在圆角外漏出一圈方弧，看起来就是「圆框套方底」。边框由按钮自己的 `box-shadow: inset 0 0 0 1px var(--dshmp-ring)` 画，三族按钮完全同构，不再有外挂 SVG 框 |
| 圆角 | 一律固定 px、与方框无关：播放 15px、上一首/下一首 10px、齿轮 13px、模式圆 11px。百分比半径会随盒子宽高变形，踩过「圆变方弧」的坑 |
| 设置面板 | `color-mix(in srgb, var(--dsw-alias-bg-overlay) 58%, transparent)` + `blur(26px) saturate(185%)`；前景统一 `--dsw-alias-label-primary`，图标 `color:inherit` 并完全不透明 |
| 图标 | 长条 / 圆圈里的图标用 `color:inherit`（跟随表层的前景 token）；唱片中心那块白色标签与黑色蝴蝶结是图形本身，不参与主题 |
| 面板控件描边 / 轨道 | 由 `--dshmp-ring`（= `color-mix(in srgb, currentColor 24%, transparent)`）派生，随主题翻转，不再写死白或灰 |
| 音量条 | 已音量段 = `var(--dsw-alias-label-primary)` 实心，未达上限段 = `--dshmp-mix-16` 的凹槽；两者色相不同，而不是同一色的透明度差 |
| 面板控件底色 | 统一使用 `--dshmp-mix-4/8/12/16/22/28` 一组 `currentColor` 比例——Material Design 3 的 state layer 做法：叠加色取自内容色，所以白底黑底都成立 |
| 模式圆点 | 按钮热区 38px、图标 22px；外框就是按钮自己的 inset 描边，不再另画光环 |
| 齿轮 / 播放键 / 上一首 / 下一首 | 44px / 51px / 34px / 34px |
| 控制条 | 195px 宽（`2×34 + 51 + 2×17 + 2×21`），高 76px |

齿轮与两个模式圆点曾经各有一套外挂 SVG 边框（各自算尺寸、带自己的投影），所以填充和外框永远差一点。现在三族按钮是同一份配方：同样的填充、同样的 inset 描边、同样没有模糊——外挂 SVG 框已删除，测试会拦住它回来。

## 字号

面板里的字只有三档，全部由 DSH 的正文字号派生（`--dsh-content-font-size`，由主题写在 `<body>` 上，会继承进悬浮层）：

| 档位 | 计算 | 归入的元素 |
|---|---|---|
| 大标题 | `var(--dshmp-h)` | 面板标题、分区标签 |
| 文本 | `calc(var(--dshmp-h) - 3px)` | 输入框、按钮、歌单行、时长、音量数字 |
| 提示 | `calc(var(--dshmp-h) - 4px)` | 状态气泡、歌单概要、指引正文与示例、页脚版本 |

`--dshmp-h` 定义在 `.dshmp-panel` 上；这两条绑定写在 CSS 最末尾，用来压过各元素原先的固定 `font-size`（那些继续作为取值兜底）。

## 悬浮体的形态与拖动

- 收起态是直径 `D` 的圆（`D = clamp(视口宽 × 0.078, 58, 76)`），黑胶直径 `D × 0.797`，给外圈留一条半透明边
- 展开态宽 `3 × D`、高度不变，黑胶整体向上淡出并缩小到 84%
- 拖动用 pointer 事件；位置钳制在 `MARGIN = 14px` 内，松手时写入 `data/settings.json` 的 `position`
- 顶部另有一条安全带：`TOP_INSET = TITLE_BAR(40) + TOP_GAP(76) = 116px`。窗口缩小或页面放大时，钳制在每次渲染都会重算，所以它既不会钻进顶栏挡住窗口按钮，也不会被挤出可视区。改这两个常量即可整体平移这条带子
- 位移超过 4px 才算拖动，并抑制随后的 click，避免"拖完顺手把面板打开了"

## 动画

- `--dshmp-beat: .5s`（120 BPM 的 1/4 拍），在 `.dshmp-root` 上定义，改一处全部按比例变化
- 单曲循环：只有图标脉动 `1×beat`。涟漪试过（围绕中心扩散，和"双弧 + 数字"的图形不搭），行进光也试过（沿轨道跑虚线），最后都删了——这个图标只需要呼吸
- 随机播放：流光 `2×beat`（遮罩里两条暗带，因此每拍经过一次）+ 图标脉动
- 流光是对图标施加 `linear-gradient` 遮罩并移动 `mask-position`（方向：`100% → 0%` 才是左→右）
- `prefers-reduced-motion` 下全部停用

## 播放链路

1. 点歌 → `GET /stream?bvid=` 整轨下载成 Blob → `URL.createObjectURL` → `<audio>`
2. **为什么要整轨缓冲**：B 站的 m4s 是分片 MP4，Chromium 对着"边下边播的 Range 流"做时间跳转时会拒绝并从头重取；换成完整 Blob 后 `seekable` 覆盖全曲，跳转变成内存读
3. 超过 20 分钟的长视频退回流式播放（内存与等待成本太高）
4. seek 后有 900ms 静默窗，忽略携带旧位置的 `timeupdate`，避免进度条回弹
5. B 站 `duration` 偶发为 `Infinity`，此时用歌单里的时长兜底，并把目标钳进 `audio.seekable`

## 歌单刷新

打开面板 / 切歌 / 播完各触发一次；只拉第 1 页，按 bvid 去重后**插到已加载列表前面**，保留"加载更多"的后续页；3 秒节流，失败静默不打断播放。

## 多链接歌单

面板里的歌单不是一个输入框，而是"若干已导入的行 + 尾部一个空行"：

- 已导入的行存在 `plists: [{ id, link }]`，`id` 单调递增、不复用，所以删行不会让别的行的 React key 变化
- 尾部空行**不落盘**，永远恰好一个；向它提交才生成新行，因此"创建多少行之后都还有地方输入"
- 新增的行**不会自己接管播放**：它会以"点击播放"加入，用户点那一行的按钮才切过去；只有当前没有任何行处于链接中时（空列表、或手改过的设置文件）才自动连接
- 编辑已导入的行到空值 → 该行被删除；删除"已链接"的行 → 第一条幸存行自动接管链接
- 任意时刻**恰好一行**处于"链接中"（`activeId`），点其它行的链条按钮即切换

切换时的三件事必须同步发生，否则图标与实际效果会脱节：

1. `clearPlaylistCache()`：清空曲目、标题、页码、进度，并 `pause()`，旧的歌单立刻静默
2. `activeId` 与文件里的 `activeId` 一起更新，图标随之切换成闭合链条
3. 重新拉第 1 页；`rowSeqRef` 自增，**过期的响应按序号丢弃**，所以快速连点几行时只有最后点的那行会落地

`rowSeqRef` 和音频加载用的 `loadSeqRef` 是两个独立序号：切歌单不该让正在加载的曲目作废，反之亦然。

每行的状态由三个布尔量决定，顺序不能颠倒：

| 状态 | 条件 | 外观 |
|---|---|---|
| 格式错误 | 链接不是 `https://www.bilibili.com/medialist/detail/ml…` | 红色三角 + 红色按钮「格式错误」，整行禁用、不参与播放 |
| 空 | 是当前行，且刚加载回来的列表是 0 条 | 黄色三角 + 黄色按钮「空」，禁用 |
| 链接中 | 是当前行 | 闭合链条 + 「播放中」 |
| 未链接 | 其余 | 断开链条 + 「点击播放」 |

「空」的判定发生在**切换过去、拿到响应那一刻**（不只是按播放时），因为切走再切回不该让用户再按一次播放才看到结论；按播放时仍会补一条黄色气泡「歌单为空」。

重复导入走的是另一条路：提交时先按 `link.trim()` 查重，命中就不新增行、不切歌，把已有那行的 `dupId` 记下来闪黄框 3 秒（`.dshmp-field-dup`，`transition: box-shadow .6s` 负责淡出），并弹黄色气泡「已有重复歌单」。黄色是"警告"，红色只留给"错误"。

## 设置存储

`data/settings.json` 存这些：`plists`（行列表）、`activeId`（链接中的行）、`link`（活动行的镜像，兼容旧版本）、播放模式、音量、悬浮位置。

用文件而不是 `localStorage`，是因为 GUI 的端口每次启动可能不同（`127.0.0.1:61134` 这类临时端口），而 `localStorage` 按 origin 隔离——换个端口就是另一套存储，设置会"全部重置"。文件路径由插件的 `import.meta.url` 推出，和端口无关。

写入走 `POST /api/settings`，客户端做了 350ms 防抖；宿主对 `plists` 做白名单与上限校验（每行最长 2000 字符，最多 50 行，id 去重）。`localStorage` 只作为读不到宿主时的兜底镜像。不保存播放历史，也不保存任何登录凭证。

## 版本号

版本号跟着**改动轮次**走：`0.1.103` 就是第 103 次改动。前两位 `0.1` 不动，第三位每轮加一 —— 这样一眼就能看出这份代码被迭代了多少次，而不用去翻提交记录。


`package.json` 的 `version` 是唯一来源：宿主每次请求实时读取 → 面板底部显示 `v0.1.103`。改版本号只需改这一处 + 刷新页面，不必重装（只有「设置 → 插件」里显示的版本来自安装时的 lockfile，发版时重装一次即可对齐）。

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
