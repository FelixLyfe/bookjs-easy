/*!
 * BookJS-Easy - WEB Print Auto Pagination / Preview / Make PDF
 * Version: 2.1.0
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
        contentBox: '#content-box',
        observeContent: true,
        resourceTimeout: 10000,
        printDelay: 0,
        simplePageNum: {
            enable: true,
            pageBegin: 1,
            pageEnd: -1,
            pendant: `<div class="page-num-simple"><span style="">\${PAGE} / \${TOTAL_PAGE}</span></div>`,
        },
        debug: false
    };

    // 仅吸收布局中的亚像素舍入误差。
    const FIT_TOLERANCE = 0.5;

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
        isPlainObject(value) {
            if (!value || typeof value !== 'object') return false;
            const prototype = Object.getPrototypeOf(value);
            return prototype === Object.prototype || prototype === null;
        },

        mergeConfig(target, source) {
            const result = {};
            for (const input of [target, source]) {
                for (const key of Object.keys(input || {})) {
                    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
                    const value = input[key];
                    result[key] = this.isPlainObject(value)
                        ? this.mergeConfig(this.isPlainObject(result[key]) ? result[key] : {}, value)
                        : Array.isArray(value) ? value.slice() : value;
                }
            }
            return result;
        },

        normalizeConfig(config) {
            const result = this.mergeConfig(DEFAULT_CONFIG, config);
            if (result.simplePageNum === true) {
                result.simplePageNum = this.mergeConfig(DEFAULT_CONFIG.simplePageNum, {});
            }
            return result;
        },

        // 转换尺寸单位为像素
        convertToPixels(value) {
            if (typeof value === 'number' && Number.isFinite(value)) return value;
            const match = String(value).trim().match(/^(\d+(?:\.\d*)?|\.\d+)(px|mm|cm|in|pt)?$/i);
            if (!match) throw new TypeError(`BookJS: Invalid dimension: ${value}`);

            const num = parseFloat(match[1]);
            const unit = (match[2] || 'px').toLowerCase();

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
            const values = String(padding).trim().split(/\s+/).map(v => this.convertToPixels(v));
            if (values.some(value => value < 0)) throw new RangeError('BookJS: Padding cannot be negative');
            if (values.length === 1) return { top: values[0], right: values[0], bottom: values[0], left: values[0] };
            if (values.length === 2) return { top: values[0], right: values[1], bottom: values[0], left: values[1] };
            if (values.length === 3) return { top: values[0], right: values[1], bottom: values[2], left: values[1] };
            if (values.length === 4) return { top: values[0], right: values[1], bottom: values[2], left: values[3] };
            throw new TypeError('BookJS: Padding requires one to four dimensions');
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
            const pageSize = this.config.pageSizeOption || PAGE_SIZES[this.config.pageSize]
                || PAGE_SIZES['ISO_' + this.config.pageSize] || PAGE_SIZES['ISO_A4'];
            let width = pageSize.width;
            let height = pageSize.height;

            if (this.config.orientation === 'landscape') {
                [width, height] = [height, width];
            }
            if (Utils.convertToPixels(width) <= this.padding.left + this.padding.right ||
                Utils.convertToPixels(height) <= this.padding.top + this.padding.bottom) {
                throw new RangeError('BookJS: Paper dimensions must leave a positive content area');
            }
            this.cssPageWidth = typeof width === 'number' ? `${width}px` : width;
            this.cssPageHeight = typeof height === 'number' ? `${height}px` : height;

            // 通过一次性基准测量动态确定页面尺寸，避免使用魔数偏移
            const tester = document.createElement('div');
            tester.style.cssText = `
                position: absolute;
                visibility: hidden;
                left: -9999px;
                top: -9999px;
                width: ${this.cssPageWidth};
                height: ${this.cssPageHeight};
                box-sizing: border-box;
                padding: 0;
                border: 0;
            `;
            document.body.appendChild(tester);
            const rect = tester.getBoundingClientRect();
            document.body.removeChild(tester);

            this.pageWidth = rect.width;
            this.pageHeight = rect.height;
            this.contentHeight = this.pageHeight - this.padding.top - this.padding.bottom;
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
            const pageSizeName = PAGE_SIZES[this.config.pageSize] ? this.config.pageSize : 'ISO_A4';
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
                --page-size: ${pageSizeName};
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

                    // 替换页码占位符；${TOTAL_PAGE} 需等全部分页完成后由 finalizePendantPlaceholders 统一替换
                    const pageNum = this.pages.length + 1; // 页码从1开始显示
                    pendant.innerHTML = pendant.innerHTML.replace(/\$\{PAGE\}/g, pageNum);

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

        updateContentHeight(page) {
            const top = page.content.getBoundingClientRect().top;
            const range = document.createRange();
            range.selectNodeContents(page.content);
            let bottom = range.getBoundingClientRect().bottom;
            for (const child of page.content.children) {
                const rect = child.getBoundingClientRect();
                if (rect.height || rect.width) {
                    bottom = Math.max(bottom, rect.bottom + (parseFloat(getComputedStyle(child).marginBottom) || 0));
                }
            }
            page.currentHeight = Math.max(0, bottom - top);
            return page.currentHeight;
        }

        addContent(element) {
            let page = this.getCurrentPage();
            const previousHeight = page.currentHeight;
            const hadContent = page.content.childNodes.length > 0;
            page.content.appendChild(element);
            this.updateContentHeight(page);

            if (page.currentHeight > this.contentHeight + FIT_TOLERANCE && hadContent) {
                element.remove();
                page.currentHeight = previousHeight;
                page = this.createNewPage();
                page.content.appendChild(element);
                this.updateContentHeight(page);
            }
            if (page.currentHeight > this.contentHeight + FIT_TOLERANCE) {
                throw new RangeError('BookJS: Unsplittable content exceeds the page height (' + element.tagName + ')');
            }
            const range = document.createRange();
            range.selectNodeContents(page.content);
            const bounds = range.getBoundingClientRect();
            const area = page.content.getBoundingClientRect();
            if (bounds.width && (bounds.right > area.right + FIT_TOLERANCE || bounds.left < area.left - FIT_TOLERANCE)) {
                throw new RangeError('BookJS: Unsplittable content exceeds the page width (' + element.tagName + ')');
            }
            return page;
        }

        addPendant(element) {
            // 只添加到当前页面，而不是所有页面
            const currentPage = this.getCurrentPage();
            currentPage.pendantsCleared = false;

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
            const pendantKey = element.getAttribute('data-pendant-key') || element.getAttribute('data-pendant-name');
            
            const existingIndex = currentPage.pendants.findIndex(p => {
                // 1. 如果有显式 key，优先匹配 key
                const pKey = p.element.getAttribute('data-pendant-key') || p.element.getAttribute('data-pendant-name');
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

            // 替换页码占位符；${TOTAL_PAGE} 需等全部分页完成后由 finalizePendantPlaceholders 统一替换
            const pageNum = this.pages.indexOf(currentPage) + 1; // 页码从1开始显示
            pendant.innerHTML = pendant.innerHTML.replace(/\$\{PAGE\}/g, pageNum);

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
                
                .nop-page-content {
                    box-sizing: border-box;
                    display: flow-root;
                }

                .nop-book [data-op-type="text-box"],
                .nop-book .nop-text-box {
                    white-space: pre-line;
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
            this.fitTolerance = FIT_TOLERANCE;

            // 调试日志门控（与 BookJS.log 行为保持一致）
            this.log = (...args) => {
                const enabled = (this.config && this.config.debug) || (typeof window !== 'undefined' && window.bookConfig && window.bookConfig.debug);
                if (enabled) console.log(...args);
            };
        }

        processContent(contentBox) {
            this.log('开始处理内容，配置:', this.config);
            if (!contentBox) {
                console.error('Content box not found');
                return;
            }

            // 隐藏原始内容
            if (contentBox.style.display !== 'none') contentBox.style.display = 'none';

            // 处理所有子元素
            Array.from(contentBox.children).forEach(child => {
                this.processElement(child);
            });

            // 全部分页完成后，回填挂件中的总页数占位符
            this.finalizePendantPlaceholders();

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
                            const previewRows = Array.from(tempBody.children).slice(0, 2).map(row => row.cloneNode(true));
                            tempBody.innerHTML = '';
                            previewRows.forEach(row => tempBody.appendChild(row));
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

                    const required = hHeight + Math.min(nextHeight, this.pageManager.contentHeight - hHeight);
                    if (this.pageManager.getCurrentPage().currentHeight > 0 &&
                        required > this.pageManager.getAvailableHeight()) {
                        this.pageManager.createNewPage();
                    }
                }
            }

            const opType = this.getElementOpType(element);

            switch (opType) {
                case 'block':
                    this.processBlock(element);
                    break;
                case 'text':
                    this.processText(element);
                    break;
                case 'text-box':
                case 'block-box':
                case 'mix-box':
                    this.fragmentElement(element, opType === 'text-box' ? 'text' : opType === 'block-box' ? 'blocks' : 'mix', '.nop-fill-box');
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

        wrapContent(element) {
            return (this._wrappers || []).reduceRight((child, wrap) => wrap(child), element);
        }

        addContent(element) {
            return this.pageManager.addContent(this.wrapContent(element));
        }

        processNestedTable(fragment) {
            const table = fragment.querySelector('table');
            if (!table) return false;
            const slot = document.createComment('table');
            table.replaceWith(slot);
            const path = [];
            for (let node = slot; node !== fragment; node = node.parentNode) {
                path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
            }
            this._wrappers ||= [];
            this._wrappers.push(child => {
                const wrapper = fragment.cloneNode(true);
                let target = wrapper;
                for (const index of path) target = target.childNodes[index];
                target.replaceWith(child);
                return wrapper;
            });
            try {
                this.processTable(table);
            } finally {
                this._wrappers.pop();
            }
            return true;
        }

        canFitHeight(height, availableHeight = this.pageManager.getAvailableHeight()) {
            return height <= availableHeight + this.fitTolerance;
        }

        processBlock(element) {
            const cloned = element.cloneNode(true);
            const height = this.getElementHeight(cloned);
            const maxPageContentHeight = this.pageManager.pageHeight - this.pageManager.padding.top - this.pageManager.padding.bottom;

            // 超过单页高度的块级元素，按子节点拆分分页，避免整体塞入一页被裁切
            if (height > maxPageContentHeight) {
                const splitSuccess = this.processOversizedBlock(element);
                if (splitSuccess) return;
            }

            const page = this.addContent(cloned, height);

            const bgEl = element.querySelector('[data-op-type="bg-image"]');
            if (bgEl) {
                const src = bgEl.getAttribute('img-src') || bgEl.getAttribute('src') || '';
                if (src && page && page.element) {
                    page.element.style.background = `url('${src}') center/contain no-repeat #fff`;
                    page.element.classList.add('nop-page-item-has-bg');
                }
            }
        }

        getElementOpType(element) {
            if (!element) return 'block';
            const explicit = element.getAttribute('data-op-type');
            if (explicit) return explicit;
            if (element.tagName === 'TABLE') return 'table';
            if (element.classList.contains('nop-text-box')) return 'text-box';
            if (element.classList.contains('nop-block-box')) return 'block-box';
            if (element.classList.contains('nop-new-page')) return 'new-page';
            return 'block';
        }

        processOversizedBlock(element) {
            if (!element.childNodes.length || /^(IMG|SVG|CANVAS|VIDEO|IFRAME)$/.test(element.tagName)) return false;
            this.fragmentElement(element, 'mix');
            return true;
        }

        processText(element) {
            this.fragmentElement(element, 'text');
        }

        // Range 克隆保留内联结构；只在页边界拆分，不再逐字插入 span 或逐行复制整段。
        getBreakPoints(root, mode = 'text') {
            const points = [{ node: root, offset: 0 }];
            const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
                ? (this._segmenter || (this._segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })))
                : null;
            const afterNode = node => {
                const parent = node.parentNode;
                return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) + 1 };
            };
            const add = point => {
                if (point.node.nodeType === Node.TEXT_NODE && point.offset === point.node.length) {
                    point = afterNode(point.node);
                }
                while (point.node !== root && point.node.nodeType !== Node.TEXT_NODE && point.offset === point.node.childNodes.length) {
                    point = afterNode(point.node);
                }
                const previous = points[points.length - 1];
                if (point.node !== previous.node || point.offset !== previous.offset) points.push(point);
            };
            const visit = node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.nodeValue;
                    let offset = 0;
                    const segments = segmenter ? segmenter.segment(text) : Array.from(text, segment => ({ segment }));
                    for (const item of segments) {
                        offset += item.segment.length;
                        add({ node, offset });
                    }
                    return;
                }
                if (node.nodeType !== Node.ELEMENT_NODE) {
                    add(afterNode(node));
                    return;
                }
                const atomic = /^(BR|HR|IMG|SVG|CANVAS|VIDEO|AUDIO|IFRAME|INPUT|TABLE)$/.test(node.tagName);
                const inline = /^(A|B|I|U|S|EM|STRONG|SPAN|SMALL|SUB|SUP|CODE|MARK|ABBR|RUBY|RT)$/.test(node.tagName);
                const explicit = node.getAttribute('data-op-type');
                if (atomic || !node.childNodes.length || mode === 'blocks' ||
                    (mode === 'mix' && !inline && !['text', 'text-box', 'mix-box'].includes(explicit))) {
                    add(afterNode(node));
                } else {
                    Array.from(node.childNodes).forEach(visit);
                }
            };
            Array.from(root.childNodes).forEach(visit);
            add({ node: root, offset: root.childNodes.length });
            return points;
        }

        createFragmenter(element, mode = 'text', fillSelector) {
            const template = element.cloneNode(true);
            const target = (fillSelector && template.querySelector(fillSelector)) || template;
            const source = target.cloneNode(true);
            target.replaceChildren();
            const fragmenter = {
                source,
                points: this.getBreakPoints(source, mode),
                make: (from, to) => {
                    const range = document.createRange();
                    const start = fragmenter.points[from];
                    const end = fragmenter.points[to];
                    range.setStart(start.node, start.offset);
                    range.setEnd(end.node, end.offset);
                    const clone = template.cloneNode(true);
                    const fill = (fillSelector && clone.querySelector(fillSelector)) || clone;
                    fill.appendChild(range.cloneContents());
                    return clone;
                }
            };
            return fragmenter;
        }

        findFittingPoint(fragmenter, start, fits) {
            let low = start;
            let high = fragmenter.points.length - 1;
            while (low < high) {
                const middle = Math.ceil((low + high) / 2);
                if (fits(fragmenter.make(start, middle))) low = middle;
                else high = middle - 1;
            }
            // 能留到下一页的英文单词保持完整；单个超长词仍允许按字素前进。
            let boundary = low;
            while (boundary > start) {
                const point = fragmenter.points[boundary];
                if (point.node.nodeType !== Node.TEXT_NODE ||
                    !/[A-Za-z0-9]/.test(point.node.data[point.offset - 1] || '') ||
                    !/[A-Za-z0-9]/.test(point.node.data[point.offset] || '')) break;
                boundary--;
            }
            if (boundary > start && boundary < low) {
                const range = document.createRange();
                const first = fragmenter.points[start];
                const last = fragmenter.points[boundary];
                range.setStart(first.node, first.offset);
                range.setEnd(last.node, last.offset);
                // 前导空白不算一个可独立分页的词；超长单词/数字仍必须向前推进。
                if (!range.toString().trim()) return low;
            }
            return boundary > start ? boundary : low;
        }

        refineBreakPoint(fragmenter, start) {
            const fine = this.getBreakPoints(fragmenter.source, 'text');
            const same = (a, b) => a.node === b.node && a.offset === b.offset;
            const begin = fine.findIndex(point => same(point, fragmenter.points[start]));
            const end = fine.findIndex(point => same(point, fragmenter.points[start + 1]));
            if (begin < 0 || end - begin <= 1) return false;
            fragmenter.points.splice(start + 1, 1, ...fine.slice(begin + 1, end + 1));
            return true;
        }

        fragmentElement(element, mode = 'text', fillSelector) {
            const fragmenter = this.createFragmenter(element, mode, fillSelector);
            let start = 0;
            if (fragmenter.points.length === 1) {
                this.addContent(element.cloneNode(true));
                return;
            }
            while (start < fragmenter.points.length - 1) {
                const available = this.pageManager.getAvailableHeight();
                const fits = clone => this.canFitHeight(this.getElementHeight(clone), available);
                const remaining = fragmenter.make(start, fragmenter.points.length - 1);
                let end = fits(remaining) ? fragmenter.points.length - 1 : this.findFittingPoint(fragmenter, start, fits);
                if (end === start) {
                    if (this.pageManager.getCurrentPage().currentHeight > 0) {
                        this.pageManager.createNewPage();
                        continue;
                    }
                    if (mode !== 'text' && this.refineBreakPoint(fragmenter, start)) continue;
                    if (this.processNestedTable(fragmenter.make(start, start + 1))) {
                        start++;
                        continue;
                    }
                    throw new RangeError('BookJS: Cannot fit content or its repeated shell on an empty page (' + element.tagName + ')');
                }
                this.addContent(fragmenter.make(start, end));
                start = end;
                if (start < fragmenter.points.length - 1) this.pageManager.createNewPage();
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

                page.element.style.background = `url('${src}') center/contain no-repeat #fff`;
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
            const template = element.cloneNode(true);
            const tableOf = root => root.tagName === 'TABLE' ? root : root.querySelector('table');
            const templateTable = tableOf(template);
            if (!templateTable || !templateTable.tBodies.length) {
                this.processBlock(element);
                return;
            }

            this.fixTableColumnWidths(template, templateTable);
            const queue = [];
            Array.from(templateTable.tBodies).forEach((body, section) => {
                const rows = Array.from(body.rows);
                rows.forEach((row, index) => Array.from(row.cells).forEach(cell => {
                    cell.rowSpan = cell.rowSpan === 0 ? rows.length - index : Math.min(cell.rowSpan, rows.length - index);
                }));
                for (let start = 0; start < rows.length;) {
                    let end = start;
                    for (let row = start; row <= end; row++) {
                        for (const cell of rows[row].cells) end = Math.max(end, row + cell.rowSpan - 1);
                    }
                    queue.push({ rows: rows.slice(start, end + 1), section });
                    start = end + 1;
                }
            });
            if (!queue.length) {
                this.addContent(template);
                return;
            }

            const newTable = () => {
                const root = template.cloneNode(true);
                const table = tableOf(root);
                Array.from(table.tBodies).forEach(body => body.replaceChildren());
                return { root, table };
            };
            let current = newTable();
            const hasRows = () => Array.from(current.table.tBodies).some(body => body.rows.length);
            const measure = () => {
                const copy = current.root.cloneNode(true);
                Array.from(tableOf(copy).tBodies).forEach(body => this.normalizeRowspansForMeasurement(body));
                return this.getElementHeight(copy);
            };
            const flush = () => {
                if (hasRows()) this.addContent(current.root);
            };
            const nextPage = () => {
                flush();
                this.pageManager.createNewPage();
                current = newTable();
            };
            const splitStrategy = element.getAttribute('data-split-strategy') || 'auto';

            while (queue.length) {
                const group = queue.shift();
                const rows = group.rows;
                let body = current.table.tBodies[group.section];
                const previousRows = body.rows.length;
                const hasPreviousContent = hasRows() || this.pageManager.getCurrentPage().currentHeight > 0;
                const keepTogether = splitStrategy !== 'precise' &&
                    rows.some(row => row.classList.contains('no-split')) &&
                    !rows.some(row => Array.from(row.cells).some(cell => cell.getAttribute('data-split-repeat') === 'true'));

                if (keepTogether && hasPreviousContent) {
                    const probe = newTable();
                    rows.forEach(row => probe.table.tBodies[group.section].appendChild(row.cloneNode(true)));
                    const height = this.getElementHeight(probe.root);
                    rows.forEach(row => body.appendChild(row.cloneNode(true)));
                    const combinedHeight = measure();
                    while (body.rows.length > previousRows) body.lastElementChild.remove();
                    if (height <= this.pageManager.contentHeight + this.fitTolerance &&
                        combinedHeight > this.pageManager.getAvailableHeight() + this.fitTolerance) {
                        nextPage();
                        queue.unshift(group);
                        continue;
                    }
                }

                let count = 0;
                for (const row of rows) {
                    body.appendChild(row.cloneNode(true));
                    if (!this.canFitHeight(measure())) {
                        body.lastElementChild.remove();
                        break;
                    }
                    count++;
                }
                if (count === rows.length) continue;

                if (count === 0) {
                    if (hasPreviousContent) {
                        const probe = newTable();
                        const probeBody = probe.table.tBodies[group.section];
                        probeBody.appendChild(rows[0].cloneNode(true));
                        this.normalizeRowspansForMeasurement(probeBody);
                        const previousElement = this.pageManager.getCurrentPage().content.lastElementChild;
                        const followsHeading = !hasRows() && /^H[1-6]$/.test(previousElement?.tagName || '');
                        if (!followsHeading && this.getElementHeight(probe.root) <= this.pageManager.contentHeight + this.fitTolerance) {
                            nextPage();
                            queue.unshift(group);
                            continue;
                        }
                    }
                    // 超高行直接利用当前页剩余空间，避免把前面的标题单独留在一页。
                    const head = rows[0].cloneNode(true);
                    const tail = rows[0].cloneNode(true);
                    Array.from(head.cells).forEach(cell => {
                        cell.rowSpan = 1;
                        cell.replaceChildren();
                    });
                    body.appendChild(head);
                    const originals = Array.from(rows[0].cells);
                    const repeat = cell => cell.getAttribute('data-split-repeat') === 'true';
                    originals.forEach((cell, index) => {
                        if (repeat(cell)) head.cells[index].replaceChildren(...Array.from(cell.cloneNode(true).childNodes));
                    });
                    if (!this.canFitHeight(measure())) {
                        head.remove();
                        if (hasPreviousContent) {
                            nextPage();
                            queue.unshift(group);
                            continue;
                        }
                        throw new RangeError('BookJS: Table header, row height or repeated cell exceeds the page height');
                    }
                    let progressed = false;
                    let remaining = false;
                    originals.forEach((cell, index) => {
                        if (repeat(cell)) return;
                        const fragmenter = this.createFragmenter(cell);
                        const end = fragmenter.points.length - 1;
                        const fits = fragment => {
                            head.cells[index].replaceChildren(...Array.from(fragment.childNodes));
                            return this.canFitHeight(measure());
                        };
                        const split = fits(fragmenter.make(0, end)) ? end : this.findFittingPoint(fragmenter, 0, fits);
                        head.cells[index].replaceChildren(...Array.from(fragmenter.make(0, split).childNodes));
                        tail.cells[index].replaceChildren(...Array.from(fragmenter.make(split, end).childNodes));
                        progressed = progressed || (split > 0 && !!(head.cells[index].textContent.trim() || head.cells[index].querySelector('img,svg,canvas')));
                        remaining = remaining || split < end;
                    });
                    if (!progressed || !remaining) {
                        head.remove();
                        if (hasPreviousContent) {
                            nextPage();
                            queue.unshift(group);
                            continue;
                        }
                        throw new RangeError('BookJS: Table cell contains an unsplittable element taller than a page');
                    }
                    rows[0] = tail;
                    nextPage();
                    queue.unshift(group);
                    continue;
                }

                const grid = this.buildGrid(rows);
                for (let row = 0; row < count; row++) {
                    for (const info of grid[row]) {
                        if (!info?.isOrigin || info.originRow + info.rowspan <= count) continue;
                        // DOM 单元格下标和逻辑列下标不同：前序行的 rowspan 会占据逻辑列。
                        body.rows[previousRows + info.originRow].cells[info.cellIndex].rowSpan = count - info.originRow;
                    }
                }

                const rest = rows.slice(count);
                const cells = [];
                for (let column = 0; column < grid[count].length;) {
                    const info = grid[count][column];
                    if (!info) { column++; continue; }
                    if (info.originRow < count) {
                        const continuation = info.cell.cloneNode(info.cell.getAttribute('data-split-repeat') === 'true');
                        continuation.rowSpan = info.originRow + info.rowspan - count;
                        cells.push(continuation);
                    } else {
                        cells.push(info.cell);
                    }
                    column += info.colspan;
                }
                rest[0].replaceChildren(...cells);
                nextPage();
                queue.unshift({ rows: rest, section: group.section });
            }
            flush();
        }

        fixTableColumnWidths(root, table) {
            const box = this.getMeasureBox();
            const measured = this.wrapContent(root);
            box.appendChild(measured);
            try {
                const rect = table.getBoundingClientRect();
                if (!rect.width) return;
                if (!Array.from(table.children).some(child => child.tagName === 'COLGROUP')) {
                    const edges = [];
                    for (const section of [table.tHead, ...table.tBodies, table.tFoot].filter(Boolean)) {
                        for (const row of this.buildGrid(Array.from(section.rows))) {
                            for (const info of row) {
                                if (!info?.isOrigin) continue;
                                const cell = info.cell.getBoundingClientRect();
                                edges[info.originCol] = cell.left - rect.left;
                                edges[info.originCol + info.colspan] = cell.right - rect.left;
                            }
                        }
                    }
                    if (edges.length > 1) {
                        const tableStyle = getComputedStyle(table);
                        const spacing = tableStyle.borderCollapse === 'separate'
                            ? parseFloat(tableStyle.borderSpacing) || 0 : 0;
                        for (let start = 0; start < edges.length - 1;) {
                            let end = start + 1;
                            while (edges[end] === undefined) end++;
                            const step = (edges[end] - edges[start]) / (end - start);
                            for (let index = start + 1; index < end; index++) edges[index] = edges[start] + step * (index - start);
                            start = end;
                        }
                        const columns = document.createElement('colgroup');
                        for (let index = 1; index < edges.length; index++) {
                            const col = document.createElement('col');
                            const gap = index < edges.length - 1 ? spacing : 0;
                            col.style.width = Math.max(0, edges[index] - edges[index - 1] - gap) + 'px';
                            columns.appendChild(col);
                        }
                        table.insertBefore(columns, Array.from(table.children).find(child => child.tagName !== 'CAPTION') || null);
                    }
                }
                table.style.width = rect.width + 'px';
                table.style.tableLayout = 'fixed';
            } finally {
                measured.remove();
                root.remove();
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
                    const rowspan = cell.rowSpan === 0 ? rows.length - r : Math.min(cell.rowSpan || 1, rows.length - r);
                    const colspan = cell.colSpan || 1;
                    
                    for (let i = 0; i < rowspan; i++) {
                        for (let j = 0; j < colspan; j++) {
                            if (r + i < rows.length) {
                                if (!grid[r + i]) grid[r + i] = [];
                                grid[r + i][c + j] = {
                                    cell: cell,
                                    originRow: r,
                                    originCol: c,
                                    cellIndex: cellIndex,
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

        normalizeRowspansForMeasurement(tbody) {
            const rows = Array.from(tbody.children);
            if (rows.length === 0) return;

            const grid = this.buildGrid(rows);
            const handledCells = new Set();

            for (let r = 0; r < grid.length; r++) {
                for (let c = 0; c < grid[r].length; c++) {
                    const cellInfo = grid[r][c];
                    if (!cellInfo || !cellInfo.isOrigin || handledCells.has(cellInfo.cell)) continue;

                    handledCells.add(cellInfo.cell);
                    const availableRows = rows.length - cellInfo.originRow;
                    const normalizedRowspan = Math.min(cellInfo.rowspan, availableRows);

                    if (normalizedRowspan > 0 && normalizedRowspan !== cellInfo.rowspan) {
                        cellInfo.cell.setAttribute('rowspan', normalizedRowspan);
                    }
                }
            }
        }

        // 辅助方法
        getMeasureBox() {
            const page = this.pageManager.getCurrentPage();
            if (!this._measureBox) {
                const box = document.createElement('div');
                box.className = 'nop-page-content nop-measure-box';
                box.setAttribute('aria-hidden', 'true');
                box.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-100000px!important;' +
                    'top:0!important;bottom:auto!important;right:auto!important;height:auto!important;' +
                    'width:' + this.getMaxLineWidth() + 'px!important;display:flow-root;overflow:visible;contain:layout;';
                this._measureBox = box;
            }
            if (this._measureBox.parentNode !== page.element) page.element.appendChild(this._measureBox);
            return this._measureBox;
        }

        getElementHeight(element) {
            const box = this.getMeasureBox();
            const measured = this.wrapContent(element);
            box.appendChild(measured);
            try {
                const style = getComputedStyle(measured);
                const rect = measured.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(measured);
                const contents = range.getBoundingClientRect();
                const height = Math.max(rect.height, contents.bottom - rect.top);
                return height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
            } finally {
                measured.remove();
                element.remove();
            }
        }

        getMaxLineWidth() {
            return this.pageManager.pageWidth - this.pageManager.padding.left - this.pageManager.padding.right;
        }

        cleanup() {
            if (this._measureBox) this._measureBox.remove();
            this._measureBox = null;
        }

        // 分页结束后统一替换用户挂件中的 ${TOTAL_PAGE}，避免使用创建页面时的临时页数
        finalizePendantPlaceholders() {
            const totalPages = this.pageManager.pages.length;
            this.pageManager.pages.forEach(page => {
                const pendants = page.element.querySelectorAll('.nop-page-pendants:not(.pendant-pageNumSimple)');
                pendants.forEach(pendant => {
                    if (pendant.innerHTML.indexOf('${TOTAL_PAGE}') !== -1) {
                        pendant.innerHTML = pendant.innerHTML.replace(/\$\{TOTAL_PAGE\}/g, totalPages);
                    }
                });
            });
        }

        addPageNumbers() {
            this.log('开始添加页码，配置:', this.config.simplePageNum);
            const config = this.config.simplePageNum;
            if (!config || !config.enable) {
                this.log('页码配置未启用或不存在');
                return;
            }

            this.log('页面数量:', this.pageManager.pages.length);
            const startPage = Math.max(0, typeof config.pageBegin === 'number' ? config.pageBegin - 1 : 0);
            const endPage = config.pageEnd === -1 ? this.pageManager.pages.length - 1 : config.pageEnd - 1;
            const lastIndex = Math.min(endPage, this.pageManager.pages.length - 1);

            const totalNumberedPages = Math.max(0, lastIndex - startPage + 1);
            let pageNumCounter = 1;
            for (let i = startPage; i <= lastIndex; i++) {
                const page = this.pageManager.pages[i];

                // 清除已存在的页脚
                const existingFooters = page.element.querySelectorAll('.pendant-pageNumSimple');
                existingFooters.forEach(footer => footer.remove());

                const currentPageNum = pageNumCounter;
                const totalPages = totalNumberedPages;

                const pendant = document.createElement('div');

                // 模板替换，仅支持变量占位
                let pendantHTML = typeof config.pendant === 'function'
                    ? config.pendant({ PAGE: currentPageNum, TOTAL_PAGE: totalPages })
                    : config.pendant || DEFAULT_CONFIG.simplePageNum.pendant;
                pendantHTML = String(pendantHTML);
                pendantHTML = pendantHTML.replace(/\$\{PAGE\}/g, currentPageNum);
                pendantHTML = pendantHTML.replace(/\$\{TOTAL_PAGE\}/g, totalPages);

                pendant.innerHTML = pendantHTML;
                pendant.className = 'nop-page-pendants pendant-pageNumSimple';

                // 若未指定 page-num-simple 类，添加默认样式
                if (!pendantHTML.includes('page-num-simple')) {
                    pendant.style.cssText = `
                        position: absolute;
                        bottom: 28px;
                        left: 0;
                        right: 0;
                    `;
                }

                // 直接追加到页面元素，无需依赖 header
                page.element.appendChild(pendant);

                // 在配置范围内连续编号
                pageNumCounter++;
            }
            this.log('页码添加完成');
        }

    }

    // 主类
    class BookJS {
        constructor(config = {}) {
            this._configSource = config;
            this._usesGlobalConfig = typeof window !== 'undefined' && config === window.bookConfig;
            this.config = Utils.normalizeConfig(config);
            this.pageManager = null;
            this.contentProcessor = null;
            this.isRendered = false;
            this._stopped = false;
            this._renderPromise = null;
            this.log = (...args) => {
                if (this.config.debug) console.log(...args);
            };
            this.init();
        }

        getConfig() {
            const source = this._usesGlobalConfig ? window.bookConfig : this._configSource;
            return Utils.normalizeConfig(Utils.mergeConfig(this.config, source));
        }

        getContentBox(config = this.getConfig()) {
            return typeof config.contentBox === 'string' ? document.querySelector(config.contentBox) : config.contentBox;
        }

        init() {
            this._onReady = () => {
                if (this._stopped) return;
                this.setupDOMObserver();
                this.watchConfig();
                this.checkStart();
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', this._onReady, { once: true });
            } else {
                queueMicrotask(this._onReady);
            }
        }

        checkStart() {
            if (this._stopped || this._hasFailed || this.isRendered || this._renderPromise) return;
            if (this._requestedStart || this.getConfig().start) {
                this.render().catch(error => this.log('BookJS: Auto render failed', error));
            }
        }

        watchConfig() {
            if (this._renderCheckInterval || this._stopped || this.isRendered) return;
            this._renderCheckInterval = setInterval(() => {
                this.setupDOMObserver();
                this.checkStart();
            }, 300);
        }

        render(force = false) {
            if (this._renderPromise) {
                if (force) this._rerenderRequested = true;
                return this._renderPromise;
            }
            if (this.isRendered && !force) return Promise.resolve(this);
            this._stopped = false;
            this._requestedStart = true;
            this._hasFailed = false;
            this._renderPromise = Promise.resolve().then(() => this.performRender()).finally(() => {
                this._renderPromise = null;
                if (this._rerenderRequested && !this._stopped) {
                    this._rerenderRequested = false;
                    return this.render(true);
                }
            });
            return this._renderPromise;
        }

        async performRender() {
            if (this._stopped) throw new DOMException('Render cancelled', 'AbortError');
            let signal;
            try {
                this.config = this.getConfig();
                const source = this.getContentBox(this.config);
                if (!source || source.children.length === 0) {
                    this.isRendered = false;
                    window.status = '';
                    this.contentProcessor?.cleanup();
                    this.pageManager?.bookContainer.remove();
                    this.contentProcessor = null;
                    this.pageManager = null;
                    this.setupDOMObserver();
                    this.watchConfig();
                    return this;
                }
                this.isRendered = false;
                window.status = '';
                this._renderAbort = new AbortController();
                signal = this._renderAbort.signal;
                this._domObserver?.disconnect();
                source.style.display = 'none';
                this._observedSource = null;
                this.setupDOMObserver();
                this.contentProcessor?.cleanup();
                this.pageManager = new PageManager(this.config);
                this.contentProcessor = new ContentProcessor(this.pageManager, this.config);
                document.dispatchEvent(new CustomEvent('book.before-render'));

                await this.waitForResources(source, signal);
                if (signal.aborted) throw new DOMException('Render cancelled', 'AbortError');
                this.contentProcessor.processContent(source);
                this.contentProcessor.cleanup();
                this.addPrintStyles();
                this.isRendered = true;
                this._requestedStart = false;
                clearInterval(this._renderCheckInterval);
                this._renderCheckInterval = null;
                this.triggerCompleteEvent();
                await this.waitForDelay(Math.max(0, Number(this.config.printDelay) || 0), signal);
                if (!this._rerenderRequested) window.status = 'PDFComplete';
                return this;
            } catch (error) {
                this.isRendered = false;
                this._hasFailed = true;
                this._requestedStart = false;
                window.status = '';
                this.contentProcessor?.cleanup();
                this.pageManager?.bookContainer.remove();
                clearInterval(this._renderCheckInterval);
                this._renderCheckInterval = null;
                if (!signal?.aborted) {
                    document.dispatchEvent(new CustomEvent('book.abort', { detail: { error, message: error.message } }));
                    if (typeof this.config.errorCallback === 'function') this.config.errorCallback(error);
                }
                throw error;
            } finally {
                this._renderAbort = null;
            }
        }

        async waitForResources(source, signal) {
            const box = this.contentProcessor.getMeasureBox();
            for (const child of source.children) box.appendChild(child.cloneNode(true));
            const cleanups = [];
            try {
                const images = Array.from(box.querySelectorAll('img')).filter(img => img.currentSrc || img.getAttribute('src') || img.getAttribute('srcset'));
                const tasks = images.map(img => {
                    img.loading = 'eager';
                    const check = () => {
                        if (!img.naturalWidth) throw new Error('BookJS: Image failed to load');
                    };
                    if (img.complete) return Promise.resolve().then(check);
                    return new Promise((resolve, reject) => {
                        const loaded = () => resolve();
                        const failed = () => reject(new Error('BookJS: Image failed to load'));
                        img.addEventListener('load', loaded, { once: true });
                        img.addEventListener('error', failed, { once: true });
                        cleanups.push(() => {
                            img.removeEventListener('load', loaded);
                            img.removeEventListener('error', failed);
                        });
                    });
                });
                // 强制排版隐藏的副本，使本次内容实际使用的字体开始加载。
                box.getBoundingClientRect();
                if (document.fonts) tasks.push(document.fonts.ready);
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('BookJS: Timed out waiting for images or fonts')),
                        Math.max(1, Number(this.config.resourceTimeout) || 10000));
                    const aborted = () => reject(new DOMException('Render cancelled', 'AbortError'));
                    signal.addEventListener('abort', aborted, { once: true });
                    cleanups.push(() => {
                        clearTimeout(timeout);
                        signal.removeEventListener('abort', aborted);
                    });
                    if (signal.aborted) aborted();
                    else Promise.all(tasks).then(resolve, reject);
                });
            } finally {
                cleanups.forEach(cleanup => cleanup());
                box.replaceChildren();
            }
        }

        waitForDelay(delay, signal) {
            return new Promise((resolve, reject) => {
                const finish = () => {
                    signal.removeEventListener('abort', aborted);
                    resolve();
                };
                const timer = setTimeout(finish, delay);
                const aborted = () => {
                    clearTimeout(timer);
                    reject(new DOMException('Render cancelled', 'AbortError'));
                };
                if (signal.aborted) aborted();
                else signal.addEventListener('abort', aborted, { once: true });
            });
        }

        setupDOMObserver() {
            if (this._stopped || typeof MutationObserver === 'undefined') return;
            const source = this.getContentBox();
            if (this._domObserver && this._observedSource === source) return;
            this._domObserver?.disconnect();
            this._observedSource = source;
            if (source && !this.getConfig().observeContent) return;
            this._domObserver = new MutationObserver(() => {
                if (this._stopped) return;
                clearTimeout(this._observerTimeout);
                this._observerTimeout = setTimeout(() => {
                    this._observerTimeout = null;
                    if (this._stopped) return;
                    this.setupDOMObserver();
                    if (this.isRendered || this._renderPromise) {
                        this.render(true).catch(error => this.log('BookJS: Rerender failed', error));
                    } else {
                        this._hasFailed = false;
                        this.checkStart();
                    }
                }, 100);
            });
            this._domObserver.observe(source || document.documentElement, {
                childList: true, subtree: true,
                attributes: !!source, characterData: !!source
            });
        }

        cleanup() {
            this._stopped = true;
            this._rerenderRequested = false;
            this._domObserver?.disconnect();
            this._domObserver = null;
            this._observedSource = null;
            clearTimeout(this._observerTimeout);
            this._observerTimeout = null;
            clearInterval(this._renderCheckInterval);
            this._renderCheckInterval = null;
            document.removeEventListener('DOMContentLoaded', this._onReady);
            this._renderAbort?.abort();
            this.contentProcessor?.cleanup();
        }

        forceRender() {
            return this.render(true);
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
            const cssPageWidth = this.pageManager.cssPageWidth;
            const cssPageHeight = this.pageManager.cssPageHeight;
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
            document.dispatchEvent(new CustomEvent('book.before-complete', { detail: info }));
            document.dispatchEvent(new CustomEvent('book.after-complete', { detail: info }));
        }

        static create(config = {}) {
            BookJS.instance?.cleanup();
            BookJS.instance = new BookJS(config);
            return BookJS.instance;
        }

        static start() {
            if (!BookJS.instance) BookJS.create(window.bookConfig || {});
            if (window.bookConfig && BookJS.instance._usesGlobalConfig) window.bookConfig.start = true;
            return BookJS.instance.render();
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
                bookInstance = BookJS.instance || BookJS.create(window.bookConfig);
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
