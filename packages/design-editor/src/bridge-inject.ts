/**
 * Sandbox-safe Inspect/Layers bridge inject for Preview iframe (Task 1c).
 * Embedded via srcDoc — parent cannot touch contentDocument without allow-same-origin.
 */

import { NEOS_BRIDGE_SOURCE } from './bridge-types.js';

/**
 * Minimal bridge runtime injected into preview HTML.
 * Speaks BridgeInboundMessage / BridgeOutboundCommand over postMessage.
 */
export function buildBridgeInjectScript(): string {
  // Keep self-contained; no imports inside iframe.
  return `(function(){
  if (window.__neosBridge) return;
  var SRC = ${JSON.stringify(NEOS_BRIDGE_SOURCE)};
  var inspectOn = false;
  var hoverEl = null;
  /** Multi-select list; last element is primary (v0.7 M3). */
  var selectEls = [];
  var HL = 'neos-inspect-hl';
  var SEL = 'neos-inspect-sel';
  var SEL_MULTI = 'neos-inspect-sel-multi';
  var style = document.createElement('style');
  style.textContent =
    '.' + HL + '{outline:2px dashed #818cf8!important;outline-offset:1px}' +
    '.' + SEL + '{outline:2px solid #6366f1!important;outline-offset:1px}' +
    '.' + SEL_MULTI + '{outline:2px solid #a5b4fc!important;outline-offset:1px;outline-style:dashed!important}';
  (document.head || document.documentElement).appendChild(style);

  function post(msg) {
    try {
      parent.postMessage(Object.assign({ source: SRC }, msg), '*');
    } catch (e) {}
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) {
      var id = el.id;
      if (/^[A-Za-z][\\w\\-:.]*$/.test(id)) return '#' + id;
    }
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && depth < 12) {
      var tag = (cur.tagName || '').toLowerCase();
      if (!tag || tag === 'html') break;
      var parent = cur.parentElement;
      if (parent) {
        var siblings = parent.children;
        var same = 0;
        var idx = 0;
        for (var i = 0; i < siblings.length; i++) {
          if ((siblings[i].tagName || '').toLowerCase() === tag) {
            same++;
            if (siblings[i] === cur) idx = same;
          }
        }
        parts.unshift(same > 1 ? tag + ':nth-of-type(' + idx + ')' : tag);
      } else {
        parts.unshift(tag);
      }
      if (cur.id && /^[A-Za-z][\\w\\-:.]*$/.test(cur.id)) {
        parts[0] = '#' + cur.id;
        break;
      }
      cur = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  function displayName(el) {
    var tag = (el.tagName || '').toLowerCase();
    var bits = [tag];
    if (el.id) bits.push('#' + String(el.id).slice(0, 40));
    if (el.classList && el.classList.length) {
      var cls = Array.prototype.slice.call(el.classList, 0, 2).join('.');
      if (cls) bits.push('.' + cls.slice(0, 48));
    }
    var label = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('data-neos-name'));
    if (label) bits.push('"' + String(label).slice(0, 24) + '"');
    else {
      var t = (el.textContent || '').trim().replace(/\\s+/g, ' ');
      if (t && t.length < 32 && el.children.length === 0) bits.push('"' + t.slice(0, 24) + '"');
    }
    return bits.join(' ');
  }

  function isLocked(el) {
    return !!(el.getAttribute && (
      el.getAttribute('data-neos-locked') === 'true' ||
      el.getAttribute('data-neos-locked') === ''
    ));
  }

  function isVisible(el) {
    if (el.hasAttribute && el.hasAttribute('hidden')) return false;
    if (el.getAttribute && el.getAttribute('data-neos-hidden') === 'true') return false;
    var st = window.getComputedStyle ? getComputedStyle(el) : null;
    if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
    return true;
  }

  var idSeq = 0;
  function nodeId(el) {
    if (el.getAttribute) {
      var existing = el.getAttribute('data-neos-id');
      if (existing) return existing;
    }
    idSeq++;
    var id = 'n' + idSeq;
    try { el.setAttribute('data-neos-id', id); } catch (e) {}
    return id;
  }

  function walk(el, depth) {
    if (!el || el.nodeType !== 1) return null;
    var tag = (el.tagName || '').toLowerCase();
    if (!tag || tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'link' || tag === 'meta') {
      return null;
    }
    var children = [];
    for (var i = 0; i < el.children.length; i++) {
      var c = walk(el.children[i], depth + 1);
      if (c) children.push(c);
    }
    return {
      id: nodeId(el),
      tag: tag,
      name: displayName(el),
      selector: cssPath(el),
      depth: depth,
      visible: isVisible(el),
      locked: isLocked(el),
      children: children
    };
  }

  function snapshot() {
    var root = document.body || document.documentElement;
    var tree = [];
    if (root) {
      var n = walk(root, 0);
      if (n) tree = [n];
    }
    post({ type: 'neos.dom-snapshot', tree: tree });
  }

  function clearHover() {
    if (hoverEl) {
      hoverEl.classList.remove(HL);
      hoverEl = null;
    }
  }

  function clearSelect() {
    for (var i = 0; i < selectEls.length; i++) {
      try {
        selectEls[i].classList.remove(SEL);
        selectEls[i].classList.remove(SEL_MULTI);
      } catch (e) {}
    }
    selectEls = [];
  }

  function restyleSelects() {
    for (var i = 0; i < selectEls.length; i++) {
      try {
        selectEls[i].classList.remove(SEL);
        selectEls[i].classList.remove(SEL_MULTI);
        if (i === selectEls.length - 1) selectEls[i].classList.add(SEL);
        else selectEls[i].classList.add(SEL_MULTI);
      } catch (e) {}
    }
  }

  function indexOfSelectEl(el) {
    for (var i = 0; i < selectEls.length; i++) {
      if (selectEls[i] === el) return i;
    }
    return -1;
  }

  function highlight(selector) {
    clearSelect();
    if (!selector) return;
    try {
      var el = document.querySelector(selector);
      if (el) {
        el.classList.add(SEL);
        selectEls = [el];
      }
    } catch (e) {}
  }

  /** Multi-outline; last selector is primary. */
  function highlightMulti(selectors) {
    clearSelect();
    if (!selectors || !selectors.length) return;
    for (var i = 0; i < selectors.length; i++) {
      try {
        var el = document.querySelector(selectors[i]);
        if (el && indexOfSelectEl(el) < 0) selectEls.push(el);
      } catch (e) {}
    }
    restyleSelects();
  }

  function scrollToSel(selector) {
    try {
      var el = document.querySelector(selector);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      highlight(selector);
    } catch (e) {}
  }

  function selectPayload(el) {
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
    var outer = '';
    try { outer = (el.outerHTML || '').slice(0, 4000); } catch (e) {}
    return {
      selector: cssPath(el),
      tag: (el.tagName || '').toLowerCase(),
      outerHTML: outer,
      bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };
  }

  function multiPayloads() {
    var out = [];
    for (var i = 0; i < selectEls.length; i++) {
      out.push(selectPayload(selectEls[i]));
    }
    return out;
  }

  function onMove(ev) {
    if (!inspectOn) return;
    var t = ev.target;
    if (!t || t === document || t === document.documentElement) return;
    if (t === hoverEl) return;
    clearHover();
    if (isLocked(t)) {
      post({ type: 'neos.hover', selector: null });
      return;
    }
    t.classList.add(HL);
    hoverEl = t;
    post({ type: 'neos.hover', selector: cssPath(t) });
  }

  function onClick(ev) {
    if (!inspectOn) return;
    var t = ev.target;
    if (!t || t.nodeType !== 1) return;
    if (isLocked(t)) return;
    ev.preventDefault();
    ev.stopPropagation();
    clearHover();
    var additive = !!(ev.shiftKey || ev.metaKey || ev.ctrlKey);
    if (additive) {
      var idx = indexOfSelectEl(t);
      if (idx >= 0) {
        try {
          selectEls[idx].classList.remove(SEL);
          selectEls[idx].classList.remove(SEL_MULTI);
        } catch (e) {}
        selectEls.splice(idx, 1);
      } else {
        selectEls.push(t);
      }
      restyleSelects();
    } else {
      clearSelect();
      try { t.classList.add(SEL); } catch (e) {}
      selectEls = [t];
    }
    var multi = multiPayloads();
    var primary = multi.length ? multi[multi.length - 1] : selectPayload(t);
    var payload = {
      selector: primary.selector,
      tag: primary.tag,
      outerHTML: primary.outerHTML,
      bbox: primary.bbox,
      additive: additive
    };
    if (multi.length > 1) payload.multi = multi;
    post({ type: 'neos.select', selection: payload });
  }

  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (!data || data.source !== SRC || typeof data.type !== 'string') return;
    if (data.type === 'neos.ping') {
      post({ type: 'neos.pong' });
      return;
    }
    if (data.type === 'neos.request-snapshot') {
      snapshot();
      return;
    }
    if (data.type === 'neos.highlight') {
      highlight(data.selector || null);
      return;
    }
    if (data.type === 'neos.highlight-multi') {
      var sels = Array.isArray(data.selectors) ? data.selectors : [];
      highlightMulti(sels);
      return;
    }
    if (data.type === 'neos.scroll-to') {
      scrollToSel(data.selector || '');
      return;
    }
    if (data.type === 'neos.set-inspect') {
      inspectOn = !!data.enabled;
      if (!inspectOn) {
        clearHover();
        document.documentElement.style.cursor = '';
      } else {
        document.documentElement.style.cursor = 'crosshair';
      }
    }
  });

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  window.__neosBridge = true;
  post({ type: 'neos.ready' });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { snapshot(); });
  } else {
    snapshot();
  }
})();`;
}

/** Inject bridge script before </body> (or append if missing). */
export function injectBridgeIntoHtml(html: string): string {
  const script = `<script data-neos-bridge="1">${buildBridgeInjectScript()}</script>`;
  // Avoid double-inject
  if (/data-neos-bridge\s*=\s*["']1["']/.test(html)) return html;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${script}</body>`);
  }
  if (/<\/html>/i.test(html)) {
    return html.replace(/<\/html>/i, `${script}</html>`);
  }
  return `${html}${script}`;
}
