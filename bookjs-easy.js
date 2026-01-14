/*!
 * BookJS-Easy - WEB Print Auto Pagination / Preview / Make PDF
 * Version: 1.0.0
 * Author: Felix Lyu
 * License: MIT
 */

(function (global, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else {
        global.BookJS = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
    'use strict';

    // 默认配置
    const DEFAULT_CONFIG = {
        start: false,
        pageSize: 'ISO_A4',
        orientation: 'portrait',
        padding: '31.8mm 25.4mm 31.8mm 25.4mm',
        textNoBreakChars: ['，', '。', '：', '"', '！', '？', '、', '；', '》', '】', '…', '.', ',', '!', ']', '}', '｝'],
        simplePageNum: {
            enable: true,
            pageBegin: 1,
            pageEnd: -1,
            pendant: `<div class="page-num-simple"><span style="">\${PAGE} / \${TOTAL_PAGE}</span></div>`,
        },
        debug: false
    };

    // 纸张尺寸定义
    const PAGE_SIZES = {
        'ISO_A4': { width: '210mm', height: '297mm' },
        'ISO_A3': { width: '297mm', height: '420mm' },
        'ISO_A5': { width: '148mm', height: '210mm' },
        'NA_LETTER': { width: '8.5in', height: '11in' },
        'NA_LEGAL': { width: '8.5in', height: '14in' }
    };

    // 工具函数
    const Utils = {
        // 合并配置
        mergeConfig(target, source) {
            const result = Object.assign({}, target);
            for (const key in source) {
                if (source.hasOwnProperty(key)) {
                    if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
                        result[key] = this.mergeConfig(target[key] || {}, source[key]);
                    } else {
                        result[key] = source[key];
                    }
                }
            }
            return result;
        },

        // 生成唯一ID
        generateId() {
            return 'nop-' + Math.random().toString(36).substr(2, 9);
        },

        // 转换尺寸单位为像素
        convertToPixels(value) {
            if (typeof value === 'number') return value;
            if (typeof value !== 'string') return 0;

            const match = value.match(/^([\d.]+)(px|mm|cm|in|pt)$/);
            if (!match) return 0;

            const num = parseFloat(match[1]);
            const unit = match[2];

            switch (unit) {
                case 'px': return num;
                case 'mm': return num * 3.7795275591;
                case 'cm': return num * 37.795275591;
                case 'in': return num * 96;
                case 'pt': return num * 1.3333333333;
                default: return num;
            }
        },

        // 解析padding值
        parsePadding(padding) {
            const values = padding.split(' ').map(v => this.convertToPixels(v));
            if (values.length === 1) return { top: values[0], right: values[0], bottom: values[0], left: values[0] };
            if (values.length === 2) return { top: values[0], right: values[1], bottom: values[0], left: values[1] };
            if (values.length === 3) return { top: values[0], right: values[1], bottom: values[2], left: values[1] };
            if (values.length === 4) return { top: values[0], right: values[1], bottom: values[2], left: values[3] };
            return { top: 0, right: 0, bottom: 0, left: 0 };
        }
    };

    // 页面管理器
    class PageManager {
        constructor(config) {
            this.config = config;
            this.pages = [];
            this.currentPage = null;
            this.pageHeight = 0;
            this.pageWidth = 0;
            this.padding = Utils.parsePadding(config.padding);
            this.init();
        }

        init() {
            this.calculatePageSize();
            this.createBookContainer();
        }

        calculatePageSize() {
            const pageSize = PAGE_SIZES[this.config.pageSize] || PAGE_SIZES['ISO_A4'];
            let width = pageSize.width;
            let height = pageSize.height;

            if (this.config.orientation === 'landscape') {
                [width, height] = [height, width];
            }

            // 通过一次性基准测量动态确定页面尺寸，避免使用魔数偏移
            const tester = document.createElement('div');
            tester.style.cssText = `
                position: absolute;
                visibility: hidden;
                left: -9999px;
                top: -9999px;
                width: ${width};
                height: ${height};
            `;
            document.body.appendChild(tester);
            const rect = tester.getBoundingClientRect();
            document.body.removeChild(tester);

            this.pageWidth = rect.width;
            this.pageHeight = rect.height;
        }

        createBookContainer() {
            // 移除现有的book容器
            const existingBook = document.querySelector('.nop-book');
            if (existingBook) {
                existingBook.remove();
            }

            // 添加基础样式
            this.addBaseStyles();

            // 创建新的book容器
            const bookContainer = document.createElement('div');
            bookContainer.className = `nop-book nop-book-preview`;

            // 添加页面尺寸样式
            const pageSize = PAGE_SIZES[this.config.pageSize] || PAGE_SIZES['ISO_A4'];
            const orientation = this.config.orientation === 'landscape' ? 'landscape' : 'portrait';

            bookContainer.style.cssText = `
                position: relative;
                margin: 0 auto;
                background: #f0f0f0;
                padding: 20px;
                font-family: inherit;
                color: rgb(49, 47, 48);
                word-break: break-all;
                --page-width: ${this.pageWidth}px;
                --page-height: ${this.pageHeight}px;
                --page-size: ${pageSize.name || 'ISO_A4'};
                --page-orientation: ${orientation};
            `;

            document.body.appendChild(bookContainer);
            this.bookContainer = bookContainer;
        }

        createNewPage() {
            const page = document.createElement('div');
            // 修改页码从0开始
            page.className = `nop-page-item nop-page-item-pagenum-${this.pages.length}`;
            page.style.cssText = `
                width: ${this.pageWidth}px;
                height: ${this.pageHeight}px;
                margin: 0 auto 10px;
                background: white;
                position: relative;
                box-shadow: 0 0 10px rgba(0,0,0,0.1);
                page-break-after: always;
                overflow: hidden;
            `;

            // 添加奇偶页class (基于0开始的页码)
            if (this.pages.length % 2 === 0) {
                page.classList.add('nop-page-item-odd');
            } else {
                page.classList.add('nop-page-item-even');
            }

            // 创建页面内容容器
            const pageContent = document.createElement('div');
            pageContent.className = 'nop-page-content';
            pageContent.style.cssText = `
                position: absolute;
                top: ${this.padding.top}px;
                left: ${this.padding.left}px;
                right: ${this.padding.right}px;
                bottom: ${this.padding.bottom}px;
                width: ${this.pageWidth - this.padding.left - this.padding.right}px;
                height: ${this.pageHeight - this.padding.top - this.padding.bottom}px;
                overflow: hidden;
            `;

            page.appendChild(pageContent);

            this.bookContainer.appendChild(page);

            const pageObj = {
                element: page,
                content: pageContent,
                currentHeight: 0,
                pendants: []
            };

            // 复制上一页的pendants到新页面（除非上一页已清除pendants）
            if (this.currentPage && this.currentPage.pendants.length > 0 && !this.currentPage.pendantsCleared) {
                if (this.config && this.config.debug) console.log('BookJS: Copying pendants from page', this.pages.indexOf(this.currentPage), 'to new page');
                this.currentPage.pendants.forEach(pendantInfo => {
                    const pendant = pendantInfo.element.cloneNode(true);
                    pendant.className += ' nop-page-pendants';

                    // 添加pendant唯一标识
                    if (pendantInfo.pendantId) {
                        pendant.className += ' ' + pendantInfo.pendantId;
                    }

                    // 检查计算样式而不是内联样式，避免覆盖CSS类样式
                    const computedStyle = window.getComputedStyle(pendantInfo.originalElement);
                    if (computedStyle.position === 'static' || computedStyle.position === '') {
                        pendant.style.position = 'absolute';
                    }

                    // 替换页码占位符
                    const pageNum = this.pages.length + 1; // 页码从1开始显示
                    const totalPages = this.pages.length; // 临时值，会在后续更新
                    pendant.innerHTML = pendant.innerHTML
                        .replace(/\$\{PAGE\}/g, pageNum)
                        .replace(/\$\{TOTAL_PAGE\}/g, totalPages);

                    page.appendChild(pendant);

                    // 将pendant信息存储到新页面
                    pageObj.pendants.push({
                        element: pendantInfo.originalElement.cloneNode(true),
                        originalElement: pendantInfo.originalElement,
                        pendantId: pendantInfo.pendantId
                    });
                });
            } else if (this.currentPage && this.currentPage.pendantsCleared) {
                if (this.config && this.config.debug) console.log('BookJS: Skipping pendant copy due to pendantsCleared flag on page', this.pages.indexOf(this.currentPage));
            }

            this.pages.push(pageObj);
            this.currentPage = pageObj;

            return pageObj;
        }

        getCurrentPage() {
            if (!this.currentPage) {
                this.createNewPage();
            }
            return this.currentPage;
        }

        getAvailableHeight() {
            const page = this.getCurrentPage();
            return this.pageHeight - this.padding.top - this.padding.bottom - page.currentHeight;
        }

        addContent(element, height, recursionDepth = 0) {
            // 防止无限递归
            const MAX_RECURSION_DEPTH = 10;
            if (recursionDepth > MAX_RECURSION_DEPTH) {
                console.error('BookJS: Maximum recursion depth exceeded in addContent, forcing add to current page');
                const page = this.getCurrentPage();
                page.content.appendChild(element);
                page.currentHeight += height;
                return page;
            }

            const page = this.getCurrentPage();
            const availableHeight = this.getAvailableHeight();

            // 如果内容高度超过可用高度，创建新页面
            if (height > availableHeight && availableHeight > 0) {
                // 检查内容是否超过单页最大高度
                const maxPageContentHeight = this.pageHeight - this.padding.top - this.padding.bottom;
                if (height > maxPageContentHeight) {
                    console.warn('Content height exceeds single page height, forcing add to current page');
                    page.content.appendChild(element);
                    page.currentHeight += height;
                    return page;
                }

                this.createNewPage();
                return this.addContent(element, height, recursionDepth + 1);
            }

            // 如果内容高度超过整个页面高度，强制添加（避免无限循环）
            if (height > this.pageHeight - this.padding.top - this.padding.bottom) {
                console.warn('Content height exceeds page height, forcing add to current page');
            }

            page.content.appendChild(element);
            page.currentHeight += height;
            return page;
        }

        addPendant(element) {
            // 只添加到当前页面，而不是所有页面
            const currentPage = this.getCurrentPage();

            // 生成pendant的特征指纹，用于识别同类pendant并进行去重替换
            // 策略：tagName + sorted classList (过滤掉nop-前缀和pendant-id-)
            const getPendantSignature = (el) => {
                const tagName = el.tagName.toLowerCase();
                const classList = Array.from(el.classList)
                    .filter(c => !c.startsWith('nop-') && !c.startsWith('pendant-id-'))
                    .sort();
                return `${tagName}|${classList.join('.')}`;
            };

            const newSignature = getPendantSignature(element);
            
            // 检查当前页面是否已存在具有相同特征的pendant
            // 优先检查 data-pendant-key (兼容手动指定)，如果没有则回退到自动特征匹配
            const pendantKey = element.getAttribute('data-pendant-key');
            
            const existingIndex = currentPage.pendants.findIndex(p => {
                // 1. 如果有显式 key，优先匹配 key
                const pKey = p.element.getAttribute('data-pendant-key');
                if (pendantKey && pKey) {
                    return pendantKey === pKey;
                }
                
                // 2. 如果没有显式 key，尝试特征匹配
                // 只有当新旧元素都没有显式 key 时才进行特征匹配，避免误杀
                if (!pendantKey && !pKey) {
                    const pSignature = getPendantSignature(p.originalElement);
                    return newSignature === pSignature && newSignature !== 'div|'; // 忽略没有任何类名的空div
                }
                
                return false;
            });
            
            if (existingIndex !== -1) {
                const existing = currentPage.pendants[existingIndex];
                if (this.config && this.config.debug) console.log('BookJS: Replacing pendant with signature', newSignature);
                
                // 移除页面上实际的 DOM 节点
                if (existing.pendantId) {
                    const existingDom = currentPage.element.querySelector('.' + existing.pendantId);
                    if (existingDom) {
                        existingDom.remove();
                    }
                }
                
                currentPage.pendants.splice(existingIndex, 1);
            }

            const pendant = element.cloneNode(true);
            pendant.className += ' nop-page-pendants';

            // 为pendant添加唯一标识
            const pendantId = 'pendant-id-' + Date.now() + Math.random().toString(36).substr(2, 9);
            pendant.className += ' ' + pendantId;

            // 检查计算样式而不是内联样式，避免覆盖CSS类样式
            const computedStyle = window.getComputedStyle(element);
            if (computedStyle.position === 'static' || computedStyle.position === '') {
                pendant.style.position = 'absolute';
            }

            // 替换页码占位符
            const pageNum = this.pages.indexOf(currentPage) + 1; // 页码从1开始显示
            const totalPages = this.pages.length;
            pendant.innerHTML = pendant.innerHTML
                .replace(/\$\{PAGE\}/g, pageNum)
                .replace(/\$\{TOTAL_PAGE\}/g, totalPages);

            currentPage.element.appendChild(pendant);

            // 将pendant信息存储到当前页面，用于后续页面复制
            currentPage.pendants.push({
                element: element.cloneNode(true),
                originalElement: element,
                pendantId: pendantId
            });
        }

        clearPendants() {
            // 清除当前页面的pendants继承
            const currentPage = this.getCurrentPage();
            if (currentPage) {
            if (this.config && this.config.debug) console.log('BookJS: clearPendants called for page', this.pages.indexOf(currentPage));

                // 移除当前页面已存在的pendants
                const existingPendants = currentPage.element.querySelectorAll('.nop-page-pendants');
                existingPendants.forEach(pendant => {
                if (this.config && this.config.debug) console.log('BookJS: Removing existing pendant:', pendant);
                    pendant.remove();
                });

                currentPage.pendants = [];
                // 添加标记，表示pendants已被清除，不应该继承到后续页面
                currentPage.pendantsCleared = true;
            }
        }

        addBaseStyles() {
            // 避免重复注入基础样式
            let style = document.getElementById('bookjs-base-styles');
            if (!style) {
                style = document.createElement('style');
                style.id = 'bookjs-base-styles';
                document.head.appendChild(style);
            }
            style.textContent = `
                /* BookJS 基础样式 */
                .nop-book {
                    position: relative;
                    margin: 0 auto;
                    background: #f0f0f0;
                    padding: 20px;
                    font-family: inherit;
                    color: rgb(49, 47, 48);
                    font-size: 12px;
                }
                
                .nop-page-item {
                    margin: 0 auto 20px;
                    background: white;
                    position: relative;
                    box-shadow: 0 0 10px rgba(0,0,0,0.1);
                    page-break-after: always;
                    overflow: hidden;
                }
                
                .nop-page-content {
                    position: absolute;
                    overflow: hidden;
                    contain: layout paint size;
                }
                
                .nop-page-content .title:first-child {
                    margin-top: 0;
                }
                
                .nop-page-pendants {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    pointer-events: none;
                    text-align: center;
                    font-size: 12px;
                    color: #666;
                }
                
                /* 页码样式 */
                .page-num-simple {
                    text-align: right !important;
                    padding-right: 56px;
                    position: absolute;
                    bottom: 28px;
                    right: 0;
                    font-size: 12px;
                    color: #666;
                }
                
                

                
                /* 打印媒体查询 */
                @media print {
                    .nop-book {
                        background: none !important;
                        padding: 0 !important;
                        margin: 0 !important;
                    }
                }
            `;
        }
    }

    // 内容处理器
    class ContentProcessor {
        constructor(pageManager, config) {
            this.pageManager = pageManager;
            this.config = config;
            // 复用离屏测量容器，减少重复DOM读写与强制布局
            this._measureBox = null;

            // 调试日志门控（与 BookJS.log 行为保持一致）
            this.log = (...args) => {
                const enabled = (this.config && this.config.debug) || (typeof window !== 'undefined' && window.bookConfig && window.bookConfig.debug);
                if (enabled) console.log(...args);
            };
        }

        processContent() {
            this.log('开始处理内容，配置:', this.config);
            const contentBox = document.getElementById('content-box');
            if (!contentBox) {
                console.error('Content box not found');
                return;
            }

            // 隐藏原始内容
            contentBox.style.display = 'none';

            // 处理所有子元素
            Array.from(contentBox.children).forEach(child => {
                this.processElement(child);
            });

            // 处理页码
            this.log('检查页码配置:', this.config.simplePageNum);
            if (this.config.simplePageNum) {
                this.log('调用addPageNumbers方法');
                this.addPageNumbers();
            } else {
                this.log('页码配置不存在或未启用');
            }
        }

        processElement(element) {
            // Keep With Next Check
            if (/^H[1-6]$/i.test(element.tagName)) {
                const next = element.nextElementSibling;
                if (next) {
                    const hHeight = this.getElementHeight(element.cloneNode(true));
                    let nextHeight = 0;

                    if (next.tagName === 'TABLE' || next.getAttribute('data-op-type') === 'table') {
                        const tempWrapper = next.cloneNode(true);
                        const tempTbl = tempWrapper.querySelector('table') || tempWrapper;
                        const tempBody = tempTbl.querySelector('tbody');
                        if (tempBody && tempBody.children.length > 0) {
                            const firstRow = tempBody.children[0].cloneNode(true);
                            tempBody.innerHTML = '';
                            tempBody.appendChild(firstRow);
                            nextHeight = this.getElementHeight(tempWrapper);
                        } else {
                            nextHeight = 50;
                        }
                    } else {
                        const nextOpType = next.getAttribute('data-op-type') || 'block';
                        const fullHeight = this.getElementHeight(next.cloneNode(true));
                        
                        // Elements that can be split: text, table (handled above)
                        const isSplitable = ['text'].includes(nextOpType);
                        
                        if (isSplitable) {
                             nextHeight = Math.min(fullHeight, 50);
                        } else {
                             // Rigid elements (block, bg-image): must fit entirely to stay with header
                             nextHeight = fullHeight;
                        }
                    }

                    if (hHeight + nextHeight > this.pageManager.getAvailableHeight()) {
                        this.pageManager.createNewPage();
                    }
                }
            }

            const opType = element.getAttribute('data-op-type') || 'block';

            switch (opType) {
                case 'block':
                    this.processBlock(element);
                    break;
                case 'text':
                    this.processText(element);
                    break;
                case 'new-page':
                    this.processNewPage();
                    break;
                case 'pendants':
                    this.processPendants(element);
                    break;
                case 'table':
                    this.processTable(element);
                    break;
                case 'bg-image':
                    this.processBackgroundImage(element);
                    break;
                default:
                    this.processBlock(element);
            }
        }

        processBlock(element) {
            const cloned = element.cloneNode(true);
            const height = this.getElementHeight(cloned);

            const page = this.pageManager.addContent(cloned, height);

            const bgEl = element.querySelector('[data-op-type="bg-image"]');
            if (bgEl) {
                const src = bgEl.getAttribute('img-src') || bgEl.getAttribute('src') || '';
                if (src && page && page.element) {
                    page.element.style.background = `url('${src}') center/cover no-repeat`;
                    page.element.classList.add('nop-page-item-has-bg');
                }
            }
        }

        processText(element) {
            // 基于真实布局的片段级分页，保留原始内联结构
            const textContent = element.textContent || element.innerText || '';
            if (!textContent || textContent.length === 0) return;

            // 深度克隆并将文本节点包装为片段span以便测量
            const sourceClone = element.cloneNode(true);
            this.wrapTextNodesWithSpans(sourceClone);

            // 创建测量容器，使用与页面一致的最大行宽度
            const measure = document.createElement('div');
            measure.style.cssText = `
                position: absolute;
                visibility: hidden;
                left: -9999px;
                top: -9999px;
                width: ${this.getMaxLineWidth()}px;
                white-space: normal;
                word-break: normal;
            `;
            measure.appendChild(sourceClone);
            document.body.appendChild(measure);

            // 按top分组，识别每一行的chunk
            const baseTop = measure.getBoundingClientRect().top;
            const eps = 0.5;
            const chunks = Array.from(measure.querySelectorAll('span.nop-text-chunk'));
            const lines = [];
            let currentTop = null;
            let currentLine = null;

            for (const span of chunks) {
                const rectList = span.getClientRects();
                if (rectList.length === 0) continue;
                // 对于中文字符分片，每个span通常只有一个rect
                const rect = rectList[0];
                const normTop = Math.round(rect.top - baseTop);
                if (currentTop === null || Math.abs(normTop - currentTop) > eps) {
                    currentTop = normTop;
                    currentLine = { ids: [], rects: [] };
                    lines.push(currentLine);
                }
                currentLine.ids.push(span.getAttribute('data-chunk-id'));
                currentLine.rects.push(rect);
            }

            // 清理测量容器
            document.body.removeChild(measure);

            // 按行生成克隆并添加到页面
            for (const lineInfo of lines) {
                const lineClone = sourceClone.cloneNode(true);

                // 移除不在该行的chunk
                const allSpans = Array.from(lineClone.querySelectorAll('span.nop-text-chunk'));
                for (const sp of allSpans) {
                    const id = sp.getAttribute('data-chunk-id');
                    if (!lineInfo.ids.includes(id)) {
                        sp.remove();
                    }
                }

                // 清理空节点，保留必要的内联结构
                this.cleanupEmptyNodes(lineClone);

                // 设置单行样式，避免受全局break-all影响
                lineClone.style.display = 'block';
                lineClone.style.margin = '0';
                lineClone.style.padding = '0';
                lineClone.style.wordBreak = 'normal';
                lineClone.style.whiteSpace = 'normal';

                // 使用统一的高度测量以确保与页面一致
                const height = this.getElementHeight(lineClone);
                this.pageManager.addContent(lineClone, height);
            }
        }

        // 处理当前页面背景图片
        processBackgroundImage(element) {
            try {
                const src = element.getAttribute('img-src') || element.getAttribute('src') || '';
                if (!src) return;

                // 获取当前页面并设置背景
                const page = this.pageManager.getCurrentPage();
                if (!page || !page.element) return;

                page.element.style.background = `url('${src}') center/cover no-repeat`;
                page.element.classList.add('nop-page-item-has-bg');
                // 背景指令不参与内容高度计算，不插入到页面内容中
            } catch (e) {
                console.warn('BookJS: 处理bg-image失败', e);
            }
        }

        processNewPage() {
            // 强制分页逻辑改进
            const currentPage = this.pageManager.getCurrentPage();

            if (!currentPage) {
                // 如果没有当前页面，创建第一个页面
                this.pageManager.createNewPage();
                return;
            }

            // 检查当前页面是否有内容
            if (currentPage.currentHeight > 0) {
                // 当前页面有内容，创建新页面
                this.pageManager.createNewPage();
            } else {
                // 当前页面为空，检查是否有DOM内容
                const hasContent = currentPage.content.children.length > 0;
                if (hasContent) {
                    // 有DOM内容但高度为0，仍然创建新页面
                    this.pageManager.createNewPage();
                }
                // 如果完全没有内容，则跳过创建新页面，避免空页面
            }
        }

        processPendants(element) {
        this.log('BookJS: processPendants called', element);
            // 检查是否有实际的pendant内容
            const hasValidPendants = Array.from(element.children).some(child => {
                return child.textContent.trim() || child.querySelector('img, svg, canvas') || child.children.length > 0;
            });

        this.log('BookJS: hasValidPendants:', hasValidPendants);

            if (hasValidPendants) {
                // 只处理有内容的pendant子元素
                Array.from(element.children).forEach(child => {
                    // 检查子元素是否有实际内容
                    if (child.textContent.trim() || child.querySelector('img, svg, canvas') || child.children.length > 0) {
                    this.log('BookJS: Adding pendant:', child);
                        this.pageManager.addPendant(child);
                    }
                });
            } else {
                // 如果pendants元素为空，清除当前页面的pendants继承
            this.log('BookJS: Empty pendants element, calling clearPendants');
                this.pageManager.clearPendants();
            }
        }

        processTable(element) {
            let tableWrapper = element.cloneNode(true);
            let tableEl = tableWrapper.querySelector('table') || tableWrapper;
            let tbody = tableEl.querySelector('tbody');
            if (!tbody) {
                this.processBlock(element);
                return;
            }

            const rows = Array.from(tbody.children);
            tbody.innerHTML = '';

            // Current table being built
            let currentTable = element.cloneNode(true);
            let currentTbl = currentTable.querySelector('table') || currentTable;
            let currentTbody = currentTbl.querySelector('tbody');
            currentTbody.innerHTML = '';

            // Helper to get height of currentTable
            const getCurrentTableHeight = () => {
                return this.getElementHeight(currentTable);
            };

            // Calculate row groups based on rowspan
            const rowGroups = [];
            let i = 0;
            while (i < rows.length) {
                let groupEnd = i;
                // Check initial rowspans
                const cells = Array.from(rows[i].children);
                cells.forEach(cell => {
                    const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
                    if (rowspan > 1) {
                        groupEnd = Math.max(groupEnd, i + rowspan - 1);
                    }
                });

                // Extend group if subsequent rows have overlapping rowspans
                for (let j = i + 1; j <= groupEnd && j < rows.length; j++) {
                    const nextCells = Array.from(rows[j].children);
                    nextCells.forEach(cell => {
                        const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
                        if (rowspan > 1) {
                            groupEnd = Math.max(groupEnd, j + rowspan - 1);
                        }
                    });
                }
                
                // Collect rows for this group
                const group = [];
                for (let k = i; k <= groupEnd && k < rows.length; k++) {
                    group.push(rows[k]);
                }
                rowGroups.push(group);
                
                i = groupEnd + 1;
            }

            // Queue of groups to process
            const queue = [...rowGroups];
            const splitStrategy = element.getAttribute('data-split-strategy') || 'auto';

            while (queue.length > 0) {
                const group = queue.shift();
                
                // Try adding rows one by one
                let addedRowsCount = 0;
                let groupFit = true;
                
                for (let r = 0; r < group.length; r++) {
                    const row = group[r];
                    currentTbody.appendChild(row.cloneNode(true));
                    
                    const height = getCurrentTableHeight();
                    if (height > this.pageManager.getAvailableHeight()) {
                        // Overflow!
                        currentTbody.removeChild(currentTbody.lastChild);
                        groupFit = false;
                        break;
                    }
                    addedRowsCount++;
                }
                
                if (groupFit) {
                    // Whole group fits
                    continue;
                }
                
                // If not precise split strategy, and we have previous content on this page,
                // prefer moving the whole group to the next page instead of splitting it.
                // We check if there is content before this group in the current tbody.
                // Note: currentTbody.children.length currently equals addedRowsCount (because we removed the overflowed row).
                const hasPreviousContent = currentTbody.children.length > addedRowsCount;
                
                // Check if any cell in the group has data-split-repeat="true"
                // If so, we imply 'precise' strategy because the user explicitly configured repeat behavior for splitting.
                const hasSplitRepeat = group.some(row => 
                    Array.from(row.children).some(cell => cell.getAttribute('data-split-repeat') === 'true')
                );

                if (splitStrategy !== 'precise' && !hasSplitRepeat && hasPreviousContent) {
                    // Backtrack: remove partial group
                    for (let k = 0; k < addedRowsCount; k++) {
                        currentTbody.removeChild(currentTbody.lastChild);
                    }
                    
                    // Flush current page
                    this.pageManager.addContent(currentTable, getCurrentTableHeight());
                    this.pageManager.createNewPage();
                    
                    // Reset currentTable
                    currentTable = element.cloneNode(true);
                    currentTbl = currentTable.querySelector('table') || currentTable;
                    currentTbody = currentTbl.querySelector('tbody');
                    currentTbody.innerHTML = '';
                    
                    // Retry this group on new page
                    queue.unshift(group);
                    continue;
                }
                
                // Group didn't fit entirely
                if (addedRowsCount === 0) {
                    // Even the first row doesn't fit
                    if (currentTbody.children.length > 0) {
                        // If we have content on this page, push to next page
                        this.pageManager.addContent(currentTable, getCurrentTableHeight());
                        this.pageManager.createNewPage();
                        
                        // Reset currentTable
                        currentTable = element.cloneNode(true);
                        currentTbl = currentTable.querySelector('table') || currentTable;
                        currentTbody = currentTbl.querySelector('tbody');
                        currentTbody.innerHTML = '';
                        
                        // Retry this group on new page
                        queue.unshift(group);
                        continue;
                    } else {
                        // We are on a fresh page, and first row doesn't fit.
                        // Force add at least one row
                        addedRowsCount = 1;
                        currentTbody.appendChild(group[0].cloneNode(true));
                    }
                }
                
                // Split the group
                const splitIndex = addedRowsCount;
                
                // Build grid for the group to identify crossing cells
                const grid = this.buildGrid(group);
                const crossingCells = []; 
                
                // Identify crossing cells
                for (let r = 0; r < splitIndex; r++) {
                    for (let c = 0; c < grid[r].length; c++) {
                        const cellInfo = grid[r][c];
                        if (cellInfo && cellInfo.isOrigin) {
                            if (cellInfo.originRow + cellInfo.rowspan > splitIndex) {
                                crossingCells.push(cellInfo);
                            }
                        }
                    }
                }
                
                // 1. Update cells in currentTbody (reduce rowspan)
                const currentRows = Array.from(currentTbody.children);
                // Calculate the starting row index of the current group within currentTbody
                // Since currentRows contains all rows in currentTbody, and we just added 'splitIndex' rows from the current group,
                // the group starts at:
                const groupStartIndex = currentRows.length - splitIndex;

                crossingCells.forEach(info => {
                    const absoluteRowIndex = groupStartIndex + info.originRow;
                    if (absoluteRowIndex < currentRows.length) {
                        const rowInCurrent = currentRows[absoluteRowIndex];
                        let targetCell = null;
                        let currentC = 0;
                        for (const cell of Array.from(rowInCurrent.children)) {
                             if (currentC === info.originCol) {
                                 targetCell = cell;
                                 break;
                             }
                             currentC += parseInt(cell.getAttribute('colspan')||'1');
                        }
                        
                        if (targetCell) {
                            const newRowspan = splitIndex - info.originRow;
                            targetCell.setAttribute('rowspan', newRowspan);
                        }
                    }
                });
                
                // 2. Prepare remaining rows for next page
                const nextGroupRows = group.slice(splitIndex);
                if (nextGroupRows.length > 0) {
                    const firstNextRow = nextGroupRows[0];
                    
                    const newChildren = [];
                    const handledCols = new Set();
                    
                    for (let c = 0; c < grid[splitIndex].length; c++) {
                        if (handledCols.has(c)) continue;
                        
                        const cellInfo = grid[splitIndex][c];
                        if (!cellInfo) continue;
                        
                        if (cellInfo.originRow < splitIndex) {
                            // Crossing cell: create continuation
                            const origCell = cellInfo.cell;
                            const newCell = origCell.cloneNode(false);
                            
                            const remainingSpan = (cellInfo.originRow + cellInfo.rowspan) - splitIndex;
                            newCell.setAttribute('rowspan', remainingSpan);
                            
                            // Handle content
                            const splitRepeat = origCell.getAttribute('data-split-repeat');
                            if (splitRepeat === 'true') {
                                 newCell.innerHTML = origCell.innerHTML;
                            } else {
                                 newCell.innerHTML = ''; 
                            }
                            
                            newChildren.push(newCell);
                            
                        } else {
                             // Native cell
                             if (cellInfo.isOrigin) {
                                 newChildren.push(cellInfo.cell);
                             }
                        }
                        
                        const colspan = cellInfo.colspan;
                        for (let k = 0; k < colspan; k++) handledCols.add(c + k);
                    }
                    
                    firstNextRow.innerHTML = '';
                    newChildren.forEach(child => firstNextRow.appendChild(child));
                    
                    // 3. Flush current page
                    this.pageManager.addContent(currentTable, getCurrentTableHeight());
                    this.pageManager.createNewPage();
                    
                    // Reset currentTable
                    currentTable = element.cloneNode(true);
                    currentTbl = currentTable.querySelector('table') || currentTable;
                    currentTbody = currentTbl.querySelector('tbody');
                    currentTbody.innerHTML = '';
                    
                    // 4. Add remaining rows to queue
                    queue.unshift(nextGroupRows);
                } else {
                     // Should not happen if splitIndex < group.length
                }
            }

            // Add remaining
            if (currentTbody.children.length > 0) {
                this.pageManager.addContent(currentTable, getCurrentTableHeight());
            }
        }

        buildGrid(rows) {
            const grid = []; 
            for (let r = 0; r < rows.length; r++) {
                grid[r] = [];
            }
            
            for (let r = 0; r < rows.length; r++) {
                const row = rows[r];
                const cells = Array.from(row.children);
                let c = 0;
                let cellIndex = 0;
                
                while (cellIndex < cells.length) {
                    while (grid[r][c]) c++;
                    
                    const cell = cells[cellIndex];
                    const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
                    const colspan = parseInt(cell.getAttribute('colspan') || '1');
                    
                    for (let i = 0; i < rowspan; i++) {
                        for (let j = 0; j < colspan; j++) {
                            if (r + i < rows.length) {
                                if (!grid[r + i]) grid[r + i] = [];
                                grid[r + i][c + j] = {
                                    cell: cell,
                                    originRow: r,
                                    originCol: c,
                                    rowspan: rowspan,
                                    colspan: colspan,
                                    isOrigin: (i === 0 && j === 0)
                                };
                            }
                        }
                    }
                    cellIndex++;
                    c += colspan;
                }
            }
            return grid;
        }

        // 辅助方法
        getMeasureBox() {
            if (this._measureBox && this._measureBox.parentNode) return this._measureBox;
            const box = document.createElement('div');
            box.style.cssText = `
                position: absolute;
                visibility: hidden;
                left: -9999px;
                top: -9999px;
                width: ${this.pageManager.pageWidth - this.pageManager.padding.left - this.pageManager.padding.right}px;
                contain: layout paint size;
            `;
            box.className = 'nop-measure-box';
            document.body.appendChild(box);
            this._measureBox = box;
            return box;
        }

        getElementHeight(element) {
            const box = this.getMeasureBox();
            // 直接在测量容器中附加传入元素，避免二次克隆
            box.appendChild(element);
            
            // 获取计算样式以包含外边距
            const style = window.getComputedStyle(element);
            const marginTop = parseFloat(style.marginTop) || 0;
            const marginBottom = parseFloat(style.marginBottom) || 0;
            
            const height = element.offsetHeight + marginTop + marginBottom;
            
            // 清理以避免堆积
            box.removeChild(element);
            return height;
        }

        getTextWidth(text, element) {
            const temp = document.createElement('span');
            temp.style.cssText = `
                position: absolute;
                visibility: hidden;
                white-space: nowrap;
                font: inherit;
            `;
            temp.textContent = text;

            if (element) {
                const computedStyle = window.getComputedStyle(element);
                temp.style.font = computedStyle.font;
            }

            document.body.appendChild(temp);
            const width = temp.offsetWidth;
            document.body.removeChild(temp);
            return width;
        }

        getMaxLineWidth() {
            return this.pageManager.pageWidth - this.pageManager.padding.left - this.pageManager.padding.right;
        }

        splitText(text) {
            const words = [];
            let currentWord = '';

            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                currentWord += char;

                if (this.config.textNoBreakChars.includes(char) ||
                    char === ' ' || char === '\n' || char === '\t') {
                    if (currentWord.trim()) {
                        words.push(currentWord);
                    }
                    currentWord = '';
                }
            }

            if (currentWord.trim()) {
                words.push(currentWord);
            }

            return words;
        }

        addTextLine(text, originalElement) {
            const line = originalElement.cloneNode(false);
            line.textContent = text;
            line.style.display = 'block';
            line.style.margin = '0';
            line.style.padding = '0';
            const height = this.getElementHeight(line);
            this.pageManager.addContent(line, height);
        }

        // 将文本节点拆分为片段span，便于基于真实布局的行识别
        wrapTextNodesWithSpans(root) {
            let idx = 0;
            const toProcess = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
            let node;
            while ((node = walker.nextNode())) {
                // 保留所有文本（包括空白），以维持间距
                if (node.nodeValue !== null) {
                    toProcess.push(node);
                }
            }
            for (const textNode of toProcess) {
                const text = textNode.nodeValue || '';
                const tokens = this.chunkText(text);
                if (tokens.length === 0) continue;
                const frag = document.createDocumentFragment();
                for (const tok of tokens) {
                    const sp = document.createElement('span');
                    sp.className = 'nop-text-chunk';
                    const id = 'chunk-' + (idx++);
                    sp.setAttribute('data-chunk-id', id);
                    // 保留原始字符（空格/标点）
                    sp.textContent = tok;
                    frag.appendChild(sp);
                }
                textNode.parentNode.replaceChild(frag, textNode);
            }
        }

        // 文本切分为片段（中文优先）：按字符分片，保留空格与标点
        chunkText(text) {
            const tokens = [];
            for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                if (ch === '\\n') {
                    tokens.push(' ');
                } else {
                    tokens.push(ch);
                }
            }
            return tokens;
        }

        // 移除空的元素节点，保留实际内容结构
        cleanupEmptyNodes(root) {
            const elements = Array.from(root.querySelectorAll('*'));
            for (const el of elements) {
                if (el.matches('span.nop-text-chunk')) continue;
                const hasChildren = el.children.length > 0;
                const hasText = Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && (n.nodeValue || '').trim().length > 0);
                const hasChunk = el.querySelector && el.querySelector('span.nop-text-chunk');
                if (!hasChildren && !hasText && !hasChunk) {
                    el.remove();
                }
            }
        }

        addPageNumbers() {
            this.log('开始添加页码，配置:', this.config.simplePageNum);
            const config = this.config.simplePageNum;
            if (!config || !config.enable) {
                this.log('页码配置未启用或不存在');
                return;
            }

            this.log('页面数量:', this.pageManager.pages.length);
            const startPage = typeof config.pageBegin === 'number' ? config.pageBegin - 1 : 0;
            const endPage = config.pageEnd === -1 ? this.pageManager.pages.length - 1 : config.pageEnd - 1;

            // 统计存在有效 pendants 的页面数量（不含已生成的页脚）
            let totalPagesWithPendants = 0;
            for (let i = startPage; i <= endPage && i < this.pageManager.pages.length; i++) {
                const page = this.pageManager.pages[i];
                const hasValidPendants = !!page.element.querySelector('.nop-page-pendants:not(.pendant-pageNumSimple)');
                if (hasValidPendants) {
                    totalPagesWithPendants++;
                }
            }

            this.log('有有效 pendants 的页面总数:', totalPagesWithPendants);

            // 仅对存在有效 pendants 的页面递增页码
            let pageNumCounter = 1;

            for (let i = startPage; i <= endPage && i < this.pageManager.pages.length; i++) {
                const page = this.pageManager.pages[i];

                // 检查页面是否存在有效 pendants（排除页脚本身）
                const hasValidPendants = !!page.element.querySelector('.nop-page-pendants:not(.pendant-pageNumSimple)');
                if (!hasValidPendants) {
                    this.log(`第 ${i + 1} 页没有有效 pendants，跳过页脚添加`);
                    continue;
                }

                // 清除已存在的页脚
                const existingFooters = page.element.querySelectorAll('.pendant-pageNumSimple');
                existingFooters.forEach(footer => footer.remove());

                const currentPageNum = pageNumCounter;
                const totalPages = totalPagesWithPendants;

                const pendant = document.createElement('div');

                // 模板替换，仅支持变量占位
                let pendantHTML = config.pendant || '第 ${PAGE} 页 / 共 ${TOTAL_PAGE} 页';
                pendantHTML = pendantHTML.replace(/\$\{PAGE\}/g, currentPageNum);
                pendantHTML = pendantHTML.replace(/\$\{TOTAL_PAGE\}/g, totalPages);

                pendant.innerHTML = pendantHTML;
                pendant.className = 'nop-page-pendants pendant-pageNumSimple';

                // 若未指定 page-num-simple 类，添加默认样式
                if (!config.pendant || !config.pendant.includes('page-num-simple')) {
                    pendant.style.cssText = `
                        position: absolute;
                        bottom: 28px;
                        left: 0;
                        right: 0;
                    `;
                }

                // 直接追加到页面元素，无需依赖 header
                page.element.appendChild(pendant);

                // 仅对有 pendants 的页面递增页码
                pageNumCounter++;
            }
            this.log('页码添加完成');
        }

    }

    // 主类
    class BookJS {
        constructor(config = {}) {
            this.config = Utils.mergeConfig(DEFAULT_CONFIG, config);
            this.pageManager = null;
            this.contentProcessor = null;
            this.isRendered = false;

            // 调试日志门控
            this.log = (...args) => {
                const enabled = (this.config && this.config.debug) || (typeof window !== 'undefined' && window.bookConfig && window.bookConfig.debug);
                if (enabled) console.log(...args);
            };

            this.init();
        }

        init() {
            this.log('BookJS: 开始初始化...');

            // 等待DOM加载完成
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.checkStart());
            } else {
                this.checkStart();
            }

            // 监听配置变化
            this.watchConfig();

            // 启动DOM变化监听
            this.setupDOMObserver();

            this.log('BookJS: 初始化完成');
        }

        checkStart() {
            if (this.config.start && !this.isRendered) {
                this.render();
            }
        }

        watchConfig() {
            this.log('BookJS: 开始监听配置变化...');
            
            const self = this;
            // 先清理已有的检查定时器，避免重复注册
            if (this._configCheckInterval) {
                clearInterval(this._configCheckInterval);
                this._configCheckInterval = null;
            }
            if (this._renderCheckInterval) {
                clearInterval(this._renderCheckInterval);
                this._renderCheckInterval = null;
            }
            // 统一注册渲染完成事件处理器（只注册一次）
            if (!this._onBeforeCompleteHandler) {
                this._onBeforeCompleteHandler = () => {
                    if (this._renderCheckInterval) {
                        clearInterval(this._renderCheckInterval);
                        this._renderCheckInterval = null;
                    }
                    if (this._domObserver) {
                        this._domObserver.disconnect();
                        this._domObserver = null;
                    }
                    if (this._observerTimeout) {
                        clearTimeout(this._observerTimeout);
                        this._observerTimeout = null;
                    }
                };
            }
            if (!this._beforeCompleteListenerAdded) {
                document.addEventListener('book.before-complete', this._onBeforeCompleteHandler);
                this._beforeCompleteListenerAdded = true;
            }

            // 持续监听全局配置的出现和变化
            const checkGlobalConfig = () => {
                if (typeof window !== 'undefined' && window.bookConfig) {
                    self.log('BookJS: 找到全局配置', window.bookConfig);

                    // 停止配置检查
                    if (this._configCheckInterval) {
                        clearInterval(this._configCheckInterval);
                        this._configCheckInterval = null;
                    }

                    // 开始渲染检查
                    const checkStart = () => {
                        if (window.bookConfig.start && !self.isRendered) {
                            self.log('BookJS: 检测到start=true，开始渲染');
                            self.render();
                        }
                    };

                    // 立即检查一次
                    checkStart();

                    // 降低检查频率以减少开销
                    this._renderCheckInterval = setInterval(checkStart, 300);

                    // 智能强制渲染机制
                    let renderAttempts = 0;
                    const maxAttempts = 2;
                    const smartRenderCheck = () => {
                        if (window.bookConfig.start && !self.isRendered && renderAttempts < maxAttempts) {
                            renderAttempts++;
                            self.log(`BookJS: 智能渲染检测 - 尝试 ${renderAttempts}/${maxAttempts}`);

                            // 检查是否有分页元素生成
                            const pageItems = document.querySelectorAll('.nop-page-item');
                            if (pageItems.length === 0) {
                                self.log('BookJS: 未检测到分页元素，执行强制渲染');
                                self.forceRender();
                            }
                        }
                    };

                    // 以序列方式进行智能检测，若已渲染或检测到分页则停止后续检查
                    const scheduleSmartRenderChecks = (delays = [1000, 3000]) => {
                        const run = (idx) => {
                            if (self.isRendered || idx >= delays.length) return;
                            setTimeout(() => {
                                if (self.isRendered) return;
                                // 若已生成分页元素则无需再检测
                                const hasPages = document.querySelectorAll('.nop-page-item').length > 0;
                                if (!hasPages) {
                                    smartRenderCheck();
                                }
                                // 渲染成功或已检测到分页则停止后续定时任务
                                if (!self.isRendered && document.querySelectorAll('.nop-page-item').length === 0) {
                                    run(idx + 1);
                                }
                            }, delays[idx]);
                        };
                        run(0);
                    };

                    scheduleSmartRenderChecks();

                    // 渲染完成后清除定时器
                    // 渲染完成的清理已由统一的 _onBeforeCompleteHandler 处理
                }
            };
            
            // 立即检查一次
            checkGlobalConfig();
            
            // 如果没有找到配置，持续检查
            if (!window.bookConfig) {
                this._configCheckInterval = setInterval(checkGlobalConfig, 300);
            }
        }

        render(force = false) {
            if (this.isRendered && !force) {
                this.log('BookJS: 已渲染，跳过重复渲染');
                return;
            }

            this.log('BookJS: 开始渲染', { force, isRendered: this.isRendered });

            try {
                // 如果是强制渲染，先清理之前的内容
                if (force) {
                    const existingPages = document.querySelectorAll('.nop-page-item, .nop-book');
                    existingPages.forEach(page => page.remove());
                    this.isRendered = false;
                }

                // 合并全局配置
                let currentConfig = this.config;
                if (typeof window !== 'undefined' && window.bookConfig) {
                    currentConfig = Utils.mergeConfig(this.config, window.bookConfig);
                }
                this.log('BookJS: 当前使用的配置', currentConfig);

                // 初始化页面管理器
                this.log('BookJS: 初始化页面管理器');
                this.pageManager = new PageManager(currentConfig);

                // 初始化内容处理器
                this.log('BookJS: 初始化内容处理器');
                this.contentProcessor = new ContentProcessor(this.pageManager, currentConfig);

                // 处理内容
                this.log('BookJS: 开始处理内容');
                this.contentProcessor.processContent();

                // 添加打印样式
                this.log('BookJS: 添加打印样式');
                this.addPrintStyles();

                // 触发完成事件
                this.log('BookJS: 触发完成事件');
                this.triggerCompleteEvent();

                this.isRendered = true;

                this.log('BookJS: 渲染完成');

            } catch (error) {
                console.error('BookJS render error:', error);
                // 渲染失败时，清理渲染轮询，避免长时间后台运行
                if (this._renderCheckInterval) {
                    clearInterval(this._renderCheckInterval);
                    this._renderCheckInterval = null;
                    this.log('BookJS: 渲染失败，已停止渲染轮询');
                }
            }
        }

        setupDOMObserver() {
            // 检查是否支持MutationObserver
            if (typeof MutationObserver === 'undefined') return;
            
            const self = this;
            // 使用实例属性保存防抖定时器引用以便后续清理
            let observerTimeout = this._observerTimeout || null;
            
            // 创建DOM变化观察器
            const observer = new MutationObserver((mutations) => {
                // 防抖处理，避免频繁触发
                if (observerTimeout) clearTimeout(observerTimeout);
                
                observerTimeout = setTimeout(() => {
                    // 检查是否需要重新渲染
                    if (self.config.start && !self.isRendered) {
                        const contentBox = document.getElementById('content-box');
                        if (contentBox && contentBox.children.length > 0) {
                            self.log('BookJS: 检测到DOM变化，尝试自动渲染');
                            
                            // 检查是否已有分页元素
                            const pageItems = document.querySelectorAll('.nop-page-item');
                            if (pageItems.length === 0) {
                                self.render();
                            }
                        }
                    }
                }, 300); // 300ms防抖
                // 保存到实例以便统一清理
                self._observerTimeout = observerTimeout;
            });
            // 保存观察器引用以便统一清理
            this._domObserver = observer;
            
            // 开始观察content-box的变化
            const contentBox = document.getElementById('content-box');
            if (contentBox) {
                observer.observe(contentBox, {
                    childList: true,
                    subtree: true,
                    attributes: false,
                    characterData: false
                });
                
                self.log('BookJS: DOM变化监听已启动');
            } else {
                // 如果content-box还不存在，延迟启动观察器
                setTimeout(() => {
                    const delayedContentBox = document.getElementById('content-box');
                    if (delayedContentBox) {
                        observer.observe(delayedContentBox, {
                            childList: true,
                            subtree: true,
                            attributes: false,
                            characterData: false
                        });
                        self.log('BookJS: DOM变化监听已延迟启动');
                    }
                }, 1000);
            }
        }

        // 清理观察器与定时器，避免重复注册或资源泄漏
        cleanup() {
            if (this._domObserver) {
                this._domObserver.disconnect();
                this._domObserver = null;
            }
            if (this._observerTimeout) {
                clearTimeout(this._observerTimeout);
                this._observerTimeout = null;
            }
            if (this._renderCheckInterval) {
                clearInterval(this._renderCheckInterval);
                this._renderCheckInterval = null;
            }
            if (this._configCheckInterval) {
                clearInterval(this._configCheckInterval);
                this._configCheckInterval = null;
            }
            if (this._beforeCompleteListenerAdded && this._onBeforeCompleteHandler) {
                document.removeEventListener('book.before-complete', this._onBeforeCompleteHandler);
                this._beforeCompleteListenerAdded = false;
            }
        }

        forceRender() {
            this.log('BookJS: 执行强制渲染');

            // 重新初始化配置
            if (typeof window !== 'undefined' && window.bookConfig) {
                this.config = Utils.mergeConfig(DEFAULT_CONFIG, window.bookConfig);
            }

            // 强制重新渲染
            try {
                this.render(true); // 使用force参数
                this.log('BookJS: 强制渲染完成');
            } catch (error) {
                console.error('BookJS: 强制渲染失败', error);
                
                // 如果强制渲染失败，清理资源后重试，不创建新实例
                setTimeout(() => {
                    this.log('BookJS: 清理资源并重试强制渲染');
                    this.cleanup();
                    try {
                        this.render(true);
                        this.log('BookJS: 重试渲染完成');
                    } catch (e) {
                        console.error('BookJS: 重试强制渲染失败', e);
                    }
                }, 500);
            }
        }



        addPrintStyles() {
            if (!this.pageManager) return;
            // 避免重复注入打印样式
            let style = document.getElementById('bookjs-print-styles');
            if (!style) {
                style = document.createElement('style');
                style.id = 'bookjs-print-styles';
                document.head.appendChild(style);
            }
            // 计算@page的物理尺寸（mm/in），根据方向切换宽高
            const pageSizeDef = PAGE_SIZES[this.config.pageSize] || PAGE_SIZES['ISO_A4'];
            let cssPageWidth = pageSizeDef.width;
            let cssPageHeight = pageSizeDef.height;
            if (this.config.orientation === 'landscape') {
                [cssPageWidth, cssPageHeight] = [cssPageHeight, cssPageWidth];
            }
            style.textContent = `
                /* 页面尺寸样式 */
                .nop-page-item {
                    width: ${this.pageManager.pageWidth}px !important;
                    height: ${this.pageManager.pageHeight}px !important;
                }
                
                .nop-page-content {
                    top: ${this.pageManager.padding.top}px !important;
                    left: ${this.pageManager.padding.left}px !important;
                    right: ${this.pageManager.padding.right}px !important;
                    bottom: ${this.pageManager.padding.bottom}px !important;
                    width: ${this.pageManager.pageWidth - this.pageManager.padding.left - this.pageManager.padding.right}px !important;
                    height: ${this.pageManager.pageHeight - this.pageManager.padding.top - this.pageManager.padding.bottom}px !important;
                }
                
                /* 打印样式 */
                @media print {
                    body { 
                        margin: 0; 
                        padding: 0; 
                        font-family: 'SourceHanSansCN', 'PingFang SC', sans-serif, 'Helvetica Neue', STHeiti, 'Microsoft Yahei', Tahoma, Simsun;
                    }
                    .nop-book { 
                        background: none !important; 
                        padding: 0 !important; 
                        margin: 0 !important;
                    }
                    .nop-page-item { 
                        margin: 0 !important; 
                        box-shadow: none !important;
                        page-break-after: always;
                    }
                    .nop-page-item:last-child {
                        page-break-after: auto !important;
                    }
                    .nop-page-item:not(.nop-page-item-has-bg) {
                        background: white !important;
                    }
                    .nop-no-print { display: none !important; }
                    .nop-measure-box { display: none !important; }
                    
                    /* 确保内容正确显示 */
                    * {
                        -webkit-print-color-adjust: exact !important;
                        color-adjust: exact !important;
                    }
                }
                
                @page {
                    size: ${cssPageWidth} ${cssPageHeight};
                    margin: 0;
                }
            `;
        }

        triggerCompleteEvent() {
            const info = {
                PAGE_BEGIN_INDEX: 0,
                PAGE_END_INDEX: this.pageManager.pages.length - 1,
                TOTAL_PAGE: this.pageManager.pages.length
            };

            // 触发原生事件
            const event = new CustomEvent('book.before-complete', { detail: info });
            document.dispatchEvent(event);
        }

        // 公共API
        static create(config) {
            return new BookJS(config);
        }

        static start() {
            if (typeof window !== 'undefined') {
                if (window.bookConfig) {
                    window.bookConfig.start = true;
                }

                // 如果已有实例，直接调用渲染
                if (window.BookJS && window.BookJS.instance && !window.BookJS.instance.isRendered) {
                    window.BookJS.instance.render();
                }
            }
        }
    }

    // 自动初始化
    if (typeof window !== 'undefined') {
        let bookInstance = null;
        let initCheckInterval = null;

        // 调试工具栏初始化
        const initDebugToolbar = () => {
            if (document.getElementById('nop-debug-toolbar')) return;

            // 注入样式
            const style = document.createElement('style');
            style.textContent = `
                .nop-debug-toolbar { position: fixed; top: 20px; right: 20px; z-index: 99999; background: rgba(0,0,0,0.8); padding: 8px; border-radius: 4px; display: flex; gap: 8px; align-items: center; }
                .nop-debug-btn { cursor: pointer; padding: 6px 12px; background: #fff; border: none; border-radius: 3px; font-size: 12px; color: #333; }
                .nop-debug-btn:hover { background: #eee; }
                .nop-debug-select { padding: 5px; border-radius: 3px; font-size: 12px; border: none; min-width: 100px; }
            `;
            document.head.appendChild(style);

            // 创建工具栏
            const toolbar = document.createElement('div');
            toolbar.id = 'nop-debug-toolbar';
            toolbar.className = 'nop-debug-toolbar nop-no-print';
            toolbar.innerHTML = `
                <select class="nop-debug-select" id="nop-select-toc">
                    <option value="" disabled selected>跳转到页面</option>
                </select>
                <button class="nop-debug-btn" id="nop-btn-print">打印</button>
            `;
            document.body.appendChild(toolbar);

            // 目录更新逻辑
            const updateOptions = () => {
                const select = document.getElementById('nop-select-toc');
                if (!select) return;
                
                select.innerHTML = '';
                select.add(new Option('跳转到页面', '', true, true));
                select.options[0].disabled = true;

                document.querySelectorAll('.nop-page-item').forEach((page, i) => {
                    select.add(new Option(`第 ${i + 1} 页`, i));
                });
            };

            updateOptions();
            document.addEventListener('book.before-complete', updateOptions);

            // 事件绑定
            document.getElementById('nop-btn-print').onclick = () => window.print();
            document.getElementById('nop-select-toc').onchange = (e) => {
                const index = parseInt(e.target.value, 10);
                const target = document.querySelectorAll('.nop-page-item')[index];
                if (target) target.scrollIntoView({ behavior: 'instant' });
            };
        };

        // 等待页面加载完成后检查配置
        const checkAndInit = () => {
            if (window.bookConfig && window.bookConfig.debug) {
                console.log('BookJS: 检查配置和初始化...', {
                    hasConfig: !!window.bookConfig,
                    hasInstance: !!bookInstance
                });
            }

            if (window.bookConfig && !bookInstance) {
                if (window.bookConfig.debug) console.log('BookJS: 创建新实例');
                bookInstance = new BookJS(window.bookConfig);
                window.BookJS = BookJS; // 暴露BookJS到全局
                window.BookJS.instance = bookInstance; // 暴露实例

                if (window.bookConfig.debug) {
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', initDebugToolbar);
                    } else {
                        initDebugToolbar();
                    }
                    document.addEventListener('book.before-complete', initDebugToolbar);
                }

                // 停止检查
                if (initCheckInterval) {
                    clearInterval(initCheckInterval);
                    initCheckInterval = null;
                }
            }
        };

        // 立即检查一次
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', checkAndInit);
        } else {
            setTimeout(checkAndInit, 0); // 延迟执行，确保脚本后的配置能被读取
        }

        // 持续检查配置，直到找到为止（适用于Vue等框架动态设置配置的情况）
        // 设置超时限制：40次 * 300ms = 12秒
        let checkCount = 0;
        const MAX_CHECK_COUNT = 40;
        
        initCheckInterval = setInterval(() => {
            if (window.bookConfig && !bookInstance) {
                checkAndInit();
            } else {
                checkCount++;
                if (checkCount >= MAX_CHECK_COUNT) {
                    if (initCheckInterval) {
                        clearInterval(initCheckInterval);
                        initCheckInterval = null;
                        console.warn('BookJS: 初始化等待超时(12s)，未检测到 window.bookConfig。请确保在页面加载后设置了 bookConfig。');
                    }
                }
            }
        }, 300);

        // 暴露BookJS到全局，即使没有实例化
        window.BookJS = BookJS;
    }

    return BookJS;
});