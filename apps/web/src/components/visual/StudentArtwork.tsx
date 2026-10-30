import sprite from './assets/students.svg';
export type StudentKind='pink'|'violet'|'blue'|'green';
export type StudentPose='default'|'think'|'cheer'|'wave'|'seated';
export function StudentArtwork({kind='pink',pose='default',className=''}:{kind?:StudentKind;pose?:StudentPose;className?:string}){
  return <svg className={'student-artwork '+className} viewBox="0 0 200 240" aria-hidden="true"><use href={`${sprite}#student-${kind}-${pose}`}/></svg>;
}
export function StudentAvatar({seed='campus'}:{seed?:string}){
  const kinds:StudentKind[]=['pink','violet','blue','green'];let hash=0;for(const char of seed)hash=(hash*31+char.charCodeAt(0))>>>0;
  return <span className="student-avatar"><StudentArtwork kind={kinds[hash%4]}/></span>;
}
