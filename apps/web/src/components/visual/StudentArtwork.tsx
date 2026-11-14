import sprite from './assets/students.svg';
import { useState } from 'react';
export type StudentKind='pink'|'violet'|'blue'|'green';
export type StudentPose='default'|'think'|'cheer'|'wave'|'seated';
export function StudentArtwork({kind='pink',pose='default',className=''}:{kind?:StudentKind;pose?:StudentPose;className?:string}){
  return <svg className={'student-artwork '+className} viewBox="0 0 200 240" aria-hidden="true"><use href={`${sprite}#student-${kind}-${pose}`}/></svg>;
}
const avatarKinds: StudentKind[] = ['pink', 'violet', 'blue', 'green'];
export function StudentAvatar({ seed = 'campus', version }: { seed?: string; version?: number | null }) {
  const [unavailable, setUnavailable] = useState('');
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const kind = avatarKinds[hash % avatarKinds.length];
  const url = version ? `/api/v1/profiles/${seed}/avatar/${version}` : '';
  return <span className={'student-avatar avatar-' + kind} aria-hidden="true">
    {url && url !== unavailable ? <img key={url} src={url} alt="" onError={() => setUnavailable(url)} /> :
      <svg viewBox="10 8 180 180"><use href={`${sprite}#student-${kind}-default`} width="200" height="240" /></svg>}
  </span>;
}
