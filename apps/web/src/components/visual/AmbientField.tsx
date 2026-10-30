import {useEffect,useRef,useState} from 'react';
import {useLocation} from 'react-router-dom';
import {useVisualPreferences} from '../../lib/visual-preferences';
import {vertexShader,fragmentShader} from './ambient-shaders';

export function AmbientField(){
  const canvas=useRef<HTMLCanvasElement>(null),fallback=useRef<HTMLCanvasElement>(null),enabled=useRef(false),palette=useRef(0),wake=useRef<(ms?:number)=>void>(()=>{});
  const [fallbackVisible,setFallback]=useState(false),{motionEnabled}=useVisualPreferences(),location=useLocation();enabled.current=motionEnabled;
  useEffect(()=>{
    const category=new URLSearchParams(location.search).get('category');
    palette.current=category==='STUDY'?1:category==='GAME'?2:category==='OUTDOOR'?3:location.pathname==='/messages'?4:0;
    wake.current(1500);
  },[location.pathname,location.search]);
  useEffect(()=>{wake.current(1000);},[motionEnabled]);
  useEffect(()=>{
    const surface=canvas.current,backup=fallback.current;if(!surface||!backup)return;
    let disposed=false,frame=0,last=0,drawAt=0,until=0,activeCanvas=surface;
    let gl:WebGLRenderingContext|null=null,program:WebGLProgram|null=null,buffer:WebGLBuffer|null=null,context:CanvasRenderingContext2D|null=null;
    const shaders:WebGLShader[]=[],uniforms:Record<string,WebGLUniformLocation|null>={};
    const state={x:.5,y:.5,tx:.5,ty:.5,vx:0,vy:0,intensity:0,palette:0};
    const ripples=Array.from({length:4},()=>[-2,-2,-100,0]);let rippleIndex=0;
    try{gl=surface.getContext('webgl',{alpha:false,antialias:false,powerPreference:'low-power'});}catch{/* Use the independent fallback canvas. */}
    if(gl){
      const renderer=gl;
      const compile=(type:number,source:string)=>{const shader=renderer.createShader(type);if(!shader)return null;renderer.shaderSource(shader,source);renderer.compileShader(shader);if(!renderer.getShaderParameter(shader,renderer.COMPILE_STATUS)){renderer.deleteShader(shader);return null;}shaders.push(shader);return shader;};
      const vs=compile(gl.VERTEX_SHADER,vertexShader),fs=compile(gl.FRAGMENT_SHADER,fragmentShader);
      if(vs&&fs){program=gl.createProgram();if(program){gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);program=null;}}}
      if(program){gl.useProgram(program);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const attribute=gl.getAttribLocation(program,'a');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);for(const key of ['r','p','v','t','k','palette','q'])uniforms[key]=gl.getUniformLocation(program,key==='q'?'q[0]':key);surface.dataset.renderer='webgl';setFallback(false);}
    }
    function useFallback(){activeCanvas=backup!;context=backup!.getContext('2d');activeCanvas.dataset.renderer='canvas2d';setFallback(true);}
    if(!program)useFallback();
    function draw(time:number){
      if(disposed)return;
      if(gl&&program){gl.uniform2f(uniforms.r,activeCanvas.width,activeCanvas.height);gl.uniform2f(uniforms.p,state.x,1-state.y);gl.uniform2f(uniforms.v,state.vx,-state.vy);gl.uniform1f(uniforms.t,enabled.current?time:12);gl.uniform1f(uniforms.k,enabled.current?state.intensity:0);gl.uniform1f(uniforms.palette,state.palette);gl.uniform4fv(uniforms.q,new Float32Array(ripples.flat()));gl.drawArrays(gl.TRIANGLES,0,6);}
      else if(context){const w=activeCanvas.width,h=activeCanvas.height;context.fillStyle='#fff9ef';context.fillRect(0,0,w,h);const colors=['#d9ccfb','#d2eafb','#e6f2d8','#f6dce4'];for(let j=0;j<4;j++){const x=(j%2?.86:.12)*w+state.x*35,y=(j<2?.12:.8)*h+state.y*30;const gradient=context.createRadialGradient(x,y,5,x,y,w*.6);gradient.addColorStop(0,colors[j]+'95');gradient.addColorStop(1,colors[j]+'00');context.fillStyle=gradient;context.fillRect(0,0,w,h);}context.lineWidth=.7;context.strokeStyle='#9d8ab020';for(let j=0;j<16;j++){context.beginPath();for(let i=0;i<=60;i++){const x=i/60*w,y=h*.15+j*h*.06+Math.sin(i*.08+time*.1+j*.1)*h*.07+(state.y-.5)*30*Math.sin(i*.09);if(!i)context.moveTo(x,y);else context.lineTo(x,y);}context.stroke();}}
    }
    function loop(now:number){
      frame=0;if(disposed)return;
      if(document.hidden||!enabled.current){activeCanvas.dataset.running='false';state.palette=palette.current;draw(12);return;}
      const interval=innerWidth<600?1000/24:1000/30;if(now-drawAt<interval){frame=requestAnimationFrame(loop);return;}drawAt=now;
      const dt=last?Math.min((now-last)/1000,.034):.016;last=now;
      state.vx+=((state.tx-state.x)*70-state.vx*14)*dt;state.vy+=((state.ty-state.y)*70-state.vy*14)*dt;state.x+=state.vx*dt;state.y+=state.vy*dt;state.intensity+=(1-state.intensity)*.07;state.palette+=(palette.current-state.palette)*.065;draw(now/1000);
      if(now<until||Math.abs(state.vx)+Math.abs(state.vy)>.001)frame=requestAnimationFrame(loop);else{last=0;state.intensity=0;activeCanvas.dataset.running='false';}
    }
    function wakeUp(ms=2500){if(disposed)return;if(!enabled.current||document.hidden){cancelAnimationFrame(frame);frame=0;last=0;state.palette=palette.current;activeCanvas.dataset.running='false';draw(12);return;}until=performance.now()+ms;if(!frame){activeCanvas.dataset.running='true';frame=requestAnimationFrame(loop);}}
    function resize(){if(disposed)return;const ratio=Math.min(devicePixelRatio||1,1.5)*(innerWidth<600?.85:.72);activeCanvas.width=Math.max(1,Math.round(innerWidth*ratio));activeCanvas.height=Math.max(1,Math.round(innerHeight*ratio));if(gl&&program)gl.viewport(0,0,activeCanvas.width,activeCanvas.height);draw(performance.now()/1000);wakeUp(1500);}
    function pointerMove(event:PointerEvent){if(!enabled.current)return;state.tx=event.clientX/innerWidth;state.ty=event.clientY/innerHeight;wakeUp();}
    function pointerDown(event:PointerEvent){if(!enabled.current)return;ripples[rippleIndex++%4]=[event.clientX/innerWidth,1-event.clientY/innerHeight,performance.now()/1000,1];wakeUp(3200);}
    function visibility(){if(document.hidden){cancelAnimationFrame(frame);frame=0;last=0;activeCanvas.dataset.running='false';}else wakeUp(500);}
    function contextLost(event:Event){event.preventDefault();cancelAnimationFrame(frame);frame=0;gl=null;program=null;useFallback();resize();}
    wake.current=wakeUp;surface.addEventListener('webglcontextlost',contextLost);window.addEventListener('pointermove',pointerMove,{passive:true});window.addEventListener('pointerdown',pointerDown,{passive:true});window.addEventListener('resize',resize,{passive:true});document.addEventListener('visibilitychange',visibility);resize();
    return()=>{disposed=true;wake.current=()=>{};cancelAnimationFrame(frame);surface.removeEventListener('webglcontextlost',contextLost);window.removeEventListener('pointermove',pointerMove);window.removeEventListener('pointerdown',pointerDown);window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visibility);if(gl){if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);shaders.forEach(shader=>gl!.deleteShader(shader));}};
  },[]);
  return <div className="ambient-backdrop" aria-hidden="true"><canvas ref={canvas} hidden={fallbackVisible}/><canvas ref={fallback} hidden={!fallbackVisible}/></div>;
}
