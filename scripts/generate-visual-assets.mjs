import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {meetingScene,cloudPaths} from './design-assets/meeting.mjs';
import {character,students} from './design-assets/characters.mjs';
import {poses} from './design-assets/expressions.mjs';
const root = new URL('../apps/web/src/components/visual/',import.meta.url);
await mkdir(new URL('./assets/',root),{recursive:true});
const data = {
  COMPETITION:{name:'竞赛组队',note:'灵感发芽了',color:'#ddd0ff',kind:'violet',path:cloudPaths.competition},
  STUDY:{name:'学习搭子',note:'等等，我懂啦',color:'#cfe8fb',kind:'blue',path:cloudPaths.study},
  GAME:{name:'游戏开黑',note:'快乐加一位',color:'#fbefac',kind:'pink',path:cloudPaths.game},
  OUTDOOR:{name:'周末户外',note:'去收集风吧',color:'#d9edc5',kind:'green',path:cloudPaths.outdoor}
};
await writeFile(new URL('categories.ts',root),`// Values intentionally match @campus/contracts Category.\nexport const categories = ${JSON.stringify(data,null,2)} as const;\nexport type InterestCategory = keyof typeof categories;\nexport const categoryOrder = Object.keys(categories) as InterestCategory[];\n`);
const svg=meetingScene().replace(/class="([^"]*)"/g,(_,value)=>`className="${value.split(' ').map(name=>'ct-'+name).join(' ')}"`)
  .replace('className="ct-meeting-illustration"','ref={svgRef} className="ct-meeting-illustration"')
  .replaceAll('stroke-width=','strokeWidth=').replaceAll('stroke-linecap=','strokeLinecap=').replaceAll('stroke-linejoin=','strokeLinejoin=');
await writeFile(new URL('MeetingScene.tsx',root),`// Generated from the verified original vector source; run prepare-integration.mjs after editing artwork.
import {useEffect,useRef} from 'react';
import {useSystemReducedMotion} from './useSystemReducedMotion';
import {categories} from './categories';
import type {InterestCategory} from './categories';
export function MeetingScene({activeCategory=null,motionEnabled=true}:{activeCategory?:InterestCategory|null;motionEnabled?:boolean}) {
  const svgRef=useRef<SVGSVGElement>(null), reduce=useSystemReducedMotion();
  useEffect(()=>{
    if(!activeCategory||!motionEnabled||reduce)return;
    const kind=categories[activeCategory].kind;
    const nodes=svgRef.current?.querySelectorAll<SVGGElement>('.ct-person-'+kind+' .ct-person-bob');
    const direction=activeCategory==='STUDY'||activeCategory==='OUTDOOR'?1:-1;
    const frames=[{transform:'translateY(0) rotate(0)'},{transform:'translateY(-4px) rotate('+direction*2+'deg)',offset:.4},{transform:'translateY(0) rotate(0)'}];
    const animations=Array.from(nodes||[]).map(node=>node.animate(frames,{duration:720,easing:'cubic-bezier(.2,.8,.2,1)'}));
    return ()=>animations.forEach(animation=>animation.cancel());
  },[activeCategory,motionEnabled,reduce]);
  return (${svg});
}
`);
await writeFile(new URL('./assets/meeting-scene.svg',root),meetingScene());
const symbols=students.flatMap(kind=>poses.map(pose=>`<symbol id="student-${kind}-${pose}" viewBox="0 0 200 240">${character(kind,'student-art',pose).replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'')}</symbol>`)).join('');
await writeFile(new URL('./assets/students.svg',root),`<svg xmlns="http://www.w3.org/2000/svg"><style>.pupils{transform:translate(var(--eye-x,0px),var(--eye-y,0px))}</style><defs>${symbols}</defs></svg>`);
console.log('Prepared typed category data, inline React illustration and licensed font assets.');
