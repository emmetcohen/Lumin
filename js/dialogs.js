'use strict';

/* ============================================================
   MODAL DIALOG — replaces blocking confirm()/prompt() with something that
   matches the app's own dark UI instead of the browser's native dialog.
   ============================================================ */
let modalResolve=null;
function closeModal(result){
  const overlay=document.getElementById('modalOverlay');
  overlay.hidden=true; overlay.innerHTML='';
  if(modalResolve){ const r=modalResolve; modalResolve=null; r(result); }
}
const SHORTCUTS=[
  ['Ctrl/Cmd+Z','Undo'], ['Ctrl/Cmd+Shift+Z','Redo'], ['Ctrl/Cmd+D','Duplicate selected nodes'],
  ['Ctrl/Cmd+C','Copy selected nodes'], ['Ctrl/Cmd+V','Paste nodes (works across tabs)'],
  ['Delete / Backspace','Delete selected node or link'], ['M','Mute/bypass selected nodes'],
  ['\\','Toggle split-view compare'], ['Shift+drag','Box-select on empty canvas'],
  ['Alt+drag or click','Apply a control to every selected node of that type'],
  ['Arrow keys','Nudge a focused slider (Shift for ×10)'], ['Tab','Move focus between nodes'],
  ['Esc','Close a dialog, or cancel color picking'], ['?','Show this help'],
];
function showShortcutsHelp(){
  const overlay=document.getElementById('modalOverlay'); overlay.hidden=false;
  overlay.innerHTML=`
    <div class="modal-box modal-wide">
      <div class="modal-title">Keyboard shortcuts</div>
      <div class="shortcuts-list">${SHORTCUTS.map(([k,d])=>`<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>
      <div class="modal-actions"><button class="btn" id="closeShortcutsBtn">Close</button></div>
    </div>`;
  overlay.querySelector('#closeShortcutsBtn').addEventListener('click', ()=>closeModal(null));
  overlay.onmousedown = (e)=>{ if(e.target===overlay) closeModal(null); };
}

document.addEventListener('keydown', e=>{
  const overlay=document.getElementById('modalOverlay');
  if(e.key==='Escape' && overlay && !overlay.hidden) closeModal(null);
});

function showConfirm(message, opts){
  opts=opts||{};
  return new Promise(resolve=>{
    modalResolve=resolve;
    const overlay=document.getElementById('modalOverlay'); overlay.hidden=false;
    overlay.innerHTML=`
      <div class="modal-box">
        <div class="modal-msg"></div>
        <div class="modal-actions">
          <button class="btn" data-act="cancel">${opts.cancelLabel||'Cancel'}</button>
          <button class="btn btn-accent" data-act="ok">${opts.okLabel||'OK'}</button>
        </div>
      </div>`;
    overlay.querySelector('.modal-msg').textContent=message;
    overlay.querySelector('[data-act="ok"]').addEventListener('click', ()=>closeModal(true));
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', ()=>closeModal(false));
    overlay.querySelector('[data-act="ok"]').focus();
    overlay.onmousedown = e=>{ if(e.target===overlay) closeModal(false); };
  });
}

function showPrompt(message, defaultValue){
  return new Promise(resolve=>{
    modalResolve=resolve;
    const overlay=document.getElementById('modalOverlay'); overlay.hidden=false;
    overlay.innerHTML=`
      <div class="modal-box">
        <div class="modal-msg"></div>
        <input type="text" class="modal-input">
        <div class="modal-actions">
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn btn-accent" data-act="ok">Save</button>
        </div>
      </div>`;
    overlay.querySelector('.modal-msg').textContent=message;
    const inp=overlay.querySelector('.modal-input'); inp.value=defaultValue||'';
    const finish=(v)=>closeModal(v);
    overlay.querySelector('[data-act="ok"]').addEventListener('click', ()=>finish(inp.value.trim()||null));
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', ()=>finish(null));
    inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); finish(inp.value.trim()||null); } });
    overlay.onmousedown = e=>{ if(e.target===overlay) finish(null); };
    inp.focus(); inp.select();
  });
}

/* ============================================================
   EXPORT OPTIONS — format (PNG/JPEG) and resolution (editing proxy vs. the
   original full-resolution photo, when one was loaded this session).
   ============================================================ */
function showExportOptions({ fullResAvailable }){
  return new Promise(resolve=>{
    modalResolve=resolve;
    const overlay=document.getElementById('modalOverlay'); overlay.hidden=false;
    overlay.innerHTML=`
      <div class="modal-box">
        <div class="modal-title">Export</div>
        <div class="modal-field">
          <label>Format</label>
          <select class="modal-select" id="expFormat">
            <option value="image/png">PNG (lossless)</option>
            <option value="image/jpeg">JPEG (smaller file)</option>
          </select>
        </div>
        <div class="modal-field">
          <label>Resolution</label>
          <select class="modal-select" id="expRes">
            <option value="working">Working size (fast)</option>
            <option value="full" ${fullResAvailable?'':'disabled'}>Full photo resolution${fullResAvailable?'':' (no photo loaded this session)'}</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn btn-accent" data-act="ok">Export</button>
        </div>
      </div>`;
    const finish=(v)=>closeModal(v);
    overlay.querySelector('[data-act="ok"]').addEventListener('click', ()=>{
      finish({ format:overlay.querySelector('#expFormat').value, resolution:overlay.querySelector('#expRes').value });
    });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', ()=>finish(null));
    overlay.onmousedown = e=>{ if(e.target===overlay) finish(null); };
  });
}

/* ============================================================
   NAMED PROJECT SLOTS — save/open/delete named projects in localStorage,
   alongside (not instead of) the existing download-a-.json-file workflow.
   ============================================================ */
const PROJECTS_KEY='lumin-projects-v1';
function loadProjectSlots(){ try{ return JSON.parse(localStorage.getItem(PROJECTS_KEY)||'{}'); }catch(e){ return {}; } }
function saveProjectSlots(slots){ try{ localStorage.setItem(PROJECTS_KEY, JSON.stringify(slots)); return true; }catch(e){ showToast('Could not save — storage full or blocked'); return false; } }

function openProjectsPanel(){
  const overlay=document.getElementById('modalOverlay');
  function render(){
    overlay.hidden=false;
    const slots=loadProjectSlots();
    const names=Object.keys(slots).sort();
    overlay.innerHTML=`
      <div class="modal-box modal-wide">
        <div class="modal-title">Projects</div>
        <div class="modal-actions modal-actions-top"><button class="btn btn-accent" id="saveAsBtn">Save current as…</button></div>
        <div class="projects-list">${names.length?'':'<div class="modal-empty">No saved projects yet</div>'}</div>
        <div class="modal-actions"><button class="btn" id="closeProjectsBtn">Close</button></div>
      </div>`;
    const list=overlay.querySelector('.projects-list');
    names.forEach(name=>{
      const row=document.createElement('div'); row.className='project-row';
      const label=document.createElement('div'); label.className='project-name'; label.textContent=name;
      const openBtn=document.createElement('button'); openBtn.className='btn'; openBtn.textContent='Open';
      const delBtn=document.createElement('button'); delBtn.className='btn btn-danger'; delBtn.textContent='Delete';
      openBtn.addEventListener('click', async ()=>{
        if(Object.keys(nodes).length && !(await showConfirm('Open "'+name+'"? This replaces your current graph.'))){ render(); return; }
        loadProjectData(slots[name]); showToast('Opened "'+name+'"'); closeModal(null);
      });
      delBtn.addEventListener('click', async ()=>{
        if(!(await showConfirm('Delete saved project "'+name+'"? This can\'t be undone.'))){ render(); return; }
        const s=loadProjectSlots(); delete s[name]; saveProjectSlots(s); render();
      });
      row.appendChild(label); row.appendChild(openBtn); row.appendChild(delBtn);
      list.appendChild(row);
    });
    overlay.querySelector('#saveAsBtn').addEventListener('click', async ()=>{
      const name=await showPrompt('Save current project as:', '');
      if(name){
        const s=loadProjectSlots(); s[name]=serializeProjectFull();
        if(saveProjectSlots(s)) showToast('Saved as "'+name+'"');
      }
      render();
    });
    overlay.querySelector('#closeProjectsBtn').addEventListener('click', ()=>closeModal(null));
    overlay.onmousedown = (e)=>{ if(e.target===overlay) closeModal(null); };
  }
  render();
}
