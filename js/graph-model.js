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

  gamma: { category:'color', title:'Gamma', ...pixelType(
    [{key:'amount',label:'Gamma',type:'slider',min:10,max:300,step:1,default:100,unit:'%'}],
    (d,w,h,p)=>fxGamma(d,p.amount)) },

  clamp: { category:'color', title:'Clamp', ...pixelType(
    [
      {key:'low',label:'Min',type:'slider',min:0,max:100,step:1,default:0,unit:'%'},
      {key:'high',label:'Max',type:'slider',min:0,max:100,step:1,default:100,unit:'%'},
    ],
    (d,w,h,p)=>fxClamp(d,p.low,p.high)) },

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

  channelMixer: { category:'color', title:'Channel Mixer', ...pixelType(
    [
      {key:'rr',label:'R from R',type:'slider',min:-200,max:200,step:1,default:100},
      {key:'rg',label:'R from G',type:'slider',min:-200,max:200,step:1,default:0},
      {key:'rb',label:'R from B',type:'slider',min:-200,max:200,step:1,default:0},
      {key:'gr',label:'G from R',type:'slider',min:-200,max:200,step:1,default:0},
      {key:'gg',label:'G from G',type:'slider',min:-200,max:200,step:1,default:100},
      {key:'gb',label:'G from B',type:'slider',min:-200,max:200,step:1,default:0},
      {key:'br',label:'B from R',type:'slider',min:-200,max:200,step:1,default:0},
      {key:'bg',label:'B from G',type:'slider',min:-200,max:200,step:1,default:0},
      {key:'bb',label:'B from B',type:'slider',min:-200,max:200,step:1,default:100},
    ],
    (d,w,h,p)=>fxChannelMixer(d,p)) },

  splitTone: { category:'color', title:'Split Tone', ...pixelType(
    [
      {key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:60},
      {key:'shadowColor',label:'Shadows',type:'color',default:'#2b2350'},
      {key:'highlightColor',label:'Highlights',type:'color',default:'#ffce7a'},
      {key:'balance',label:'Balance',type:'slider',min:0,max:100,step:1,default:50},
    ],
    (d,w,h,p)=>fxSplitTone(d,p)) },

  fade: { category:'color', title:'Fade', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:40}],
    (d,w,h,p)=>fxFade(d,p.amount)) },

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

  highPass: { category:'detail', title:'High Pass', ...pixelType(
    [{key:'radius',label:'Radius',type:'slider',min:1,max:40,step:1,default:8,unit:'px'}],
    (d,w,h,p)=>fxHighPass(d,w,h,p.radius)) },

  medianDenoise: { category:'detail', title:'Median Denoise', ...pixelType(
    [{key:'radius',label:'Radius',type:'slider',min:0,max:3,step:1,default:1,unit:'px'}],
    (d,w,h,p)=>fxMedianDenoise(d,w,h,p.radius)) },

  dehaze: { category:'detail', title:'Dehaze', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:40}],
    (d,w,h,p)=>fxDehaze(d,w,h,p.amount)) },

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

  iridescent: { category:'distort', title:'Iridescent', ...pixelType(
    [
      {key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:100},
      {key:'threshold',label:'Threshold',type:'slider',min:5,max:150,step:1,default:30},
    ],
    (d,w,h,p)=>fxIridescent(d,w,h,p.amount,p.threshold)) },

  prismGlow: { category:'distort', title:'Prism Glow', ...pixelType(
    [
      {key:'threshold',label:'Threshold',type:'slider',min:0,max:100,step:1,default:70},
      {key:'amount',label:'Glow',type:'slider',min:0,max:100,step:1,default:60},
    ],
    (d,w,h,p)=>fxPrismGlow(d,w,h,p.amount,p.threshold)) },

  pixelSort: { category:'distort', title:'Pixel Sort', ...pixelType(
    [
      {key:'threshold',label:'Threshold',type:'slider',min:0,max:100,step:1,default:50},
      {key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:100},
    ],
    (d,w,h,p)=>fxPixelSort(d,w,h,p.amount,p.threshold)) },

  liquifyWarp: { category:'distort', title:'Liquify Warp', ...pixelType(
    [
      {key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:40},
      {key:'scale',label:'Scale',type:'slider',min:1,max:10,step:1,default:4},
    ],
    (d,w,h,p)=>fxLiquifyWarp(d,w,h,p.amount,p.scale)) },

  vortexTwist: { category:'distort', title:'Vortex Twist', ...pixelType(
    [{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:50}],
    (d,w,h,p)=>fxVortexTwist(d,w,h,p.amount)) },

  dither: { category:'distort', title:'Dither', ...pixelType(
    [{key:'levels',label:'Levels',type:'slider',min:2,max:8,step:1,default:4}],
    (d,w,h,p)=>fxDither(d,w,h,p.levels)) },

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

  frame: {
    category:'finish', title:'Frame', inputs:['Image'], outputs:['Image'],
    params:[
      {key:'width',label:'Width',type:'slider',min:0,max:100,step:1,default:20,unit:'px'},
      {key:'color',label:'Color',type:'color',default:'#ffffff'},
    ],
    compute(ins,p){
      const src=ins[0]; if(!src) return null; const out=cloneCanvas(src); const bw=p.width||0; if(!bw) return out;
      const octx=out.getContext('2d'); octx.strokeStyle=p.color; octx.lineWidth=bw*2;
      octx.strokeRect(0,0,out.width,out.height);
      return out;
    }
  },
  lightLeak: {
    category:'finish', title:'Light Leak', inputs:['Image'], outputs:['Image'],
    params:[
      {key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:50},
      {key:'color',label:'Color',type:'color',default:'#ff8a3d'},
    ],
    compute(ins,p){
      const src=ins[0]; if(!src) return null; const out=cloneCanvas(src); if(!p.amount) return out;
      const octx=out.getContext('2d'); const w=out.width,h=out.height; const c=hexToRgb(p.color);
      const grad=octx.createRadialGradient(w*0.85,h*0.15,0,w*0.85,h*0.15,Math.max(w,h)*0.7);
      grad.addColorStop(0,`rgba(${c[0]},${c[1]},${c[2]},${(p.amount/100)*0.9})`);
      grad.addColorStop(1,'rgba(0,0,0,0)');
      octx.save(); octx.globalCompositeOperation='screen'; octx.fillStyle=grad; octx.fillRect(0,0,w,h); octx.restore();
      return out;
    }
  },
  bloom: { category:'finish', title:'Bloom', ...pixelType(
    [
      {key:'threshold',label:'Threshold',type:'slider',min:0,max:100,step:1,default:70},
      {key:'amount',label:'Glow',type:'slider',min:0,max:100,step:1,default:50},
    ],
    (d,w,h,p)=>fxBloom(d,w,h,p.amount,p.threshold)) },

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
  skew: {
    category:'transform', title:'Skew', inputs:['Image'], outputs:['Image'],
    params:[
      {key:'x',label:'Horizontal',type:'slider',min:-60,max:60,step:1,default:0,unit:'°'},
      {key:'y',label:'Vertical',type:'slider',min:-60,max:60,step:1,default:0,unit:'°'},
    ],
    compute(ins,p){
      const src=ins[0]; if(!src) return null; const w=src.width,h=src.height;
      const out=document.createElement('canvas'); out.width=w; out.height=h; const octx=out.getContext('2d');
      const shx=Math.tan((p.x||0)*Math.PI/180), shy=Math.tan((p.y||0)*Math.PI/180);
      octx.save(); octx.translate(w/2,h/2); octx.transform(1,shy,shx,1,0,0); octx.drawImage(src,-w/2,-h/2,w,h); octx.restore();
      return out;
    }
  },
  pad: {
    category:'transform', title:'Pad', inputs:['Image'], outputs:['Image'],
    params:[
      {key:'amount',label:'Padding',type:'slider',min:0,max:50,step:1,default:10,unit:'%'},
      {key:'color',label:'Fill color',type:'color',default:'#000000'},
    ],
    compute(ins,p){
      const src=ins[0]; if(!src) return null; const w=src.width,h=src.height;
      const pad=Math.round(Math.min(w,h)*(p.amount||0)/100);
      const out=document.createElement('canvas'); out.width=w+pad*2; out.height=h+pad*2;
      const octx=out.getContext('2d'); octx.fillStyle=p.color; octx.fillRect(0,0,out.width,out.height);
      octx.drawImage(src,pad,pad);
      return out;
    }
  },
  tile: {
    category:'transform', title:'Tile', inputs:['Image'], outputs:['Image'],
    params:[
      {key:'repeats',label:'Repeats',type:'slider',min:1,max:6,step:1,default:2},
      {key:'mirror',label:'Mirror',type:'toggle',default:true},
    ],
    compute(ins,p){
      const src=ins[0]; if(!src) return null; const w=src.width,h=src.height;
      const n=Math.max(1,Math.round(p.repeats||2));
      const out=document.createElement('canvas'); out.width=w; out.height=h; const octx=out.getContext('2d');
      const tw=w/n, th=h/n;
      for(let ty=0;ty<n;ty++){
        for(let tx=0;tx<n;tx++){
          const flipX = p.mirror && (tx%2===1), flipY = p.mirror && (ty%2===1);
          octx.save();
          octx.translate(tx*tw, ty*th);
          octx.translate(flipX?tw:0, flipY?th:0);
          octx.scale(flipX?-1:1, flipY?-1:1);
          octx.drawImage(src,0,0,w,h,0,0,tw,th);
          octx.restore();
        }
      }
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
  checker: {
    category:'generate', title:'Checker', inputs:[], outputs:['Image'],
    params:[
      {key:'colorA',label:'Color A',type:'color',default:'#ffffff'},
      {key:'colorB',label:'Color B',type:'color',default:'#161617'},
      {key:'size',label:'Size',type:'slider',min:4,max:200,step:1,default:40,unit:'px'},
    ],
    compute(ins,p){
      const out=document.createElement('canvas'); out.width=projectSize.w; out.height=projectSize.h;
      const octx=out.getContext('2d'); const sz=Math.max(2,p.size||40);
      for(let y=0;y<out.height;y+=sz){
        for(let x=0;x<out.width;x+=sz){
          octx.fillStyle = (((x/sz)|0)+((y/sz)|0))%2===0 ? p.colorA : p.colorB;
          octx.fillRect(x,y,sz,sz);
        }
      }
      return out;
    }
  },
  voronoi: {
    category:'generate', title:'Voronoi', inputs:[], outputs:['Image'],
    params:[
      {key:'cells',label:'Cells',type:'slider',min:2,max:60,step:1,default:14},
      {key:'colorA',label:'Color A',type:'color',default:'#161617'},
      {key:'colorB',label:'Color B',type:'color',default:'#3f8cff'},
    ],
    compute(ins,p){
      const w=projectSize.w, h=projectSize.h;
      const out=document.createElement('canvas'); out.width=w; out.height=h; const octx=out.getContext('2d');
      const n=Math.max(2,p.cells||14);
      const pts=[]; for(let i=0;i<n;i++) pts.push({x:Math.random()*w, y:Math.random()*h});
      const ca=hexToRgb(p.colorA), cb=hexToRgb(p.colorB);
      const id=octx.createImageData(w,h); const norm=(Math.min(w,h)*0.5)||1;
      for(let y=0;y<h;y++){
        for(let x=0;x<w;x++){
          let best=Infinity;
          for(let i=0;i<n;i++){ const dx=x-pts[i].x, dy=y-pts[i].y; const dist=dx*dx+dy*dy; if(dist<best) best=dist; }
          const t=Math.min(1, Math.sqrt(best)/norm);
          const idx=(y*w+x)*4;
          id.data[idx]=ca[0]+(cb[0]-ca[0])*t; id.data[idx+1]=ca[1]+(cb[1]-ca[1])*t; id.data[idx+2]=ca[2]+(cb[2]-ca[2])*t; id.data[idx+3]=255;
        }
      }
      octx.putImageData(id,0,0); return out;
    }
  },
  radialGradient: {
    category:'generate', title:'Radial Gradient', inputs:[], outputs:['Image'],
    params:[
      {key:'colorA',label:'Center',type:'color',default:'#ffffff'},
      {key:'colorB',label:'Edge',type:'color',default:'#161617'},
      {key:'radius',label:'Radius',type:'slider',min:10,max:150,step:1,default:70,unit:'%'},
    ],
    compute(ins,p){
      const out=document.createElement('canvas'); out.width=projectSize.w; out.height=projectSize.h;
      const octx=out.getContext('2d'); const w=out.width,h=out.height,cx=w/2,cy=h/2;
      const r=Math.max(w,h)*((p.radius||70)/100);
      const grad=octx.createRadialGradient(cx,cy,0,cx,cy,r);
      grad.addColorStop(0,p.colorA); grad.addColorStop(1,p.colorB);
      octx.fillStyle=grad; octx.fillRect(0,0,w,h); return out;
    }
  },
  stripes: {
    category:'generate', title:'Stripes', inputs:[], outputs:['Image'],
    params:[
      {key:'colorA',label:'Color A',type:'color',default:'#ffffff'},
      {key:'colorB',label:'Color B',type:'color',default:'#161617'},
      {key:'size',label:'Size',type:'slider',min:2,max:200,step:1,default:30,unit:'px'},
      {key:'angle',label:'Angle',type:'slider',min:0,max:180,step:1,default:0,unit:'°'},
    ],
    compute(ins,p){
      const w=projectSize.w, h=projectSize.h;
      const out=document.createElement('canvas'); out.width=w; out.height=h; const octx=out.getContext('2d');
      const sz=Math.max(2,p.size||30); const rad=(p.angle||0)*Math.PI/180; const diag=Math.hypot(w,h);
      octx.fillStyle=p.colorB; octx.fillRect(0,0,w,h);
      octx.save(); octx.translate(w/2,h/2); octx.rotate(rad); octx.translate(-w/2,-h/2);
      octx.fillStyle=p.colorA;
      for(let x=-diag; x<diag; x+=sz*2) octx.fillRect(x, -diag/2, sz, diag*2);
      octx.restore();
      return out;
    }
  },
  text: {
    category:'generate', title:'Text', inputs:[], outputs:['Image'],
    params:[
      {key:'content',label:'Text',type:'text',default:'Lumin'},
      {key:'color',label:'Color',type:'color',default:'#ffffff'},
      {key:'size',label:'Size',type:'slider',min:10,max:400,step:1,default:80,unit:'px'},
      {key:'bg',label:'Background',type:'color',default:'#161617'},
    ],
    compute(ins,p){
      const out=document.createElement('canvas'); out.width=projectSize.w; out.height=projectSize.h;
      const octx=out.getContext('2d'); const w=out.width,h=out.height;
      octx.fillStyle=p.bg; octx.fillRect(0,0,w,h);
      octx.fillStyle=p.color; octx.font=`700 ${p.size||80}px Inter, sans-serif`;
      octx.textAlign='center'; octx.textBaseline='middle';
      octx.fillText(p.content||'', w/2, h/2);
      return out;
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
  math: {
    category:'composite', title:'Math', inputs:['A','B'], outputs:['Image'],
    params:[{key:'op',label:'Operation',type:'select',default:'Add',
      options:['Add','Subtract','Multiply','Divide','Min','Max','Difference','Average','Screen']}],
    compute(ins,p){
      const a=ins[0], b=ins[1]; if(!a && !b) return null; if(!a) return cloneCanvas(b); if(!b) return cloneCanvas(a);
      const out=cloneCanvas(a); const octx=out.getContext('2d'); const w=out.width,h=out.height;
      const bMatched=document.createElement('canvas'); bMatched.width=w; bMatched.height=h;
      bMatched.getContext('2d').drawImage(b,0,0,w,h);
      const ida=octx.getImageData(0,0,w,h), idb=bMatched.getContext('2d').getImageData(0,0,w,h);
      fxMathOp(ida.data, idb.data, p.op);
      octx.putImageData(ida,0,0); return out;
    }
  },
  separateRGB: {
    category:'composite', title:'Separate RGB', inputs:['Image'], outputs:['R','G','B'], params:[],
    compute(ins){
      const src=ins[0]; if(!src) return {R:null,G:null,B:null};
      const w=src.width, h=src.height;
      const sctx=document.createElement('canvas'); sctx.width=w; sctx.height=h;
      const sc=sctx.getContext('2d'); sc.drawImage(src,0,0);
      const id=sc.getImageData(0,0,w,h);
      function chanCanvas(offset){
        const c=document.createElement('canvas'); c.width=w; c.height=h; const cx=c.getContext('2d');
        const od=cx.createImageData(w,h);
        for(let i=0;i<id.data.length;i+=4){ const v=id.data[i+offset]; od.data[i]=v; od.data[i+1]=v; od.data[i+2]=v; od.data[i+3]=255; }
        cx.putImageData(od,0,0); return c;
      }
      return { R:chanCanvas(0), G:chanCanvas(1), B:chanCanvas(2) };
    }
  },
  combineRGB: {
    category:'composite', title:'Combine RGB', inputs:['R','G','B'], outputs:['Image'], params:[],
    compute(ins){
      const [rIn,gIn,bIn]=ins; const ref=rIn||gIn||bIn; if(!ref) return null;
      const w=ref.width, h=ref.height;
      function chanData(src){
        if(!src) return null;
        const c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(src,0,0,w,h);
        return c.getContext('2d').getImageData(0,0,w,h).data;
      }
      const rd=chanData(rIn), gd=chanData(gIn), bd=chanData(bIn);
      const out=document.createElement('canvas'); out.width=w; out.height=h; const octx=out.getContext('2d');
      const od=octx.createImageData(w,h);
      for(let i=0;i<od.data.length;i+=4){
        od.data[i]=rd?rd[i]:0; od.data[i+1]=gd?gd[i+1]:0; od.data[i+2]=bd?bd[i+2]:0; od.data[i+3]=255;
      }
      octx.putImageData(od,0,0); return out;
    }
  },
  mask: {
    category:'composite', title:'Mask', inputs:['A','B'], outputs:['Image'],
    params:[{key:'invert',label:'Invert mask',type:'toggle',default:false}],
    compute(ins,p){
      const a=ins[0], b=ins[1]; if(!a) return null; if(!b) return cloneCanvas(a);
      const out=cloneCanvas(a); const octx=out.getContext('2d'); const w=out.width,h=out.height;
      const maskC=document.createElement('canvas'); maskC.width=w; maskC.height=h; maskC.getContext('2d').drawImage(b,0,0,w,h);
      const id=octx.getImageData(0,0,w,h); const md=maskC.getContext('2d').getImageData(0,0,w,h).data;
      for(let i=0;i<id.data.length;i+=4){
        let lum=(0.299*md[i]+0.587*md[i+1]+0.114*md[i+2])/255;
        if(p.invert) lum=1-lum;
        id.data[i+3]=Math.round(lum*255);
      }
      octx.putImageData(id,0,0); return out;
    }
  },
  displace: {
    category:'composite', title:'Displace', inputs:['A','B'], outputs:['Image'],
    params:[{key:'amount',label:'Amount',type:'slider',min:0,max:100,step:1,default:30}],
    compute(ins,p){
      const a=ins[0], b=ins[1]; if(!a) return null; if(!b || !p.amount) return cloneCanvas(a);
      const w=a.width,h=a.height;
      const aC=cloneCanvas(a); const srcData=aC.getContext('2d').getImageData(0,0,w,h).data;
      const bC=document.createElement('canvas'); bC.width=w; bC.height=h; bC.getContext('2d').drawImage(b,0,0,w,h);
      const dispData=bC.getContext('2d').getImageData(0,0,w,h).data;
      const out=document.createElement('canvas'); out.width=w; out.height=h; const octx=out.getContext('2d');
      const od=octx.createImageData(w,h); const maxOffset=(p.amount/100)*Math.min(w,h)*0.06;
      for(let y=0;y<h;y++){
        for(let x=0;x<w;x++){
          const di=(y*w+x)*4;
          const dispLum=(dispData[di]+dispData[di+1]+dispData[di+2])/3/255-0.5;
          const sx=Math.min(w-1,Math.max(0,x+Math.round(dispLum*maxOffset*2)));
          const si=(y*w+sx)*4;
          od.data[di]=srcData[si]; od.data[di+1]=srcData[si+1]; od.data[di+2]=srcData[si+2]; od.data[di+3]=srcData[si+3];
        }
      }
      octx.putImageData(od,0,0); return out;
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
// Would connecting fromId -> toId create a cycle? True if toId can already
// reach fromId by following existing links forward.
function wouldCreateCycle(fromId, toId){
  if(fromId===toId) return true;
  const seen=new Set(); const stack=[toId];
  while(stack.length){
    const cur=stack.pop(); if(cur===fromId) return true;
    if(seen.has(cur)) continue; seen.add(cur);
    links.filter(l=>l.from===cur).forEach(l=>stack.push(l.to));
  }
  return false;
}
function addLink(fromId,fromSock,toId,toSock,record){
  if(wouldCreateCycle(fromId,toId)){
    if(typeof showToast==='function') showToast('Can\'t connect — that would create a loop');
    return null;
  }
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
    const upstream=evaluateNode(l.from, visiting);
    const srcType=nodes[l.from] && NODE_TYPES[nodes[l.from].type];
    // a node with more than one output (e.g. Separate RGB) caches an
    // {outputName: canvas} object instead of a lone canvas — pick out the
    // one this link actually connects to
    return (srcType && srcType.outputs.length>1) ? ((upstream && upstream[l.fromSock]) || null) : upstream;
  });
  let result=null;
  if(node.muted && type.inputs.length && type.outputs.length===1){
    result = inputCanvases[0] || null; // bypassed: pass the first input straight through
    node._error=null;
  } else {
    try{
      result = type.compute(inputCanvases, node.params, node);
      if(node._error){ node._error=null; renderNode(node); }
    }catch(e){
      console.error('node compute error', node.type, e);
      const message = e && e.message ? e.message : String(e);
      const isNewError = node._error!==message;
      node._error=message; result=null;
      if(isNewError){
        if(typeof showToast==='function') showToast(node.title+' hit an error — hover its badge for details');
        renderNode(node);
      }
    }
  }
  node._cache=result; node._dirty=false;
  visiting.delete(id);
  return result;
}

let evalScheduled=false;
function scheduleEval(){
  if(evalScheduled) return; evalScheduled=true;
  const indicator=document.getElementById('computingIndicator'); if(indicator) indicator.hidden=false;
  // Evaluation is synchronous and can be slow on a heavy graph — wait one extra
  // frame after showing the indicator so the browser actually gets to paint it
  // before the main thread blocks on the real computation.
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      evalScheduled=false; runEvaluation();
      if(indicator) indicator.hidden=true;
    });
  });
}
function runEvaluation(){
  // previewPinId (declared in render.js) lets you preview any node's output
  // without touching the real Output node's wiring — Export always uses the
  // real outputNodeId regardless of what's pinned.
  const targetId = (typeof previewPinId!=='undefined' && previewPinId && nodes[previewPinId]) ? previewPinId : outputNodeId;
  let outCanvas=null;
  if(targetId && nodes[targetId]){
    const val = evaluateNode(targetId);
    const t = NODE_TYPES[nodes[targetId].type];
    outCanvas = (t.outputs.length>1) ? ((val && val[t.outputs[0]]) || null) : val;
  }
  if(compareMode){
    const original=findFirstImageSource();
    updatePreviewSplit(original, outCanvas);
  } else {
    updatePreview(outCanvas, false);
  }
}

