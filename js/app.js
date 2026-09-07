'use strict';

/* ============================================================
   TOP BAR ACTIONS
   ============================================================ */
document.getElementById('frameBtn').addEventListener('click', ()=>{
  const list=Object.values(nodes); if(!list.length) return;
  const minX=Math.min(...list.map(n=>n.x)), minY=Math.min(...list.map(n=>n.y));
  const maxX=Math.max(...list.map(n=>n.x+NODE_WIDTH)), maxY=Math.max(...list.map(n=>n.y+260));
  const rect=graphWrap.getBoundingClientRect();
  const contentW=maxX-minX, contentH=maxY-minY;
  viewScale=Math.min(1.4, Math.max(0.3, Math.min(rect.width/(contentW+120), rect.height/(contentH+120))));
  viewX = -minX*viewScale + 60; viewY = -minY*viewScale + 60;
  applyView();
});
document.getElementById('clearBtn').addEventListener('click', async ()=>{
  if(!Object.keys(nodes).length) return;
  if(!(await showConfirm('Clear the whole graph? This can\'t be undone.'))) return;
  graphLayer.innerHTML=''; wireSvg.innerHTML=''; nodes={}; links=[]; outputNodeId=null; previewPinId=null; selectedNodeIds=new Set(); selectedLinkId=null;
  imageAssets={}; historyStack=[]; historyIdx=-1; pushHistory(); applyView(); scheduleEval();
});

/* ---- export: recomputes the graph once at full photo resolution when
   available, instead of exporting the downscaled editing proxy ---- */
function hasFullResAvailable(){
  return Object.values(nodes).some(n=>n.type==='image' && n._fullSrc);
}
async function exportFullRes(){
  const swapped=[];
  Object.values(nodes).forEach(n=>{
    if(n.type==='image' && n._fullSrc){ swapped.push({node:n, prevSrc:n._src}); n._src=n._fullSrc; }
  });
  const prevProjectSize=projectSize;
  const firstFull=swapped[0];
  if(firstFull) projectSize={ w:firstFull.node._fullSrc.width, h:firstFull.node._fullSrc.height };
  Object.values(nodes).forEach(n=>{ n._dirty=true; }); // generate nodes depend on projectSize, not graph edges — force everything fresh
  const indicator=document.getElementById('computingIndicator'); if(indicator) indicator.hidden=false;
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); // let the indicator actually paint first
  let outCanvas=null;
  try{ outCanvas = outputNodeId ? evaluateNode(outputNodeId) : null; }
  finally{
    swapped.forEach(({node,prevSrc})=>{ node._src=prevSrc; });
    projectSize=prevProjectSize;
    Object.values(nodes).forEach(n=>{ n._dirty=true; });
    if(indicator) indicator.hidden=true;
    scheduleEval(); // restore the normal working-resolution preview
  }
  return outCanvas;
}
function downloadCanvas(canvas, format){
  if(!canvas){ showToast('Nothing to export yet'); return; }
  const ext = format==='image/jpeg' ? 'jpg' : 'png';
  const a=document.createElement('a'); a.download='lumin-export.'+ext;
  a.href = format==='image/jpeg' ? canvas.toDataURL('image/jpeg',0.92) : canvas.toDataURL('image/png');
  a.click();
}
async function doExport(){
  if(!lastGradedCanvas && !hasFullResAvailable()){ showToast('Nothing to export yet'); return; }
  const choice = await showExportOptions({ fullResAvailable: hasFullResAvailable() });
  if(!choice) return;
  if(choice.resolution==='full'){
    const canvas = await exportFullRes();
    downloadCanvas(canvas, choice.format);
  } else {
    downloadCanvas(lastGradedCanvas, choice.format);
  }
}
document.getElementById('exportBtn').addEventListener('click', doExport);
document.getElementById('exportBtn2').addEventListener('click', doExport);
document.getElementById('projectsBtn').addEventListener('click', openProjectsPanel);

function showToast(msg){
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(showToast._tm); showToast._tm=setTimeout(()=>t.classList.remove('show'),2200);
}


/* ============================================================
   COMPARE — toggle the viewer between the graded output and the
   original loaded photo (Lightroom-style before/after)
   ============================================================ */
let compareMode=false;
function findFirstImageSource(){
  const n=Object.values(nodes).find(n=>n.type==='image' && n._src);
  return n ? n._src : null;
}
document.getElementById('compareBtn').addEventListener('click', ()=>{
  compareMode=!compareMode;
  document.getElementById('compareBtn').classList.toggle('btn-accent', compareMode);
  document.getElementById('compareBtn').textContent = compareMode ? '⇄ Hide split compare' : '⇄ Compare original';
  runEvaluation();
});

/* ============================================================
   BOOTSTRAP — restore an autosaved session, or start with a
   friendly Image -> Output chain
   ============================================================ */
function bootstrap(){
  let restored=false;
  try{
    const saved=localStorage.getItem(AUTOSAVE_KEY);
    if(saved && JSON.parse(saved).nodes && Object.keys(JSON.parse(saved).nodes).length){
      loadProjectData(saved);
      restored=true;
      showToast('Restored your last session');
    }
  }catch(err){ /* localStorage unavailable or corrupt autosave — fall through to default */ }
  if(!restored){
    const img=addNode('image', 80, 140, false);
    const out=addNode('output', 560, 150, false);
    addLink(img.id, 'Image', out.id, 0, false);
    applyView();
    pushHistory();
  }
}
bootstrap();
window.addEventListener('resize', drawWires);
