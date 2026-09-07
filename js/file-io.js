'use strict';

/* ============================================================
   FILE LOADING
   ============================================================ */
const MAX_DIM=1400;
let pendingImageNodeId=null;
// Loaded photo canvases live here, keyed by node id, *outside* the JSON undo
// history (canvases aren't serializable) — restoreSnapshot re-attaches from
// this table so undo/redo never wipes out a loaded photo.
let imageAssets = {};
document.getElementById('fileInput').addEventListener('change', (e)=>{
  const file=e.target.files[0]; if(!file || !pendingImageNodeId) return;
  const node=nodes[pendingImageNodeId]; if(!node) return;
  const prevUrl=node._thumbUrl;
  const url=URL.createObjectURL(file);
  const img=new Image();
  img.onload=()=>{
    let w=img.naturalWidth, h=img.naturalHeight; const scale=Math.min(1, MAX_DIM/Math.max(w,h));
    w=Math.round(w*scale); h=Math.round(h*scale);
    const c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(img,0,0,w,h);
    node._src=c; node._thumbUrl=url; node._dirty=true;
    imageAssets[node.id] = { src:c, thumbUrl:url };
    if(prevUrl) URL.revokeObjectURL(prevUrl);
    projectSize={w,h};
    markDirtyForward(node.id);
    renderNode(node);
    scheduleEval();
    showToast('Photo loaded into '+node.title);
  };
  img.onerror=()=>{ URL.revokeObjectURL(url); showToast('Could not load that image'); };
  img.src=url;
  e.target.value='';
});


/* ============================================================
   PROJECT SAVE / LOAD (full .json file, embeds loaded photos)
   ============================================================ */
function serializeProjectFull(){
  const nodesOut={};
  Object.values(nodes).forEach(n=>{
    nodesOut[n.id]={
      id:n.id, type:n.type, x:n.x, y:n.y, title:n.title, muted:!!n.muted,
      params:JSON.parse(JSON.stringify(n.params)),
      imageData: (n.type==='image' && n._src) ? n._src.toDataURL('image/png') : null
    };
  });
  return JSON.stringify({ version:1, nodes:nodesOut, links, outputNodeId, nextId, projectSize });
}
function doSaveProject(){
  if(!Object.keys(nodes).length){ showToast('Nothing to save yet'); return; }
  const blob=new Blob([serializeProjectFull()],{type:'application/json'});
  const a=document.createElement('a'); a.download='lumin-project.json'; a.href=URL.createObjectURL(blob); a.click();
  showToast('Project saved');
}
function loadProjectData(json){
  let data; try{ data=JSON.parse(json); }catch(e){ showToast('That file isn\'t a valid Lumin project'); return; }
  graphLayer.innerHTML=''; wireSvg.innerHTML=''; nodes={}; links=data.links||[];
  outputNodeId=data.outputNodeId||null; nextId=data.nextId||1; projectSize=data.projectSize||projectSize;
  imageAssets={}; selectedNodeIds=new Set(); selectedLinkId=null;
  const entries=Object.values(data.nodes||{});
  let pending=0;
  function finishIfDone(){ if(pending===0){ applyView(); drawWires(); scheduleEval(); historyStack=[]; historyIdx=-1; pushHistory(); } }
  entries.forEach(nd=>{
    if(!NODE_TYPES[nd.type]) return;
    const node={ id:nd.id, type:nd.type, x:nd.x, y:nd.y, title:nd.title||NODE_TYPES[nd.type].title, muted:!!nd.muted,
      params:nd.params, _src:null, _cache:null, _dirty:true, _thumbUrl:null };
    nodes[nd.id]=node;
    if(nd.id.match(/^n(\d+)$/)) nextId=Math.max(nextId, parseInt(RegExp.$1,10)+1);
    if(nd.imageData){
      pending++;
      const img=new Image();
      img.onload=()=>{
        const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight; c.getContext('2d').drawImage(img,0,0);
        node._src=c; node._thumbUrl=nd.imageData; imageAssets[node.id]={src:c, thumbUrl:nd.imageData};
        renderNode(node); pending--; finishIfDone();
      };
      img.onerror=()=>{ pending--; finishIfDone(); };
      img.src=nd.imageData;
    }
  });
  Object.values(nodes).forEach(n=>renderNode(n));
  finishIfDone();
}
document.getElementById('saveProjectBtn').addEventListener('click', doSaveProject);
document.getElementById('loadProjectBtn').addEventListener('click', ()=>{
  if(Object.keys(nodes).length && !confirm('Load a project? This replaces your current graph (autosave of the current graph is kept until you load).')) return;
  document.getElementById('projectFileInput').click();
});
document.getElementById('projectFileInput').addEventListener('change', (e)=>{
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{ loadProjectData(reader.result); showToast('Project loaded'); };
  reader.readAsText(file);
  e.target.value='';
});

/* ---- autosave to localStorage, so a refresh or closed tab never loses work ---- */
let autosaveTimer=null;
function scheduleAutosave(){
  clearTimeout(autosaveTimer);
  autosaveTimer=setTimeout(()=>{
    try{ localStorage.setItem('lumin-autosave-v1', serializeProjectFull()); }
    catch(err){ /* storage full/blocked — silently skip, nothing else we can do */ }
  }, 700);
}

