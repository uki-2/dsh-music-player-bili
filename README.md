# dsh-music-player-bili

悬浮在DSH界面上的音乐播放器。

一个 DSH UI 插件：一枚毛玻璃圆圈，中间黑胶唱片旋转；点开变成控制长条，齿轮打开完整面板（歌单、搜索、进度、音量、播放模式）。

> 非官方项目。与哔哩哔哩（Bilibili）、DeepSeek 均无关联，未经其认可或赞助。

---

## 功能

**播放器**

- 上一首 / 播放暂停 / 下一首，可调播放进度
- 局部音量控制
- 可切换单曲循环/随机播放

**B 站音源**

- 免登录，直接导入公开收藏夹链接即可使用
- 面板内置搜索框：输入歌名直接搜 B 站视频，点结果立即播放（临时顶替歌单，播完自动回到歌单）
- 打开面板、切歌、放完都会自动刷新歌单

## 安装

插件是一个标准的 DSH bundle。

```bash
# 从 GitHub 装
dsh plugin --profile <profile> add github:uki-2/dsh-music-player-bili

# 从本地目录装
dsh plugin --profile <profile> add link:<本仓库的绝对路径>

# 或者你许个愿让大肥鱼帮你装
```

安装后在「设置 → 插件」里可以看到 **`dsh-music-player-bili`**，启用即可出现在界面上。

## 使用

1. 点击圆圈展开，点下方齿轮打开面板
2. 面板里的 **?** 按钮有完整指引：如何在 B 站拿到可用的歌单链接
3. 粘贴链接 → 点「载入」→ 点歌名播放
4. 齿轮两侧的模式圆点：左＝单曲循环，右＝随机播放

## 数据存储

不保存播放历史。

## 隐私与网络

- 只向 `api.bilibili.com`、`passport.bilibili.com`（仅取访客指纹）、B 站音频 CDN 发起请求
- **不采集、不上传任何用户数据**，无遥测、无统计
- 音频仅在内存中缓冲用于播放，**不提供下载或导出功能**

## 免责声明

代码按 [MIT](LICENSE) 授权，可以商用、修改、再分发；但**通过本插件访问到的内容不属于代码**。

- 所有音频、封面、标题、UP 主信息等内容的**著作权归哔哩哔哩及相应权利人**所有，本项目不主张任何权利
- 本项目通过 B 站公开的 Web 接口访问数据，**不绕过任何付费、会员或权限限制**，只能播放正常访问即可获得的内容
- **不得用本插件对 B 站内容做批量抓取、商业分发或二次售卖**，也不得用于任何违反[哔哩哔哩用户协议](https://www.bilibili.com/protocal/licence.html)的用途
- 使用本项目产生的任何后果由使用者自行承担；作者不对内容可用性、接口变更、账号风险作任何担保

若权利人认为本项目存在不当之处，请通过仓库 Issue 联系，将及时处理。

**维护方式**：作者是测试工程师，代码只能在业余时间不定期维护，不保证修哪些问题，也不保证什么时候修。

## 第三方

- 不包含任何第三方插件的代码
- 唱片中心的图标为原创矢量图形，不含任何角色形象或品牌标识
- 品牌规范遵循 [DeepSeek Harness Brand Asset Usage Guidelines](https://github.com/deepseek-ai/deepseek-harness/blob/master/BRAND_GUIDELINES.md)：项目名使用 `DSH` 缩写，未使用 "DeepSeek Harness" 全称作为项目名
- B 站接口细节参考公开社区文档 [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)

## 许可证

[MIT](LICENSE) © 2026 uki-2

商业使用、二次开发、再分发均被允许，**但请保留版权声明与许可证全文**。
