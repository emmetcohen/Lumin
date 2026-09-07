'use strict';

/* ============================================================
   GRAPH DATA MODEL
   ============================================================ */
let nodes = {};      // id -> node instance
let links = [];       // {id, from, fromSock, to, toSock}
let nextId = 1;
let selectedNodeIds = new Set(); // multi-select — Shift+click or Shift+drag box-select adds to this
let selectedLinkId = null;
let projectSize = { w: 1200, h: 800 };
let outputNodeId = null;

function uid(prefix){ return prefix + (nextId++); }

/* ============================================================
   NODE TYPE REGISTRY
   ============================================================ */
const CATS = {
  input:      { label:'Input',      color:'var(--cat-input)' },
  color:      { label:'Color',      color:'var(--cat-color)' },
  detail:     { label:'Detail',     color:'var(--cat-detail)' },
  distort:    { label:'Distort',    color:'var(--cat-distort)' },
  generate:   { label:'Generate',   color:'var(--cat-generate)' },
  finish:     { label:'Finish',     color:'var(--cat-finish)' },
  transform:  { label:'Transform',  color:'var(--cat-transform)' },
  composite:  { label:'Composite',  color:'var(--cat-composite)' },
  output:     { label:'Output',     color:'var(--cat-output)' },
};

function cloneCanvas(src){
  const c=document.createElement('canvas'); c.width=src.width; c.height=src.height;
  c.getContext('2d').drawImage(src,0,0); return c;
}
function pixelType(paramsDef, fn){
  return {
    inputs:['Image'], outputs:['Image'], params:paramsDef,
    compute(ins,p){
      const src=ins[0]; if(!src) return null;
      const out=cloneCanvas(src); const octx=out.getContext('2d');
      const id=octx.getImageData(0,0,out.width,out.height);
      fn(id.data,out.width,out.height,p); octx.putImageData(id,0,0); return out;
    }
  };
}

const NODE_TYPES = {

  // ---------------- INPUT ----------------
  image: {
    category:'input', title:'Image', inputs:[], outputs:['Image'], params:[], special:'image-source',
    compute(ins, p, node){ return node._src || null; }
  },

  // ---------------- COLOR ----------------
  exposure: { category:'color', title:'Exposure', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:-100,max:100,step:1,default:0}],
    (d,w,h,p)=>fxExposure(d,p.amount)) },

  contrast: { category:'color', title:'Contrast', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:-100,max:100,step:1,default:0}],
    (d,w,h,p)=>fxContrast(d,p.amount)) },

  levels: { category:'color', title:'Levels', ...pixelType(
    [
      {key:'highlights',label:'Highlights',type:'slider',min:-100,max:100,step:1,default:0},
      {key:'shadows',label:'Shadows',type:'slider',min:-100,max:100,step:1,default:0},
      {key:'whites',label:'Whites',type:'slider',min:-100,max:100,step:1,default:0},
      {key:'blacks',label:'Blacks',type:'slider',min:-100,max:100,step:1,default:0},
    ],
    (d,w,h,p)=>fxLevels(d,p)) },

  whiteBalance: { category:'color', title:'White Balance', ...pixelType(
    [
      {key:'temperature',label:'Temperature',type:'slider',min:-100,max:100,step:1,default:0},
      {key:'tint',label:'Tint',type:'slider',min:-100,max:100,step:1,default:0},
    ],
    (d,w,h,p)=>fxWhiteBalance(d,p)) },

  saturation: { category:'color', title:'Saturation', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:-100,max:100,step:1,default:0}],
    (d,w,h,p)=>fxSaturation(d,p.amount)) },

  vibrance: { category:'color', title:'Vibrance', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:-100,max:100,step:1,default:0}],
    (d,w,h,p)=>fxVibrance(d,p.amount)) },

  hueShift: { category:'color', title:'Hue Shift', ...pixelType(
    [{key:'degrees',label:'Degrees',type:'slider',min:-180,max:180,step:1,default:0,unit:'°'}],
    (d,w,h,p)=>fxHueShift(d,p.degrees)) },

  blackWhite: { category:'color', title:'Black & White', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:100}],
    (d,w,h,p)=>fxBlackWhite(d,p.amount)) },

  invert: { category:'color', title:'Invert', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:100}],
    (d,w,h,p)=>fxInvert(d,p.amount)) },

  colorRamp: { category:'color', title:'Color Ramp', ...pixelType(
    [
      {key:'stops',label:'Stops',type:'ramp',default:[{pos:0,color:'#000000'},{pos:0.5,color:'#3f8cff'},{pos:1,color:'#ffffff'}]},
      {key:'interpolation',label:'Interpolation',type:'select',options:['Linear','Ease','Constant'],default:'Linear',refreshNode:true},
      {key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:100},
    ],
    (d,w,h,p)=>fxColorRamp(d,p.stops,p.interpolation,p.amount)) },

  duotone: { category:'color', title:'Duotone', ...pixelType(
    [
      {key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:100},
      {key:'shadowColor',label:'Shadows',type:'color',default:'#16364a'},
      {key:'highlightColor',label:'Highlights',type:'color',default:'#ffb05c'},
    ],
    (d,w,h,p)=>fxDuotone(d,p)) },

  // ---------------- DETAIL ----------------
  clarity: { category:'detail', title:'Clarity', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:-100,max:100,step:1,default:0}],
    (d,w,h,p)=>fxClaritySharpen(d,w,h,p.amount,0)) },

  sharpen: { category:'detail', title:'Sharpen', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:0}],
    (d,w,h,p)=>fxClaritySharpen(d,w,h,0,p.amount)) },

  blur: { category:'detail', title:'Blur', ...pixelType(
    [{key:'radius',label:'Radius',type:'slider',min:0,max:60,step:1,default:0,unit:'px'}],
    (d,w,h,p)=>fxGaussianBlur(d,w,h,p.radius)) },

  noiseReduction: { category:'detail', title:'Noise Reduction', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:0}],
    (d,w,h,p)=>fxNoiseReduction(d,w,h,p.amount)) },

  // ---------------- DISTORT ----------------
  rgbSplit: { category:'distort', title:'RGB Split', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:40}],
    (d,w,h,p)=>fxRgbSplit(d,w,h,p.amount)) },

  glitch: { category:'distort', title:'Glitch', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:40}],
    (d,w,h,p)=>fxGlitch(d,w,h,p.amount)) },

  pixelate: { category:'distort', title:'Pixelate', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:40}],
    (d,w,h,p)=>fxPixelate(d,w,h,p.amount)) },

  posterize: { category:'distort', title:'Posterize', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:40}],
    (d,w,h,p)=>fxPosterize(d,p.amount)) },

  solarize: { category:'distort', title:'Solarize', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:40}],
    (d,w,h,p)=>fxSolarize(d,p.amount)) },

  neonEdges: { category:'distort', title:'Neon Edges', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:40}],
    (d,w,h,p)=>fxNeonEdges(d,w,h,p.amount)) },

  kaleidoscope: { category:'distort', title:'Kaleidoscope', ...pixelType(
    [{key:'segments',label:'Segments',type:'slider',min:3,max:16,step:1,default:8}],
    (d,w,h,p)=>fxKaleidoscope(d,w,h,p.segments)) },

  halftone: { category:'distort', title:'Halftone', ...pixelType(
    [
      {key:'cell',label:'Cell size',type:'slider',min:4,max:28,step:1,default:10},
      {key:'shape',label:'Shape',type:'select',options:['dots','lines','squares','cross'],default:'dots'},
      {key:'colorMode',label:'Color',type:'select',options:['mono','color'],default:'mono'},
    ],
    (d,w,h,p)=>fxHalftone(d,w,h,p.cell,p.shape,p.colorMode)) },

  sketch: { category:'distort', title:'Sketch', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:70}],
    (d,w,h,p)=>fxSketch(d,w,h,p.amount)) },

  thermal: { category:'distort', title:'Thermal', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:70}],
    (d,w,h,p)=>fxThermal(d,p.amount)) },

  chromaticAberration: { category:'distort', title:'Chromatic Aberration', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:40}],
    (d,w,h,p)=>fxChromaticAberration(d,w,h,p.amount)) },

  emboss: { category:'distort', title:'Emboss', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:100}],
    (d,w,h,p)=>fxEmboss(d,w,h,p.amount)) },

  oldFilm: { category:'distort', title:'Old Film', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:60}],
    (d,w,h,p)=>fxOldFilm(d,w,h,p.amount)) },

  waveWarp: { category:'distort', title:'Wave Warp', ...pixelType(
    [
      {key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:40},
      {key:'waves',label:'Waves',type:'slider',min:1,max:20,step:1,default:6},
    ],
    (d,w,h,p)=>fxWaveWarp(d,w,h,p.amount,p.waves)) },

  rainbow: { category:'distort', title:'Rainbow', ...pixelType(
    [
      {key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:100},
      {key:'bands',label:'Bands',type:'slider',min:1,max:12,step:1,default:4},
    ],
    (d,w,h,p)=>fxRainbow(d,w,h,p.amount,p.bands)) },

  // ---------------- FINISH ----------------
  vignette: {
    category:'finish', title:'Vignette', inputs:['Image'], outputs:['Image'],
    params:[{key:'amount',label:'Amount',type:'slider',min:-100,max:100,step:1,default:40}],
    compute(ins,p){
      const src=ins[0]; if(!src) return null; const out=cloneCanvas(src);
      if(!p.amount) return out;
      const octx=out.getContext('2d'); const w=out.width,h=out.height,cx=w/2,cy=h/2;
      const outerR=Math.sqrt(cx*cx+cy*cy), innerR=outerR*0.35;
      const grad=octx.createRadialGradient(cx,cy,innerR,cx,cy,outerR); const strength=Math.abs(p.amount)/100;
      if(p.amount>0){ grad.addColorStop(0,'rgba(0,0,0,0)'); grad.addColorStop(1,`rgba(0,0,0,${strength*0.85})`); }
      else { grad.addColorStop(0,'rgba(255,255,255,0)'); grad.addColorStop(1,`rgba(255,255,255,${strength*0.7})`); }
      octx.fillStyle=grad; octx.fillRect(0,0,w,h); return out;
    }
  },
  grain: { category:'finish', title:'Grain', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:35}],
    (d,w,h,p)=>fxFilmGrain(d,w,h,p.amount)) },

  // ---------------- TRANSFORM ----------------
  rotate: {
    category:'transform', title:'Rotate', inputs:['Image'], outputs:['Image'],
    params:[{key:'angle',label:'Angle',type:'slider',min:-45,max:45,step:1,default:0,unit:'°'}],
    compute(ins,p){
      const src=ins[0]; if(!src) return null;
      const w=src.width,h=src.height; const out=document.createElement('canvas'); out.width=w; out.height=h;
      const octx=out.getContext('2d'); if(!p.angle){ octx.drawImage(src,0,0); return out; }
      const rad=p.angle*Math.PI/180; const scale=Math.abs(Math.cos(rad))+Math.abs(Math.sin(rad))*(w/h);
      octx.save(); octx.translate(w/2,h/2); octx.rotate(rad); octx.scale(scale,scale); octx.drawImage(src,-w/2,-h/2,w,h); octx.restore();
      return out;
    }
  },
  flip: {
    category:'transform', title:'Flip', inputs:['Image'], outputs:['Image'],
    params:[
      {key:'horizontal',label:'Horizontal',type:'toggle',default:false},
      {key:'vertical',label:'Vertical',type:'toggle',default:false},
    ],
    compute(ins,p){
      const src=ins[0]; if(!src) return null; const w=src.width,h=src.height;
      const out=document.createElement('canvas'); out.width=w; out.height=h; const octx=out.getContext('2d');
      octx.save(); octx.translate(p.horizontal?w:0, p.vertical?h:0); octx.scale(p.horizontal?-1:1, p.vertical?-1:1); octx.drawImage(src,0,0); octx.restore();
      return out;
    }
  },
  crop: {
    category:'transform', title:'Crop', inputs:['Image'], outputs:['Image'],
    params:[
      {key:'left',label:'Left',type:'slider',min:0,max:49,step:1,default:0,unit:'%'},
      {key:'top',label:'Top',type:'slider',min:0,max:49,step:1,default:0,unit:'%'},
      {key:'right',label:'Right',type:'slider',min:0,max:49,step:1,default:0,unit:'%'},
      {key:'bottom',label:'Bottom',type:'slider',min:0,max:49,step:1,default:0,unit:'%'},
    ],
    compute(ins,p){
      const src=ins[0]; if(!src) return null; const w=src.width,h=src.height;
      const l=Math.round(w*(p.left||0)/100), t=Math.round(h*(p.top||0)/100);
      const r=Math.round(w*(p.right||0)/100), b=Math.round(h*(p.bottom||0)/100);
      const cw=Math.max(1,w-l-r), ch=Math.max(1,h-t-b);
      const out=document.createElement('canvas'); out.width=cw; out.height=ch;
      out.getContext('2d').drawImage(src,l,t,cw,ch,0,0,cw,ch);
      return out;
    }
  },
  scale: {
    category:'transform', title:'Scale', inputs:['Image'], outputs:['Image'],
    params:[{key:'amount',label:'Amount',type:'slider',min:10,max:300,step:1,default:100,unit:'%'}],
    compute(ins,p){
      const src=ins[0]; if(!src) return null; const factor=(p.amount||100)/100;
      const w=Math.max(1,Math.round(src.width*factor)), h=Math.max(1,Math.round(src.height*factor));
      const out=document.createElement('canvas'); out.width=w; out.height=h;
      out.getContext('2d').drawImage(src,0,0,w,h);
      return out;
    }
  },

  // ---------------- GENERATE ----------------
  solidColor: {
    category:'generate', title:'Solid Color', inputs:[], outputs:['Image'],
    params:[{key:'color',label:'Color',type:'color',default:'#3f8cff'}],
    compute(ins,p){
      const out=document.createElement('canvas'); out.width=projectSize.w; out.height=projectSize.h;
      const octx=out.getContext('2d'); octx.fillStyle=p.color; octx.fillRect(0,0,out.width,out.height); return out;
    }
  },
  gradient: {
    category:'generate', title:'Gradient', inputs:[], outputs:['Image'],
    params:[
      {key:'colorA',label:'Color A',type:'color',default:'#3f8cff'},
      {key:'colorB',label:'Color B',type:'color',default:'#161617'},
      {key:'angle',label:'Angle',type:'slider',min:0,max:360,step:1,default:45,unit:'°'},
    ],
    compute(ins,p){
      const out=document.createElement('canvas'); out.width=projectSize.w; out.height=projectSize.h;
      const octx=out.getContext('2d'); const w=out.width,h=out.height; const rad=(p.angle||0)*Math.PI/180;
      const dx=Math.cos(rad)*w/2, dy=Math.sin(rad)*h/2; const cx=w/2, cy=h/2;
      const grad=octx.createLinearGradient(cx-dx,cy-dy,cx+dx,cy+dy);
      grad.addColorStop(0,p.colorA); grad.addColorStop(1,p.colorB);
      octx.fillStyle=grad; octx.fillRect(0,0,w,h); return out;
    }
  },
  noise: {
    category:'generate', title:'Noise', inputs:[], outputs:['Image'],
    params:[
      {key:'amount',label:'Contrast',type:'slider',min:0,max:100,step:1,default:100},
      {key:'colorMode',label:'Type',type:'select',options:['mono','color'],default:'mono'},
    ],
    compute(ins,p){
      const out=document.createElement('canvas'); out.width=projectSize.w; out.height=projectSize.h;
      const octx=out.getContext('2d'); const id=octx.createImageData(out.width,out.height); const amt=(p.amount||100)/100;
      for(let i=0;i<id.data.length;i+=4){
        if(p.colorMode==='color'){ id.data[i]=Math.random()*255*amt; id.data[i+1]=Math.random()*255*amt; id.data[i+2]=Math.random()*255*amt; }
        else { const v=Math.random()*255*amt; id.data[i]=v; id.data[i+1]=v; id.data[i+2]=v; }
        id.data[i+3]=255;
      }
      octx.putImageData(id,0,0); return out;
    }
  },

  // ---------------- COMPOSITE ----------------
  mix: {
    category:'composite', title:'Mix', inputs:['A','B'], outputs:['Image'],
    params:[
      {key:'mode',label:'Blend mode',type:'select',default:'source-over',
        options:['source-over','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion']},
      {key:'factor',label:'Factor',type:'slider',min:0,max:100,step:1,default:100},
    ],
    compute(ins,p){
      const a=ins[0], b=ins[1]; if(!a && !b) return null; if(!a) return cloneCanvas(b); if(!b) return cloneCanvas(a);
      const out=cloneCanvas(a); const octx=out.getContext('2d');
      const iw=b.width, ih=b.height; const coverScale=Math.max(out.width/iw,out.height/ih);
      const dw=iw*coverScale, dh=ih*coverScale; const dx=(out.width-dw)/2, dy=(out.height-dh)/2;
      octx.save(); octx.globalAlpha=clamp01((p.factor??100)/100); octx.globalCompositeOperation=p.mode||'source-over';
      octx.drawImage(b,dx,dy,dw,dh); octx.restore(); return out;
    }
  },

  // ---------------- OUTPUT ----------------
  output: {
    category:'output', title:'Output', inputs:['Image'], outputs:[], params:[], special:'output',
    compute(ins){ return ins[0] || null; }
  },
};

const PALETTE_ORDER = ['input','color','detail','distort','finish','transform','generate','composite','output'];

/* ============================================================
   NODE INSTANCE / GRAPH OPS
   ============================================================ */
function makeParamDefaults(typeKey){
  // deep-clone each default — several param types (e.g. the color ramp's stop
  // list) default to an object/array, and sharing that reference across every
  // instance of the node type would let editing one node's stops mutate them all
  const def={}; NODE_TYPES[typeKey].params.forEach(pd=>{ def[pd.key]=JSON.parse(JSON.stringify(pd.default)); }); return def;
}
function addNode(typeKey, x, y, record){
  const type=NODE_TYPES[typeKey]; if(!type) return null;
  const id=uid('n');
  const node={ id, type:typeKey, x, y, params:makeParamDefaults(typeKey), title:type.title, _src:null, _cache:null, _dirty:true };
  nodes[id]=node;
  if(typeKey==='output') outputNodeId = outputNodeId || id;
  renderNode(node);
  if(record!==false) pushHistory();
  markDirty(id);
  scheduleEval();
  return node;
}
function removeNode(id){
  if(!nodes[id]) return;
  links = links.filter(l=>{
    if(l.from===id || l.to===id){ const el=document.getElementById('wire_'+l.id); if(el) el.remove(); return false; }
    return true;
  });
  const el=document.getElementById(id); if(el) el.remove();
  delete nodes[id];
  if(outputNodeId===id) outputNodeId = Object.keys(nodes).find(k=>nodes[k].type==='output') || null;
  selectedNodeIds.delete(id);
  scheduleEval();
}
function addLink(fromId,fromSock,toId,toSock,record){
  // one link per input socket
  links = links.filter(l=>!(l.to===toId && l.toSock===toSock));
  const id=uid('l');
  links.push({id, from:fromId, fromSock, to:toId, toSock});
  markDirtyForward(toId);
  drawWires();
  if(record!==false) pushHistory();
  scheduleEval();
  return id;
}
function removeLink(id){
  const l=links.find(x=>x.id===id); if(!l) return;
  links=links.filter(x=>x.id!==id);
  markDirtyForward(l.to);
  drawWires();
  scheduleEval();
}
function markDirty(id){ if(nodes[id]) nodes[id]._dirty=true; }
function markDirtyForward(id){
  const seen=new Set(); const stack=[id];
  while(stack.length){ const cur=stack.pop(); if(seen.has(cur)) continue; seen.add(cur);
    if(nodes[cur]) nodes[cur]._dirty=true;
    links.filter(l=>l.from===cur).forEach(l=>stack.push(l.to));
  }
}

/* ---- evaluation ---- */
function evaluateNode(id, visiting){
  const node=nodes[id]; if(!node) return null;
  visiting = visiting || new Set();
  if(visiting.has(id)) return null; // cycle guard
  if(!node._dirty && node._cache!==undefined) return node._cache;
  visiting.add(id);
  const type=NODE_TYPES[node.type];
  const inputCanvases = type.inputs.map((name,idx)=>{
    const l=links.find(x=>x.to===id && x.toSock===idx);
    if(!l) return null;
    return evaluateNode(l.from, visiting);
  });
  let result=null;
  if(node.muted && type.inputs.length && type.outputs.length){
    result = inputCanvases[0] || null; // bypassed: pass the first input straight through
  } else {
    try{ result = type.compute(inputCanvases, node.params, node); }catch(e){ console.error('node compute error', node.type, e); result=null; }
  }
  node._cache=result; node._dirty=false;
  visiting.delete(id);
  return result;
}

let evalScheduled=false;
function scheduleEval(){
  if(evalScheduled) return; evalScheduled=true;
  requestAnimationFrame(()=>{ evalScheduled=false; runEvaluation(); });
}
function runEvaluation(){
  let outCanvas=null;
  if(outputNodeId && nodes[outputNodeId]){
    outCanvas = evaluateNode(outputNodeId);
  }
  if(compareMode){
    const original=findFirstImageSource();
    updatePreview(original || outCanvas, !!original);
  } else {
    updatePreview(outCanvas, false);
  }
}

