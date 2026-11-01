# 第三方素材说明

本项目自身的代码与图形（唱片、蝴蝶结、加号链条、警告三角、音量步进三角等）均为原创，按
仓库根目录的 MIT 许可证发布。

## Lucide Icons — `repeat-1` 图标

`client.js` 中「单曲循环」图标的 SVG 路径直接取自 Lucide 的 `repeat-1`：

- 来源：https://lucide.dev/icons/repeat-1
- 文件：https://github.com/lucide-icons/lucide/blob/main/icons/repeat-1.svg
- 许可证：ISC（允许商用、修改、再分发，需保留下列版权与许可声明）

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

改动方式：仅把 Lucide 写在根 `<svg>` 上的描边属性逐个搬到各 `<path>` 上（本项目用程序化方式
构造 SVG，没有根节点级默认值），路径数据未改动。
