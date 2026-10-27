import { useRef, useState } from 'react';
import { api, ApiError, messageOf } from '../lib/api';
import { FormError } from './UI';
export function ImagePicker({ids,onChange,disabled,onBusyChange}:{ids:string[];onChange:(ids:string[])=>void;disabled:boolean;onBusyChange?:(busy:boolean)=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const attempt=useRef<{requestKey:string;base64:string}|null>(null);
  async function upload(file?:File) {
    if(busy||disabled)return;setBusy(true);onBusyChange?.(true);setError('');
    try {
      if(!attempt.current) {
        if(!file||file.size>5*1024*1024)throw new Error('每张图片最多 5MB。');
        const base64=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(new Error('读取图片失败。'));r.readAsDataURL(file);});
        attempt.current={requestKey:crypto.randomUUID(),base64};
      }
      const response=await api<{id:string}>('/media',{method:'POST',body:attempt.current});
      onChange([...new Set([...ids,response.data.id])]);attempt.current=null;
    } catch(e) {setError(messageOf(e));if(e instanceof ApiError && [400,422,429].includes(e.status))attempt.current=null;}
    finally {setBusy(false);onBusyChange?.(false);}
  }
  return <section><h3>讨论图片（{ids.length}/6）</h3><p className="form-note">JPEG、PNG、WebP，每张最多 5MB。上传后会重新编码并移除附带元数据。</p><div className="image-picker-list">{ids.map(id=><div key={id}><img src={'/api/v1/media/'+id} alt="待发布配图" /><button type="button" className="text-button" disabled={disabled||busy} onClick={()=>onChange(ids.filter(i=>i!==id))}>移除图片</button></div>)}</div>{ids.length<6&&!attempt.current&&<label>添加讨论图片<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled||busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file);}} /></label>}{busy&&<p role="status">正在处理图片……</p>}<FormError>{error}</FormError>{attempt.current&&error&&<button className="button secondary" type="button" disabled={busy||disabled} onClick={()=>void upload()}>核对并重试原图片上传</button>}</section>;
}
