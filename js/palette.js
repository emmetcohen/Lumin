'use strict';

/* ============================================================
   PALETTE (left sidebar + floating add menu)
   ============================================================ */
const paletteList=document.getElementById('paletteList');
function buildPalette(filter){
  paletteList.innerHTML='';
  const q=(filter||'').toLowerCase();
  PALETTE_ORDER.forEach(catKey=>{
    const items=Object.entries(NODE_TYPES).filter(([k,t])=>t.category===catKey && (!q || t.title.toLowerCase().includes(q)));
    if(!items.length) return;
    const cat=document.createElement('div'); cat.className='palette-cat';
    const head=document.createElement('div'); head.className='palette-cat-head';
    head.innerHTML=`<div class="palette-cat-dot" style="background:${CATS[catKey].color}"></div><span>${CATS[catKey].label}</span><span class="chev">▾</span>`;
    head.addEventListener('click',()=>cat.classList.toggle('collapsed'));
    cat.appendChild(head);
    const list=document.createElement('div'); list.className='palette-items';
    items.forEach(([key,t])=>{
      const it=document.createElement('div'); it.className='palette-item'; it.textContent=t.title; it.draggable=true;
      it.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/node-type', key); });
      it.addEventListener('click', ()=>{ const c=graphWrapCenterGraphCoords(); addNode(key, c.x, c.y); });
      list.appendChild(it);
    });
    cat.appendChild(list);
    paletteList.appendChild(cat);
  });
  if(!paletteList.children.length){ paletteList.innerHTML='<div class="palette-empty">No nodes match “'+filter+'”</div>'; }
}
document.getElementById('paletteSearch').addEventListener('input', e=>buildPalette(e.target.value));
buildPalette('');

graphWrap.addEventListener('dragover', e=>e.preventDefault());
graphWrap.addEventListener('drop', e=>{
  e.preventDefault(); const key=e.dataTransfer.getData('text/node-type'); if(!key) return;
  const rect=graphWrap.getBoundingClientRect();
  const gx=(e.clientX-rect.left-viewX)/viewScale, gy=(e.clientY-rect.top-viewY)/viewScale;
  addNode(key, gx-NODE_WIDTH/2, gy-20);
});

function graphWrapCenterGraphCoords(){
  const rect=graphWrap.getBoundingClientRect();
  return { x:(rect.width/2 - viewX)/viewScale - NODE_WIDTH/2, y:(rect.height/2 - viewY)/viewScale - 20 };
}

/* floating add-node menu */
let addMenuEl=null;
function openAddMenu(clientX, clientY, graphX, graphY){
  closeAddMenu();
  addMenuEl=document.createElement('div'); addMenuEl.className='add-menu';
  let left=clientX, top=clientY;
  addMenuEl.style.left=Math.min(left, window.innerWidth-250)+'px';
  addMenuEl.style.top=Math.min(top, window.innerHeight-360)+'px';
  addMenuEl.innerHTML = `<div class="add-menu-search"><input type="text" placeholder="Search…" autofocus></div><div class="add-menu-list"></div>`;
  document.body.appendChild(addMenuEl);
  const listEl=addMenuEl.querySelector('.add-menu-list');
  const searchEl=addMenuEl.querySelector('input');
  function refresh(q){
    listEl.innerHTML='';
    PALETTE_ORDER.forEach(catKey=>{
      const items=Object.entries(NODE_TYPES).filter(([k,t])=>t.category===catKey && (!q || t.title.toLowerCase().includes(q.toLowerCase())));
      if(!items.length) return;
      const head=document.createElement('div'); head.className='palette-cat-head';
      head.innerHTML=`<div class="palette-cat-dot" style="background:${CATS[catKey].color}"></div><span>${CATS[catKey].label}</span>`;
      listEl.appendChild(head);
      items.forEach(([key,t])=>{
        const it=document.createElement('div'); it.className='palette-item'; it.textContent=t.title;
        it.addEventListener('click', ()=>{ addNode(key, graphX-NODE_WIDTH/2, graphY-20); closeAddMenu(); });
        listEl.appendChild(it);
      });
    });
  }
  refresh(''); searchEl.addEventListener('input', ()=>refresh(searchEl.value));
  searchEl.focus();
  setTimeout(()=>document.addEventListener('mousedown', onDocClickCloseMenu),0);
}
function onDocClickCloseMenu(e){ if(addMenuEl && !addMenuEl.contains(e.target)) closeAddMenu(); }
function closeAddMenu(){ if(addMenuEl){ addMenuEl.remove(); addMenuEl=null; document.removeEventListener('mousedown', onDocClickCloseMenu); } }

document.getElementById('addBtn').addEventListener('click', (e)=>{
  const c=graphWrapCenterGraphCoords(); openAddMenu(e.clientX, e.clientY, c.x+NODE_WIDTH/2, c.y+20);
});
graphWrap.addEventListener('contextmenu', (e)=>{
  e.preventDefault(); const rect=graphWrap.getBoundingClientRect();
  const gx=(e.clientX-rect.left-viewX)/viewScale, gy=(e.clientY-rect.top-viewY)/viewScale;
  openAddMenu(e.clientX, e.clientY, gx, gy);
});

