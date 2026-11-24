import { createElement, Fragment, type ReactNode } from 'react';
import type { DefaultTreeAdapterTypes } from 'parse5';

const publication = 'https://reals-web.pages.dev';
const maxBytes = 512 * 1024;
const formatting = new Set('h1 h2 h3 h4 h5 h6 p br hr ol ul li strong b em i u s del ins sup sub blockquote pre code dl dt dd table caption thead tbody tfoot tr td th'.split(' '));
const containers = new Set('body main article section header footer div span a small time cite abbr'.split(' '));

function renderContent(document: DefaultTreeAdapterTypes.Document) {
  const root = document.childNodes.find(node => 'tagName' in node && node.tagName === 'html');
  const body = root && 'childNodes' in root && root.childNodes.find(node => 'tagName' in node && node.tagName === 'body');
  let hasText = false, count = 0;
  function render(node: DefaultTreeAdapterTypes.ChildNode, key: number, depth: number): ReactNode {
    if (++count > 16000 || depth > 64) throw Error('Document complexity');
    if ('value' in node) {
      if (node.value.trim()) hasText = true;
      return node.value;
    }
    if (!('tagName' in node)) return null;
    const tag = node.tagName;
    if (!formatting.has(tag) && !containers.has(tag)) throw Error('Unsupported document element');
    const children = node.childNodes.map((child, index) => render(child, index, depth + 1));
    if (containers.has(tag)) return createElement(Fragment, { key }, children);
    const props: Record<string, string | number | boolean> = { key };
    for (const { name, value } of node.attrs) {
      if (tag === 'ol' && name === 'reversed') props.reversed = true;
      if ((tag === 'ol' && name === 'start' || tag === 'li' && name === 'value') && /^-?\d+$/.test(value)) props[name] = Number(value);
      if (tag === 'ol' && name === 'type' && /^[aAiI1]$/.test(value)) props.type = value;
      if ((tag === 'td' || tag === 'th') && (name === 'rowspan' || name === 'colspan') && /^\d{1,3}$/.test(value)) props[name === 'rowspan' ? 'rowSpan' : 'colSpan'] = Number(value);
    }
    return children.length ? createElement(tag, props, children) : createElement(tag, props);
  }
  const content = body && render(body, 0, 0);
  if (!hasText || !content) throw Error('Empty document');
  return content;
}

export async function loadDocument(url: string, owner: AbortSignal) {
  const target = new URL(url);
  if (target.origin !== publication || !target.pathname.startsWith('/legal/') || target.username || target.password || target.hash) throw Error('Unexpected publication');
  // Pages publishes document.html at its extensionless canonical route.
  // Derive only that known path, never follow a Location supplied by a response.
  if (target.pathname.endsWith('/document.html')) target.pathname = target.pathname.slice(0, -5);
  const request = new AbortController();
  const signal = AbortSignal.any([owner, request.signal]);
  const timer = setTimeout(() => request.abort(), 15000);
  try {
    const response = await fetch(target.href, {
      signal, mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
    });
    if (response.status !== 200 || response.redirected || response.url !== target.href || !response.body ||
        !/^text\/html(?:\s*;\s*charset\s*=\s*"?utf-8"?)?\s*$/i.test(response.headers.get('content-type') ?? '') ||
        Number(response.headers.get('content-length')) > maxBytes) throw Error('Unexpected document response');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0, html = '';
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error('Document too large');
      html += decoder.decode(value, { stream: true });
    }
    const { parse } = await import('parse5');
    signal.throwIfAborted();
    return renderContent(parse(html + decoder.decode()));
  } finally {
    clearTimeout(timer);
    request.abort();
  }
}
