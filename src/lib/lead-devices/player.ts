// src/lib/lead-devices/player.ts
// The public page: the framed file and the lead form, as one server-rendered document with its own nonce, so no
// Hub script or stylesheet loads on the public origin. Ported to plain JavaScript from the University platform
// at 9bb18cba (src/app/x/[org]/[slug]/page.tsx). The tool runs first and stays on screen. The lead form appears
// after it finishes, so the on-screen result shows whether or not the person gives an email.
import { randomBytes } from 'node:crypto'
import { MESSAGES, SANDBOX_ATTR, jsonForScript } from './contract'
import { LEAD_DEVICE_ORIGIN, frameAncestors } from './public-origin'
import type { DeviceRow } from './manifest'

const TURNSTILE = 'https://challenges.cloudflare.com'

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

export const newNonce = () => randomBytes(18).toString('base64')

/** Pure: the policy for the page. Scripts need the nonce, and only Turnstile may be framed or loaded from elsewhere. */
export function pageCsp(nonce: string, embedOrigins: unknown): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${TURNSTILE}`,
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    `frame-src 'self' ${TURNSTILE}`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    frameAncestors(embedOrigins),
  ].join('; ')
}

/** Pure: the policy for the file. It may reach nothing, and third-party scripts only from the manifest's allowlist. */
export function fileCsp(scriptAllowlist: string[]): string {
  const extra = scriptAllowlist.length ? ` ${scriptAllowlist.join(' ')}` : ''
  return [
    `sandbox ${SANDBOX_ATTR}`,
    "default-src 'none'",
    `script-src 'unsafe-inline'${extra}`,
    `style-src 'unsafe-inline'${extra}`,
    'img-src data: https:',
    `font-src data:${extra}`,
    'media-src https:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${LEAD_DEVICE_ORIGIN}`,
  ].join('; ')
}

/** Every response on the public origin. Nothing here sets a cookie. */
export function publicHeaders(csp: string): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }
}

export function notAvailablePage(): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not available</title></head><body style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:24px"><h1 style="font-size:18px">This page is not available</h1><p style="font-size:13px;color:#6b7280">The link may have been withdrawn, or it may be mistyped.</p></body></html>'
}

export function renderPlayer(p: {
  device: Pick<DeviceRow, 'slug' | 'name' | 'content' | 'manifest'>
  nonce: string
  siteKey: string
  preview: string | null
}): string {
  const { device: d, nonce, siteKey, preview } = p
  const m = d.manifest
  const fileUrl = `/${d.slug}/file${preview ? `?preview=${encodeURIComponent(preview)}` : ''}`
  const cfg = jsonForScript({ slug: d.slug, preview, messages: MESSAGES, formOnly: d.content === 'form' })
  const frame = d.content === 'html'
    ? `<iframe id="tool" src="${esc(fileUrl)}" sandbox="${SANDBOX_ATTR}" title="${esc(d.name)}" style="width:100%;height:520px;border:1px solid #edf1f4;border-radius:12px;display:block"></iframe>`
    : ''
  const box = (id: string, text: string) => `<label class="tick"><input type="checkbox" id="${id}"><span>${esc(text)}</span></label><p class="err" id="err-${id}"></p>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.name)}</title>
<style nonce="${esc(nonce)}">
body{font-family:system-ui,sans-serif;color:#2f3a4a;margin:0}main{max-width:760px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:0 0 12px}h2{font-size:15px;margin:0 0 4px}.muted{font-size:12px;color:#6b7280;margin:0 0 12px}
#lead,#done{margin-top:16px;padding:16px;border:1px solid #edf1f4;border-radius:12px}
label.f{display:block;font-size:12px;margin-bottom:8px}label.f input{display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:4px;border:1px solid #d7dee5;border-radius:8px;font-size:14px}
label.tick{display:flex;gap:8px;align-items:flex-start;font-size:12px;margin-bottom:6px}
.err{font-size:11px;color:#b45309;margin:0 0 8px}.hp{position:absolute;left:-10000px}
button{background:#2a9d8f;color:#fff;border:0;border-radius:9px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}button[disabled]{opacity:.5;cursor:default}
.note{font-size:11px;background:#fef3e7;color:#b45309;padding:8px;border-radius:8px;margin-bottom:12px}[hidden]{display:none!important}
</style></head><body><main>
<h1>${esc(d.name)}</h1>
${preview ? '<p class="note">Test mode. A submission here is stored as a test. It creates no contact and starts no campaign.</p>' : ''}
${frame}
<section id="lead" hidden>
<h2>Where should we send your result?</h2><p class="muted">Your answers are not saved until you send them.</p>
<label class="f">First name<input id="first_name" autocomplete="given-name"></label><p class="err" id="err-first_name"></p>
<label class="f">Email<input id="email" type="email" autocomplete="email"></label><p class="err" id="err-email"></p>
<label class="f">Phone (optional)<input id="phone" type="tel" autocomplete="tel"></label><p class="err" id="err-phone"></p>
<label class="hp" aria-hidden="true">Website<input id="website" tabindex="-1" autocomplete="off"></label>
${box('result', m.result_consent_text)}
${box('consent_email', m.email_consent_text)}
${box('sms', m.sms_consent_text)}
${siteKey ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}"></div>` : '<p class="err">The anti-spam check is not set up, so this form cannot be sent yet.</p>'}
<p class="err" id="err-form"></p>
<button type="button" id="send"${siteKey ? '' : ' disabled'}>Send</button>
</section>
<section id="done" hidden><h2>Thank you</h2><p class="muted">Your details have been sent.</p></section>
</main>
${siteKey ? `<script nonce="${esc(nonce)}" src="${TURNSTILE}/turnstile/v0/api.js" async defer></script>` : ''}
<script nonce="${esc(nonce)}">(function(){
"use strict";
var C=${cfg};
var q=new URLSearchParams(location.search);
var utm={};["source","medium","campaign","content"].forEach(function(k){var v=q.get("utm_"+k);if(v)utm[k]=v;});
var frame=document.getElementById("tool"),lead=document.getElementById("lead"),done=document.getElementById("done"),send=document.getElementById("send");
var held={answers:{},outcome:null};
var key=(self.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+"-"+String(Math.random()).slice(2);
function track(ev){
  try{fetch("/"+C.slug+"/track",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event:ev,preview:C.preview,utm_source:utm.source||null}),keepalive:true});}catch(x){}
}
track("view");
if(C.formOnly){lead.hidden=false;}
window.addEventListener("message",function(e){
  if(!frame||e.source!==frame.contentWindow)return;
  var d=e.data;if(!d||typeof d!=="object")return;
  if(d.type===C.messages.height){var n=Number(d.height);if(isFinite(n)){frame.style.height=Math.max(520,Math.min(6000,Math.ceil(n)))+"px";}return;}
  if(d.type===C.messages.track){if(typeof d.event==="string")track(d.event);return;}
  if(d.type!==C.messages.submit)return;
  held.answers=(d.answers&&typeof d.answers==="object")?d.answers:{};
  held.outcome=typeof d.outcome==="string"?d.outcome:null;
  lead.hidden=false;lead.scrollIntoView({behavior:"smooth",block:"nearest"});
});
function val(id){return document.getElementById(id).value;}
function tick(id){return document.getElementById(id).checked===true;}
function clearErrs(){Array.prototype.forEach.call(document.querySelectorAll(".err[id]"),function(p){p.textContent="";});}
function say(id,t){var p=document.getElementById("err-"+id);if(p)p.textContent=t;}
function resetChallenge(){try{if(window.turnstile)window.turnstile.reset();}catch(x){}}
send.addEventListener("click",function(){
  clearErrs();send.disabled=true;
  var tokenField=document.querySelector('input[name="cf-turnstile-response"]');
  fetch("/"+C.slug+"/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    first_name:val("first_name"),email:val("email"),phone:val("phone"),website:val("website"),
    answers:held.answers,outcome:held.outcome,
    consent:{result:tick("result"),email:tick("consent_email"),sms:tick("sms")},
    utm:utm,page_url:location.href,idempotency_key:key,preview:C.preview,
    turnstileToken:tokenField?tokenField.value:""
  })}).then(function(r){return r.json().catch(function(){return {};}).then(function(j){return {ok:r.ok,j:j};});}).then(function(x){
    if(x.ok){
      lead.hidden=true;done.hidden=false;
      if(frame&&frame.contentWindow)frame.contentWindow.postMessage({type:C.messages.submitted,id:x.j.id||null},"*");
      return;
    }
    if(x.j.fields){Object.keys(x.j.fields).forEach(function(k){say(k==="email_consent"?"consent_email":k,x.j.fields[k]);});}
    say("form",x.j.error||"Your answers could not be saved. Please try again.");
    resetChallenge();send.disabled=false;
  }).catch(function(){say("form","Your answers could not be saved. Please try again.");resetChallenge();send.disabled=false;});
});
})();</script>
</body></html>`
}
