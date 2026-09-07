'use strict';

/* ============================================================
   RENDERING: nodes, sockets, wires
   ============================================================ */
const graphWrap = document.getElementById('graphWrap');
const graphLayer = document.getElementById('graphLayer');
const wireSvg = document.getElementById('wireSvg');
const emptyHint = document.getElementById('emptyHint');

let viewX=40, viewY=40, viewScale=1;
function applyView(){
  graphLayer.style.transform = `translate(${viewX}px,${viewY}px) scale(${viewScale})`;
  wireSvg.style.transform = graphLayer.style.transform;
  document.getElementById('zoomHud').textContent = Math.round(viewScale*100)+'%';
  emptyHint.style.display = Object.keys(nodes).length ? 'none' : '';
}

const NODE_WIDTH=210;
function getSocketEl(nodeId, dir, idx){
  const el=document.getElementById(nodeId); if(!el) return null;
  return el.querySelector(`.socket-${dir}[data-idx="${idx}"]`);
}
function localSocketXY(nodeId, dir, idx){
  const node=nodes[nodeId]; if(!node) return {x:node?node.x:0,y:node?node.y:0};
  const sockEl=getSocketEl(nodeId,dir,idx);
  if(!sockEl) return {x:node.x, y:node.y};
  // Measure the socket dot's actual on-screen center and convert it back into
  // graph-local space. This tracks the real rendered position exactly, so wires
  // always land dead-on regardless of header height, wrapped titles, node
  // content, zoom, or future CSS changes — no hardcoded offsets to drift out of sync.
  const r = sockEl.getBoundingClientRect();
  const wrap = graphWrap.getBoundingClientRect();
  const cx = r.left + r.width/2 - wrap.left;
  const cy = r.top + r.height/2 - wrap.top;
  return { x: (cx - viewX) / viewScale, y: (cy - viewY) / viewScale };
}

function wirePath(p1,p2){
  const dx=Math.max(40,Math.abs(p2.x-p1.x)*0.5);
  return `M ${p1.x} ${p1.y} C ${p1.x+dx} ${p1.y}, ${p2.x-dx} ${p2.y}, ${p2.x} ${p2.y}`;
}
// Sample the same cubic bezier drawWires() renders for a link, so hit-testing
// against a wire follows its actual curve rather than a straight line.
function sampleWire(p1,p2,steps){
  const dx=Math.max(40,Math.abs(p2.x-p1.x)*0.5);
  const c1={x:p1.x+dx,y:p1.y}, c2={x:p2.x-dx,y:p2.y};
  const pts=[];
  for(let i=0;i<=steps;i++){
    const t=i/steps, mt=1-t;
    const x = mt*mt*mt*p1.x + 3*mt*mt*t*c1.x + 3*mt*t*t*c2.x + t*t*t*p2.x;
    const y = mt*mt*mt*p1.y + 3*mt*mt*t*c1.y + 3*mt*t*t*c2.y + t*t*t*p2.y;
    pts.push({x,y});
  }
  return pts;
}
// Find the existing link (if any) that a dragged node currently overlaps, so it
// can be spliced in between. Only nodes with both an input and an output are
// eligible, and a node's own wires are excluded.
function findNearbyLink(node){
  const type=NODE_TYPES[node.type];
  if(!type.inputs.length || !type.outputs.length) return null;
  const el=document.getElementById(node.id); if(!el) return null;
  const r=el.getBoundingClientRect(), wrap=graphWrap.getBoundingClientRect();
  const centerX=(r.left+r.width/2-wrap.left-viewX)/viewScale;
  const centerY=(r.top+r.height/2-wrap.top-viewY)/viewScale;
  let best=null, bestDist=Infinity;
  links.forEach(l=>{
    if(l.from===node.id || l.to===node.id) return;
    const p1=localSocketXY(l.from,'out', outSockIndex(l.from, l.fromSock));
    const p2=localSocketXY(l.to,'in', l.toSock);
    const pts=sampleWire(p1,p2,24);
    for(const pt of pts){
      const dist=Math.hypot(pt.x-centerX, pt.y-centerY);
      if(dist<bestDist){ bestDist=dist; best=l; }
    }
  });
  return (best && bestDist<=WIRE_INSERT_PX) ? best : null;
}
function setWireInsertHighlight(link, node){
  if(hoverWireLink && hoverWireLink.id!==(link&&link.id)){
    const prevEl=document.getElementById('wire_'+hoverWireLink.id); if(prevEl) prevEl.classList.remove('insert-target');
    const nodeEl=document.getElementById(node.id); if(nodeEl) nodeEl.classList.remove('drop-target');
  }
  hoverWireLink=link;
  const nodeEl=document.getElementById(node.id);
  if(link){
    const wEl=document.getElementById('wire_'+link.id); if(wEl) wEl.classList.add('insert-target');
    if(nodeEl) nodeEl.classList.add('drop-target');
  } else if(nodeEl){ nodeEl.classList.remove('drop-target'); }
}
function clearWireInsertHighlight(node){
  if(hoverWireLink){ const wEl=document.getElementById('wire_'+hoverWireLink.id); if(wEl) wEl.classList.remove('insert-target'); }
  if(node){ const nodeEl=document.getElementById(node.id); if(nodeEl) nodeEl.classList.remove('drop-target'); }
  hoverWireLink=null;
}
// Splice a node into the middle of an existing link: old source -> node -> old target.
function insertNodeIntoLink(node, link){
  const type=NODE_TYPES[node.type];
  if(!type.inputs.length || !type.outputs.length) return;
  const { from, fromSock, to, toSock } = link;
  const fromNode=nodes[from], toNode=nodes[to];
  removeLink(link.id);
  addLink(from, fromSock, node.id, 0, false);
  addLink(node.id, type.outputs[0], to, toSock, false);
  makeRoomForInsertedNode(node, fromNode, toNode);
  renderNode(fromNode); renderNode(node); renderNode(toNode);
  drawWires();
  showToast('Inserted '+node.title+' into the wire');
}
// Shift a node and everything connected further downstream (or upstream) by dx,
// so an inserted node doesn't end up overlapping its new neighbors — mirrors the
// "push the chain apart" behavior Blender's node editor does on link-drop.
function shiftChain(startId, dx, direction, visited){
  if(visited.has(startId)) return;
  visited.add(startId);
  const node=nodes[startId]; if(!node) return;
  node.x += dx;
  const el=document.getElementById(startId); if(el) el.style.left=node.x+'px';
  const nextIds = direction==='downstream'
    ? links.filter(l=>l.from===startId).map(l=>l.to)
    : links.filter(l=>l.to===startId).map(l=>l.from);
  nextIds.forEach(id=>shiftChain(id, dx, direction, visited));
}
function makeRoomForInsertedNode(newNode, fromNode, toNode){
  const excluded=new Set([newNode.id]);
  if(toNode){
    const neededToX = newNode.x + NODE_WIDTH + INSERT_MARGIN;
    if(toNode.x < neededToX) shiftChain(toNode.id, neededToX-toNode.x, 'downstream', new Set(excluded));
  }
  if(fromNode){
    const fromRightEdge = fromNode.x + NODE_WIDTH;
    const maxAllowedRightEdge = newNode.x - INSERT_MARGIN;
    if(fromRightEdge > maxAllowedRightEdge) shiftChain(fromNode.id, maxAllowedRightEdge-fromRightEdge, 'upstream', new Set(excluded));
  }
}

function drawWires(){
  wireSvg.innerHTML='';
  links.forEach(l=>{
    const p1=localSocketXY(l.from,'out', outSockIndex(l.from, l.fromSock));
    const p2=localSocketXY(l.to,'in', l.toSock);
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('class','wire'+(selectedLinkId===l.id?' selected':''));
    path.setAttribute('d', wirePath(p1,p2));
    path.setAttribute('id','wire_'+l.id);
    path.addEventListener('click',(e)=>{ e.stopPropagation(); selectedLinkId=l.id; drawWires(); });
    path.addEventListener('dblclick',(e)=>{ e.stopPropagation(); removeLink(l.id); });
    wireSvg.appendChild(path);
  });
  sizeSvg();
}
function outSockIndex(nodeId, sockName){
  const node=nodes[nodeId]; if(!node) return 0;
  const outs=NODE_TYPES[node.type].outputs; const i=outs.indexOf(sockName); return i<0?0:i;
}
function sizeSvg(){
  let maxX=1200, maxY=900;
  Object.values(nodes).forEach(n=>{ maxX=Math.max(maxX,n.x+400); maxY=Math.max(maxY,n.y+400); });
  wireSvg.setAttribute('width',maxX); wireSvg.setAttribute('height',maxY);
  wireSvg.style.width=maxX+'px'; wireSvg.style.height=maxY+'px';
}

// A Blender-style color ramp: a gradient bar with draggable stop markers.
// Click empty bar space to add a stop (seeded with the ramp's own color at
// that point), drag a marker to reposition it, click a marker to select it
// and edit its color below. Interpolation itself is a plain 'select' param
// defined alongside 'stops', so it reuses the existing select control.
function buildColorRamp(node, pd){
  const wrap=document.createElement('div'); wrap.className='ramp-wrap';
  const label=document.createElement('div'); label.className='row-label'; label.innerHTML=`<span>${pd.label}</span>`;
  wrap.appendChild(label);

  const bar=document.createElement('div'); bar.className='ramp-bar';
  const track=document.createElement('div'); track.className='ramp-track';
  bar.appendChild(track);
  wrap.appendChild(bar);

  const controls=document.createElement('div'); controls.className='ramp-controls';
  const colorInp=document.createElement('input'); colorInp.type='color';
  const delBtn=document.createElement('div'); delBtn.className='ramp-del'; delBtn.textContent='Remove stop';
  controls.appendChild(colorInp); controls.appendChild(delBtn);
  wrap.appendChild(controls);
  const hint=document.createElement('div'); hint.className='ramp-hint'; hint.textContent='Click the bar to add a stop';
  wrap.appendChild(hint);

  const stops=()=>node.params[pd.key];
  let selectedIdx=0;

  function interpolation(){ return node.params.interpolation||'Linear'; }
  function gradientCss(){
    const s=stops().slice().sort((a,b)=>a.pos-b.pos);
    if(interpolation()==='Constant'){
      const parts=[];
      s.forEach((st,i)=>{ const nextPos = i<s.length-1 ? s[i+1].pos : 1; parts.push(`${st.color} ${st.pos*100}%`, `${st.color} ${nextPos*100}%`); });
      return `linear-gradient(to right, ${parts.join(',')})`;
    }
    return `linear-gradient(to right, ${s.map(st=>`${st.color} ${st.pos*100}%`).join(',')})`;
  }

  function refresh(){
    bar.style.background=gradientCss();
    track.innerHTML='';
    stops().forEach((st,i)=>{
      const m=document.createElement('div'); m.className='ramp-marker'+(i===selectedIdx?' selected':'');
      m.style.left=(st.pos*100)+'%'; m.style.background=st.color;
      m.addEventListener('mousedown',(e)=>{
        e.stopPropagation(); e.preventDefault(); selectedIdx=i; refresh();
        const rect=bar.getBoundingClientRect();
        function onMove(ev){
          const pos=Math.min(1,Math.max(0,(ev.clientX-rect.left)/rect.width));
          stops()[i].pos=pos; markDirtyForward(node.id); scheduleEval(); refresh();
        }
        function onUp(){ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); pushHistory(); }
        document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
      });
      track.appendChild(m);
    });
    colorInp.value=stops()[selectedIdx].color;
    delBtn.classList.toggle('disabled', stops().length<=2);
  }

  bar.addEventListener('mousedown',(e)=>{
    if(e.target!==track) return;
    e.stopPropagation();
    const rect=bar.getBoundingClientRect();
    const pos=Math.min(1,Math.max(0,(e.clientX-rect.left)/rect.width));
    const color=sampleRampHex(stops(), pos, interpolation());
    stops().push({pos,color});
    selectedIdx=stops().length-1;
    markDirtyForward(node.id); scheduleEval(); refresh(); pushHistory();
  });
  colorInp.addEventListener('mousedown', e=>e.stopPropagation());
  colorInp.addEventListener('input', ()=>{ stops()[selectedIdx].color=colorInp.value; markDirtyForward(node.id); scheduleEval(); refresh(); });
  colorInp.addEventListener('change', ()=>pushHistory());
  delBtn.addEventListener('mousedown', e=>e.stopPropagation());
  delBtn.addEventListener('click', ()=>{
    if(stops().length<=2) return;
    stops().splice(selectedIdx,1); selectedIdx=Math.max(0,selectedIdx-1);
    markDirtyForward(node.id); scheduleEval(); refresh(); pushHistory();
  });

  refresh();
  return wrap;
}

// A Blender-style number slider: the whole bar is the drag surface (drag L/R
// to scrub the value, hold Shift for fine control), a plain click with no
// drag switches to a text field for typing an exact value, and small arrows
// fade in at each edge to nudge by one step.
function buildBlenderSlider(node, pd){
  const min=pd.min, max=pd.max, step=pd.step||1, decimals=(String(step).split('.')[1]||'').length;
  const wrap=document.createElement('div'); wrap.className='bslider';
  const fill=document.createElement('div'); fill.className='bs-fill';
  const face=document.createElement('div'); face.className='bs-face';
  const labelEl=document.createElement('span'); labelEl.className='bs-label'; labelEl.textContent=pd.label;
  const valueEl=document.createElement('span'); valueEl.className='bs-value';
  face.appendChild(labelEl); face.appendChild(valueEl);
  const arrowL=document.createElement('div'); arrowL.className='bs-arrow left'; arrowL.textContent='◂';
  const arrowR=document.createElement('div'); arrowR.className='bs-arrow right'; arrowR.textContent='▸';
  wrap.appendChild(fill); wrap.appendChild(face); wrap.appendChild(arrowL); wrap.appendChild(arrowR);

  wrap.tabIndex=0; wrap.setAttribute('role','slider'); wrap.setAttribute('aria-label', pd.label);
  wrap.setAttribute('aria-valuemin', min); wrap.setAttribute('aria-valuemax', max);

  function fmt(v){ return decimals? v.toFixed(decimals) : Math.round(v)+''; }
  function setValue(v, commit, applyToAll){
    v=Math.min(max,Math.max(min, Math.round(v/step)*step));
    v=parseFloat(v.toFixed(6));
    node.params[pd.key]=v;
    valueEl.textContent=fmt(v)+(pd.unit||'');
    fill.style.width=((v-min)/(max-min)*100)+'%';
    wrap.setAttribute('aria-valuenow', v);
    markDirtyForward(node.id);
    if(applyToAll) propagateParamToSelection(node, pd.key, v);
    scheduleEval();
    if(commit) pushHistory();
  }
  setValue(node.params[pd.key], false);
  wrap.addEventListener('keydown', (e)=>{
    if(e.key==='ArrowRight'){ e.preventDefault(); setValue(node.params[pd.key]+step*(e.shiftKey?10:1), true, e.altKey); }
    else if(e.key==='ArrowLeft'){ e.preventDefault(); setValue(node.params[pd.key]-step*(e.shiftKey?10:1), true, e.altKey); }
    else if(e.key==='Enter'){ e.preventDefault(); enterEdit(); }
  });

  function enterEdit(){
    wrap.classList.add('editing');
    const input=document.createElement('input'); input.className='bs-edit'; input.type='text';
    input.value=fmt(node.params[pd.key]);
    fill.style.visibility='hidden'; face.style.visibility='hidden'; arrowL.style.visibility='hidden'; arrowR.style.visibility='hidden';
    wrap.appendChild(input);
    input.addEventListener('mousedown', e=>e.stopPropagation());
    input.focus(); input.select();
    function commit(apply){
      if(apply){ const n=parseFloat(input.value); if(!isNaN(n)) setValue(n, true); }
      input.remove(); fill.style.visibility=''; face.style.visibility=''; arrowL.style.visibility=''; arrowR.style.visibility='';
      wrap.classList.remove('editing');
    }
    input.addEventListener('keydown', e=>{
      if(e.key==='Enter'){ commit(true); }
      else if(e.key==='Escape'){ commit(false); }
    });
    input.addEventListener('blur', ()=>commit(true));
  }

  let dragging=false, startX=0, startVal=0, dragApplyToAll=false;
  wrap.addEventListener('mousedown', (e)=>{
    e.stopPropagation();
    if(e.target===arrowL||e.target===arrowR) return;
    dragging=false; startX=e.clientX; startVal=node.params[pd.key]; dragApplyToAll=e.altKey;
    const rect=wrap.getBoundingClientRect();
    function onMove(ev){
      const dx=ev.clientX-startX;
      if(!dragging && Math.abs(dx)>3){ dragging=true; wrap.classList.add('scrubbing'); }
      if(!dragging) return;
      const sensitivity = ev.shiftKey ? 0.15 : 1;
      const ratio = dx / rect.width * sensitivity;
      setValue(startVal + ratio*(max-min), false, dragApplyToAll);
    }
    function onUp(){
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      wrap.classList.remove('scrubbing');
      if(dragging){ pushHistory(); }
      else { enterEdit(); }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  arrowL.addEventListener('mousedown', e=>{ e.stopPropagation(); setValue(node.params[pd.key]-step, true, e.altKey); });
  arrowR.addEventListener('mousedown', e=>{ e.stopPropagation(); setValue(node.params[pd.key]+step, true, e.altKey); });

  return wrap;
}

// Blender's "Alt+drag/click applies to every selected object" convention:
// hold Alt while changing a control to push the same value into every other
// selected node of the same type that has a param with this key.
function propagateParamToSelection(node, key, value){
  if(selectedNodeIds.size<=1 || !selectedNodeIds.has(node.id)) return;
  selectedNodeIds.forEach(id=>{
    if(id===node.id) return;
    const n=nodes[id]; if(!n || n.type!==node.type) return;
    if(!(key in n.params)) return;
    n.params[key]=value; markDirtyForward(id); renderNode(n);
  });
}

function buildControl(node, pd){
  const row=document.createElement('div'); row.className='row';
  const val = node.params[pd.key];
  if(pd.type==='slider'){
    row.appendChild(buildBlenderSlider(node, pd));
  } else if(pd.type==='ramp'){
    return buildColorRamp(node, pd);
  } else if(pd.type==='select'){
    row.innerHTML = `<div class="row-label"><span>${pd.label}</span></div>`;
    const sel=document.createElement('select'); sel.className='n-select'; sel.setAttribute('aria-label', pd.label);
    pd.options.forEach(o=>{ const opt=document.createElement('option'); opt.value=o; opt.textContent=o; if(o===val) opt.selected=true; sel.appendChild(opt); });
    sel.addEventListener('mousedown',e=>e.stopPropagation());
    sel.addEventListener('change', (e)=>{
      node.params[pd.key]=sel.value; markDirtyForward(node.id);
      if(e.altKey) propagateParamToSelection(node, pd.key, sel.value);
      scheduleEval();
      if(pd.refreshNode) renderNode(node); // e.g. ramp interpolation — its preview lives in a sibling row
      pushHistory();
    });
    row.appendChild(sel);
  } else if(pd.type==='color'){
    row.innerHTML = `<div class="row-label"><span>${pd.label}</span></div>`;
    const inp=document.createElement('input'); inp.type='color'; inp.value=val; inp.setAttribute('aria-label', pd.label);
    inp.addEventListener('mousedown',e=>e.stopPropagation());
    inp.addEventListener('input', (e)=>{ node.params[pd.key]=inp.value; markDirtyForward(node.id); if(e.altKey) propagateParamToSelection(node, pd.key, inp.value); scheduleEval(); });
    inp.addEventListener('change', ()=>pushHistory());
    row.appendChild(inp);
  } else if(pd.type==='toggle'){
    row.innerHTML = `<div class="row-label"><span>${pd.label}</span></div>`;
    const seg=document.createElement('div'); seg.className='seg-row';
    const on=document.createElement('div'); on.className='seg-btn'+(val?' active':''); on.textContent='On';
    const off=document.createElement('div'); off.className='seg-btn'+(!val?' active':''); off.textContent='Off';
    on.addEventListener('click',(e)=>{ node.params[pd.key]=true; on.classList.add('active'); off.classList.remove('active'); markDirtyForward(node.id); if(e.altKey) propagateParamToSelection(node, pd.key, true); scheduleEval(); pushHistory(); });
    off.addEventListener('click',(e)=>{ node.params[pd.key]=false; off.classList.add('active'); on.classList.remove('active'); markDirtyForward(node.id); if(e.altKey) propagateParamToSelection(node, pd.key, false); scheduleEval(); pushHistory(); });
    seg.appendChild(on); seg.appendChild(off); row.appendChild(seg);
  } else if(pd.type==='text'){
    row.innerHTML = `<div class="row-label"><span>${pd.label}</span></div>`;
    const inp=document.createElement('input'); inp.type='text'; inp.className='n-text-input'; inp.value=val||''; inp.setAttribute('aria-label', pd.label);
    inp.addEventListener('mousedown',e=>e.stopPropagation());
    inp.addEventListener('input', ()=>{ node.params[pd.key]=inp.value; markDirtyForward(node.id); scheduleEval(); });
    inp.addEventListener('change', ()=>pushHistory());
    row.appendChild(inp);
  }
  return row;
}

// Preview any node's output in the Viewer without touching the real Output
// node's wiring — Export always uses the actual Output node regardless.
let previewPinId=null;
function setPreviewPin(id){
  previewPinId = (previewPinId===id) ? null : id;
  document.querySelectorAll('.node-pin').forEach(b=>b.classList.toggle('active', b.dataset.node===previewPinId));
  scheduleEval();
}
// Makes a small icon-only control (mute/delete/pin) keyboard-operable and
// announce itself to assistive tech, mirroring what a native <button> gives
// you for free — these are plain divs so click ripples don't fight the drag
// handlers on the node header.
function a11yButton(el, label){
  el.setAttribute('role','button'); el.setAttribute('aria-label', label); el.tabIndex=0;
  el.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); el.click(); } });
}
function renderNode(node){
  const type=NODE_TYPES[node.type]; const cat=CATS[type.category];
  let el=document.getElementById(node.id);
  const isNew = !el;
  if(!el){ el=document.createElement('div'); el.className='node'; el.id=node.id; graphLayer.appendChild(el); }
  el.style.left=node.x+'px'; el.style.top=node.y+'px';
  el.innerHTML='';

  el.classList.toggle('muted', !!node.muted);
  const header=document.createElement('div'); header.className='node-header'; header.style.background=cat.color;
  const titleSpan=document.createElement('span'); titleSpan.className='n-title'; titleSpan.textContent=node.title;
  titleSpan.title='Double-click to rename';
  titleSpan.addEventListener('mousedown', (e)=>startNodeDrag(e,node));
  titleSpan.addEventListener('touchstart', (e)=>startNodeDrag(e,node), {passive:false});
  titleSpan.addEventListener('dblclick', (e)=>{
    e.stopPropagation();
    const input=document.createElement('input'); input.className='n-title-edit'; input.value=node.title;
    input.addEventListener('mousedown', ev=>ev.stopPropagation());
    titleSpan.replaceWith(input); input.focus(); input.select();
    function commit(){ node.title=input.value.trim()||NODE_TYPES[node.type].title; renderNode(node); pushHistory(); }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', ev=>{ if(ev.key==='Enter') input.blur(); else if(ev.key==='Escape'){ input.value=node.title; input.blur(); } });
  });
  header.appendChild(titleSpan);
  if(node._error){
    const errBadge=document.createElement('div'); errBadge.className='node-error-badge'; errBadge.textContent='!';
    errBadge.title='Error: '+node._error;
    header.appendChild(errBadge);
    el.classList.add('node-error');
  } else {
    el.classList.remove('node-error');
  }
  if(type.outputs.length>0){
    const pin=document.createElement('div'); pin.className='node-pin'+(previewPinId===node.id?' active':''); pin.textContent='◎';
    pin.dataset.node=node.id;
    pin.title='Preview this node\'s output in the Viewer, without rewiring Output';
    a11yButton(pin, 'Preview this node in the Viewer');
    pin.addEventListener('mousedown',e=>e.stopPropagation());
    pin.addEventListener('click',(e)=>{ e.stopPropagation(); setPreviewPin(node.id); });
    header.appendChild(pin);
  }
  const canMute = type.inputs.length>0 && type.outputs.length===1; // bypass only makes sense for a single output
  if(canMute){
    const mute=document.createElement('div'); mute.className='node-mute'+(node.muted?' active':''); mute.textContent='⏻';
    mute.title='Mute / bypass this node (M)';
    a11yButton(mute, 'Mute this node');
    mute.addEventListener('mousedown',e=>e.stopPropagation());
    mute.addEventListener('click',(e)=>{ e.stopPropagation(); toggleMuteNodes([node.id]); });
    header.appendChild(mute);
  }
  const del=document.createElement('div'); del.className='node-del'; del.textContent='✕';
  a11yButton(del, 'Delete this node');
  del.addEventListener('mousedown',e=>e.stopPropagation());
  del.addEventListener('click',(e)=>{ e.stopPropagation(); removeNode(node.id); drawWires(); pushHistory(); });
  header.appendChild(del);
  el.appendChild(header);

  const body=document.createElement('div'); body.className='node-body';

  if(type.special==='image-source'){
    const thumb=document.createElement('div'); thumb.className='node-thumb';
    if(node._thumbUrl){ thumb.innerHTML=''; const thumbImg=document.createElement('img'); thumbImg.src=node._thumbUrl; thumb.appendChild(thumbImg); }
    else { thumb.innerHTML=`<div class="ph">No photo loaded</div>`; }
    body.appendChild(thumb);
    const btn=document.createElement('div'); btn.className='file-btn'; btn.textContent=node._thumbUrl? 'Replace photo' : 'Choose photo…';
    btn.addEventListener('mousedown',e=>e.stopPropagation());
    btn.addEventListener('click', ()=>{ pendingImageNodeId=node.id; document.getElementById('fileInput').click(); });
    body.appendChild(btn);
  } else if(type.special==='output'){
    const note=document.createElement('div'); note.className='node-note'; note.textContent='Wires its input straight to the Viewer panel and Export.';
    body.appendChild(note);
  }

  type.params.forEach(pd=>body.appendChild(buildControl(node,pd)));
  el.appendChild(body);

  // sockets
  type.inputs.forEach((name,idx)=>{
    const s=document.createElement('div'); s.className='socket socket-in'; s.dataset.idx=idx; s.dataset.node=node.id; s.dataset.dir='in';
    const has = links.some(l=>l.to===node.id && l.toSock===idx);
    if(has) s.classList.add('filled');
    positionSocketVert(s, idx, type.inputs.length, header, body);
    s.addEventListener('mousedown', e=>{ e.stopPropagation(); e.preventDefault(); selectNode(node.id); startWireDrag(s); });
    s.addEventListener('touchstart', e=>{ e.stopPropagation(); e.preventDefault(); selectNode(node.id); startWireDrag(s); }, {passive:false});
    el.appendChild(s);
    if(type.inputs.length>1){
      const lab=document.createElement('div'); lab.className='socket-label in'; lab.textContent=name;
      lab.style.top=s.style.top; el.appendChild(lab);
    }
  });
  type.outputs.forEach((name,idx)=>{
    const s=document.createElement('div'); s.className='socket socket-out'; s.dataset.idx=idx; s.dataset.node=node.id; s.dataset.dir='out';
    const has = links.some(l=>l.from===node.id && l.fromSock===name);
    if(has) s.classList.add('filled');
    positionSocketVert(s, idx, type.outputs.length, header, body);
    s.addEventListener('mousedown', e=>{ e.stopPropagation(); e.preventDefault(); selectNode(node.id); startWireDrag(s); });
    s.addEventListener('touchstart', e=>{ e.stopPropagation(); e.preventDefault(); selectNode(node.id); startWireDrag(s); }, {passive:false});
    el.appendChild(s);
    if(type.outputs.length>1){
      const lab=document.createElement('div'); lab.className='socket-label out'; lab.textContent=name;
      lab.style.top=s.style.top; el.appendChild(lab);
    }
  });

  header.addEventListener('mousedown', (e)=>startNodeDrag(e,node));
  header.addEventListener('touchstart', (e)=>startNodeDrag(e,node), {passive:false});
  el.addEventListener('mousedown', (e)=>{ e.stopPropagation(); if(e.shiftKey) selectNode(node.id, true); else if(!selectedNodeIds.has(node.id)) selectNode(node.id, false); });
  el.addEventListener('touchstart', (e)=>{ e.stopPropagation(); if(!selectedNodeIds.has(node.id)) selectNode(node.id, false); });

  // reachable by Tab, and focusing it selects it so Delete/Ctrl+D work from the keyboard
  el.tabIndex=0; el.setAttribute('role','group'); el.setAttribute('aria-label', node.title+' node');
  el.addEventListener('focus', ()=>{ if(!selectedNodeIds.has(node.id)) selectNode(node.id, false); });

  requestAnimationFrame(drawWires);
  return el;
}
function positionSocketVert(sockEl, idx, count, header, body){
  const headerH=36;
  const top = headerH + 14 + idx*20;
  sockEl.style.top = top+'px';
}

function selectNode(id, additive){
  if(additive){
    if(selectedNodeIds.has(id)) selectedNodeIds.delete(id); else selectedNodeIds.add(id);
  } else {
    selectedNodeIds = new Set([id]);
  }
  selectedLinkId=null;
  document.querySelectorAll('.node').forEach(n=>n.classList.toggle('selected', selectedNodeIds.has(n.id)));
  drawWires();
}
function clearSelection(){
  selectedNodeIds=new Set();
  document.querySelectorAll('.node').forEach(n=>n.classList.remove('selected'));
}
function toggleMuteNodes(ids){
  ids.forEach(id=>{
    const n=nodes[id]; if(!n) return;
    const type=NODE_TYPES[n.type];
    if(!type.inputs.length || !type.outputs.length) return; // only pass-through-capable nodes can be muted
    n.muted=!n.muted;
    markDirtyForward(id);
    renderNode(n);
  });
  scheduleEval(); pushHistory();
}
function duplicateSelected(){
  if(!selectedNodeIds.size) return;
  const idMap={}; const newIds=[];
  selectedNodeIds.forEach(id=>{
    const src=nodes[id]; if(!src) return;
    const copy=addNode(src.type, src.x+28, src.y+28, false);
    copy.params=JSON.parse(JSON.stringify(src.params));
    copy.title=src.title; copy.muted=src.muted;
    if(src.type==='image' && src._src){ copy._src=src._src; copy._thumbUrl=src._thumbUrl; copy._fullSrc=src._fullSrc||null; imageAssets[copy.id]={src:src._src, thumbUrl:src._thumbUrl}; }
    idMap[id]=copy.id; newIds.push(copy.id);
  });
  links.slice().forEach(l=>{
    if(idMap[l.from] && idMap[l.to]) addLink(idMap[l.from], l.fromSock, idMap[l.to], l.toSock, false);
  });
  newIds.forEach(id=>renderNode(nodes[id]));
  selectedNodeIds=new Set(newIds);
  document.querySelectorAll('.node').forEach(n=>n.classList.toggle('selected', selectedNodeIds.has(n.id)));
  drawWires(); pushHistory(); scheduleEval();
  showToast('Duplicated '+newIds.length+' node'+(newIds.length===1?'':'s'));
}

/* ---- clipboard copy/paste: unlike duplicate, this goes through the OS
   clipboard as JSON text, so it also works across browser tabs/windows.
   Loaded photos aren't included (canvases can't round-trip through text) —
   only structure, params, and titles copy over. ---- */
async function copySelectedToClipboard(){
  if(!selectedNodeIds.size) return;
  const ids=Array.from(selectedNodeIds);
  const nodesOut={};
  ids.forEach(id=>{
    const n=nodes[id];
    nodesOut[id]={ type:n.type, x:n.x, y:n.y, title:n.title, muted:!!n.muted, params:JSON.parse(JSON.stringify(n.params)) };
  });
  const linksOut=links.filter(l=>ids.includes(l.from) && ids.includes(l.to));
  const payload=JSON.stringify({ luminClipboard:1, nodes:nodesOut, links:linksOut });
  try{ await navigator.clipboard.writeText(payload); showToast('Copied '+ids.length+' node'+(ids.length===1?'':'s')); }
  catch(e){ showToast('Clipboard copy failed — check browser permissions'); }
}
async function pasteFromClipboard(){
  let text;
  try{ text=await navigator.clipboard.readText(); }
  catch(e){ showToast('Clipboard paste blocked — click the page first, or check browser permissions'); return; }
  let data; try{ data=JSON.parse(text); }catch(e){ return; } // not our JSON — silently ignore, it's just whatever was on the clipboard
  if(!data || data.luminClipboard!==1 || !data.nodes) return;
  const idMap={}; const newIds=[];
  Object.entries(data.nodes).forEach(([oldId,nd])=>{
    if(!NODE_TYPES[nd.type]) return;
    const copy=addNode(nd.type, nd.x+28, nd.y+28, false);
    copy.params=JSON.parse(JSON.stringify(nd.params)); copy.title=nd.title; copy.muted=!!nd.muted;
    idMap[oldId]=copy.id; newIds.push(copy.id);
  });
  (data.links||[]).forEach(l=>{ if(idMap[l.from] && idMap[l.to]) addLink(idMap[l.from], l.fromSock, idMap[l.to], l.toSock, false); });
  if(!newIds.length) return;
  newIds.forEach(id=>renderNode(nodes[id]));
  selectedNodeIds=new Set(newIds);
  document.querySelectorAll('.node').forEach(n=>n.classList.toggle('selected', selectedNodeIds.has(n.id)));
  drawWires(); pushHistory(); scheduleEval();
  showToast('Pasted '+newIds.length+' node'+(newIds.length===1?'':'s'));
}

/* ============================================================
   PREVIEW
   ============================================================ */
const previewStage=document.getElementById('previewStage');
const previewContent=document.getElementById('previewContent'); // rewritten on every update; computingIndicator/compareDivider are siblings so they survive that
const viewerSub=document.getElementById('viewerSub');
let previewCanvasEl=null;
let compareDividerEl=null, splitPos=0.5, lastCompareOriginal=null, lastCompareGraded=null;
// The actual graded result, independent of what the viewer canvas is currently
// showing (which, in split-compare mode, is a composite of graded+original) —
// this is what Export should use for a "working size" download.
let lastGradedCanvas=null;

function updatePreview(canvas, isOriginal){
  if(compareDividerEl){ compareDividerEl.remove(); compareDividerEl=null; }
  const pinning = !!(previewPinId && nodes[previewPinId]);
  if(!outputNodeId && !isOriginal && !pinning){
    viewerSub.textContent='no Output node in graph';
    previewContent.innerHTML='<div class="preview-empty">Add an <b>Output</b> node and wire something into it — or pin a node\'s output with ◎.</div>';
    drawHistogram(null);
    return;
  }
  if(!canvas){
    const hasLink = pinning || (outputNodeId && links.some(l=>l.to===outputNodeId));
    viewerSub.textContent = hasLink ? (pinning?'pinned node has no input yet':'Output input is empty') : 'nothing wired into Output';
    previewContent.innerHTML = hasLink
      ? '<div class="preview-empty">Load a photo into the Image node upstream to see it here.</div>'
      : '<div class="preview-empty">Connect a node into the Output node\'s input.</div>';
    drawHistogram(null);
    return;
  }
  viewerSub.textContent = (isOriginal?'original — ':'') + (pinning?'pinned: '+nodes[previewPinId].title+' — ':'') + canvas.width+' × '+canvas.height;
  if(!previewCanvasEl || !previewContent.contains(previewCanvasEl)){
    previewContent.innerHTML=''; previewCanvasEl=document.createElement('canvas'); previewContent.appendChild(previewCanvasEl);
  }
  previewCanvasEl.width=canvas.width; previewCanvasEl.height=canvas.height;
  previewCanvasEl.getContext('2d').drawImage(canvas,0,0);
  if(!isOriginal) lastGradedCanvas=canvas;
  drawHistogram(canvas);
}

/* ---- split-view compare: draws the graded result with the original clipped
   in from the left up to a draggable divider, Lightroom-style, instead of an
   all-or-nothing swap. ---- */
function updatePreviewSplit(original, graded){
  lastCompareOriginal=original; lastCompareGraded=graded;
  if(graded) lastGradedCanvas=graded;
  const canvas = graded || original;
  if(!canvas){
    viewerSub.textContent='nothing to compare yet';
    previewContent.innerHTML='<div class="preview-empty">Load a photo and wire something into Output to compare.</div>';
    if(compareDividerEl){ compareDividerEl.remove(); compareDividerEl=null; }
    drawHistogram(null);
    return;
  }
  viewerSub.textContent = 'compare — '+canvas.width+' × '+canvas.height;
  if(!previewCanvasEl || !previewContent.contains(previewCanvasEl)){
    previewContent.innerHTML=''; previewCanvasEl=document.createElement('canvas'); previewContent.appendChild(previewCanvasEl);
  }
  if(!compareDividerEl || !previewStage.contains(compareDividerEl)) ensureCompareDivider();
  previewCanvasEl.width=canvas.width; previewCanvasEl.height=canvas.height;
  redrawSplit();
  positionCompareDivider();
  drawHistogram(canvas);
}
function redrawSplit(){
  const graded=lastCompareGraded, original=lastCompareOriginal;
  const canvas = graded || original; if(!canvas || !previewCanvasEl) return;
  const ctx=previewCanvasEl.getContext('2d');
  ctx.clearRect(0,0,previewCanvasEl.width,previewCanvasEl.height);
  if(graded) ctx.drawImage(graded,0,0);
  if(original){
    const splitX=previewCanvasEl.width*splitPos;
    ctx.save(); ctx.beginPath(); ctx.rect(0,0,splitX,previewCanvasEl.height); ctx.clip();
    ctx.drawImage(original,0,0,previewCanvasEl.width,previewCanvasEl.height);
    ctx.restore();
  }
}
function ensureCompareDivider(){
  compareDividerEl=document.createElement('div'); compareDividerEl.className='compare-divider';
  const handle=document.createElement('div'); handle.className='compare-divider-handle'; handle.textContent='⇔';
  compareDividerEl.appendChild(handle);
  previewStage.appendChild(compareDividerEl);
  function onDown(e){
    e.preventDefault(); e.stopPropagation();
    function onMove(ev){
      const point = ev.touches ? ev.touches[0] : ev;
      const rect=previewStage.getBoundingClientRect();
      splitPos=Math.min(1,Math.max(0,(point.clientX-rect.left)/rect.width));
      redrawSplit(); positionCompareDivider();
    }
    function onUp(){
      document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp);
      document.removeEventListener('touchmove',onMove); document.removeEventListener('touchend',onUp);
    }
    document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
    document.addEventListener('touchmove',onMove,{passive:false}); document.addEventListener('touchend',onUp);
  }
  compareDividerEl.addEventListener('mousedown', onDown);
  compareDividerEl.addEventListener('touchstart', onDown, {passive:false});
}
function positionCompareDivider(){
  if(compareDividerEl) compareDividerEl.style.left=(splitPos*100)+'%';
}

/* ---- live RGB histogram of whatever's currently in the viewer ---- */
function drawHistogram(canvas){
  const hc=document.getElementById('histogramCanvas'); if(!hc) return;
  const ctx=hc.getContext('2d'); ctx.clearRect(0,0,hc.width,hc.height);
  if(!canvas) return;
  const sw=Math.min(canvas.width,240), sh=Math.min(canvas.height,160);
  const sc=document.createElement('canvas'); sc.width=sw; sc.height=sh;
  sc.getContext('2d').drawImage(canvas,0,0,sw,sh);
  const data=sc.getContext('2d').getImageData(0,0,sw,sh).data;
  const r=new Uint32Array(256), g=new Uint32Array(256), b=new Uint32Array(256);
  for(let i=0;i<data.length;i+=4){ r[data[i]]++; g[data[i+1]]++; b[data[i+2]]++; }
  let max=1; for(let i=0;i<256;i++){ if(r[i]>max)max=r[i]; if(g[i]>max)max=g[i]; if(b[i]>max)max=b[i]; }
  function drawChannel(arr,color){
    ctx.strokeStyle=color; ctx.beginPath();
    for(let x=0;x<256;x++){
      const px=x/255*hc.width, py=hc.height-(arr[x]/max)*hc.height;
      if(x===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation='lighter'; ctx.globalAlpha=0.85; ctx.lineWidth=1;
  drawChannel(r,'#ff5a5a'); drawChannel(g,'#4ce08a'); drawChannel(b,'#5a9bff');
  ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
}

