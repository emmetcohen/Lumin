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
document.getElementById('clearBtn').addEventListener('click', ()=>{
  if(!Object.keys(nodes).length) return;
  if(!confirm('Clear the whole graph? This can\'t be undone.')) return;
  graphLayer.innerHTML=''; wireSvg.innerHTML=''; nodes={}; links=[]; outputNodeId=null; selectedNodeIds=new Set(); selectedLinkId=null;
  imageAssets={}; historyStack=[]; historyIdx=-1; pushHistory(); applyView(); scheduleEval();
});
function doExport(){
  if(!previewCanvasEl){ showToast('Nothing to export yet'); return; }
  const a=document.createElement('a'); a.download='lumin-export.png'; a.href=previewCanvasEl.toDataURL('image/png'); a.click();
}
document.getElementById('exportBtn').addEventListener('click', doExport);
document.getElementById('exportBtn2').addEventListener('click', doExport);

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
  document.getElementById('compareBtn').textContent = compareMode ? '⇄ Showing original' : '⇄ Compare original';
  runEvaluation();
});

/* ============================================================
   BOOTSTRAP — restore an autosaved session, or start with a
   friendly Image -> Output chain
   ============================================================ */
function bootstrap(){
  let restored=false;
  try{
    const saved=localStorage.getItem('lumin-autosave-v1');
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
