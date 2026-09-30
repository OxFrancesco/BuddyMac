import {mkdir,copyFile} from 'node:fs/promises'
import {join} from 'node:path'
const out='report'
await mkdir(join(out,'assets'),{recursive:true})
const ui=await Bun.file('evidence/ui-verification.json').json()
const focus=await Bun.file('evidence/focus-ui-verification.json').json()
const liny=await Bun.file('evidence/live/liny.json').json()
const tests=await Bun.file('evidence/service-tests.txt').text()
const assertions=tests.match(/(\d+) expect\(\) calls/)?.[1]??'Unverified'
const passed=tests.match(/(\d+) pass/)?.[1]??'Unverified'
for(const name of ['buddymac-files.png','buddymac-focus.png','buddymac-write.png','buddymac-talk.png','buddymac-dock.png','buddymac-liny.png','buddymac-compact-focus.png','buddymac-compact-talk.png','buddymac-walkthrough.mp4'])await copyFile(join('evidence',name),join(out,'assets',name))
for(const name of ['ChakraPetch-Bold.ttf','IBMPlexMono-Regular.ttf'])await copyFile(join('assets/fonts',name),join(out,'assets',name))
for(const name of ['ui-verification.json','focus-ui-verification.json','service-tests.txt','installed-runtime.json','installed-sha256.txt'])await copyFile(join('evidence',name),join(out,name))
await copyFile('docs/review.md',join(out,'review.md'))
await copyFile('docs/parity.md',join(out,'workflow-coverage.md'))
await copyFile('docs/decisions.tsv',join(out,'decisions.tsv'))
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const rows=[
 ['Files','Shelf, search, paste/drop, multi-selection, native drag, pinned edge view.','External drag delivery and physical edge activation need live verification.'],
 ['Talk','Recorder, retry, history, vocabulary, snippets, memory, screen context, local S1 cleanup, compact view.','Save an OpenRouter key in Talk settings, then grant microphone permission. Live capture and insertion remain unverified.'],
 ['Write','Imported provider settings, rewrite profiles, notes, output editing, copy and opt-in hotkeys.','Uses the same BuddyMac OpenRouter key. Optional original MLX and voice routes are not active.'],
 ['Focus','Imported tasks, persistent timer, compact view, history, analytics, check-ins, notifications and sounds.','CloudKit, mobile sync and smile detection are not connected. Native notification delivery remains unverified.'],
 ['Dock','Read saved pack, compare actual artwork, apply selected icons, optional periodic repair and stop control.','Fixture icon application passed. Installed icons were inspected without changes. Artwork generation is not ported.'],
 ['Liny','Personal provider login, imported active profile, streaming chat, sessions, memory, images, native computer tools.','Live Codex text inference passed with tools disabled. Computer-control permissions remain unverified. Managed credits and billing are not connected.'],
]
await Bun.write(join(out,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuddyMac implementation</title><style>
@font-face{font-family:Chakra;src:url(assets/ChakraPetch-Bold.ttf)}@font-face{font-family:Mono;src:url(assets/IBMPlexMono-Regular.ttf)}*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font:14px/1.65 Mono,monospace}main{max-width:1120px;margin:auto;padding:48px 24px}h1,h2{font-family:Chakra,sans-serif;line-height:1.15}h1{font-size:44px;margin:0 0 20px}h2{font-size:26px;margin:44px 0 18px}p{max-width:850px;color:#bbb}a{color:#d6544b;text-underline-offset:4px}code{color:#fff;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td{padding:18px 14px 18px 0;border-bottom:1px solid #222;text-align:left;vertical-align:top}th{font-weight:400;color:#aaa}td:first-child{white-space:nowrap;color:#d6544b}td{width:45%}td:first-child{width:10%}video,img{display:block;width:100%;height:auto;border:1px solid #222}video{max-height:640px;background:#000}details{border-bottom:1px solid #222;padding:16px 0}summary{cursor:pointer;padding:4px 0 16px}ul{padding-left:22px}li{margin:8px 0}.scroll{overflow-x:auto}.compact{display:flex;gap:20px;align-items:flex-start;margin:20px 0}.compact img{width:calc(50% - 10px)}@media(max-width:700px){main{padding:28px 16px}h1{font-size:34px}table{min-width:740px}.compact{display:block}.compact img{width:100%;margin:16px 0}}
</style><main><h1>BuddyMac</h1><p>Installed at <code>~/Applications/BuddyMac.app</code>. Files, Talk, Write, Focus, Dock and Liny share one native GPUix interface. Jesty is excluded. Original apps and stores remain intact.</p>
<p>The frontend follows <a href="https://oddofrancesco.com/design">Francesco's design guidelines</a>. This is a locally signed build, not a notarized public release.</p>
<h2>Setup still needed</h2><p>Open Talk → Settings → Set API key. macOS blocked the original apps' protected keys, so BuddyMac uses its own Keychain item. Grant microphone and Accessibility permissions when using recording and insertion. Shortcuts and launch-at-login are opt-in.</p>
<h2>Verification</h2><ul><li>${escape(passed)} service tests passed with ${escape(assertions)} assertions.</li><li>${ui.steps.length} native UI checks passed against the installed app using isolated fixtures. The final timer build passed ${focus.checks.length} additional Focus UI checks.</li><li>Liny's configured Codex provider returned <code>${escape(liny.reply??'Unverified')}</code> with computer tools disabled.</li><li>Signed bundle, bundled GPUix runtime, source typecheck and source secret scan passed.</li><li>Local S1 cleanup ran with the real cached model. No microphone audio was recorded in verification.</li></ul>
<p><a href="ui-verification.json">UI results</a> · <a href="service-tests.txt">Service results</a> · <a href="workflow-coverage.md">Full workflow coverage</a> · <a href="decisions.tsv">Decision log</a> · <a href="review.md">Independent review</a></p>
<video controls preload="metadata" poster="assets/buddymac-focus.png" src="assets/buddymac-walkthrough.mp4"></video><p>The recording uses synthetic fixture data. It shows the installed native interface, not production transcription or live icon changes.</p>
<div class="compact"><img src="assets/buddymac-compact-focus.png" alt="Compact Focus timer"><img src="assets/buddymac-compact-talk.png" alt="Compact Talk recorder"></div>
<h2>Coverage and limits</h2><div class="scroll"><table><thead><tr><th>Tool</th><th>Implemented</th><th>Remaining</th></tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
<h2>Screens</h2>${['files','focus','write','talk','dock','liny'].map(name=>`<details><summary>${name[0]!.toUpperCase()+name.slice(1)}</summary><img loading="lazy" src="assets/buddymac-${name}.png" alt="BuddyMac ${name} native interface"></details>`).join('')}
<h2>Attention</h2><p>Independent source review found broad helper entitlements and outdated OAuth documentation; both were corrected. Remaining live checks and omitted optional features are listed above. The original utilities remain available until those checks pass.</p></main></html>`)
console.log('Created report/index.html')
