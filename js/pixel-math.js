'use strict';

/* ============================================================
   PIXEL MATH — ported from the original stack-based editor
   ============================================================ */
function clamp01(v){ return v<0?0:v>1?1:v; }
function clampByte(v){ return v<0?0:v>255?255:v; }
function srgbToLinear(c){ c=c/255; return c<=0.04045? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }
function linearToSrgb(c){ if(c<=0) return 0; return (c<=0.0031308? c*12.92 : 1.055*Math.pow(c,1/2.4)-0.055)*255; }
const SRGB_TO_LINEAR = new Float32Array(256);
for(let i=0;i<256;i++) SRGB_TO_LINEAR[i]=srgbToLinear(i);

function clampIdx(i,size){ return i<0?0:(i>=size?size-1:i); }
function boxBlurPass(src,dst,width,height,radius,horizontal){
  const windowSize=radius*2+1;
  if(horizontal){
    for(let y=0;y<height;y++){
      const rowBase=y*width*4; let rS=0,gS=0,bS=0;
      for(let dx=-radius;dx<=radius;dx++){ const idx=rowBase+clampIdx(dx,width)*4; rS+=src[idx]; gS+=src[idx+1]; bS+=src[idx+2]; }
      for(let x=0;x<width;x++){
        const idx=rowBase+x*4;
        dst[idx]=rS/windowSize; dst[idx+1]=gS/windowSize; dst[idx+2]=bS/windowSize; dst[idx+3]=src[idx+3];
        const rIdx=rowBase+clampIdx(x-radius,width)*4, aIdx=rowBase+clampIdx(x+radius+1,width)*4;
        rS+=src[aIdx]-src[rIdx]; gS+=src[aIdx+1]-src[rIdx+1]; bS+=src[aIdx+2]-src[rIdx+2];
      }
    }
  } else {
    for(let x=0;x<width;x++){
      let rS=0,gS=0,bS=0;
      for(let dy=-radius;dy<=radius;dy++){ const idx=(clampIdx(dy,height)*width+x)*4; rS+=src[idx]; gS+=src[idx+1]; bS+=src[idx+2]; }
      for(let y=0;y<height;y++){
        const idx=(y*width+x)*4;
        dst[idx]=rS/windowSize; dst[idx+1]=gS/windowSize; dst[idx+2]=bS/windowSize; dst[idx+3]=src[idx+3];
        const rIdx=(clampIdx(y-radius,height)*width+x)*4, aIdx=(clampIdx(y+radius+1,height)*width+x)*4;
        rS+=src[aIdx]-src[rIdx]; gS+=src[aIdx+1]-src[rIdx+1]; bS+=src[aIdx+2]-src[rIdx+2];
      }
    }
  }
}
function boxBlur(data,width,height,radius){
  const horiz=new Float32Array(data.length); boxBlurPass(data,horiz,width,height,radius,true);
  const out=new Float32Array(data.length); boxBlurPass(horiz,out,width,height,radius,false);
  return out;
}
function boxBlur1(src,width,height,radius){
  const windowSize=radius*2+1; const tmp=new Float32Array(width*height);
  for(let y=0;y<height;y++){
    const rowBase=y*width; let sum=0;
    for(let dx=-radius;dx<=radius;dx++) sum+=src[rowBase+clampIdx(dx,width)];
    for(let x=0;x<width;x++){
      tmp[rowBase+x]=sum/windowSize;
      const rIdx=rowBase+clampIdx(x-radius,width), aIdx=rowBase+clampIdx(x+radius+1,width);
      sum+=src[aIdx]-src[rIdx];
    }
  }
  const out=new Float32Array(width*height);
  for(let x=0;x<width;x++){
    let sum=0;
    for(let dy=-radius;dy<=radius;dy++) sum+=tmp[clampIdx(dy,height)*width+x];
    for(let y=0;y<height;y++){
      const idx=y*width+x;
      out[idx]=sum/windowSize;
      const rIdx=clampIdx(y-radius,height)*width+x, aIdx=clampIdx(y+radius+1,height)*width+x;
      sum+=tmp[aIdx]-tmp[rIdx];
    }
  }
  return out;
}
function hexToRgb(hex){
  const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex||'#000000');
  return m? [parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16)] : [0,0,0];
}

/* ---- individual effect functions (d = Uint8ClampedArray RGBA) ---- */
function fxExposure(d,amount){
  if(!amount) return; const mul=Math.pow(2,amount/100*5);
  for(let i=0;i<d.length;i+=4){
    d[i]=clampByte(linearToSrgb(SRGB_TO_LINEAR[d[i]]*mul));
    d[i+1]=clampByte(linearToSrgb(SRGB_TO_LINEAR[d[i+1]]*mul));
    d[i+2]=clampByte(linearToSrgb(SRGB_TO_LINEAR[d[i+2]]*mul));
  }
}
function fxContrast(d,amount){
  if(!amount) return; const c255=amount*2.55; const f=(259*(c255+255))/(255*(259-c255));
  for(let i=0;i<d.length;i+=4){ d[i]=clampByte(f*(d[i]-128)+128); d[i+1]=clampByte(f*(d[i+1]-128)+128); d[i+2]=clampByte(f*(d[i+2]-128)+128); }
}
function fxLevels(d,p){
  const hlAmt=(p.highlights||0)/100*70, shAmt=(p.shadows||0)/100*70, whAmt=(p.whites||0)/100*90, blAmt=(p.blacks||0)/100*90;
  if(!hlAmt&&!shAmt&&!whAmt&&!blAmt) return;
  for(let i=0;i<d.length;i+=4){
    let r=d[i],g=d[i+1],b=d[i+2]; const lum=0.299*r+0.587*g+0.114*b;
    if(hlAmt){ const w=clamp01((lum-128)/127); r+=hlAmt*w; g+=hlAmt*w; b+=hlAmt*w; }
    if(shAmt){ const w=clamp01((128-lum)/128); r+=shAmt*w; g+=shAmt*w; b+=shAmt*w; }
    if(whAmt){ const w=clamp01((lum-200)/55); r+=whAmt*w; g+=whAmt*w; b+=whAmt*w; }
    if(blAmt){ const w=clamp01((55-lum)/55); r+=blAmt*w; g+=blAmt*w; b+=blAmt*w; }
    d[i]=clampByte(r); d[i+1]=clampByte(g); d[i+2]=clampByte(b);
  }
}
function fxSaturation(d,amount){
  if(!amount) return; const mul=1+amount/100;
  for(let i=0;i<d.length;i+=4){ const lum=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    d[i]=clampByte(lum+mul*(d[i]-lum)); d[i+1]=clampByte(lum+mul*(d[i+1]-lum)); d[i+2]=clampByte(lum+mul*(d[i+2]-lum)); }
}
function fxVibrance(d,amount){
  if(!amount) return; const vibAmt=amount/100;
  for(let i=0;i<d.length;i+=4){
    const r=d[i],g=d[i+1],b=d[i+2]; const lum=0.299*r+0.587*g+0.114*b;
    const maxC=Math.max(r,g,b), minC=Math.min(r,g,b); const curSat=maxC<=0?0:(maxC-minC)/maxC;
    const isSkinish=r>g && g>=b && (r-b)>10 && (r-b)<130; const protect=isSkinish?0.5:1;
    const boost=vibAmt*(1-curSat)*protect;
    d[i]=clampByte(lum+(1+boost)*(r-lum)); d[i+1]=clampByte(lum+(1+boost)*(g-lum)); d[i+2]=clampByte(lum+(1+boost)*(b-lum));
  }
}
function fxHueShift(d,degrees){
  if(!degrees) return; const rad=degrees*Math.PI/180; const cosA=Math.cos(rad), sinA=Math.sin(rad);
  // Rotate hue via the standard YIQ-like matrix approximation.
  const m00=0.213+cosA*0.787-sinA*0.213, m01=0.715-cosA*0.715-sinA*0.715, m02=0.072-cosA*0.072+sinA*0.928;
  const m10=0.213-cosA*0.213+sinA*0.143, m11=0.715+cosA*0.285+sinA*0.140, m12=0.072-cosA*0.072-sinA*0.283;
  const m20=0.213-cosA*0.213-sinA*0.787, m21=0.715-cosA*0.715+sinA*0.715, m22=0.072+cosA*0.928+sinA*0.072;
  for(let i=0;i<d.length;i+=4){
    const r=d[i],g=d[i+1],b=d[i+2];
    d[i]=clampByte(r*m00+g*m01+b*m02); d[i+1]=clampByte(r*m10+g*m11+b*m12); d[i+2]=clampByte(r*m20+g*m21+b*m22);
  }
}
function fxWhiteBalance(d,p){
  const temp=(p.temperature||0)/100, tint=(p.tint||0)/100;
  if(!temp&&!tint) return;
  for(let i=0;i<d.length;i+=4){
    d[i]=clampByte(d[i]+temp*24-tint*10); d[i+1]=clampByte(d[i+1]+tint*20); d[i+2]=clampByte(d[i+2]-temp*24-tint*10);
  }
}
function fxInvert(d,amount){
  if(!amount) return; const a=amount/100;
  for(let i=0;i<d.length;i+=4){ d[i]=clampByte(d[i]+(255-2*d[i])*a); d[i+1]=clampByte(d[i+1]+(255-2*d[i+1])*a); d[i+2]=clampByte(d[i+2]+(255-2*d[i+2])*a); }
}
function fxBlackWhite(d,amount){
  if(!amount) return; const a=amount/100;
  for(let i=0;i<d.length;i+=4){ const lum=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; d[i]=clampByte(d[i]+(lum-d[i])*a); d[i+1]=clampByte(d[i+1]+(lum-d[i+1])*a); d[i+2]=clampByte(d[i+2]+(lum-d[i+2])*a); }
}
function fxDuotone(d,p){
  const amt=(p.amount||0)/100; if(!amt) return;
  const sc=hexToRgb(p.shadowColor||'#16364a'), hc=hexToRgb(p.highlightColor||'#ffb05c');
  for(let i=0;i<d.length;i+=4){
    const lum=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255;
    const dr=sc[0]+(hc[0]-sc[0])*lum, dg=sc[1]+(hc[1]-sc[1])*lum, db=sc[2]+(hc[2]-sc[2])*lum;
    d[i]=clampByte(d[i]+(dr-d[i])*amt); d[i+1]=clampByte(d[i+1]+(dg-d[i+1])*amt); d[i+2]=clampByte(d[i+2]+(db-d[i+2])*amt);
  }
}
function fxPosterize(d,amount){
  if(!amount) return; const levels=Math.max(2,Math.round(16-(amount/100)*14)); const step=255/(levels-1);
  for(let i=0;i<d.length;i+=4){ d[i]=clampByte(Math.round(d[i]/step)*step); d[i+1]=clampByte(Math.round(d[i+1]/step)*step); d[i+2]=clampByte(Math.round(d[i+2]/step)*step); }
}
function fxSolarize(d,amount){
  if(!amount) return; const threshold=255-(amount/100)*140;
  for(let i=0;i<d.length;i+=4){ let r=d[i],g=d[i+1],b=d[i+2]; if(r>threshold) r=255-r; if(g>threshold) g=255-g; if(b>threshold) b=255-b; d[i]=clampByte(r); d[i+1]=clampByte(g); d[i+2]=clampByte(b); }
}
function fxThermal(d,amount){
  if(!amount) return; const amt=amount/100; const stops=[[8,8,64],[0,170,180],[255,220,0],[230,20,20]];
  for(let i=0;i<d.length;i+=4){
    const lum=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255; const t=Math.min(2.999,lum*3); const seg=t|0,f=t-seg;
    const c0=stops[seg],c1=stops[seg+1];
    d[i]=clampByte(d[i]+((c0[0]+(c1[0]-c0[0])*f)-d[i])*amt); d[i+1]=clampByte(d[i+1]+((c0[1]+(c1[1]-c0[1])*f)-d[i+1])*amt); d[i+2]=clampByte(d[i+2]+((c0[2]+(c1[2]-c0[2])*f)-d[i+2])*amt);
  }
}
function fxRgbSplit(d,width,height,amount){
  if(!amount) return; const src=new Uint8ClampedArray(d); const maxOffset=Math.max(1,Math.round(width*0.02)); const offset=Math.round(amount/100*maxOffset);
  for(let y=0;y<height;y++){ const rowBase=y*width*4;
    for(let x=0;x<width;x++){ const idx=rowBase+x*4; const rx=Math.min(width-1,Math.max(0,x-offset)); const bx=Math.min(width-1,Math.max(0,x+offset));
      d[idx]=src[rowBase+rx*4]; d[idx+2]=src[rowBase+bx*4+2]; }
  }
}
function fxGlitch(d,width,height,amount){
  if(!amount) return; const amt=amount/100; const src=new Uint8ClampedArray(d);
  let seed=42; const rand=()=>{ seed=(seed*9301+49297)%233280; return seed/233280; };
  const maxBand=Math.max(6,Math.round(height*0.05)); const maxShift=Math.max(1,Math.round(width*0.15*amt));
  let y=0;
  while(y<height){
    const bandH=Math.max(2,Math.round(rand()*maxBand)); const yEnd=Math.min(height,y+bandH);
    const doShift=rand()<(0.35+amt*0.5); const shift=doShift?Math.round((rand()*2-1)*maxShift):0;
    const chanOffset=(doShift&&rand()<0.4)?Math.round(rand()*maxShift*0.5):0;
    for(let yy=y;yy<yEnd;yy++){ const rowBase=yy*width*4;
      for(let x=0;x<width;x++){ const idx=rowBase+x*4; const sx=Math.min(width-1,Math.max(0,x-shift)); const rx=Math.min(width-1,Math.max(0,sx-chanOffset)); const bx=Math.min(width-1,Math.max(0,sx+chanOffset));
        d[idx]=src[rowBase+rx*4]; d[idx+1]=src[rowBase+sx*4+1]; d[idx+2]=src[rowBase+bx*4+2]; }
    }
    y=yEnd;
  }
}
function fxNeonEdges(d,width,height,amount){
  if(!amount) return; const amt=amount/100; const src=new Uint8ClampedArray(d);
  const lum=new Float32Array(width*height);
  for(let i=0,p=0;i<src.length;i+=4,p++) lum[p]=0.299*src[i]+0.587*src[i+1]+0.114*src[i+2];
  const edge=new Float32Array(width*height);
  for(let y=0;y<height;y++){ const ym=Math.max(0,y-1), yp=Math.min(height-1,y+1);
    for(let x=0;x<width;x++){ const xm=Math.max(0,x-1), xp=Math.min(width-1,x+1);
      const tl=lum[ym*width+xm], tc=lum[ym*width+x], tr=lum[ym*width+xp];
      const ml=lum[y*width+xm], mr=lum[y*width+xp];
      const bl=lum[yp*width+xm], bc=lum[yp*width+x], br=lum[yp*width+xp];
      const gx=(tr+2*mr+br)-(tl+2*ml+bl), gy=(bl+2*bc+br)-(tl+2*tc+tr);
      edge[y*width+x]=Math.sqrt(gx*gx+gy*gy);
    }
  }
  const glow=boxBlur1(edge,width,height,3); const split=Math.max(1,Math.round(amt*5));
  const glowMix=0.6, punch=amt*2.2, darken=1-amt*0.65;
  for(let y=0;y<height;y++){ const rowBase=y*width;
    for(let x=0;x<width;x++){ const idx=(rowBase+x)*4;
      const rx=Math.min(width-1,Math.max(0,x-split)), bx=Math.min(width-1,Math.max(0,x+split));
      const rMag=edge[rowBase+rx]+glow[rowBase+rx]*glowMix, gMag=edge[rowBase+x]+glow[rowBase+x]*glowMix, bMag=edge[rowBase+bx]+glow[rowBase+bx]*glowMix;
      d[idx]=clampByte(src[idx]*darken+rMag*punch); d[idx+1]=clampByte(src[idx+1]*darken+gMag*punch); d[idx+2]=clampByte(src[idx+2]*darken+bMag*punch);
    }
  }
}
function fxKaleidoscope(d,width,height,segmentsIn){
  const src=new Uint8ClampedArray(d); const cx=width/2, cy=height/2; const segments=Math.max(3,segmentsIn||8); const wedge=(Math.PI*2)/segments;
  for(let y=0;y<height;y++){ const dy=y-cy;
    for(let x=0;x<width;x++){ const dx=x-cx; const radius=Math.sqrt(dx*dx+dy*dy); const angle=Math.atan2(dy,dx);
      let a=((angle%wedge)+wedge)%wedge; if(a>wedge/2) a=wedge-a;
      const sx=Math.min(width-1,Math.max(0,Math.round(cx+radius*Math.cos(a)))); const sy=Math.min(height-1,Math.max(0,Math.round(cy+radius*Math.sin(a))));
      const sIdx=(sy*width+sx)*4, idx=(y*width+x)*4; d[idx]=src[sIdx]; d[idx+1]=src[sIdx+1]; d[idx+2]=src[sIdx+2];
    }
  }
}
function fxPixelate(d,width,height,amount){
  if(!amount) return; const amt=amount/100; const maxBlock=Math.max(6,Math.round(Math.min(width,height)*0.1)); const bs=Math.max(2,Math.round(2+amt*(maxBlock-2)));
  for(let by=0;by<height;by+=bs){ const bh=Math.min(bs,height-by);
    for(let bx=0;bx<width;bx+=bs){ const bw=Math.min(bs,width-bx); let rs=0,gs=0,bsum=0;
      for(let y=by;y<by+bh;y++){ let idx=(y*width+bx)*4; for(let x=0;x<bw;x++){ rs+=d[idx]; gs+=d[idx+1]; bsum+=d[idx+2]; idx+=4; } }
      const count=bw*bh; const ra=rs/count, ga=gs/count, ba=bsum/count;
      for(let y=by;y<by+bh;y++){ let idx=(y*width+bx)*4; for(let x=0;x<bw;x++){ d[idx]=ra; d[idx+1]=ga; d[idx+2]=ba; idx+=4; } }
    }
  }
}
function fxHalftone(d,width,height,cellIn,shape,colorMode){
  const cell=Math.max(4,cellIn||10), half=cell/2; const cols=Math.ceil(width/cell), rows=Math.ceil(height/cell);
  const avgR=new Float32Array(cols*rows), avgG=new Float32Array(cols*rows), avgB=new Float32Array(cols*rows);
  for(let cy=0;cy<rows;cy++){ const y0=cy*cell, y1=Math.min(height,y0+cell);
    for(let cx=0;cx<cols;cx++){ const x0=cx*cell, x1=Math.min(width,x0+cell); let sr=0,sg=0,sb=0;
      for(let y=y0;y<y1;y++){ let idx=(y*width+x0)*4; for(let x=x0;x<x1;x++){ sr+=d[idx]; sg+=d[idx+1]; sb+=d[idx+2]; idx+=4; } }
      const n=(y1-y0)*(x1-x0); const ci=cy*cols+cx; avgR[ci]=sr/n; avgG[ci]=sg/n; avgB[ci]=sb/n;
    }
  }
  const useColor=colorMode==='color';
  for(let y=0;y<height;y++){ const cy=(y/cell)|0;
    for(let x=0;x<width;x++){ const cx=(x/cell)|0; const ci=cy*cols+cx;
      const lum=(0.299*avgR[ci]+0.587*avgG[ci]+0.114*avgB[ci])/255;
      const ddx=x-(cx*cell+half), ddy=y-(cy*cell+half); let inside;
      if(shape==='lines'){ const barHalf=(1-lum)*half; inside=Math.abs(ddy)<barHalf; }
      else if(shape==='squares'){ const side=Math.sqrt(1-lum)*cell*0.92; inside=Math.abs(ddx)<side/2 && Math.abs(ddy)<side/2; }
      else if(shape==='cross'){ const r=(1-lum)*(half*1.15); inside=(Math.abs(ddx)+Math.abs(ddy))<r; }
      else { const r=(1-lum)*(half*0.92); inside=(ddx*ddx+ddy*ddy)<r*r; }
      const idx=(y*width+x)*4;
      if(inside&&useColor){ d[idx]=avgR[ci]; d[idx+1]=avgG[ci]; d[idx+2]=avgB[ci]; } else { const v=inside?0:255; d[idx]=v; d[idx+1]=v; d[idx+2]=v; }
    }
  }
}
function fxSketch(d,width,height,amount){
  if(!amount) return; const amt=amount/100; const src=new Uint8ClampedArray(d); const lum=new Float32Array(width*height);
  for(let i=0,p=0;i<src.length;i+=4,p++) lum[p]=0.299*src[i]+0.587*src[i+1]+0.114*src[i+2];
  for(let y=0;y<height;y++){ const ym=Math.max(0,y-1), yp=Math.min(height-1,y+1);
    for(let x=0;x<width;x++){ const xm=Math.max(0,x-1), xp=Math.min(width-1,x+1);
      const tl=lum[ym*width+xm], tc=lum[ym*width+x], tr=lum[ym*width+xp];
      const ml=lum[y*width+xm], mr=lum[y*width+xp];
      const bl=lum[yp*width+xm], bc=lum[yp*width+x], br=lum[yp*width+xp];
      const gx=(tr+2*mr+br)-(tl+2*ml+bl), gy=(bl+2*bc+br)-(tl+2*tc+tr);
      const val=clampByte(255-Math.sqrt(gx*gx+gy*gy)*1.4); const idx=(y*width+x)*4;
      d[idx]+=(val-d[idx])*amt; d[idx+1]+=(val-d[idx+1])*amt; d[idx+2]+=(val-d[idx+2])*amt;
    }
  }
}
function fxFilmGrain(d,width,height,amount){
  if(!amount) return; const amt=amount/100; const n=width*height; const fine=new Float32Array(n);
  for(let p=0;p<n;p++) fine[p]=Math.random()*2-1; const blotch=boxBlur1(fine,width,height,2);
  for(let i=0,p=0;i<d.length;i+=4,p++){ const lum=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255; const shadowWeight=1-Math.pow(lum,1.4);
    const g=(fine[p]*0.6+blotch[p]*0.4)*amt*55*shadowWeight; d[i]=clampByte(d[i]+g); d[i+1]=clampByte(d[i+1]+g); d[i+2]=clampByte(d[i+2]+g);
  }
}
function fxClaritySharpen(d,width,height,clarity,sharpen){
  if(!clarity&&!sharpen) return; const n=width*height; let lum=new Float32Array(n);
  for(let i=0,p=0;i<d.length;i+=4,p++) lum[p]=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
  if(clarity){ const radius=Math.max(4,Math.round(width/180)); const blurredLum=boxBlur1(lum,width,height,radius); const amt=clarity/100*0.65;
    for(let i=0,p=0;i<d.length;i+=4,p++){ const delta=amt*(lum[p]-blurredLum[p]); d[i]=clampByte(d[i]+delta); d[i+1]=clampByte(d[i+1]+delta); d[i+2]=clampByte(d[i+2]+delta); }
    if(sharpen){ lum=new Float32Array(n); for(let i=0,p=0;i<d.length;i+=4,p++) lum[p]=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; }
  }
  if(sharpen){ const blurredLum=boxBlur1(lum,width,height,1); const amt=sharpen/100*0.7;
    for(let i=0,p=0;i<d.length;i+=4,p++){ const delta=amt*(lum[p]-blurredLum[p]); d[i]=clampByte(d[i]+delta); d[i+1]=clampByte(d[i+1]+delta); d[i+2]=clampByte(d[i+2]+delta); }
  }
}
function fxNoiseReduction(d,width,height,amount){
  if(!amount) return; const radius=Math.max(2,Math.round(width/350)); const blurred=boxBlur(d,width,height,radius); const strength=amount/100*0.85;
  for(let i=0;i<d.length;i+=4){ d[i]=d[i]*(1-strength)+blurred[i]*strength; d[i+1]=d[i+1]*(1-strength)+blurred[i+1]*strength; d[i+2]=d[i+2]*(1-strength)+blurred[i+2]*strength; }
}
function fxGaussianBlur(d,width,height,radius){
  if(!radius) return; let cur=d; for(let pass=0;pass<3;pass++){ cur=boxBlur(cur,width,height,Math.max(1,Math.round(radius/2))); }
  for(let i=0;i<d.length;i+=4){ d[i]=cur[i]; d[i+1]=cur[i+1]; d[i+2]=cur[i+2]; }
}

