// Original procedural paper, flow contours and pointer ripples.
export const vertexShader = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
export const fragmentShader = `precision mediump float;
      uniform vec2 r,p,v;uniform float t,k,palette;uniform vec4 q[4];
      float hash(vec2 a){return fract(sin(dot(a,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 a){vec2 i=floor(a),f=fract(a);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
      float fbm(vec2 a){return .57*noise(a)+.28*noise(a*2.01+3.)+.15*noise(a*4.02+7.);}
      void main(){vec2 uv=gl_FragCoord.xy/r;float aspect=r.x/r.y;vec2 z=uv*vec2(aspect,1.);vec2 pm=p*vec2(aspect,1.);float d=length(z-pm);vec2 push=(z-pm)*exp(-d*d*3.5)*k*.24;z+=push+v*exp(-d*d*4.)*.12;
      for(int i=0;i<4;i++){float age=t-q[i].z;float dist=length((uv-q[i].xy)*vec2(aspect,1.));float wave=sin(dist*28.-age*7.)*exp(-age*1.8)*exp(-abs(dist-age*.24)*12.);if(age>0.&&age<4.)z+=(z-pm)*wave*.065;}
      float n=fbm(z*2.2+vec2(t*.013,-t*.009));float flow=fbm(z*1.6+vec2(n*1.5,-n));
      vec3 paper=vec3(1.,.978,.949),lilac=vec3(.815,.76,.978),rose=vec3(.984,.812,.865),blue=vec3(.77,.89,.977),mint=vec3(.825,.93,.793);
      float a=exp(-pow((z.x+.30*z.y-.20-n*.6)*1.4,2.))*smoothstep(.18,.68,flow);
      float b=exp(-pow((z.x-.45*z.y-aspect*.70+n*.4)*1.6,2.))*smoothstep(.22,.66,n);
      vec3 c=mix(paper,mix(lilac,blue,.4+.25*sin(palette)),a*.56);c=mix(c,mix(rose,mint,.42+.35*sin(palette+1.8)),b*.43);
      float centre=exp(-pow((uv.x-.5)*2.5,2.)-pow((uv.y-.53)*3.,2.));c=mix(c,paper,centre*.45);
      float contour=abs(sin((flow*1.5+z.x*.16-z.y*.18)*31.));float line=1.-smoothstep(.0,.047,contour);float edge=1.-centre*.86;c=mix(c,vec3(.68,.65,.77),line*edge*.14);
      float fine=hash(gl_FragCoord.xy+1.)-.5;c+=fine*.019;float sheen=exp(-d*d*10.)*k*.07;c+=vec3(.5,.45,.6)*sheen;gl_FragColor=vec4(c,1.);}`;
