# BookJS-Easy v2.0.0

## 概述

BookJS-Easy 是一个基于 Web 的自动分页与 PDF 生成工具。v2.0.0 版本对核心逻辑进行了重写，提供了更清晰的代码结构、更强大的分页算法、更完善的表格跨页处理以及更好的性能。

## 主要特性

- **自动分页**: 智能处理内容溢出，自动创建新页面。
- **智能文本截断**: 基于真实渲染位置的文本分行，精确控制文本跨页。
- **表格跨页优化**:
  - 支持表格行自动分割。
  - 支持跨页合并单元格（Rowspan）的拆分与重建。
  - 支持表头（Thead）自动重复。
  - 支持 `data-split-repeat` 属性让特定单元格在跨页后重复内容。
- **标题防孤悬**: 自动检测 H1-H6 标题后的内容，避免标题单独留在页尾。
- **页眉页脚系统**: 支持动态页码 (`${PAGE}`, `${TOTAL_PAGE}`) 和自定义 HTML 模板。
- **调试模式**: 内置调试工具栏，支持快速跳转页面和打印预览。
- **背景图片**: 支持页面级背景图片。
- **自动监听**: 支持 DOM 变化自动触发渲染，支持延迟配置加载。

## 快速开始

### 1. 引入脚本

```html
<script src="./bookjs-easy-new.js"></script>
```

### 2. 定义配置

```javascript
window.bookConfig = {
  start: true, // 加载完成后自动开始渲染
  pageSize: 'ISO_A4', // 页面尺寸：ISO_A4, ISO_A3, ISO_A5, NA_LETTER, NA_LEGAL
  orientation: 'portrait', // 页面方向：portrait (纵向), landscape (横向)
  padding: '31.8mm 25.4mm 31.8mm 25.4mm', // 页边距 (上 右 下 左)
  debug: false, // 开启调试模式（输出日志并在页面显示调试工具栏）
  
  // 文本自动换行时的避头尾字符
  textNoBreakChars: ['，', '。', '：', '"', '！', '？', '、', '；', '》', '】', '…', '.', ',', '!', ']', '}', '｝'],

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
| `data-op-type="table"` | 表格容器 | 包含 `table` 的容器。支持行级拆分。 |
| `data-op-type="new-page"` | 强制分页 | 在此处强制插入新页面。 |
| `data-op-type="pendants"` | 挂件容器 | 内部元素会作为页眉/页脚复制到每一页。 |
| `data-op-type="bg-image"` | 背景图片 | 需配合 `src` 或 `img-src` 属性。 |
| `data-split-repeat="true"` | 表格单元格属性 | 用于 `td`。当该单元格因跨页被拆分时，在下一页的单元格中重复内容。 |
| `data-split-strategy="precise"` | 表格容器属性 | 强制使用精确拆分策略，不尝试将整个行组移到下一页。 |

## API 参考

### `window.bookConfig`
全局配置对象，脚本加载时会自动读取。

### `BookJS.start()`
手动启动渲染。适用于 `bookConfig.start = false` 的情况。

### `BookJS.create(config)`
创建一个新的 BookJS 实例。

### `window.BookJS.instance`
获取当前运行的 BookJS 实例。

### `book.render(force = false)`
实例方法。`force = true` 可强制重新渲染。

### `book.forceRender()`
强制重新渲染的便捷方法，内部会处理资源清理和重试逻辑。

## 常见问题

### 1. 内容为什么没显示？
请确保你的内容放在 `<div id="content-box">` 中，并且该元素在脚本执行前已存在（或在短时间内动态生成）。BookJS 会自动监听该元素的变化。

### 2. 样式错乱？
*   **打印样式**: BookJS 会自动注入 `@media print` 样式。请确保你的自定义样式不会覆盖 `.nop-page-item` 的关键属性。
*   **高度计算**: 避免在 `content-box` 内部使用 `fixed` 定位或依赖视口单位 (`vh`, `vw`) 的样式，这可能会影响高度计算。
*   **字体**: 推荐使用系统通用字体，避免特殊字体加载延迟导致的高度计算偏差。

### 3. 如何调试？
将 `window.bookConfig.debug` 设置为 `true`。
*   控制台会输出详细的分页日志。
*   页面右上角会出现悬浮工具栏，支持跳转特定页面查看和触发打印。

### 4. 表格跨页问题
如果表格行包含复杂的 `rowspan`，BookJS 会尝试保持行的完整性。如果一行实在太高放不下，它会尝试拆分。你可以使用 `data-split-strategy="precise"` 强制拆分，或者使用 `data-split-repeat="true"` 让拆分后的单元格重复显示内容（例如序号列）。

## License

MIT
