// src/lib/lead-devices/contract.ts
// The file contract for an uploaded device, as Hub-owned code. Ported from the University platform at
// 9bb18cba (src/lib/assessments/contract.ts and host-frame.ts), so a file built for it runs here unedited.
//   A file calls window.NPU.submit({ answers, report?, outcome? }) and never collects identity.
//   The bridge is added when the file is served, so what is stored stays byte-identical to the upload.
// Hub additions: an outcome field on submit, and window.NPU.track(event) for views and starts.

// allow-same-origin is absent on purpose and permanently: a same-origin framed document could reach its
// own iframe element and rewrite this list. allow-forms is included because authors write forms; without
// it a submit button does nothing and the browser reports nothing to the page.
export const SANDBOX_TOKENS = ['allow-scripts', 'allow-modals', 'allow-downloads', 'allow-popups', 'allow-forms'] as const
export const SANDBOX_ATTR = SANDBOX_TOKENS.join(' ')

export const MESSAGES = {
  submit: 'assessment:submit',
  submitted: 'assessment:submitted',
  error: 'assessment:error',
  height: 'assessment:height',
  track: 'assessment:track',
} as const

/** A value for a script block: nothing in it can end the block early. */
export function jsonForScript(value: unknown): string {
  const ESC = String.fromCharCode(92)
  return JSON.stringify(value)
    .replace(/</g, `${ESC}u003c`)
    .replace(/>/g, `${ESC}u003e`)
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), `${ESC}u2028`)
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), `${ESC}u2029`)
}

/**
 * The bridge, as a complete script element. It only ever posts to the parent page, which holds the answers
 * until the person sends the lead form. The target is '*' because a sandboxed frame has an opaque origin and
 * cannot name one; the parent trusts the sending window, not the origin.
 */
export function buildNpuBridge(slug: string): string {
  const j = jsonForScript
  return [
    '<script>(function(){',
    '"use strict";',
    `var CTX=${j({ slug })};`,
    'var sent=false;',
    'function post(p){',
    '  if(sent){ if(window.console) console.warn("[NPU] submit already sent; ignored"); return false; }',
    '  sent=true;',
    `  var m={type:${j(MESSAGES.submit)},slug:CTX.slug};`,
    '  if(p&&typeof p==="object"){for(var k in p){if(Object.prototype.hasOwnProperty.call(p,k)){m[k]=p[k];}}}',
    '  window.parent.postMessage(m,"*");',
    '  return true;',
    '}',
    'function track(ev){',
    `  if(typeof ev==="string"&&ev){window.parent.postMessage({type:${j(MESSAGES.track)},event:ev},"*");return true;}`,
    '  return false;',
    '}',
    'var prior=null;',
    'var onPrior=[];',
    'window.addEventListener("message",function(e){',
    '  if(e.source!==window.parent) return;',
    '  var d=e.data; if(!d||typeof d!=="object") return;',
    `  if(d.type===${j(MESSAGES.submitted)}){`,
    '    prior=(d.prior===undefined?null:d.prior);',
    '    for(var i=0;i<onPrior.length;i++){try{onPrior[i](prior,d.id||null);}catch(x){}}',
    '  }',
    `  if(d.type===${j(MESSAGES.error)}){ sent=false; }`,
    '});',
    'window.NPU=Object.freeze({',
    '  version:1,',
    '  context:Object.freeze({slug:CTX.slug,lessonId:null}),',
    '  submit:post,',
    '  track:track,',
    '  priorAnswers:function(){return prior;},',
    '  onPriorAnswers:function(fn){if(typeof fn==="function"){onPrior.push(fn);if(prior!==null){try{fn(prior,null);}catch(x){}}}},',
    '});',
    'var lastH=0;',
    'function reportHeight(){',
    '  try{',
    '    var h=Math.ceil(document.documentElement.scrollHeight||0);',
    `    if(h>0&&Math.abs(h-lastH)>2){lastH=h;window.parent.postMessage({type:${j(MESSAGES.height)},height:h},"*");}`,
    '  }catch(x){}',
    '}',
    'if(document.readyState==="complete"){reportHeight();}',
    'else{window.addEventListener("load",reportHeight);}',
    'if(typeof ResizeObserver!=="undefined"){',
    '  try{new ResizeObserver(reportHeight).observe(document.documentElement);}catch(x){}',
    '}',
    'var ticks=0;var iv=setInterval(function(){reportHeight();if(++ticks>10){clearInterval(iv);}},100);',
    '})();</script>',
  ].join('\n')
}

/** The stored file with the bridge in front. After a leading doctype, so the page stays out of quirks mode. */
export function wrapDeviceHtml(storedHtml: string, bridge: string): string {
  const m = /^\s*<!doctype[^>]*>/i.exec(storedHtml)
  if (!m) return `${bridge}\n${storedHtml}`
  const cut = m.index + m[0].length
  return `${storedHtml.slice(0, cut)}\n${bridge}${storedHtml.slice(cut)}`
}
