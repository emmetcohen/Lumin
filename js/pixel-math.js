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
function rgbToHex(rgb){
  const h=n=>clampByte(Math.round(n)).toString(16).padStart(2,'0');
  return '#'+h(rgb[0])+h(rgb[1])+h(rgb[2]);
}
// Blender-style color ramp: given sorted {pos,color} stops and a 0..1 factor,
// find the bracketing pair and interpolate. Shared by the live ramp-editor
// widget (hex in/out) and the per-pixel image pass (numeric RGB, precomputed
// stops for speed) below.
function sampleRampHex(stopsIn, t, interpolation){
  const raw=(stopsIn&&stopsIn.length?stopsIn:[{pos:0,color:'#000000'},{pos:1,color:'#ffffff'}]);
  const stops=raw.map(s=>({pos:s.pos, rgb:hexToRgb(s.color)})).sort((a,b)=>a.pos-b.pos);
  const n=stops.length;
  if(n===1||t<=stops[0].pos) return rgbToHex(stops[0].rgb);
  if(t>=stops[n-1].pos) return rgbToHex(stops[n-1].rgb);
  for(let k=0;k<n-1;k++){
    const a=stops[k], b=stops[k+1];
    if(t>=a.pos && t<=b.pos){
      const span=b.pos-a.pos; let f=span<=0?0:(t-a.pos)/span;
      if(interpolation==='Constant') f=0; else if(interpolation==='Ease') f=f*f*(3-2*f);
      return rgbToHex([a.rgb[0]+(b.rgb[0]-a.rgb[0])*f, a.rgb[1]+(b.rgb[1]-a.rgb[1])*f, a.rgb[2]+(b.rgb[2]-a.rgb[2])*f]);
    }
  }
  return rgbToHex(stops[n-1].rgb);
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
function fxGamma(d,amount){
  const gamma=(amount==null?100:amount)/100; if(gamma===1) return;
  const inv=1/gamma; const lut=new Uint8ClampedArray(256);
  for(let i=0;i<256;i++) lut[i]=clampByte(255*Math.pow(i/255, inv));
  for(let i=0;i<d.length;i+=4){ d[i]=lut[d[i]]; d[i+1]=lut[d[i+1]]; d[i+2]=lut[d[i+2]]; }
}
function fxClamp(d,low,high){
  const lo=(low==null?0:low)*2.55, hi=(high==null?100:high)*2.55; if(lo<=0 && hi>=255) return;
  for(let i=0;i<d.length;i+=4){
    d[i]=clampByte(Math.min(hi,Math.max(lo,d[i]))); d[i+1]=clampByte(Math.min(hi,Math.max(lo,d[i+1]))); d[i+2]=clampByte(Math.min(hi,Math.max(lo,d[i+2])));
  }
}
// Per-channel binary arithmetic between two equal-length RGBA buffers,
// written into `da` in place — the Math node's engine (distinct from Mix's
// alpha-blended blend modes: this is literal, unclamped-until-the-end math).
function fxMathOp(da,db,op){
  for(let i=0;i<da.length;i+=4){
    for(let c=0;c<3;c++){
      const a=da[i+c], b=db[i+c]; let v;
      switch(op){
        case 'Subtract': v=a-b; break;
        case 'Multiply': v=(a*b)/255; break;
        case 'Divide': v=b===0?255:(a/b)*255; break;
        case 'Min': v=Math.min(a,b); break;
        case 'Max': v=Math.max(a,b); break;
        case 'Difference': v=Math.abs(a-b); break;
        case 'Average': v=(a+b)/2; break;
        case 'Screen': v=255-((255-a)*(255-b))/255; break;
        default: v=a+b; // Add
      }
      da[i+c]=clampByte(v);
    }
  }
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
function hueToRgb(h){
  h=((h%360)+360)%360;
  const x=1-Math.abs((h/60)%2-1); let r,g,b;
  if(h<60){r=1;g=x;b=0;} else if(h<120){r=x;g=1;b=0;} else if(h<180){r=0;g=1;b=x;}
  else if(h<240){r=0;g=x;b=1;} else if(h<300){r=x;g=0;b=1;} else {r=1;g=0;b=x;}
  return [r*255,g*255,b*255];
}
// Maps each pixel's own luminance to a hue on the full rainbow wheel, cycling
// through it `bands` times across the brightness range — so the bands trace
// the source image's brightness contours (edges/shapes stay legible) while
// the color itself becomes a repeating rainbow. Shading by luminance keeps a
// sense of the original's depth instead of flat, fully-saturated color patches.
function fxRainbow(d,width,height,amount,bandsIn){
  const amt=(amount==null?100:amount)/100; if(!amt) return;
  const bands=Math.max(1,bandsIn||4);
  for(let i=0;i<d.length;i+=4){
    const lum=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255;
    const c=hueToRgb(lum*bands*360); const shade=0.35+0.65*lum;
    const tr=c[0]*shade, tg=c[1]*shade, tb=c[2]*shade;
    d[i]=clampByte(d[i]+(tr-d[i])*amt); d[i+1]=clampByte(d[i+1]+(tg-d[i+1])*amt); d[i+2]=clampByte(d[i+2]+(tb-d[i+2])*amt);
  }
}
// Tints edges by the *direction* of their brightness gradient rather than its
// magnitude — a Sobel angle mapped onto the rainbow wheel — so the color sheen
// shifts as a surface's contours turn, like an oil slick or holographic foil.
// Flat regions have no reliable gradient direction, so edge strength gates how
// much color shows through, leaving them close to the original image.
function fxIridescent(d,width,height,amount,thresholdIn){
  const amt=(amount==null?100:amount)/100; if(!amt) return;
  const threshold=thresholdIn==null?30:thresholdIn;
  const src=new Uint8ClampedArray(d);
  const lum=new Float32Array(width*height);
  for(let i=0,p=0;i<src.length;i+=4,p++) lum[p]=0.299*src[i]+0.587*src[i+1]+0.114*src[i+2];
  for(let y=0;y<height;y++){ const ym=Math.max(0,y-1), yp=Math.min(height-1,y+1);
    for(let x=0;x<width;x++){ const xm=Math.max(0,x-1), xp=Math.min(width-1,x+1);
      const tl=lum[ym*width+xm], tc=lum[ym*width+x], tr=lum[ym*width+xp];
      const ml=lum[y*width+xm], mr=lum[y*width+xp];
      const bl=lum[yp*width+xm], bc=lum[yp*width+x], br=lum[yp*width+xp];
      const gx=(tr+2*mr+br)-(tl+2*ml+bl), gy=(bl+2*bc+br)-(tl+2*tc+tr);
      const mag=Math.sqrt(gx*gx+gy*gy);
      const angle=Math.atan2(gy,gx)*180/Math.PI+180;
      const c=hueToRgb(angle);
      const weight=amt*Math.min(1,mag/threshold);
      const idx=(y*width+x)*4;
      d[idx]=clampByte(src[idx]+(c[0]-src[idx])*weight);
      d[idx+1]=clampByte(src[idx+1]+(c[1]-src[idx+1])*weight);
      d[idx+2]=clampByte(src[idx+2]+(c[2]-src[idx+2])*weight);
    }
  }
}
// Blooms the brightest areas outward with a slight R/B spatial offset, like
// light scattering through a prism — a soft rainbow-fringed halo around
// highlights rather than a full-frame recolor.
function fxPrismGlow(d,width,height,amount,thresholdIn){
  const amt=(amount==null?100:amount)/100; if(!amt) return;
  const thr=(thresholdIn==null?70:thresholdIn)/100*255;
  const n=width*height; const bright=new Float32Array(n);
  for(let i=0,p=0;i<d.length;i+=4,p++){ const lum=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; bright[p]=Math.max(0,lum-thr); }
  const radius=Math.max(3,Math.round(Math.min(width,height)*0.03));
  const glow=boxBlur1(bright,width,height,radius);
  const offset=Math.max(1,Math.round(Math.min(width,height)*0.01));
  for(let y=0;y<height;y++){ const rowBase=y*width;
    for(let x=0;x<width;x++){
      const idx=(rowBase+x)*4;
      const rx=Math.min(width-1,Math.max(0,x-offset)), bx=Math.min(width-1,Math.max(0,x+offset));
      d[idx]=clampByte(d[idx]+glow[rowBase+rx]*amt);
      d[idx+1]=clampByte(d[idx+1]+glow[rowBase+x]*amt);
      d[idx+2]=clampByte(d[idx+2]+glow[rowBase+bx]*amt);
    }
  }
}
// Classic glitch-art pixel sort: within each row, contiguous runs of pixels
// brighter than the threshold are sorted ascending by luminance, producing
// streaky, melting trails wherever the source image is bright.
function fxPixelSort(d,width,height,amount,thresholdIn){
  if(!amount) return; const amt=amount/100; const thr=(thresholdIn==null?50:thresholdIn)/100*255;
  const src=new Uint8ClampedArray(d);
  const lumAt=(rowBase,px)=>0.299*src[rowBase+px*4]+0.587*src[rowBase+px*4+1]+0.114*src[rowBase+px*4+2];
  for(let y=0;y<height;y++){
    const rowBase=y*width*4; let x=0;
    while(x<width){
      if(lumAt(rowBase,x)>thr){
        let xEnd=x+1; while(xEnd<width && lumAt(rowBase,xEnd)>thr) xEnd++;
        const runLen=xEnd-x;
        if(runLen>1){
          const order=[]; for(let k=0;k<runLen;k++) order.push(x+k);
          order.sort((pa,pb)=>lumAt(rowBase,pa)-lumAt(rowBase,pb));
          for(let k=0;k<runLen;k++){
            const sIdx=rowBase+order[k]*4, dIdx=rowBase+(x+k)*4;
            d[dIdx]=clampByte(src[dIdx]+(src[sIdx]-src[dIdx])*amt);
            d[dIdx+1]=clampByte(src[dIdx+1]+(src[sIdx+1]-src[dIdx+1])*amt);
            d[dIdx+2]=clampByte(src[dIdx+2]+(src[sIdx+2]-src[dIdx+2])*amt);
          }
        }
        x=xEnd;
      } else x++;
    }
  }
}
// Organic 2D flow warp: each pixel samples from a spot displaced by a sum of
// a few offset sine waves, giving a smoother, swirlier ripple than Wave
// Warp's single per-row sine shift.
function fxLiquifyWarp(d,width,height,amount,scaleIn){
  if(!amount) return; const src=new Uint8ClampedArray(d);
  const amp=(amount/100)*Math.min(width,height)*0.04;
  const freq=(scaleIn||4)/4; const s=Math.min(width,height)||1;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const nx=(x/s)*freq, ny=(y/s)*freq;
      const dx=(Math.sin(ny*12+1.3)+Math.sin(nx*7+ny*5+4.1)*0.5)*amp;
      const dy=(Math.sin(nx*10+2.7)+Math.sin(ny*6+nx*4+0.6)*0.5)*amp;
      const sx=Math.min(width-1,Math.max(0,Math.round(x+dx)));
      const sy=Math.min(height-1,Math.max(0,Math.round(y+dy)));
      const idx=(y*width+x)*4, sIdx=(sy*width+sx)*4;
      d[idx]=src[sIdx]; d[idx+1]=src[sIdx+1]; d[idx+2]=src[sIdx+2];
    }
  }
}
function fxColorRamp(d,stopsIn,interpolation,amount){
  const amt=(amount==null?100:amount)/100; if(!amt) return;
  const raw=(stopsIn&&stopsIn.length?stopsIn:[{pos:0,color:'#000000'},{pos:1,color:'#ffffff'}]);
  const stops=raw.map(s=>({pos:s.pos, rgb:hexToRgb(s.color)})).sort((a,b)=>a.pos-b.pos);
  const n=stops.length;
  for(let i=0;i<d.length;i+=4){
    const lum=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255;
    let c=stops[n-1].rgb;
    if(n===1||lum<=stops[0].pos) c=stops[0].rgb;
    else if(lum>=stops[n-1].pos) c=stops[n-1].rgb;
    else {
      for(let k=0;k<n-1;k++){
        const a=stops[k], b=stops[k+1];
        if(lum>=a.pos && lum<=b.pos){
          const span=b.pos-a.pos; let f=span<=0?0:(lum-a.pos)/span;
          if(interpolation==='Constant') f=0; else if(interpolation==='Ease') f=f*f*(3-2*f);
          c=[a.rgb[0]+(b.rgb[0]-a.rgb[0])*f, a.rgb[1]+(b.rgb[1]-a.rgb[1])*f, a.rgb[2]+(b.rgb[2]-a.rgb[2])*f];
          break;
        }
      }
    }
    d[i]=clampByte(d[i]+(c[0]-d[i])*amt); d[i+1]=clampByte(d[i+1]+(c[1]-d[i+1])*amt); d[i+2]=clampByte(d[i+2]+(c[2]-d[i+2])*amt);
  }
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
// Radial channel shift (red pulled outward, blue pulled inward from center) —
// unlike RGB Split's flat horizontal offset, this grows with distance from
// center like real lens chromatic aberration.
function fxChromaticAberration(d,width,height,amount){
  if(!amount) return; const src=new Uint8ClampedArray(d);
  const cx=width/2, cy=height/2; const maxR=Math.hypot(cx,cy)||1; const strength=(amount/100)*0.03;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const dx=x-cx, dy=y-cy; const dist=Math.hypot(dx,dy)||1; const shift=(dist/maxR)*strength*maxR;
      const ux=dx/dist, uy=dy/dist;
      const rx=Math.min(width-1,Math.max(0,Math.round(x+ux*shift))), ry=Math.min(height-1,Math.max(0,Math.round(y+uy*shift)));
      const bx=Math.min(width-1,Math.max(0,Math.round(x-ux*shift))), by=Math.min(height-1,Math.max(0,Math.round(y-uy*shift)));
      const idx=(y*width+x)*4;
      d[idx]=src[(ry*width+rx)*4]; d[idx+2]=src[(by*width+bx)*4+2];
    }
  }
}
function fxEmboss(d,width,height,amount){
  if(!amount) return; const amt=amount/100; const src=new Uint8ClampedArray(d);
  const gray=new Float32Array(width*height);
  for(let i=0,p=0;i<src.length;i+=4,p++) gray[p]=0.299*src[i]+0.587*src[i+1]+0.114*src[i+2];
  for(let y=0;y<height;y++){ const yp=Math.min(height-1,y+1);
    for(let x=0;x<width;x++){ const xp=Math.min(width-1,x+1);
      const g0=gray[y*width+x], g1=gray[y*width+xp], g2=gray[yp*width+x];
      const v=clampByte(128+(g1-g0)+(g2-g0)); const idx=(y*width+x)*4;
      d[idx]=clampByte(src[idx]+(v-src[idx])*amt); d[idx+1]=clampByte(src[idx+1]+(v-src[idx+1])*amt); d[idx+2]=clampByte(src[idx+2]+(v-src[idx+2])*amt);
    }
  }
}
function fxOldFilm(d,width,height,amount){
  if(!amount) return; const amt=amount/100;
  for(let i=0;i<d.length;i+=4){
    const lum=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    const sr=clampByte(lum*1.07+18), sg=clampByte(lum*0.86+10), sb=clampByte(lum*0.62);
    d[i]=clampByte(d[i]+(sr-d[i])*amt); d[i+1]=clampByte(d[i+1]+(sg-d[i+1])*amt); d[i+2]=clampByte(d[i+2]+(sb-d[i+2])*amt);
  }
  fxFilmGrain(d,width,height,amount*0.45);
}
function fxWaveWarp(d,width,height,amount,wavesIn){
  if(!amount) return; const src=new Uint8ClampedArray(d);
  const amp=(amount/100)*Math.min(width,height)*0.05; const freq=(Math.PI*2*(wavesIn||6))/height;
  for(let y=0;y<height;y++){
    const shift=Math.round(Math.sin(y*freq)*amp); const rowBase=y*width*4;
    for(let x=0;x<width;x++){
      const sx=Math.min(width-1,Math.max(0,x-shift)); const idx=rowBase+x*4, sIdx=rowBase+sx*4;
      d[idx]=src[sIdx]; d[idx+1]=src[sIdx+1]; d[idx+2]=src[sIdx+2];
    }
  }
}

