import {createContext,useContext,useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {MotionConfig} from 'motion/react';
import {useSystemReducedMotion} from '../components/visual/useSystemReducedMotion';

const Preferences=createContext({motionEnabled:true,manualMotion:true,systemReduced:false,toggleMotion:()=>{}});
export function VisualPreferencesProvider({children}:{children:ReactNode}){
  const [manualMotion,setManualMotion]=useState(()=>{try{return localStorage.getItem('campus-motion')!=='off';}catch{return true;}});
  const systemReduced=useSystemReducedMotion(),motionEnabled=manualMotion&&!systemReduced;
  useEffect(()=>{document.documentElement.classList.toggle('motion-off',!motionEnabled);return()=>document.documentElement.classList.remove('motion-off');},[motionEnabled]);
  function toggleMotion(){setManualMotion(value=>{const next=!value;try{localStorage.setItem('campus-motion',next?'on':'off');}catch{/* Private browsing still supports the in-memory choice. */}return next;});}
  return <Preferences value={{motionEnabled,manualMotion,systemReduced,toggleMotion}}><MotionConfig reducedMotion={motionEnabled?'user':'always'}>{children}</MotionConfig></Preferences>;
}
export const useVisualPreferences=()=>useContext(Preferences);
export function MotionToggle(){
  const {motionEnabled,systemReduced,toggleMotion}=useVisualPreferences();
  return <button type="button" className="motion-toggle" aria-pressed={motionEnabled} onClick={toggleMotion} title={systemReduced?'遵循系统的减少动态效果设置':undefined}>{motionEnabled?'动效开启':'动效关闭'}</button>;
}
