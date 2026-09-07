// Plain-Node regression test for the compute engine (js/pixel-math.js +
// js/graph-model.js). No dependencies, no build step — run with:
//   node tests/engine.test.js
//
// This covers the node-graph evaluator and pixel math only. The DOM-heavy UI
// layer (render.js, interaction.js, file-io.js, app.js, dialogs.js) isn't
// covered here — that would need a real browser or a jsdom-style dependency,
// which this project deliberately has none of. Those changes are verified by
// hand (see the session notes / commit messages) rather than by this suite.
//
// Both target files declare their top-level state with `let`/`const`. A
// direct eval() of that source shares this script's own lexical scope, which
// is what lets the assertions below see `nodes`, `links`, `NODE_TYPES`, etc.
// Loading them via require() instead would NOT work — module-scoped
// let/const wouldn't leak out — so eval-in-this-scope is intentional here,
// not a shortcut.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* ---- minimal canvas/2D-context mock, just enough for the compute() paths ---- */
function makeCanvas(){
  const cv={width:0,height:0};
  cv.getContext=function(){
    if(!cv._data || cv._data.length!==cv.width*cv.height*4) cv._data=new Uint8ClampedArray(cv.width*cv.height*4);
    const w=cv.width,h=cv.height;
    return {
      getImageData(x,y,gw,gh){ return {data:new Uint8ClampedArray(cv._data), width:gw,height:gh}; },
      putImageData(imgData){ cv._data.set(imgData.data); },
      createImageData(gw,gh){ return {data:new Uint8ClampedArray(gw*gh*4), width:gw,height:gh}; },
      drawImage(src, ...args){
        let dx,dy,dw,dh;
        if(args.length===2){ [dx,dy]=args; dw=src.width; dh=src.height; }
        else { [dx,dy,dw,dh]=args; }
        for(let yy=0;yy<dh;yy++){
          const py=Math.floor(dy)+yy; if(py<0||py>=h) continue;
          const sy=Math.min(src.height-1, Math.floor(yy*src.height/dh));
          for(let xx=0;xx<dw;xx++){
            const px=Math.floor(dx)+xx; if(px<0||px>=w) continue;
            const sx=Math.min(src.width-1, Math.floor(xx*src.width/dw));
            const di=(py*w+px)*4, si=(sy*src.width+sx)*4;
            cv._data[di]=src._data[si]; cv._data[di+1]=src._data[si+1]; cv._data[di+2]=src._data[si+2]; cv._data[di+3]=src._data[si+3];
          }
        }
      },
      save(){}, restore(){}, translate(){}, rotate(){}, scale(){}, fillRect(){}, transform(){}, strokeRect(){}, fillText(){},
      createRadialGradient(){return{addColorStop(){}};}, createLinearGradient(){return{addColorStop(){}};},
      set strokeStyle(v){}, set lineWidth(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){},
      set globalCompositeOperation(v){}, set globalAlpha(v){},
    };
  };
  return cv;
}
function solidCanvas(w,h,r,g,b){
  const c=makeCanvas(); c.width=w; c.height=h;
  const cx=c.getContext(); const id=cx.createImageData(w,h);
  for(let i=0;i<id.data.length;i+=4){ id.data[i]=r; id.data[i+1]=g; id.data[i+2]=b; id.data[i+3]=255; }
  cx.putImageData(id); return c;
}
global.document={createElement:()=>makeCanvas(), getElementById:()=>null};
global.compareMode=false;
global.requestAnimationFrame=(fn)=>fn();
global.drawWires=()=>{};
global.pushHistory=()=>{};
global.updatePreview=()=>{};
global.updatePreviewSplit=()=>{};
global.findFirstImageSource=()=>null;
global.renderNode=()=>{};
global.showToast=()=>{};

const pm=fs.readFileSync(path.join(__dirname,'../js/pixel-math.js'),'utf8').replace("'use strict';",'');
const gm=fs.readFileSync(path.join(__dirname,'../js/graph-model.js'),'utf8').replace("'use strict';",'');

let passed=0;
function test(name, fn){
  try{ fn(); passed++; console.log('  ok -', name); }
  catch(e){ console.error('  FAIL -', name); throw e; }
}

eval(pm + gm + `

console.log('engine.test.js');

test('single-output node evaluates and caches', ()=>{
  const src=solidCanvas(4,4,100,100,100);
  nodes={ a:{id:'a',type:'image',params:{},_src:src,_cache:undefined,_dirty:true},
          b:{id:'b',type:'exposure',params:{amount:50},_cache:undefined,_dirty:true} };
  links=[{id:'l1',from:'a',fromSock:'Image',to:'b',toSock:0}];
  const out=evaluateNode('b');
  assert.ok(out.getContext().getImageData(0,0,4,4).data[0] > 100, 'exposure should brighten');
  assert.strictEqual(nodes.b._dirty, false, 'node should be marked clean after evaluating');
});

test('Separate RGB -> Combine RGB round-trips exactly', ()=>{
  const src=solidCanvas(2,2,10,150,240);
  nodes={
    img:{id:'img',type:'image',params:{},_src:src,_cache:undefined,_dirty:true},
    sep:{id:'sep',type:'separateRGB',params:{},_cache:undefined,_dirty:true},
    comb:{id:'comb',type:'combineRGB',params:{},_cache:undefined,_dirty:true},
  };
  links=[
    {id:'l1',from:'img',fromSock:'Image',to:'sep',toSock:0},
    {id:'l2',from:'sep',fromSock:'R',to:'comb',toSock:0},
    {id:'l3',from:'sep',fromSock:'G',to:'comb',toSock:1},
    {id:'l4',from:'sep',fromSock:'B',to:'comb',toSock:2},
  ];
  const pix=evaluateNode('comb').getContext().getImageData(0,0,2,2).data;
  assert.deepStrictEqual([pix[0],pix[1],pix[2],pix[3]], [10,150,240,255]);
});

test('per-socket routing: swapping which output feeds which input actually swaps channels', ()=>{
  const src=solidCanvas(2,2,10,150,240);
  nodes={
    img:{id:'img',type:'image',params:{},_src:src,_cache:undefined,_dirty:true},
    sep:{id:'sep',type:'separateRGB',params:{},_cache:undefined,_dirty:true},
    comb:{id:'comb',type:'combineRGB',params:{},_cache:undefined,_dirty:true},
  };
  links=[
    {id:'l1',from:'img',fromSock:'Image',to:'sep',toSock:0},
    {id:'l2',from:'sep',fromSock:'G',to:'comb',toSock:0}, // R input <- G channel
    {id:'l3',from:'sep',fromSock:'R',to:'comb',toSock:1}, // G input <- R channel
    {id:'l4',from:'sep',fromSock:'B',to:'comb',toSock:2},
  ];
  const pix=evaluateNode('comb').getContext().getImageData(0,0,2,2).data;
  assert.deepStrictEqual([pix[0],pix[1],pix[2],pix[3]], [150,10,240,255], 'R and G channels should be swapped');
});

test('Math node: Add clamps at 255, Subtract clamps at 0', ()=>{
  const ca=solidCanvas(2,2,200,10,50), cb=solidCanvas(2,2,100,20,10);
  nodes={ a:{id:'a',type:'image',params:{},_src:ca,_cache:undefined,_dirty:true},
          b:{id:'b',type:'image',params:{},_src:cb,_cache:undefined,_dirty:true},
          m:{id:'m',type:'math',params:{op:'Add'},_cache:undefined,_dirty:true} };
  links=[{id:'l1',from:'a',fromSock:'Image',to:'m',toSock:0},{id:'l2',from:'b',fromSock:'Image',to:'m',toSock:1}];
  let pix=evaluateNode('m').getContext().getImageData(0,0,2,2).data;
  assert.deepStrictEqual([pix[0],pix[1],pix[2]], [255,30,60]);
  nodes.m.params.op='Subtract'; nodes.m._dirty=true; nodes.m._cache=undefined;
  pix=evaluateNode('m').getContext().getImageData(0,0,2,2).data;
  assert.deepStrictEqual([pix[0],pix[1],pix[2]], [100,0,40]);
});

test('Gamma and Clamp nodes behave as expected', ()=>{
  nodes={ a:{id:'a',type:'image',params:{},_src:solidCanvas(2,2,50,50,50),_cache:undefined,_dirty:true},
          g:{id:'g',type:'gamma',params:{amount:200},_cache:undefined,_dirty:true} };
  links=[{id:'l1',from:'a',fromSock:'Image',to:'g',toSock:0}];
  assert.ok(evaluateNode('g').getContext().getImageData(0,0,2,2).data[0] > 50, 'gamma 200% should brighten midtones');

  nodes={ a:{id:'a',type:'image',params:{},_src:solidCanvas(2,2,250,250,250),_cache:undefined,_dirty:true},
          c:{id:'c',type:'clamp',params:{low:0,high:80},_cache:undefined,_dirty:true} };
  links=[{id:'l1',from:'a',fromSock:'Image',to:'c',toSock:0}];
  assert.strictEqual(evaluateNode('c').getContext().getImageData(0,0,2,2).data[0], 204);
});

test('Checker and Voronoi generate at the requested project size', ()=>{
  projectSize={w:20,h:20};
  nodes={ ck:{id:'ck',type:'checker',params:{colorA:'#ffffff',colorB:'#000000',size:5},_cache:undefined,_dirty:true} };
  links=[];
  const ck=evaluateNode('ck');
  assert.strictEqual(ck.width,20); assert.strictEqual(ck.height,20);

  nodes={ vo:{id:'vo',type:'voronoi',params:{cells:5,colorA:'#000000',colorB:'#ffffff'},_cache:undefined,_dirty:true} };
  const vo=evaluateNode('vo');
  assert.strictEqual(vo.width,20); assert.strictEqual(vo.height,20);
});

test('every registered node type computes without throwing and produces no NaN pixels', ()=>{
  projectSize={w:16,h:12};
  const src=solidCanvas(16,12,120,80,200);
  Object.entries(NODE_TYPES).forEach(([key,type])=>{
    const params={}; type.params.forEach(pd=>{ params[pd.key]=JSON.parse(JSON.stringify(pd.default)); });
    const ins = type.inputs.map(()=>src);
    let out;
    try{ out=type.compute(ins, params, {id:'test-'+key, title:key}); }
    catch(e){ throw new Error('node "'+key+'" threw: '+e.message); }
    if(type.outputs.length>1){
      Object.values(out||{}).forEach(c=>{ if(c) assertNoNaN(c, key); });
    } else if(out){
      assertNoNaN(out, key);
    }
  });
});
function assertNoNaN(canvas, key){
  const id=canvas.getContext().getImageData(0,0,canvas.width,canvas.height);
  const bad=Array.from(id.data).some(v=>Number.isNaN(v));
  assert.ok(!bad, 'node "'+key+'" produced NaN pixel data');
}

test('Pad grows the canvas and Mask produces real alpha transparency', ()=>{
  const src=solidCanvas(10,10,200,100,50);
  const padded=NODE_TYPES.pad.compute([src], {amount:20,color:'#000000'});
  assert.ok(padded.width>10 && padded.height>10, 'Pad should grow the canvas');

  const a=solidCanvas(4,4,200,100,50);
  const b=solidCanvas(4,4,0,0,0); // fully black mask -> alpha should go to 0
  const masked=NODE_TYPES.mask.compute([a,b], {invert:false});
  const alpha=masked.getContext().getImageData(0,0,4,4).data[3];
  assert.strictEqual(alpha, 0, 'a black mask should zero out alpha');
});

test('addLink rejects a connection that would create a cycle', ()=>{
  nodes={ a:{id:'a',type:'exposure',params:{amount:0}}, b:{id:'b',type:'exposure',params:{amount:0}} };
  links=[];
  const first=addLink('a','Image','b',0);
  assert.ok(first, 'a normal forward link should succeed');
  const cyclic=addLink('b','Image','a',0);
  assert.strictEqual(cyclic, null, 'connecting b back to a would create a cycle and must be rejected');
  assert.strictEqual(links.length, 1, 'the rejected link must not have been added');
});

test('addLink rejects a node linking to itself', ()=>{
  nodes={ a:{id:'a',type:'exposure',params:{amount:0}} };
  links=[];
  assert.strictEqual(addLink('a','Image','a',0), null);
  assert.strictEqual(links.length, 0);
});

test('makeParamDefaults deep-clones object/array defaults per node', ()=>{
  const d1=makeParamDefaults('colorRamp');
  const d2=makeParamDefaults('colorRamp');
  d1.stops.push({pos:0.9,color:'#ff0000'});
  assert.notStrictEqual(d1.stops.length, d2.stops.length, 'two nodes of the same type must not share one stops array');
});

test('a node with no valid input returns null instead of throwing', ()=>{
  nodes={ g:{id:'g',type:'gamma',params:{amount:150},_cache:undefined,_dirty:true} };
  links=[];
  assert.strictEqual(evaluateNode('g'), null);
});

test('a throwing compute() is caught, tagged with _error, and does not crash the graph', ()=>{
  const savedType=NODE_TYPES.gamma;
  NODE_TYPES.gamma={ ...savedType, compute(){ throw new Error('boom'); } };
  nodes={ g:{id:'g',type:'gamma',params:{amount:150},_cache:undefined,_dirty:true,title:'Gamma'} };
  links=[];
  const result=evaluateNode('g');
  assert.strictEqual(result, null);
  assert.strictEqual(nodes.g._error, 'boom');
  NODE_TYPES.gamma=savedType;
});

test('previewPinId lets runEvaluation preview a node other than the real Output, and extracts the right socket from a multi-output node', ()=>{
  const src=solidCanvas(2,2,10,150,240);
  nodes={
    img:{id:'img',type:'image',params:{},_src:src,_cache:undefined,_dirty:true},
    sep:{id:'sep',type:'separateRGB',params:{},_cache:undefined,_dirty:true},
    out:{id:'out',type:'output',params:{},_cache:undefined,_dirty:true},
  };
  links=[{id:'l1',from:'img',fromSock:'Image',to:'sep',toSock:0}]; // nothing wired to Output at all
  outputNodeId='out';
  let seen=null;
  global.updatePreview=(canvas)=>{ seen=canvas; };
  previewPinId='sep'; // pin the multi-output node directly, bypassing Output
  runEvaluation();
  assert.ok(seen, 'pinning a node with no Output wiring should still produce a preview');
  const pix=seen.getContext().getImageData(0,0,2,2).data;
  assert.strictEqual(pix[0], 10, 'pinning a multi-output node should preview its first output (R)');
  previewPinId=null;
  global.updatePreview=()=>{};
});

console.log(passed+' passed');
`);
