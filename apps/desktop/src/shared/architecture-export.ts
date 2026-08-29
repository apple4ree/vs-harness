import type { ArchitectureGraph } from "./architecture";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function embeddedJson(value: unknown) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function requireValidated(graph: ArchitectureGraph) {
  if (!graph.validation.valid)
    throw new Error("Only validated architecture IR can be exported");
}

export function serializeArchitectureJson(graph: ArchitectureGraph) {
  requireValidated(graph);
  return JSON.stringify(graph, null, 2) + "\n";
}

/** A portable, dependency-free reader. All authored text is inserted via textContent. */
export function renderArchitectureHtml(graph: ArchitectureGraph) {
  requireValidated(graph);
  const title = escapeHtml(
    `${graph.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) || "Witch"} architecture`,
  );
  const ir = embeddedJson(graph);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${title}</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#eadff5;background:#0f0a17;color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 75% 0,#2b1740 0,transparent 34%),#0f0a17}header{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:16px;padding:15px 20px;border-bottom:1px solid #3d2950;background:#130d1deb;backdrop-filter:blur(12px)}h1{margin:0;font:600 18px Georgia,serif}header small{color:#a58eb8}input{min-width:220px;margin-left:auto;border:1px solid #58406b;border-radius:7px;padding:8px 10px;background:#1b1226;color:#eee3f8}button{border:1px solid #5f4476;border-radius:6px;padding:7px 9px;background:#2b1b3b;color:#e6d5f5}.layout{display:grid;grid-template-columns:minmax(0,1fr) 330px;min-height:calc(100vh - 60px)}main{padding:20px}.metrics{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:16px}.metrics span{border:1px solid #3d2a4c;border-radius:999px;padding:5px 8px;color:#b9a4ca;font-size:11px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(235px,1fr));gap:10px}.card{display:grid;gap:7px;min-height:128px;padding:13px;border:1px solid #503b61;border-radius:10px;background:linear-gradient(135deg,#251832,#17101f);box-shadow:0 8px 28px #0004;text-align:left}.card:hover,.card.active{border-color:#c797f7;box-shadow:0 0 0 2px #a872df2c}.card.external{border-color:#465e74}.card em{color:#ae8bd0;font-size:9px;letter-spacing:.09em;text-transform:uppercase}.card strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card small{color:#9584a5}.card footer{margin-top:auto;color:#ad98bd;font-size:10px}aside{position:sticky;top:60px;height:calc(100vh - 60px);overflow:auto;border-left:1px solid #3b2949;padding:18px;background:#130d1d}aside h2{font:500 21px Georgia,serif}aside h3{margin-top:20px;color:#ba9cd2;font-size:10px;letter-spacing:.08em;text-transform:uppercase}.empty{color:#8d7d9b;font-size:12px}.relation{display:grid;gap:4px;width:100%;margin:5px 0;padding:8px;border:0;border-bottom:1px solid #30203d;background:transparent;text-align:left}.relation code{overflow-wrap:anywhere;color:#d6c4e5;font-size:10px}.relation small{color:#806e8e}.evidence{display:block;margin-top:3px;padding:6px;border-radius:4px;background:#0e0915;color:#a996b9;font:10px ui-monospace,monospace;white-space:pre-wrap}@media(max-width:800px){.layout{grid-template-columns:1fr}aside{position:static;height:auto;border-left:0;border-top:1px solid #3b2949}header{flex-wrap:wrap}input{order:3;width:100%;margin-left:0}}
</style>
</head>
<body>
<header><h1>◐ Witch · Code Observatory</h1><small id="heading"></small><input id="search" type="search" placeholder="Find a component…" aria-label="Find a component"><button id="reset">Reset</button></header>
<div class="layout"><main><div class="metrics" id="metrics"></div><div class="cards" id="cards"></div></main><aside id="details"><p class="empty">Select a source-backed component to inspect its authored relations and evidence.</p></aside></div>
<script id="witch-ir" type="application/json">${ir}</script>
<script>
const graph=JSON.parse(document.getElementById('witch-ir').textContent);const cards=document.getElementById('cards'),details=document.getElementById('details'),search=document.getElementById('search');let selected='';
const add=(parent,tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;parent.append(e);return e};
document.getElementById('heading').textContent=graph.workspaceRoot+' · '+graph.revision.slice(0,8);['nodes '+graph.nodes.length,'relations '+graph.edges.length,'evidence '+graph.validation.evidenceCount,'verified '+graph.validation.sourceBackedEdges+'/'+graph.validation.edgeCount].forEach(x=>add(document.getElementById('metrics'),'span',x));
function show(id){selected=id;const item=graph.nodes.find(n=>n.id===id);details.replaceChildren();add(details,'em',item.kind+' evidence');add(details,'h2',item.label);add(details,'p',item.path||item.id);const symbols=item.symbols.filter(s=>s.exported);if(symbols.length){add(details,'h3','Exported symbols');symbols.slice(0,40).forEach(s=>{const b=add(details,'button',s.kind+' · '+s.name+' · L'+s.line,'relation');b.onclick=()=>{};});}const relations=graph.edges.filter(e=>e.from===id||e.to===id);add(details,'h3','Authored relations · '+relations.length);relations.slice(0,100).forEach(r=>{const b=add(details,'button',undefined,'relation');add(b,'code',r.from+' → '+r.to);add(b,'small',r.kind+' · '+r.evidence.length+' evidence');r.evidence.slice(0,3).forEach(v=>add(b,'span',v.path+':'+v.line+(v.excerpt?'\n'+v.excerpt:''),'evidence'));b.onclick=()=>show(r.from===id?r.to:r.from);});render();}
function render(){const q=search.value.trim().toLowerCase();cards.replaceChildren();graph.nodes.filter(n=>!q||[n.id,n.label,n.module,n.language,...n.symbols.map(s=>s.name)].join(' ').toLowerCase().includes(q)).slice(0,1000).forEach(n=>{const b=add(cards,'button',undefined,'card '+(n.kind==='external'?'external ':'')+(n.id===selected?'active':''));add(b,'em',n.kind+' · '+n.module);add(b,'strong',n.label);add(b,'small',n.path||'External dependency');add(b,'footer',n.symbols.length+' symbols · '+n.evidence.length+' evidence');b.onclick=()=>show(n.id);});}
search.addEventListener('input',render);document.getElementById('reset').onclick=()=>{search.value='';selected='';details.innerHTML='<p class="empty">Select a source-backed component to inspect its authored relations and evidence.</p>';render();};render();
</script>
</body>
</html>
`;
}
