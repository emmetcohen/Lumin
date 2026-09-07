'use strict';

/* ============================================================
   INTERACTION: pan / zoom / drag nodes / drag wires
   ============================================================ */
let isPanning=false, panStart=null;
let isDraggingNode=false, dragNode=null, dragOffset=null;
let isBoxSelecting=false, boxSelectStart=null, boxSelectEl=null;
let isDraggingWire=false, wireStart=null, wireDragEl=null;
let wireSnapTarget=null;   // socket el the dragged wire is currently magnet-snapped to
let hoverWireLink=null;    // link currently under a dragged node, eligible for insertion
let wireWasDetached=false; // true if this wire-drag started by unplugging an existing connection
const SNAP_PX=26;          // screen-pixel radius for wire-to-socket snapping
const WIRE_INSERT_PX=46;   // graph-unit radius for node-over-wire detection
const INSERT_MARGIN=60;    // graph-unit breathing room kept on each side of an inserted node

graphWrap.addEventListener('mousedown', (e)=>{
  if(e.target===graphWrap || e.target===graphLayer){
    if(e.shiftKey){
      isBoxSelecting=true;
      const rect=graphWrap.getBoundingClientRect();
      boxSelectStart={x:e.clientX-rect.left, y:e.clientY-rect.top};
      boxSelectEl=document.createElement('div'); boxSelectEl.className='box-select'; graphWrap.appendChild(boxSelectEl);
      updateBoxSelect(e);
    } else {
      isPanning=true; panStart={x:e.clientX-viewX, y:e.clientY-viewY};
      graphWrap.classList.add('panning');
      selectedLinkId=null; clearSelection();
      drawWires();
    }
  }
});
function updateBoxSelect(e){
  const rect=graphWrap.getBoundingClientRect();
  const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
  const x1=Math.min(boxSelectStart.x,cx), x2=Math.max(boxSelectStart.x,cx);
  const y1=Math.min(boxSelectStart.y,cy), y2=Math.max(boxSelectStart.y,cy);
  boxSelectEl.style.left=x1+'px'; boxSelectEl.style.top=y1+'px'; boxSelectEl.style.width=(x2-x1)+'px'; boxSelectEl.style.height=(y2-y1)+'px';
  const newSel=new Set();
  Object.values(nodes).forEach(n=>{
    const el=document.getElementById(n.id); if(!el) return;
    const r=el.getBoundingClientRect();
    const nx1=r.left-rect.left, nx2=r.right-rect.left, ny1=r.top-rect.top, ny2=r.bottom-rect.top;
    if(nx1<x2 && nx2>x1 && ny1<y2 && ny2>y1) newSel.add(n.id);
  });
  selectedNodeIds=newSel;
  document.querySelectorAll('.node').forEach(n=>n.classList.toggle('selected', selectedNodeIds.has(n.id)));
}
window.addEventListener('mousemove', (e)=>{
  if(isPanning){ viewX=e.clientX-panStart.x; viewY=e.clientY-panStart.y; applyView(); }
  if(isBoxSelecting){ updateBoxSelect(e); }
  if(isDraggingNode && dragNode){
    const rect=graphWrap.getBoundingClientRect();
    const newX=(e.clientX-rect.left-viewX)/viewScale - dragOffset.x;
    const newY=(e.clientY-rect.top-viewY)/viewScale - dragOffset.y;
    const dx=newX-dragNode.x, dy=newY-dragNode.y;
    // move every selected node together, not just the one grabbed — mirrors
    // Blender's group-drag behavior when multiple nodes are selected.
    selectedNodeIds.forEach(id=>{
      const n=nodes[id]; if(!n) return;
      n.x+=dx; n.y+=dy;
      const el=document.getElementById(id); if(el){ el.style.left=n.x+'px'; el.style.top=n.y+'px'; }
    });
    drawWires();
    if(selectedNodeIds.size===1) setWireInsertHighlight(findNearbyLink(dragNode), dragNode);
  }
  if(isDraggingWire){ updateWireDrag(e); }
});
window.addEventListener('mouseup', (e)=>{
  if(isPanning){ isPanning=false; graphWrap.classList.remove('panning'); }
  if(isBoxSelecting){ isBoxSelecting=false; if(boxSelectEl){ boxSelectEl.remove(); boxSelectEl=null; } drawWires(); }
  if(isDraggingNode){
    if(hoverWireLink && dragNode && selectedNodeIds.size===1) insertNodeIntoLink(dragNode, hoverWireLink);
    clearWireInsertHighlight(dragNode);
    isDraggingNode=false; dragNode=null; pushHistory();
  }
  if(isDraggingWire){ finishWireDrag(e); }
});
// Safety net: if the window loses focus mid-drag (alt-tab, devtools, etc.) we'll
// never get the matching mouseup, which would otherwise leave the app stuck
// mid-drag with stray highlight styles.
window.addEventListener('blur', ()=>{
  if(isPanning){ isPanning=false; graphWrap.classList.remove('panning'); }
  if(isBoxSelecting){ isBoxSelecting=false; if(boxSelectEl){ boxSelectEl.remove(); boxSelectEl=null; } }
  if(isDraggingNode){ clearWireInsertHighlight(dragNode); isDraggingNode=false; dragNode=null; }
  if(isDraggingWire){ clearSnapHighlight(); if(wireDragEl){ wireDragEl.remove(); wireDragEl=null; } isDraggingWire=false; wireStart=null; wireWasDetached=false; }
});
graphWrap.addEventListener('wheel', (e)=>{
  e.preventDefault();
  const rect=graphWrap.getBoundingClientRect();
  const mx=e.clientX-rect.left, my=e.clientY-rect.top;
  const before={ x:(mx-viewX)/viewScale, y:(my-viewY)/viewScale };
  // Scale the zoom step to how far the wheel actually moved, instead of a flat
  // 10% per event. Trackpads fire many small events per gesture, so a flat
  // step compounded into very fast, jumpy zooming; this makes it proportional
  // and smooth while still letting a fast flick zoom quickly.
  const clampedDelta = Math.max(-50, Math.min(50, e.deltaY));
  const factor = Math.exp(-clampedDelta * 0.003);
  viewScale=Math.min(2.2, Math.max(0.25, viewScale*factor));
  viewX = mx - before.x*viewScale; viewY = my - before.y*viewScale;
  applyView();
}, { passive:false });

function startNodeDrag(e, node){
  if(e.stopPropagation) e.stopPropagation();
  if(e.preventDefault) e.preventDefault();
  const point = e.touches ? e.touches[0] : e; // accept a touch event or a mouse event
  if(e.shiftKey) selectNode(node.id, true);
  else if(!selectedNodeIds.has(node.id)) selectNode(node.id, false);
  // else: node is already part of a multi-selection — keep the whole selection so it drags as a group
  const rect=graphWrap.getBoundingClientRect();
  const gx=(point.clientX-rect.left-viewX)/viewScale, gy=(point.clientY-rect.top-viewY)/viewScale;
  isDraggingNode=true; dragNode=node; dragOffset={x:gx-node.x, y:gy-node.y};
}

function startWireDrag(sockEl){
  const nodeId=sockEl.dataset.node, dir=sockEl.dataset.dir, idx=parseInt(sockEl.dataset.idx,10);
  wireWasDetached=false;
  if(dir==='in'){
    // if already connected, detach and drag from the source end instead
    const existing=links.find(l=>l.to===nodeId && l.toSock===idx);
    if(existing){
      const fromId=existing.from, fromSockIdx=outSockIndex(existing.from, existing.fromSock);
      removeLink(existing.id);
      wireWasDetached=true;
      isDraggingWire=true; wireStart={ nodeId:fromId, dir:'out', idx:fromSockIdx };
    } else {
      isDraggingWire=true; wireStart={ nodeId, dir:'in', idx };
    }
  } else {
    isDraggingWire=true; wireStart={ nodeId, dir:'out', idx };
  }
  wireDragEl=document.createElementNS('http://www.w3.org/2000/svg','path');
  wireDragEl.setAttribute('class','wire-drag');
  wireSvg.appendChild(wireDragEl);
}
// Find the nearest compatible socket to the cursor (screen space), for magnetic
// snapping while dragging a wire. Only sockets facing the opposite direction of
// the drag start, and not on the originating node, are eligible.
function findSnapSocket(e){
  if(!wireStart) return null;
  const wantDir = wireStart.dir==='out' ? 'in' : 'out';
  let best=null, bestDist=Infinity;
  document.querySelectorAll('.socket-'+wantDir).forEach(s=>{
    if(s.dataset.node===wireStart.nodeId) return;
    const r=s.getBoundingClientRect();
    const cx=r.left+r.width/2, cy=r.top+r.height/2;
    const dist=Math.hypot(e.clientX-cx, e.clientY-cy);
    if(dist<bestDist){ bestDist=dist; best={ el:s, cx, cy }; }
  });
  return (best && bestDist<=SNAP_PX) ? best : null;
}
function clearSnapHighlight(){
  if(wireSnapTarget && wireSnapTarget.el) wireSnapTarget.el.classList.remove('snap-target');
  wireSnapTarget=null;
}
function updateWireDrag(e){
  if(!wireStart) return;
  const rect=graphWrap.getBoundingClientRect();
  const snap=findSnapSocket(e);
  if(wireSnapTarget && wireSnapTarget.el!==(snap&&snap.el)) clearSnapHighlight();
  let p2;
  if(snap){
    snap.el.classList.add('snap-target');
    wireSnapTarget=snap;
    p2={ x:(snap.cx-rect.left-viewX)/viewScale, y:(snap.cy-rect.top-viewY)/viewScale };
  } else {
    p2={ x:(e.clientX-rect.left-viewX)/viewScale, y:(e.clientY-rect.top-viewY)/viewScale };
  }
  const p1=localSocketXY(wireStart.nodeId, wireStart.dir, wireStart.idx);
  wireDragEl.setAttribute('d', wireStart.dir==='out'? wirePath(p1,p2) : wirePath(p2,p1));
}
function finishWireDrag(e){
  // Prefer the magnet-snapped socket (forgiving target); fall back to whatever's
  // literally under the cursor.
  const target = (wireSnapTarget && wireSnapTarget.el) || document.elementFromPoint(e.clientX, e.clientY);
  if(wireDragEl) wireDragEl.remove();
  let reconnected=false;
  if(target && target.classList && target.classList.contains('socket') && wireStart){
    const nodeId=target.dataset.node, dir=target.dataset.dir, idx=parseInt(target.dataset.idx,10);
    if(dir!==wireStart.dir && nodeId!==wireStart.nodeId){
      let fromId, fromSockName, toId, toSockIdx;
      if(wireStart.dir==='out'){ fromId=wireStart.nodeId; fromSockName=NODE_TYPES[nodes[fromId].type].outputs[wireStart.idx]; toId=nodeId; toSockIdx=idx; }
      else { fromId=nodeId; fromSockName=NODE_TYPES[nodes[fromId].type].outputs[idx]; toId=wireStart.nodeId; toSockIdx=wireStart.idx; }
      const linkId=addLink(fromId, fromSockName, toId, toSockIdx); // null if that would create a cycle
      if(linkId){ renderNode(nodes[fromId]); renderNode(nodes[toId]); reconnected=true; }
    }
  }
  // If we unplugged an existing wire and it wasn't reconnected anywhere, that
  // disconnection needs its own history entry or an immediate Ctrl+Z won't undo it.
  if(!reconnected && wireWasDetached) pushHistory();
  wireWasDetached=false;
  clearSnapHighlight();
  isDraggingWire=false; wireStart=null; wireDragEl=null;
  drawWires();
}

document.addEventListener('keydown',(e)=>{
  if(document.activeElement.tagName==='INPUT') return; // never intercept while typing
  if(e.key==='Delete'||e.key==='Backspace'){
    if(selectedNodeIds.size){ Array.from(selectedNodeIds).forEach(id=>removeNode(id)); selectedNodeIds=new Set(); drawWires(); pushHistory(); }
    else if(selectedLinkId){ removeLink(selectedLinkId); selectedLinkId=null; pushHistory(); }
  }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z'){
    e.preventDefault(); if(e.shiftKey) redo(); else undo();
  }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='d'){
    e.preventDefault(); duplicateSelected();
  }
  if(e.key.toLowerCase()==='m' && !e.ctrlKey && !e.metaKey && selectedNodeIds.size){
    toggleMuteNodes(Array.from(selectedNodeIds));
  }
  if(e.key==='\\'){ document.getElementById('compareBtn').click(); }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='c' && selectedNodeIds.size){
    e.preventDefault(); copySelectedToClipboard();
  }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='v'){
    e.preventDefault(); pasteFromClipboard();
  }
  if(e.key==='?'){ e.preventDefault(); showShortcutsHelp(); }
});

/* ---- touch: single-finger pan/drag-node/drag-wire, two-finger pinch-zoom.
   Mirrors the mouse handlers above so the app is usable on a tablet or
   touchscreen. Box-select (Shift+drag on desktop) has no touch gesture here. ---- */
let pinchStartDist=null, pinchStartScale=1, pinchStartMid=null;
function touchDist(t0,t1){ return Math.hypot(t1.clientX-t0.clientX, t1.clientY-t0.clientY); }
function touchMid(t0,t1){ return { x:(t0.clientX+t1.clientX)/2, y:(t0.clientY+t1.clientY)/2 }; }
graphWrap.addEventListener('touchstart', (e)=>{
  if(e.touches.length===2){
    e.preventDefault();
    isPanning=false;
    pinchStartDist=touchDist(e.touches[0],e.touches[1]);
    pinchStartScale=viewScale;
    pinchStartMid=touchMid(e.touches[0],e.touches[1]);
    return;
  }
  if(e.touches.length===1 && (e.target===graphWrap || e.target===graphLayer)){
    const t=e.touches[0];
    isPanning=true; panStart={x:t.clientX-viewX, y:t.clientY-viewY};
    selectedLinkId=null; clearSelection(); drawWires();
  }
}, { passive:false });
graphWrap.addEventListener('touchmove', (e)=>{
  if(e.touches.length===2 && pinchStartDist!=null){
    e.preventDefault();
    const dist=touchDist(e.touches[0],e.touches[1]);
    const rect=graphWrap.getBoundingClientRect();
    const mid=touchMid(e.touches[0],e.touches[1]);
    const before={ x:(pinchStartMid.x-rect.left-viewX)/viewScale, y:(pinchStartMid.y-rect.top-viewY)/viewScale };
    viewScale=Math.min(2.2, Math.max(0.25, pinchStartScale*(dist/pinchStartDist)));
    viewX = mid.x-rect.left - before.x*viewScale; viewY = mid.y-rect.top - before.y*viewScale;
    applyView();
    return;
  }
  if(e.touches.length===1){
    const t=e.touches[0];
    if(isPanning){ e.preventDefault(); viewX=t.clientX-panStart.x; viewY=t.clientY-panStart.y; applyView(); }
    if(isDraggingNode && dragNode){
      e.preventDefault();
      const rect=graphWrap.getBoundingClientRect();
      const newX=(t.clientX-rect.left-viewX)/viewScale - dragOffset.x;
      const newY=(t.clientY-rect.top-viewY)/viewScale - dragOffset.y;
      const dx=newX-dragNode.x, dy=newY-dragNode.y;
      selectedNodeIds.forEach(id=>{
        const n=nodes[id]; if(!n) return; n.x+=dx; n.y+=dy;
        const el=document.getElementById(id); if(el){ el.style.left=n.x+'px'; el.style.top=n.y+'px'; }
      });
      drawWires();
    }
    if(isDraggingWire){ e.preventDefault(); updateWireDrag(t); }
  }
}, { passive:false });
graphWrap.addEventListener('touchend', (e)=>{
  if(e.touches.length<2) pinchStartDist=null;
  if(e.touches.length===0){
    if(isPanning) isPanning=false;
    if(isDraggingNode){ isDraggingNode=false; dragNode=null; pushHistory(); }
    if(isDraggingWire){ finishWireDrag(e.changedTouches[0]); }
  }
});

/* ============================================================
   HISTORY (undo/redo)
   ============================================================ */
let historyStack=[]; let historyIdx=-1; let restoring=false;
function serializeGraph(){
  const nodesOut={};
  Object.values(nodes).forEach(n=>{ nodesOut[n.id]={ id:n.id, type:n.type, x:n.x, y:n.y, title:n.title, muted:!!n.muted, params:JSON.parse(JSON.stringify(n.params)) }; });
  return JSON.stringify({ nodes:nodesOut, links, outputNodeId, nextId });
}
function pushHistory(){
  if(restoring) return;
  const snap=serializeGraph();
  if(historyStack[historyIdx]===snap) return; // nothing actually changed — don't spam the undo stack
  historyStack=historyStack.slice(0,historyIdx+1);
  historyStack.push(snap); historyIdx=historyStack.length-1;
  if(historyStack.length>60){ historyStack.shift(); historyIdx--; }
  if(typeof scheduleAutosave==='function') scheduleAutosave();
}
function restoreSnapshot(snap){
  restoring=true;
  const data=JSON.parse(snap);
  graphLayer.innerHTML=''; wireSvg.innerHTML='';
  nodes={}; links=data.links; outputNodeId=data.outputNodeId; nextId=data.nextId;
  Object.values(data.nodes).forEach(nd=>{
    const asset=imageAssets[nd.id];
    const node={ id:nd.id, type:nd.type, x:nd.x, y:nd.y, params:nd.params, title:nd.title||NODE_TYPES[nd.type].title, muted:!!nd.muted,
      _src: asset? asset.src : null, _cache:null, _dirty:true, _thumbUrl: asset? asset.thumbUrl : null,
      _fullSrc: asset? (asset.fullSrc||null) : null };
    nodes[nd.id]=node;
  });
  selectedNodeIds=new Set(Array.from(selectedNodeIds).filter(id=>nodes[id]));
  Object.values(nodes).forEach(n=>renderNode(n));
  applyView(); drawWires(); scheduleEval();
  restoring=false;
}
function undo(){ if(historyIdx<=0) return; historyIdx--; restoreSnapshot(historyStack[historyIdx]); }
function redo(){ if(historyIdx>=historyStack.length-1) return; historyIdx++; restoreSnapshot(historyStack[historyIdx]); }
document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);
document.getElementById('zoomHud').addEventListener('click', ()=>{
  const rect=graphWrap.getBoundingClientRect(); const cx=rect.width/2, cy=rect.height/2;
  const before={ x:(cx-viewX)/viewScale, y:(cy-viewY)/viewScale };
  viewScale=1; viewX=cx-before.x*viewScale; viewY=cy-before.y*viewScale; applyView();
});

