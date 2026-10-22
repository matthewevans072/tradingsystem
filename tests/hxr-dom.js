// A minimal DOM (elements, text nodes, attributes, listeners) so the HXR page
// (public/views/hxr.js) can be rendered in node --test from real service
// output. It supports what public/lib/ui.js and charts.js use; no layout, no
// markup parsing (the page never builds markup from strings).
class Node {
  constructor() { this.childNodes = []; this.parentNode = null; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get children() { return this.childNodes.filter((c) => c instanceof Element); }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  append(...cs) { for (const c of cs) this.appendChild(c instanceof Node ? c : new Text(String(c))); }
  removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); c.parentNode = null; return c; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
}

class Text extends Node {
  constructor(data) { super(); this.data = data; }
  get textContent() { return this.data; }
}

class Element extends Node {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.attributes = {}; this.style = {}; this.dataset = {}; this.listeners = {}; this.className = ''; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  focus() {}
  scrollIntoView() {}
  // Elements in document order whose tag or class matches a simple selector ("tag", ".cls" or "tag.cls").
  querySelectorAll(sel) {
    const [tag, cls] = sel.split('.');
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if ((!tag || c.tagName === tag.toUpperCase()) && (!cls || c.className.split(/\s+/).includes(cls))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}

// Installs the DOM globals the page needs and returns a root element to render into.
export function installDom({ hash = '#/hxr' } = {}) {
  const byId = new Map(['toast', 'overlay'].map((id) => [id, new Element('div')]));
  globalThis.Node = Node;
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    createElementNS: (_ns, tag) => new Element(tag),
    createTextNode: (s) => new Text(s),
    getElementById: (id) => byId.get(id) ?? null,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.location = { hash };
  return new Element('main');
}

// Lets every pending lazy block (API call, then mount) finish.
export async function settle(rounds = 40) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

// An api(method, path) for the page that calls the service directly, with a JSON round trip like HTTP.
export function serviceApi(hxr) {
  const routes = [
    [/^\/api\/hxr\/overview$/, () => hxr.overview()],
    [/^\/api\/hxr\/readiness$/, () => hxr.readiness()],
    [/^\/api\/hxr\/fetch$/, () => hxr.fetchStatus()],
    [/^\/api\/hxr\/prospective$/, () => hxr.prospectiveStatus()],
    [/^\/api\/hxr\/runs\/(\d+)$/, (m) => hxr.getRun(Number(m[1]))],
    [/^\/api\/hxr\/runs$/, (m, q) => hxr.listRuns({ kind: q.get('kind') || null, limit: q.get('limit') ? Number(q.get('limit')) : undefined })],
  ];
  const calls = [];
  const api = async (method, url) => {
    calls.push(`${method} ${url}`);
    if (method !== 'GET') throw new Error(`the render test makes no state change (${method} ${url})`);
    const [p, qs = ''] = url.split('?');
    for (const [re, fn] of routes) {
      const m = p.match(re);
      if (m) return JSON.parse(JSON.stringify(fn(m, new URLSearchParams(qs))));
    }
    throw new Error(`no route for ${url}`);
  };
  return { api, calls };
}
