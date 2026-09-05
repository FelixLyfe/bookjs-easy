# BookJS-Easy v2.1.1

## 概述

BookJS-Easy 是一个无需第三方运行时依赖的浏览器自动分页与打印预览工具，可通过浏览器打印生成 PDF。v2.1.1 修复纸张尺寸变更后的重新分页、跨页富文本格式丢失，以及内容更新和取消时的打印就绪状态。

## 主要特性

- **自动分页**: 智能处理内容溢出，自动创建新页面。
- **超高块级元素拆分**: 当块级容器超过单页可用高度时，会优先按子节点拆分分页，减少整块内容被截断的情况。
- **文本分页**: 用 DOM Range 和二分查找按页拆分，保留内联标签、换行、图片和 Unicode 字素，不再逐字创建测量 span、逐行复制整段。
- **盒子分页**: 支持 `text-box`、`block-box`、`mix-box`，跨页保留外壳和 `.nop-fill-box`；嵌套表格继续在原容器内分页。
- **表格跨页优化**:
  - 支持表格行自动分割。
  - 支持跨页合并单元格（Rowspan）的拆分与重建。
  - 支持多个 `tbody`、`rowspan="0"`、错位的 rowspan/colspan，以及超高行的单元格内容续接。
  - 针对 `rowspan` 场景优化高度测量，降低临界高度误判。
  - 支持表头（Thead）自动重复。
  - 支持 `data-split-repeat` 属性让特定单元格在跨页后重复内容。
  - 单元格内的纯换行可以续接；独占一行的单个单元格仅包含内表时，可继续分页并重复内外表头。
- **标题防孤悬**: 自动检测 H1-H6 标题后的内容，避免标题单独留在页尾。
- **页眉页脚系统**: 支持动态页码 (`${PAGE}`, `${TOTAL_PAGE}`) 和自定义 HTML 模板。
- **调试模式**: 内置调试工具栏，支持快速跳转页面和打印预览。
- **背景图片**: 支持页面级背景图片。
- **自动监听**: 等待非空内容、图片和字体；监听内容节点、文本及属性变化，合并重复渲染请求。
- **自定义纸张**: `pageSizeOption` 的尺寸同时用于预览和 PDF 打印。

从 v2.0 升级时注意：`render()`、`forceRender()`、`BookJS.start()` 现在返回 Promise，读取分页结果或调用打印前应 `await`。无法容纳的固定高度元素、图片加载失败等会拒绝 Promise 并触发 `book.abort`，不会再把被裁切的结果标记为成功。

## 快速开始

### 1. 引入脚本

```html
<script src="./bookjs-easy.js"></script>
```

### 2. 定义配置

```javascript
window.bookConfig = {
  start: true, // 加载完成后自动开始渲染
  pageSize: 'ISO_A4', // 页面尺寸：ISO_A4, ISO_A3, ISO_A5, NA_LETTER, NA_LEGAL
  orientation: 'portrait', // 页面方向：portrait (纵向), landscape (横向)
  padding: '31.8mm 25.4mm 31.8mm 25.4mm', // 页边距 (上 右 下 左)
  // pageSizeOption: { width: '100mm', height: '140mm' }, // 优先于 pageSize
  contentBox: '#content-box', // 也可传入 DOM 元素
  observeContent: true, // 自动响应容器内部的 DOM、文本和属性变化
  resourceTimeout: 10000, // 图片/字体等待超时，毫秒
  printDelay: 0, // 完成事件后设置 PDFComplete 的延时，0 有效
  debug: false, // 开启调试模式（输出日志并在页面显示调试工具栏）

  // 简易页码配置
  simplePageNum: {
    enable: true,
    pageBegin: 1, // 起始页码
    pageEnd: -1,  // 结束页码 (-1 为直到最后)
    // 页码模板，支持 HTML
    pendant: '<div class="page-num-simple">第 ${PAGE} 页 / 共 ${TOTAL_PAGE} 页</div>', 
  },
};
```

`simplePageNum` 也支持 `true` / `false`。编号范围采用 **从 1 开始的页号**。范围内的页面会连续编号，与是否存在页眉挂件无关。

### 3. 编写 HTML 内容

内容必须包含在 `id="content-box"` 的容器中。

```html
<div id="content-box" style="display: none;">
  <!-- 块级元素 -->
  <div data-op-type="block">这是一段不会被拆分的块级内容</div>

  <!-- 文本内容（允许跨页拆分） -->
  <p data-op-type="text">这是一段很长的文本，它会自动根据页面剩余空间进行拆分...</p>

  <!-- 强制分页 -->
  <div data-op-type="new-page"></div>

  <!-- 表格 -->
  <div data-op-type="table">
    <table>
      <thead>
        <tr><th>标题1</th><th>标题2</th></tr>
      </thead>
      <tbody>
        <tr><td>内容1</td><td>内容2</td></tr>
        <!-- 支持跨行合并，会自动处理 -->
        <tr><td rowspan="2">跨行内容</td><td>行1</td></tr>
        <tr><td>行2</td></tr>
      </tbody>
    </table>
  </div>
  
  <!-- 背景图片 -->
  <div data-op-type="bg-image" src="background.jpg"></div>

  <!-- 自定义页眉/页脚挂件 -->
  <div data-op-type="pendants">
      <div style="position: absolute; top: 10px; left: 0; width: 100%; text-align: center;">
          这是页眉 - 第 ${PAGE} 页
      </div>
  </div>
</div>
```

## 数据属性说明 (Data Attributes)

| 属性 | 说明 | 备注 |
|---|---|---|
| `data-op-type="block"` | 块级元素 | 作为一个整体，不会被拆分。如果当前页放不下，会移到下一页。 |
| `data-op-type="text"` | 文本元素 | 会根据字符位置精确拆分，跨页显示。 |
| `data-op-type="text-box"` | 文本盒子 | 拆分 `.nop-fill-box` 内的文本，重复外壳；没有填充区时处理自身。默认保留显式换行。 |
| `data-op-type="block-box"` | 块盒子 | 优先保持填充区内的子块完整；单块超高时进一步拆分。 |
| `data-op-type="mix-box"` | 混合盒子 | 同时处理文本、块和嵌套表格，保留跨页外壳。 |
| `data-op-type="table"` | 表格容器 | 包含 `table` 的容器。支持行级拆分。 |
| `data-op-type="new-page"` | 强制分页 | 在此处强制插入新页面。 |
| `data-op-type="pendants"` | 挂件容器 | 内部元素会作为页眉/页脚复制到每一页。 |
| `data-op-type="bg-image"` | 背景图片 | 需配合 `src` 或 `img-src` 属性。 |
| `data-split-repeat="true"` | 表格单元格属性 | 用于 `td`。当该单元格因跨页被拆分时，在下一页的单元格中重复内容。 |
| `data-split-strategy="precise"` | 表格容器属性 | 强制使用精确拆分策略，不尝试将整个行组移到下一页。 |
| `data-pendant-key` / `data-pendant-name` | 挂件标识 | 替换当前页的同名挂件并向后续页面继承。空 `pendants` 容器清除挂件。 |

补充说明:

- 对于超过单页高度的普通块级容器，BookJS 会优先按其子节点逐段分页；如果子节点本身还是复杂内容，会继续按对应类型处理。
- 对于需要尽量整体移动、避免中途拆开的表格行组，可以在相关 `tr` 上添加 `class="no-split"`。
- 背景图片会以完整显示优先的方式铺入页面，避免因铺满页面而裁切。
- 也可使用 `.nop-text-box`、`.nop-block-box`、`.nop-new-page` 三种 class 指定对应的分页类型。
- 不可拆分的图片、固定高度元素或重复外壳必须能放入一页；否则会报告错误。源 DOM 保留，便于修正尺寸后重新渲染。
- 普通挂件的 `${PAGE}` / `${TOTAL_PAGE}` 使用实际页号/页数；简易页码模板使用配置范围内的连续编号/页数。

## API 参考

### `window.bookConfig`
全局配置对象，脚本加载时会自动读取。

### `BookJS.start()`
手动启动渲染，返回 Promise。适用于 `bookConfig.start = false` 的情况；没有实例时会创建实例。

### `BookJS.create(config)`
创建并登记当前实例。每个文档维护一份预览；创建新实例会清理旧实例的监听。显式传入的配置不会被其他全局配置覆盖。

### `window.BookJS.instance`
获取当前运行的 BookJS 实例。

### `book.render(force = false)`
返回 Promise；等待资源后完成分页。`force = true` 可强制重新渲染。源容器不存在或为空时继续等待；此时返回的 Promise 不代表已有分页结果，应使用 `book.after-complete` 或 `window.status` 判断就绪。

### `book.forceRender()`
等价于 `render(true)`，返回 Promise；运行中的重复请求合并为一次后续渲染。调用后立即清除旧的就绪状态，并停止等待已被替换内容的资源。修改纸张尺寸或方向后，会按新尺寸重新测量和分页。

### `book.cleanup()`
停止 DOM 监听、配置轮询，取消待执行的渲染，并移除测量容器。需要恢复时调用 `forceRender()`。

### 渲染事件与打印就绪

原生 `document` 事件顺序为 `book.before-render` → `book.before-complete` → `book.after-complete`。后两个事件触发时 `isRendered` 已为 `true`；`event.detail` 含 `PAGE_BEGIN_INDEX`、`PAGE_END_INDEX`、`TOTAL_PAGE`，表示实际页面范围。在 `book.before-complete` 中调用 `cleanup()` 可取消后续完成事件；取消时 Promise 以 `AbortError` 拒绝。渲染失败触发 `book.abort`，`event.detail.error` 为错误对象，也可使用 `errorCallback(error)`。

成功后经过 `printDelay` 将 `window.status` 设为 `PDFComplete`；失败、内容为空或重新渲染时清除此状态。

开启 `observeContent` 时，DOM 变更通知会立即使 `isRendered` 和 `PDFComplete` 失效，实际重排仍合并执行。内容在资源加载期间更新时，会重新等待最新内容的图片和字体后再发出完成事件。

```javascript
// 确保源内容已经准备好，再等待分页完成。
await BookJS.start();
if (BookJS.instance.isRendered) window.print();

// 替换整个源容器或通过代码变更配置后，显式重新渲染。
await BookJS.instance.forceRender();
```

## 常见问题

### 1. 内容为什么没显示？
请确保配置了 `start: true`，且 `contentBox` 指向的容器内有内容。空容器不会被提前标记为完成；内容稍后插入时会继续渲染。自动监听针对容器内部变化，替换整个容器后请调用 `forceRender()`。

### 2. 样式错乱？
*   **打印样式**: BookJS 会自动注入 `@media print` 样式。请确保你的自定义样式不会覆盖 `.nop-page-item` 的关键属性。
*   **高度计算**: 避免在 `content-box` 内部使用 `fixed` 定位或依赖视口单位 (`vh`, `vw`) 的样式，这可能会影响高度计算。
*   **字体**: 渲染会等待当前内容使用的字体与图片。预览与打印应使用相同的排版样式，避免在 `@media print` 中改变字号、行高或宽度。

### 3. 如何调试？
将 `window.bookConfig.debug` 设置为 `true`。
*   控制台会输出详细的分页日志。
*   页面右上角会出现悬浮工具栏，支持跳转特定页面查看和触发打印。

### 4. 表格跨页问题
如果表格行包含复杂的 `rowspan`，BookJS 会尝试保持行的完整性，并对跨页测量做额外修正以减少误判。如果一行实在太高放不下，它会尝试拆分。你可以使用 `data-split-strategy="precise"` 强制拆分，使用 `data-split-repeat="true"` 让拆分后的单元格重复显示内容（例如序号列），或者在希望尽量整体后移的 `tr` 上添加 `class="no-split"`。

内表的跨页续接目前支持：外层行仅有一个 `rowspan="1"` 的单元格（可以设置 `colspan`），该单元格仅包含一张表格及空白。多列中并排的超高内表、与普通内容混排的超高内表，仍可能因无法拆分而拒绝渲染。

## License

MIT

## 开发与验证

开发测试需要 Node.js 20+，运行脚本本身无第三方依赖。

```sh
npm ci --ignore-scripts
# macOS 默认使用已安装的 Google Chrome；其他环境可安装 Chromium：
npx playwright install chromium
npm run check
npm test
```

可用 `BOOKJS_CHROME` 指定浏览器可执行文件。30 个回归样例使用真实浏览器布局，覆盖文本及格式完整性、盒子、表格、异步资源、纸张重排和失败/取消路径。

目前自动化回归已在 Chrome 中验证。
