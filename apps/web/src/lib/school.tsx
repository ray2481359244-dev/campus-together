import {createContext,useContext,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {SchoolDTO} from '@campus/contracts';
import {api} from './api';
import {useAuth} from './auth';

const SchoolContext=createContext({schoolId:'',setSchoolId:(_id:string)=>{},schools:[] as SchoolDTO[],schoolsLoading:true,schoolsError:null as Error|null,reloadSchools:()=>{}});
export const useSchool=()=>useContext(SchoolContext);
export function SchoolProvider({children}:{children:ReactNode}){
  const {user}=useAuth(),[schoolId,setSchoolId]=useState(''),previousUser=useRef<string|null|undefined>(null);
  const schools=useQuery({queryKey:['schools'],queryFn:()=>api<SchoolDTO[]>('/schools')});
  useEffect(()=>{
    if(!schools.data?.data.length)return;
    if(!schoolId||previousUser.current!==user?.id){setSchoolId(user?.school.id||schools.data.data[0].id);previousUser.current=user?.id;}
  },[schools.data,user?.id,user?.school.id,schoolId]);
  return <SchoolContext value={{schoolId,setSchoolId,schools:schools.data?.data||[],schoolsLoading:schools.isPending,schoolsError:schools.error,reloadSchools:()=>{void schools.refetch();}}}>{children}</SchoolContext>;
}
